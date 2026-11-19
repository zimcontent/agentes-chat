import type { PubSub } from "@dougbot/adapters";
import { and, type Database, eq, inArray, isNull, schema, sql } from "@dougbot/db";
import { serverText } from "@dougbot/i18n";
import type { AppLocale } from "@dougbot/i18n/locale";
import { fileRefOf } from "../artifacts";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import { publishAgentsChanged } from "../events";
import { requirePermission } from "../organizations";
import { personLocale } from "../requester";
import { untrustedBlock } from "../untrusted";

const { agentSkills, agents, organizationSettings, organizations, skills } = schema;

/**
 * "Sua marca" (docs/adr/doug-0030-time-doug.md): the onboarding step that follows the Doug team, required there. What
 * the person says of the company becomes the workspace skill "Marca <empresa>" (`marca`), written in the sections the
 * agents that read a brand look for (ROSA, SONY, SOCIAL MEDIA, CHESS), and given to them.
 */
export const BRAND_SKILL = "marca";

/** The tones to tap; the person may also write their own. Their words: `dougTeam.brand.tones.<id>`. */
export const BRAND_TONES = [
  "proximo",
  "profissional",
  "divertido",
  "inspirador",
  "direto",
  "acolhedor",
  "tecnico",
  "sofisticado",
  "ousado",
  "educativo",
] as const;
export type BrandTone = (typeof BRAND_TONES)[number];

/** The Doug team's templates that read the brand skill. */
export const BRAND_READERS = ["rosa", "sony", "social-media", "chess"] as const;

export interface BrandInput {
  company: string;
  tones?: string[];
  /** The tone in the person's own words. */
  tone?: string | null;
  site?: string | null;
  instagram?: string | null;
  audience?: string | null;
  /** Files of the brand manual, uploaded to the Drive first (their ids). */
  files?: string[];
  /** Links to the brand manual (a shared folder, a page). */
  links?: string[];
}

/** What was said, as the step shows it back. */
export interface BrandView {
  company: string;
  tones: BrandTone[];
  tone: string | null;
  site: string | null;
  instagram: string | null;
  audience: string | null;
  files: { id: string; title: string }[];
  links: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** An address as people type it ("acme.com.br"), with its scheme; refused when it isn't one. */
function webAddress(raw: string, field: string) {
  const text = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(text);
    if (!u.hostname.includes(".")) throw new Error("no host");
    return u.toString();
  } catch {
    throw new ValidationError(`${field}: not a web address`, "brand.invalid_link", { field });
  }
}

/** "@acme", "acme" or its profile's address → `@acme`. */
function instagramHandle(raw: string) {
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i.exec(raw);
  const handle = (m?.[1] ?? raw).replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    throw new ValidationError("instagram: not a profile", "brand.invalid_instagram");
  }
  return `@${handle}`;
}

/**
 * A free-text field as the skill keeps it: its line breaks collapsed to spaces (a newline could open a heading or a
 * list in the Markdown the agents read, or read as an instruction of its own). It is still the person's text; the body
 * puts it inside `untrustedBlock`, which neutralises what could pass for an instruction.
 */
const oneLine = (v: string, max: number) =>
  v
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);

/** The input checked: the company's name and a tone (tapped or written) are required. */
export function checkBrand(input: BrandInput) {
  // The name is a heading and a line of the body: one line, no heading of its own.
  const company = oneLine(str(input.company), 120);
  if (!company) throw new ValidationError("Say the company's name", "brand.company_required");
  const tones = [...new Set(input.tones ?? [])];
  const unknown = tones.filter((t) => !(BRAND_TONES as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new ValidationError(`No tone ${unknown.join(", ")}`, "brand.unknown_tone", { tones: unknown });
  }
  const tone = oneLine(str(input.tone), 2_000) || null;
  if (tones.length === 0 && !tone) throw new ValidationError("Pick or write the tone of voice", "brand.tone_required");
  const site = str(input.site) ? webAddress(str(input.site), "site") : null;
  const instagram = str(input.instagram) ? instagramHandle(str(input.instagram)) : null;
  const audience = oneLine(str(input.audience), 2_000) || null;
  const links = [...new Set((input.links ?? []).map(str).filter(Boolean))]
    .slice(0, 20)
    .map((l) => webAddress(l, "links"));
  const files = [...new Set((input.files ?? []).map(str).filter(Boolean))].slice(0, 20);
  return { company, tones: tones as BrandTone[], tone, site, instagram, audience, links, files };
}

const or = (v: string | null, missing: string) => v ?? `A definir: ${missing}.`;

/**
 * The skill's body in Brazilian Portuguese, the language the agents' instructions are in: the sections they read
 * before any piece (what the company is, audience, voice, visual identity, networks and formats, compliance, the
 * manual), what wasn't said yet marked "A definir", which they ask for or propose instead of inventing.
 */
export function brandBody(b: BrandView) {
  const tones = b.tones.map((t) => serverText("pt-BR", `dougTeam.brand.tones.${t}`).toLowerCase());
  // The person's own words, inside an envelope the agents weigh as data, never as instructions of the skill itself.
  const voice = [tones.length ? `Tons: ${tones.join(", ")}.` : "", b.tone ? untrustedBlock("tom de voz", b.tone) : ""]
    .filter(Boolean)
    .join("\n\n");
  const audience = b.audience
    ? untrustedBlock("público", b.audience)
    : or(null, "para quem a marca fala (quem é, o que busca, o que a faz desistir)");
  return [
    `# Marca ${b.company}`,
    `Esta é a skill de marca de ${b.company}. Leia inteira antes de qualquer peça, legenda, roteiro, vídeo ou estratégia desta marca: ela manda sobre qualquer regra geral. O que estiver "A definir" você não inventa: pergunte a quem pediu ou proponha um rascunho para a pessoa responsável aprovar, e a resposta aprovada vira regra aqui.`,
    "## A empresa",
    `- Nome: ${b.company}`,
    `- Site: ${or(b.site, "o site da empresa")}`,
    `- O que faz e o que ela NÃO é: ${b.site ? "leia no site antes da primeira peça e proponha o resumo para aprovação" : "A definir"}.`,
    "## Público",
    audience,
    "## Tom de voz",
    voice,
    "- Vocabulário que a marca usa: A definir.",
    "- Vocabulário que a marca evita e o que nunca diz: A definir.",
    "- Idioma de publicação: português do Brasil, salvo pedido em contrário.",
    "## Identidade visual",
    "- Cores (com hex), fontes e seus papéis, logo e onde ele vai, grid, tom de foto, o que pode e o que não pode: A definir. Tire do manual de marca abaixo e das peças publicadas; meça as cores nas peças reais.",
    "- Encerramento padrão (logo animado, frase da marca) e assinatura: A definir.",
    "- Modelos aprovados e referências: A definir. Toda peça aprovada vira referência aqui.",
    "## Vídeo: som, trilha e níveis",
    "- Trilha e efeitos aprovados e o nível de referência: A definir. Uma vez aprovado, o nível desta marca vale para todo vídeo dela.",
    "- Glossário de grafia (nomes, produtos, termos que nunca se traduzem): A definir.",
    "## Redes e formatos",
    `- Instagram: ${b.instagram ?? "A definir"}`,
    "- Cadência, horários, hashtags, assinatura e CTA padrão: A definir.",
    "- Limites de formato (lâminas de carrossel, duração de vídeo, proporção): A definir.",
    "## Pilares de conteúdo",
    "A definir: os temas que a marca sustenta. Proponha a partir do site, do perfil e do que a pessoa contar.",
    "## Compliance e o que não citar",
    "A definir: regras do setor, alegações proibidas, nomes e assuntos que a marca não cita.",
    "## Manual de marca",
    b.files.length || b.links.length
      ? [
          // A file's title is the person's text (a file they uploaded): one line, kept as data.
          ...b.files.map(
            (f) => `- Arquivo no Drive: ${untrustedBlock("título do arquivo", oneLine(f.title, 200))} (id ${f.id})`,
          ),
          ...b.links.map((l) => `- Link: ${l}`),
        ].join("\n")
      : "Nenhum arquivo ainda. Peça o manual, os logos sem fundo, as fontes e 15 a 30 peças publicadas.",
  ].join("\n\n");
}

/**
 * The brand skill as saved, whether this workspace still waits for it, and the skill a `marca` of another origin
 * already holds there. The brand is the skill marked `metadata.brand` (not a slug someone else may hold): a `marca`
 * another origin made stays as it is, and the brand is written under another slug.
 */
async function brandSkillRow(db: Database, orgId: string) {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, BRAND_SKILL), isNull(skills.ownerUserId)));
  const live = rows.find((r) => !r.deletedAt) ?? null;
  // The one that is the brand: marked, and not deleted.
  if (live && (live.metadata as { brand?: unknown }).brand === true) return { row: live, live, other: null };
  // A live `marca` of another origin: the brand picks another slug, never overwriting it.
  if (live) return { row: null, live: null, other: live };
  // A deleted one: it comes back with the brand if it was the brand; else it stays deleted, and it still holds the
  // slug (`skills_team_slug` is one per name), so the brand is written under another (`marca-2`).
  const back = rows.find((r) => r.deletedAt && (r.metadata as { brand?: unknown }).brand === true);
  if (back) return { row: back, live: null, other: null };
  const gone = rows.find((r) => r.deletedAt) ?? null;
  if (gone) return { row: null, live: null, other: gone };
  return { row: null, live: null, other: null };
}

/**
 * Gives the brand that already exists to the readers a workspace just gained (docs/adr/doug-0030-time-doug.md): a
 * team made again after Desfazer kept the brand skill (Desfazer removes only what the card made), so the new ROSA,
 * SONY, SOCIAL MEDIA and CHESS read it from the first piece. A no-op where there is no brand.
 */
export async function giveBrandToReaders(db: Database, orgId: string, byTemplate: Record<string, string>) {
  const { live } = await brandSkillRow(db, orgId);
  if (!live) return;
  const readers = BRAND_READERS.flatMap((h) => (byTemplate[h] ? [byTemplate[h]] : []));
  if (readers.length === 0) return;
  const here = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), inArray(agents.id, readers), isNull(agents.archivedAt)));
  if (here.length === 0) return;
  await db
    .insert(agentSkills)
    .values(here.map((a) => ({ orgId, agentId: a.id, skillId: live.id, enabled: true })))
    .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
}

/**
 * Whether the onboarding's brand step is pending here: the Doug team was made during the onboarding and no brand
 * skill was saved. A workspace already set up never waits for it.
 */
export async function brandPending(db: Database, orgId: string) {
  return (await brandPendingIn(db, [orgId])).has(orgId);
}

/**
 * Whether the workspace has the Doug team and no brand yet, as the right hand's prompt reads it
 * (docs/adr/doug-0030-time-doug.md): a team made (`doug_team`), and no skill marked `metadata.brand`. It is the
 * prompt's own question, so it stays true after the onboarding is over (`brandPending` means "the onboarding still
 * waits"): a workspace that got its team and took no brand keeps being asked for it in the DOUG's DM.
 */
export async function brandMissing(db: Database, orgId: string) {
  const [row] = await db
    .select({ dougTeam: organizationSettings.dougTeam })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  if (!row?.dougTeam) return false;
  const [brand] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(
      and(
        eq(skills.orgId, orgId),
        isNull(skills.ownerUserId),
        isNull(skills.deletedAt),
        sql`${skills.metadata}->>'brand' = 'true'`,
      ),
    )
    .limit(1);
  return !brand;
}

/** `brandPending` for several workspaces at once (`GET /me`). */
export async function brandPendingIn(db: Database, orgIds: readonly string[]) {
  if (orgIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ orgId: organizations.id })
    .from(organizations)
    .innerJoin(organizationSettings, eq(organizationSettings.orgId, organizations.id))
    .where(
      and(
        inArray(organizations.id, [...orgIds]),
        isNull(organizations.onboardedAt),
        sql`${organizationSettings.dougTeam} is not null`,
        // No brand skill yet: the one marked `metadata.brand`, whatever slug it holds (a `marca` of another origin
        // doesn't count as the brand).
        sql`not exists (select 1 from ${skills} s where s.org_id = ${organizations.id}
          and s.owner_user_id is null and s.deleted_at is null and s.metadata->>'brand' = 'true')`,
      ),
    );
  return new Set(rows.map((r) => r.orgId));
}

const viewOf = (meta: Record<string, unknown> | null | undefined): BrandView | null => {
  // The brand's own data is under `data` (`brand: true` is the mark that says this skill is the brand).
  const b = (meta?.data ?? null) as BrandView | null;
  return b && typeof b.company === "string" ? b : null;
};

/** `GET …/brand`: the brand as said, the tones to tap in the person's language, and whether the step waits for it. */
export async function getBrand(db: Database, userId: string, orgId: string, preferred?: string | null) {
  await requirePermission(db, userId, orgId, "read");
  const [{ live }, pending, locale] = await Promise.all([
    brandSkillRow(db, orgId),
    brandPending(db, orgId),
    personLocale(db, userId, preferred),
  ]);
  return {
    pending,
    brand: live ? viewOf(live.metadata) : null,
    skillId: live?.id ?? null,
    tones: BRAND_TONES.map((id) => ({ id, label: serverText(locale as AppLocale, `dougTeam.brand.tones.${id}`) })),
  };
}

/**
 * `PUT …/brand` (who manages agents, as for any workspace skill): creates or rewrites the skill "Marca <empresa>"
 * (`marca`, a new version each time), with what was said kept in its metadata for the step to show back, and gives it
 * to the Doug team's agents that read a brand. The files are the Drive's, readable by whoever saves it.
 */
export async function saveBrand(
  deps: { db: Database; pubsub?: PubSub },
  userId: string,
  orgId: string,
  input: BrandInput,
) {
  await requirePermission(deps.db, userId, orgId, "manage_agents");
  const b = checkBrand(input);
  const files: BrandView["files"] = [];
  for (const id of b.files) {
    const ref = await fileRefOf(deps.db, userId, orgId, id).catch(() => null);
    if (!ref) throw new ValidationError("A file of the manual isn't in your Drive", "brand.file_missing", { id });
    files.push({ id: ref.id, title: ref.title });
  }
  const brand: BrandView = { ...b, files };
  const { row: had, other } = await brandSkillRow(deps.db, orgId);
  // A `marca` another origin made stays as it is: the brand is written under another slug (a free `marca-2`).
  const slug = had ? had.slug : other ? await freeBrandSlug(deps.db, orgId) : BRAND_SKILL;
  const values = {
    description: `Marca ${b.company}: o que a empresa é, público, tom de voz, identidade visual, redes e o manual. Leia antes de qualquer peça, legenda, roteiro, vídeo ou estratégia desta marca.`,
    body: brandBody(brand),
    // Marked as the brand (`metadata.brand`), so a `marca` of another origin is never mistaken for it.
    metadata: { title: `Marca ${b.company}`, brand: true, data: brand },
    source: "manual" as const,
  };
  const skillId = await deps.db.transaction(async (raw) => {
    const tx = raw as unknown as Database;
    const [row] = had
      ? await tx
          .update(skills)
          .set({
            ...values,
            slug,
            name: slug,
            deletedAt: null,
            version: sql`${skills.version} + 1`,
            editedSinceSource: false,
            updatedAt: new Date(),
          })
          .where(eq(skills.id, had.id))
          .returning({ id: skills.id })
      : await tx
          .insert(skills)
          .values({ orgId, slug, name: slug, ...values, createdByUserId: userId })
          .returning({ id: skills.id });
    if (!row) throw new Error("brand skill write returned nothing");
    const [settings] = await tx
      .select({ dougTeam: organizationSettings.dougTeam })
      .from(organizationSettings)
      .where(eq(organizationSettings.orgId, orgId));
    const readers = BRAND_READERS.flatMap((h) => {
      const id = settings?.dougTeam?.agents[h];
      return id ? [id] : [];
    });
    const live = readers.length
      ? await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.orgId, orgId), inArray(agents.id, readers), isNull(agents.archivedAt)))
      : [];
    if (live.length > 0)
      await tx
        .insert(agentSkills)
        .values(live.map((a) => ({ orgId, agentId: a.id, skillId: row.id, enabled: true })))
        .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: userId },
      action: had && !had.deletedAt ? "skill.updated" : had ? "skill.restored" : "skill.created",
      target: { type: "skill", id: row.id },
      details: { name: slug, via: "brand" },
    });
    return row.id;
  });
  if (deps.pubsub) await publishAgentsChanged(deps.pubsub, orgId);
  return { skillId, brand, pending: await brandPending(deps.db, orgId) };
}

/** A free slug for the brand where another origin holds `marca`: `marca-2`, `marca-3`… */
async function freeBrandSlug(db: Database, orgId: string) {
  const taken = new Set(
    (
      await db
        .select({ slug: skills.slug })
        .from(skills)
        .where(and(eq(skills.orgId, orgId), isNull(skills.ownerUserId), sql`${skills.slug} like ${`${BRAND_SKILL}%`}`))
    ).map((r) => r.slug),
  );
  let slug = BRAND_SKILL;
  for (let n = 2; taken.has(slug); n++) slug = `${BRAND_SKILL}-${n}`;
  return slug;
}
