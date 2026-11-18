import {
  type BrandToneWord,
  channelsQuery,
  type DougTemplateMember,
  keys,
  routinesQuery,
  type TeamTemplate,
  useApi,
} from "@agenteschat/client";
import { joinNames } from "@agenteschat/client/lib/format";
import { teamFailureText } from "@agenteschat/client/lib/team-plan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from "react-native";
import { AgentAvatar, Button, Chip, Icon, Locked, SkeletonList, Text } from "@/ui";
import { AuthField } from "@/ui/auth/AuthField";
import { CENTER } from "@/ui/auth/AuthScaffold";
import { ChoiceChip } from "../right-hand/TeamCard";
import { useColors } from "../shared/hooks";
import { tapHaptic } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import {
  type BrandForm,
  brandFormOf,
  brandInput,
  brandReady,
  computerMembers,
  countText,
  DOUG_TEMPLATE,
  hasAgents,
  keptHandles,
  memberTree,
  newMembers,
  phaseAfter,
  rightHandMember,
  roleLine,
  stepFailedText,
  TEAM_STARTS,
  type TeamStart,
  toggled,
} from "./logic";

/*
 * The onboarding's Doug team screens (docs/adr/doug-0020-time-doug.md), the phone's own drawing of the web's steps:
 * how to start the team (the Doug team first, already picked), who joins it (every agent checked, the Doug fixed) and,
 * once it is made, the brand the whole team reads. Plain borders and fills only: no shadows on a repeated row.
 */

/** The faces on the Doug card: the first agents of the template, one row, never over each other. */
const FACES = 8;
/** The members the manager's HQ shows before "+N" opens the rest. */
const HQ_PEEK = 3;

/** The Doug team, made as the person checked it: the agents' list is read again before the step moves on. */
export function useDougTeam(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ handles, locale }: { handles: readonly string[]; locale?: string }) =>
      api.agents.applyTeamTemplate(orgId, DOUG_TEMPLATE, locale, handles),
    onSuccess: async ({ channelId, state }) => {
      void qc.invalidateQueries({ queryKey: keys.messages(orgId, channelId) });
      if (state !== "created") return;
      await Promise.all([
        qc.prefetchQuery({ ...routinesQuery(api, orgId), staleTime: 0 }),
        qc.prefetchQuery({ ...channelsQuery(api, orgId), staleTime: 0 }),
      ]);
      // The workspace says its brand waits before the team shows, so the opening never runs ahead of it.
      await qc.invalidateQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.agents(orgId) });
    },
    // A request that failed after the server made the team (the answer lost on the way back) leaves the workspace
    // changed: the two asks the success reads again are read again here too, so a retry sees the team and the brand.
    onError: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.agents(orgId) }),
      ]);
    },
  });
}

/** A round radio, the card's mark. */
function Radio({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.radio, { borderColor: on ? c.green : c.lineStrong }]}>
      {on ? <View style={[styles.radioDot, { backgroundColor: c.green }]} /> : null}
    </View>
  );
}

/** A square check: the agent's place in the team. */
function Check({ on, fixed = false }: { on: boolean; fixed?: boolean }) {
  const c = useColors();
  return (
    <View
      style={[
        styles.check,
        on ? { backgroundColor: fixed ? c.line2 : c.green, borderColor: fixed ? c.line2 : c.green } : null,
        !on ? { borderColor: c.lineStrong } : null,
      ]}
    >
      {on ? <Icon name="check" size={14} color={fixed ? c.muted : c.greenInk} /> : null}
    </View>
  );
}

/** One way to start: a radio, its words and, on the Doug's, the bots' faces. */
function StartCard({
  on,
  title,
  text,
  badge,
  faces,
  onPress,
}: {
  on: boolean;
  title: string;
  text: string;
  badge?: string;
  faces?: readonly DougTemplateMember[];
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${title}. ${text}`}
      style={[
        styles.card,
        { backgroundColor: on ? c.chosen : c.raised, borderColor: on ? c.green : c.line2 },
        on ? styles.cardOn : null,
      ]}
    >
      <Radio on={on} />
      <View style={styles.grow}>
        <View style={styles.titleLine}>
          <Text variant="body" style={[styles.bold, styles.grow]}>
            {title}
          </Text>
          {badge ? <Chip label={badge} /> : null}
        </View>
        <Text variant="small" tone="muted">
          {text}
        </Text>
        {faces && faces.length > 0 ? (
          <View style={styles.faces}>
            {faces.slice(0, FACES).map((m) => (
              <AgentAvatar
                key={m.handle}
                agent={{ color: "sky", eyes: "round", id: m.handle, name: m.name, handle: m.handle, role: m.role }}
                size={30}
                live={false}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * "Como você quer começar o time?": the Doug team (picked, "Recomendado"), another ready-made model, or nothing but the
 * Doug. The button says what comes next.
 */
export function StartStep({
  doug,
  start,
  onStart,
  onNext,
  leaving,
}: {
  doug: TeamTemplate & { members: DougTemplateMember[] };
  start: TeamStart;
  onStart: (start: TeamStart) => void;
  onNext: () => void;
  leaving: boolean;
}) {
  const { t } = useTranslation();
  const next = phaseAfter(start);
  return (
    <>
      <Locked when={leaving} style={styles.stack}>
        <View style={styles.stack} accessibilityRole="radiogroup">
          {TEAM_STARTS.map((s) => (
            <StartCard
              key={s}
              on={start === s}
              title={s === "doug" ? doug.name : t(`mobile.dougOnb.${s}Title`)}
              text={s === "doug" ? doug.description : t(`mobile.dougOnb.${s}Text`)}
              {...(s === "doug" ? { badge: t("mobile.dougOnb.recommended"), faces: doug.members } : {})}
              onPress={() => onStart(s)}
            />
          ))}
        </View>
      </Locked>
      <View style={styles.action}>
        <Button
          variant="primary"
          wide
          label={t(
            next === "members"
              ? "mobile.dougOnb.pickMembers"
              : next === "other"
                ? "mobile.dougOnb.pickModel"
                : "mobile.dougOnb.startAlone",
          )}
          loading={leaving}
          onPress={onNext}
        />
      </View>
    </>
  );
}

/** One agent of the list: its check, its bot, its name and what it is; the right hand's check is fixed. */
function MemberRow({
  m,
  on,
  small = false,
  onToggle,
}: {
  m: DougTemplateMember;
  on: boolean;
  small?: boolean;
  onToggle: (handle: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const line = roleLine(m);
  return (
    <Pressable
      disabled={m.rightHand}
      onPress={() => {
        tapHaptic();
        onToggle(m.handle);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: m.rightHand }}
      accessibilityLabel={m.rightHand ? t("mobile.dougOnb.fixedA11y", { name: m.name }) : m.name}
      accessibilityHint={m.rightHand ? undefined : t("mobile.dougOnb.toggleHint", { name: m.name })}
      style={small ? styles.under : [styles.member, { backgroundColor: c.raised, borderColor: c.line2 }]}
    >
      <Check on={on} fixed={m.rightHand} />
      <AgentAvatar
        agent={{ color: "sky", eyes: "round", id: m.handle, name: m.name, handle: m.handle, role: m.role }}
        size={small ? 28 : 40}
        live={false}
      />
      <View style={styles.grow}>
        <Text variant={small ? "small" : "subhead"} style={styles.bold} numberOfLines={1}>
          {m.name}
        </Text>
        {/* Its role only when it says more than its name: a "Copywriter" named after its role said it twice. */}
        {line ? (
          <Text variant="footnote" tone="muted" numberOfLines={small ? 1 : 2}>
            {line}
          </Text>
        ) : null}
        {/* Its own line, as the computer's is, rather than a third "·" on the role's: a chain reads dense. */}
        {m.rightHand && !small ? (
          <View style={styles.tag}>
            <Icon name="lock" size={12} color={c.muted} />
            <Text variant="caption" tone="muted">
              {t("mobile.dougOnb.fixed")}
            </Text>
          </View>
        ) : null}
        {m.needsComputer && on && !small ? (
          <View style={styles.tag}>
            <Icon name="server" size={12} color={c.muted} />
            <Text variant="caption" tone="muted">
              {t("mobile.dougOnb.usesComputer")}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * "Quem entra no seu time?": every agent checked, the Doug fixed, the manager's HQ under it (three shown, "+N" opens
 * the rest) with each one's own check. Agents that work on a computer say so, with the way to connect one.
 */
export function MembersStep({
  doug,
  unchecked,
  onToggle,
  wantsComputer,
  onWantsComputer,
  failed,
  creating,
  onCreate,
}: {
  doug: TeamTemplate & { members: DougTemplateMember[] };
  unchecked: ReadonlySet<string>;
  onToggle: (handle: string) => void;
  wantsComputer: boolean;
  onWantsComputer: (wants: boolean) => void;
  failed: string | null;
  creating: boolean;
  onCreate: (handles: string[]) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { top, under } = memberTree(doug.members);
  const kept = keptHandles(doug.members, unchecked);
  const computers = computerMembers(doug.members, kept);
  const adding = newMembers(doug.members, kept).length;
  const rightHand = rightHandMember(doug.members);
  const count = countText(t, adding, rightHand?.name ?? null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const ready = hasAgents(doug.members, kept);
  // A count that changes and a failure are said aloud on iOS: the line is quiet type, and VoiceOver reads a change
  // here only when told. `accessibilityLiveRegion` is Android's; there has to be an announcement of its own.
  const said = useRef({ count, failed });
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (said.current.count !== count) AccessibilityInfo.announceForAccessibility(count);
    said.current.count = count;
  }, [count]);
  useEffect(() => {
    if (!failed) {
      // A failure that comes back with the same words is said again.
      said.current.failed = null;
      return;
    }
    if (Platform.OS !== "ios" || said.current.failed === failed) return;
    AccessibilityInfo.announceForAccessibility(failed);
    said.current.failed = failed;
  }, [failed]);
  return (
    <>
      <Locked when={creating} style={styles.stack}>
        <Text variant="footnote" tone="faint" style={styles.count} accessibilityLiveRegion="polite">
          {count}
        </Text>
        <View style={styles.stack}>
          {top.map((m) => {
            const reports = under.get(m.handle) ?? [];
            const shown = open.has(m.handle) ? reports : reports.slice(0, HQ_PEEK);
            return (
              <View key={m.handle} style={styles.group}>
                <MemberRow m={m} on={m.rightHand || !unchecked.has(m.handle)} onToggle={onToggle} />
                {reports.length > 0 ? (
                  <View style={[styles.reports, { borderLeftColor: c.green }]}>
                    {shown.map((r) => (
                      <MemberRow key={r.handle} m={r} small on={!unchecked.has(r.handle)} onToggle={onToggle} />
                    ))}
                    {reports.length > HQ_PEEK ? (
                      <Pressable
                        onPress={() => setOpen((s) => toggled(s, m.handle))}
                        accessibilityRole="button"
                        // A 32-point line: 8 of slop around it reaches past the 44-point target.
                        hitSlop={8}
                        style={styles.more}
                      >
                        <Text variant="footnote" tone="muted">
                          {open.has(m.handle)
                            ? t("mobile.dougOnb.less")
                            : t("mobile.dougOnb.more", { n: reports.length - HQ_PEEK })}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        {computers.length > 0 ? (
          <View style={[styles.notice, { borderColor: c.line2, backgroundColor: c.raised }]}>
            <Icon name="server" size={18} color={c.muted} />
            <View style={styles.grow}>
              <Text variant="small" tone="ink2">
                {t("mobile.dougOnb.computerText", {
                  names: joinNames(
                    computers.map((m) => m.name),
                    t,
                  ),
                })}
              </Text>
              {wantsComputer ? (
                <>
                  <Text variant="footnote" tone="muted" style={styles.noticeLine}>
                    {t("mobile.dougOnb.computerLater")}
                  </Text>
                  {/* A 32-point text button has no plate to grow: it sits in a 44-point row instead. */}
                  <View style={styles.skipRow}>
                    <Button
                      variant="text"
                      size="sm"
                      label={t("mobile.dougOnb.computerSkip")}
                      onPress={() => onWantsComputer(false)}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.noticeLine}>
                  <Button
                    variant="secondary"
                    size="sm"
                    label={t("mobile.dougOnb.computerButton")}
                    onPress={() => onWantsComputer(true)}
                  />
                </View>
              )}
            </View>
          </View>
        ) : null}
      </Locked>
      {ready ? null : (
        <Text variant="small" tone="muted" style={CENTER}>
          {t("mobile.dougOnb.needOne")}
        </Text>
      )}
      {failed ? (
        <Text variant="small" tone="danger" accessibilityRole="alert" style={CENTER}>
          {failed}
        </Text>
      ) : null}
      <View style={styles.action}>
        <Button
          variant="primary"
          wide
          label={t(failed ? "teamPlan.card.retry" : "mobile.dougOnb.create")}
          loading={creating}
          disabled={!ready}
          onPress={() => onCreate(kept)}
        />
      </View>
    </>
  );
}

/** The reason a Doug team that was made with a step failed, or the request's own. */
export const dougFailure = (
  t: Parameters<typeof teamFailureText>[0],
  out: { state: string; error?: Parameters<typeof teamFailureText>[1] | null },
  locale: string,
) => (out.state !== "created" && out.error ? teamFailureText(t, out.error, locale) : null);

/** The brand the workspace has, and the tones to tap. */
function useBrandForm(orgId: string, locale: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["org", orgId, "brand", locale] as const,
    queryFn: () => api.orgs.brand(orgId, locale),
    staleTime: 0,
  });
}

/** A tone chip row: the words to tap, several at once. */
function Tones({
  tones,
  picked,
  onToggle,
}: {
  tones: readonly BrandToneWord[];
  picked: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.tones}>
      {tones.map((x) => (
        <ChoiceChip key={x.id} label={x.label} on={picked.includes(x.id)} onPress={() => onToggle(x.id)} />
      ))}
    </View>
  );
}

/** A labelled field of the brand's form. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.labelled}>
      <Text variant="label" tone="ink2">
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * "Ensine a sua marca ao time", required once the Doug team was chosen: the company's name and a tone of voice (tapped,
 * written or both) first, then what the agents may use when they have it: Instagram, the site, who the company sells
 * to and the brand manual (a file from the phone, or a link). It saves as one skill the agents read (`PUT …/brand`).
 * What was typed lives in the step above (`form`/`onForm`): going back to the team and forward again keeps it.
 */
/** The brand's form as the step above keeps it: a value, or an update read from what it holds now (two quick taps). */
export type BrandFormOf = (update: BrandForm | ((form: BrandForm) => BrandForm)) => void;

export function BrandStep({
  orgId,
  company,
  form,
  onForm,
  seed,
  onSaved,
  onBusy,
}: {
  orgId: string;
  company: string;
  form: BrandForm;
  onForm: BrandFormOf;
  /** Nothing was typed yet (the step above holds no form): what an earlier visit saved fills it. */
  seed: boolean;
  onSaved: () => void;
  /** Told while a save or an upload runs: the step above turns Back off then, so nothing leaves mid-request. */
  onBusy?: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const c = useColors();
  const brand = useBrandForm(orgId, i18n.language);
  const seeded = useRef(false);
  // What an earlier visit saved fills the form once, and only while nothing was typed here: a form the step above
  // already holds (a back and forward) is never overwritten.
  useEffect(() => {
    if (seeded.current || !seed || !brand.data) return;
    seeded.current = true;
    if (brand.data.brand) onForm(brandFormOf(brand.data.brand, company));
  }, [seed, brand.data, company, onForm]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof BrandForm>(key: K, value: BrandForm[K]) => {
    onForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };
  const save = useMutation({
    mutationFn: async () => {
      await api.orgs.saveBrand(orgId, brandInput(form));
      // The workspace stops waiting for it: the onboarding moves on once `me` says so.
      await qc.invalidateQueries({ queryKey: keys.me });
    },
    onSuccess: onSaved,
    onError: (e) => setError(stepFailedText(t, e, i18n.language)),
  });
  const attach = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (res.canceled) return;
    setUploading(true);
    setError(null);
    // Each file lands in the form as it is uploaded: a later one failing keeps the earlier ones.
    for (const a of res.assets) {
      // React Native's FormData sends `{ uri, name, type }` as a file part, as the Drive's upload does.
      const file = { uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream" };
      try {
        const saved = await api.artifacts.upload(orgId, file as unknown as Parameters<typeof api.artifacts.upload>[1]);
        onForm((f) => ({ ...f, files: [...f.files, { id: saved.id, title: saved.title }] }));
      } catch (e) {
        setError(stepFailedText(t, e, i18n.language));
        break;
      }
    }
    setUploading(false);
  };
  const busy = save.isPending || uploading;
  // The step above turns Back off while a request runs, and on again when it ends.
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  if (brand.isPending)
    return (
      <View style={styles.stack}>
        <SkeletonList rows={4} />
      </View>
    );
  if (brand.isError)
    return (
      <View style={styles.center}>
        <Text variant="small" tone="danger" style={CENTER}>
          {t("common.loadFailed")}
        </Text>
        <View style={styles.skipRow}>
          <Button variant="text" size="sm" label={t("mobile.common.retry")} onPress={() => void brand.refetch()} />
        </View>
      </View>
    );
  return (
    <>
      <Locked when={busy} keepKeyboard style={styles.fields}>
        <Labelled label={t("mobile.dougOnb.company")}>
          <AuthField
            value={form.company}
            onChangeText={(v) => set("company", v)}
            accessibilityLabel={t("mobile.dougOnb.company")}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
          />
        </Labelled>
        <Labelled label={t("mobile.dougOnb.tone")}>
          <Tones
            tones={brand.data.tones}
            picked={form.tones}
            onToggle={(id) =>
              set("tones", form.tones.includes(id) ? form.tones.filter((x) => x !== id) : [...form.tones, id])
            }
          />
          <AuthField
            value={form.tone}
            onChangeText={(v) => set("tone", v)}
            placeholder={t("mobile.dougOnb.toneOwn")}
            accessibilityLabel={t("mobile.dougOnb.toneOwn")}
            returnKeyType="next"
          />
        </Labelled>
        <Labelled label={t("mobile.dougOnb.instagram")}>
          <AuthField
            value={form.instagram}
            onChangeText={(v) => set("instagram", v)}
            placeholder={t("mobile.dougOnb.instagramPlaceholder")}
            accessibilityLabel={t("mobile.dougOnb.instagram")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </Labelled>
        <Labelled label={t("mobile.dougOnb.site")}>
          <AuthField
            value={form.site}
            onChangeText={(v) => set("site", v)}
            placeholder={t("mobile.dougOnb.sitePlaceholder")}
            accessibilityLabel={t("mobile.dougOnb.site")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />
        </Labelled>
        <Labelled label={t("mobile.dougOnb.audience")}>
          <TextArea
            value={form.audience}
            onChangeText={(v) => set("audience", v)}
            accessibilityLabel={t("mobile.dougOnb.audience")}
            minHeight={72}
            scrollEnabled={false}
          />
        </Labelled>
        <Labelled label={t("mobile.dougOnb.manual")}>
          {form.files.map((f) => (
            <View key={f.id} style={[styles.file, { backgroundColor: c.raised, borderColor: c.line2 }]}>
              <Icon name="file" size={16} color={c.muted} />
              <Text variant="small" numberOfLines={1} style={styles.grow}>
                {f.title}
              </Text>
              <Pressable
                onPress={() =>
                  set(
                    "files",
                    form.files.filter((x) => x.id !== f.id),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t("mobile.dougOnb.removeFile", { name: f.title })}
                hitSlop={12}
              >
                <Icon name="x" size={16} color={c.faint} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => void attach()}
            accessibilityRole="button"
            accessibilityLabel={`${t("mobile.dougOnb.manualPick")}. ${t("mobile.dougOnb.manualHelp")}`}
            style={[styles.drop, { borderColor: c.lineStrong }]}
          >
            <Icon name="up" size={20} color={c.muted} />
            <View style={styles.grow}>
              <Text variant="subhead" style={styles.bold}>
                {uploading ? t("mobile.dougOnb.uploading") : t("mobile.dougOnb.manualPick")}
              </Text>
              <Text variant="footnote" tone="muted">
                {t("mobile.dougOnb.manualHelp")}
              </Text>
            </View>
          </Pressable>
          <AuthField
            value={form.link}
            onChangeText={(v) => set("link", v)}
            placeholder={t("mobile.dougOnb.manualLink")}
            accessibilityLabel={t("mobile.dougOnb.manualLink")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
          />
        </Labelled>
      </Locked>
      {error ? (
        <Text variant="small" tone="danger" accessibilityRole="alert" style={CENTER}>
          {error}
        </Text>
      ) : null}
      {brandReady(form) ? null : (
        <Text variant="footnote" tone="muted" style={CENTER}>
          {t("mobile.dougOnb.needs")}
        </Text>
      )}
      <View style={styles.action}>
        <Button
          variant="primary"
          wide
          label={t("onboarding.actions.continue")}
          loading={save.isPending}
          disabled={!brandReady(form) || uploading}
          onPress={() => save.mutate()}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  stack: { gap: 12 },
  center: { alignItems: "center", gap: 4 },
  action: { marginTop: 8 },
  // A start card: the radio in its own column, the words beside it.
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  cardOn: { borderWidth: 1.5 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  faces: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  count: { textAlign: "right" },
  group: { gap: 8 },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // The HQ's agents hang from the manager by a line, in the same column of the list.
  reports: { marginLeft: 22, paddingLeft: 12, borderLeftWidth: 2, gap: 4 },
  under: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  more: { minHeight: 32, justifyContent: "center", paddingLeft: 2 },
  // The "Agora não" text button (32 tall, no plate) in a finger's own row.
  skipRow: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeLine: { marginTop: 8, alignSelf: "flex-start" },
  fields: { gap: 20 },
  labelled: { gap: 8 },
  tones: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  drop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
});
