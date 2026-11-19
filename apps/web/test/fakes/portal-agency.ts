/**
 * Test fixture — an agency's portal across five clients, each in a different situation, for the overview (ADR 9001
 * §10): one with an adjustment asked and late work, one all in production, one waiting on the client, one ready to
 * schedule, one with nothing open. Dates are relative to today, so "late" stays late whenever a test runs.
 */
import type { Member } from "@dougbot/client";
import { type FakePortal, portalCard, portalItem } from "./portal";

export const ME = "u-walter";
export const JOAO = "u-joao";
export const MARINA = "u-marina";
export const CAIO = "u-caio";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A day `n` days from today. */
export const agencyDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** Two more people on the team, as the members' list would send them. */
export const agencyMembers = (like: Member): Member[] => [
  { ...like, userId: MARINA, name: "Marina", email: "marina@example.com", handle: "marina", role: "member" },
  { ...like, userId: CAIO, name: "Caio", email: "caio@example.com", handle: "caio", role: "member" },
];

export function fillAgency(portal: FakePortal) {
  portal.clients = ["acme", "zeta", "orla-cafe", "norte-moveis", "vila-pet"];
  portal.cards = [
    // Acme: an adjustment asked, late work, and a bit of everything else.
    portalCard({
      id: "c-00a001",
      client: "acme",
      title: "Depoimento da aluna Júlia",
      item: "a1",
      members: [JOAO, CAIO],
      produceOn: agencyDay(-3),
    }),
    portalCard({
      id: "c-00a002",
      client: "acme",
      title: "Story de enquete: qual treino?",
      type: "story",
      members: [ME],
      produceOn: agencyDay(-1),
    }),
    portalCard({
      id: "c-00a003",
      client: "acme",
      title: "Reel: lançamento da linha de inverno",
      state: "doing",
      members: [ME, JOAO],
      produceOn: agencyDay(0),
      date: `${agencyDay(6)}T18:00`,
    }),
    portalCard({
      id: "c-00a004",
      client: "acme",
      title: "Promoção de aniversário",
      type: "image",
      item: "a2",
      members: [MARINA],
    }),
    portalCard({
      id: "c-00a005",
      client: "acme",
      title: "Carrossel de receitas rápidas",
      type: "carousel",
      item: "a3",
      members: [ME, MARINA],
    }),
    portalCard({ id: "c-00a006", client: "acme", title: "Dicas de hidratação", item: "a4", members: [MARINA] }),
    // Zeta: everything still being made, nothing late.
    portalCard({
      id: "c-00b001",
      client: "zeta",
      title: "Tour pelo novo showroom",
      state: "doing",
      members: [ME, CAIO],
      produceOn: agencyDay(1),
      date: `${agencyDay(5)}T10:00`,
    }),
    portalCard({
      id: "c-00b002",
      client: "zeta",
      title: "Depoimento do arquiteto",
      members: [CAIO],
      produceOn: agencyDay(3),
    }),
    portalCard({
      id: "c-00b003",
      client: "zeta",
      title: "Carrossel: antes e depois",
      type: "carousel",
      state: "doing",
      members: [MARINA],
      produceOn: agencyDay(2),
    }),
    // Orla Café: with the client.
    portalCard({
      id: "c-00c001",
      client: "orla-cafe",
      title: "Cardápio de verão",
      type: "carousel",
      item: "o1",
      members: [JOAO],
    }),
    portalCard({
      id: "c-00c002",
      client: "orla-cafe",
      title: "Brunch de domingo",
      type: "image",
      item: "o2",
      members: [JOAO],
    }),
    // Norte Móveis: approved, waiting for a date.
    portalCard({
      id: "c-00d001",
      client: "norte-moveis",
      title: "Sofá Oslo em 30 segundos",
      item: "n1",
      members: [MARINA],
    }),
    portalCard({
      id: "c-00d002",
      client: "norte-moveis",
      title: "Guia de medidas",
      type: "carousel",
      item: "n2",
      members: [MARINA, CAIO],
    }),
    portalCard({
      id: "c-00d003",
      client: "norte-moveis",
      title: "Oferta de fim de mês",
      type: "image",
      item: "n3",
      members: [CAIO],
    }),
  ];
  portal.items = [
    portalItem({
      id: "a1",
      client: "acme",
      title: "Depoimento da aluna Júlia",
      status: "adjust_requested",
      lastNote: { at: null, by: "Renata", text: "Trocar a música e cortar os 3 segundos finais." },
    }),
    portalItem({ id: "a2", client: "acme", title: "Promoção de aniversário", type: "image", status: "seen" }),
    portalItem({
      id: "a3",
      client: "acme",
      title: "Carrossel de receitas rápidas",
      type: "carousel",
      status: "approved",
    }),
    portalItem({
      id: "a4",
      client: "acme",
      title: "Dicas de hidratação",
      status: "scheduled",
      scheduledFor: `${agencyDay(2)}T18:00:00-03:00`,
    }),
    portalItem({ id: "o1", client: "orla-cafe", title: "Cardápio de verão", type: "carousel", status: "sent" }),
    portalItem({ id: "o2", client: "orla-cafe", title: "Brunch de domingo", type: "image", status: "seen" }),
    // A post sent with no card: it is in the pipeline too.
    portalItem({ id: "o3", client: "orla-cafe", title: "Happy hour de quinta", type: "story", status: "sent" }),
    portalItem({ id: "n1", client: "norte-moveis", title: "Sofá Oslo em 30 segundos", status: "approved" }),
    portalItem({ id: "n2", client: "norte-moveis", title: "Guia de medidas", type: "carousel", status: "approved" }),
    portalItem({ id: "n3", client: "norte-moveis", title: "Oferta de fim de mês", type: "image", status: "approved" }),
    // Vila Pet: only what already went out.
    portalItem({
      id: "v1",
      client: "vila-pet",
      title: "Adoção responsável",
      status: "published",
      publishedAt: `${agencyDay(-6)}T10:00:00-03:00`,
    }),
  ];
}
