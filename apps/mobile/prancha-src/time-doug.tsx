import type { ApiClient, DougTemplateMember, TeamTemplate } from "@agenteschat/client";
import { ApiProvider } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { BrandStep, MembersStep, StartStep } from "@/features/onboarding/doug";
import { ToastHost } from "@/ui";
import { AuthScaffold } from "@/ui/auth/AuthScaffold";

/*
 * The onboarding's Doug team screens on the board: the app's own components over sample data, one address each
 * (`/time-doug-como`, `/time-doug-quem`, `/time-doug-marca`), to be looked at in a browser.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";

const member = (
  handle: string,
  name: string,
  role: string,
  over: Partial<DougTemplateMember> = {},
): DougTemplateMember => ({
  handle,
  name,
  role,
  line: "",
  qg: null,
  channel: null,
  reportsTo: null,
  needsComputer: false,
  rightHand: false,
  routines: 0,
  skills: 0,
  ...over,
});

const MEMBERS: DougTemplateMember[] = [
  member("doug", "DOUG", "Braço direito · gerente da operação", { rightHand: true }),
  member("rosa", "ROSA", "Diretora de arte"),
  member("sony", "SONY", "Vídeo e motion", { needsComputer: true }),
  member("mark", "MARK", "Líder do QG de Tráfego", { qg: "trafego" }),
  ...[
    "Copywriter",
    "Diretor de Criativo",
    "Estrategista de Mídia",
    "Analista de Resultado",
    "Humanizador",
    "Gestor de Contas",
    "Pesquisador",
    "Revisor",
    "Financeiro de Tráfego",
  ].map((r, i) => member(`trafego-${i}`, r, r, { reportsTo: "mark" })),
  member("chess", "CHESS", "Estrategista"),
  member("kiara", "KIARA", "Financeiro"),
  member("junin", "JUNIN", "Código e automações", { needsComputer: true }),
];

const DOUG = {
  id: "doug",
  name: "Time Doug",
  sub: "",
  description:
    "Design, vídeo, tráfego, estratégia, social media, código e financeiro. Sem memória: aprendem a sua empresa.",
  team: { agents: [], newChannels: [], routines: [], skills: [] },
  members: MEMBERS,
} as unknown as TeamTemplate & { members: DougTemplateMember[] };

const TONES = ["Próximo", "Bem-humorado", "Sério", "Profissional", "Inspirador", "Direto", "Acolhedor", "Técnico"].map(
  (label) => ({
    id: label.toLowerCase(),
    label,
  }),
);

const fakeApi = (): ApiClient =>
  ({
    agents: {
      brand: async () => ({ pending: true, brand: null, skillId: null, tones: TONES }),
      saveBrand: async () => ({}),
    },
    artifacts: { upload: async () => ({ id: "f1", title: "manual-de-marca.pdf" }) },
  }) as unknown as ApiClient;

/** A phone as wide as the browser gives it, the sky and the right hand above, as in the first run. */
function Phone({
  title,
  subtitle,
  progress,
  children,
}: {
  title: string;
  subtitle: string;
  progress: string;
  children: ReactNode;
}) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <ToastHost>
          <View style={{ flex: 1 }}>
            <AuthScaffold
              sky="low"
              title={title}
              subtitle={subtitle}
              progress={progress}
              agent={{ color: "sky", eyes: "round", id: "doug", name: "Doug" }}
              onBack={() => {}}
              scrollToFocus
              toolbar
            >
              {children}
            </AuthScaffold>
          </View>
        </ToastHost>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function TimeDougComo() {
  const [start, setStart] = useState<"doug" | "other" | "scratch">("doug");
  return (
    <Phone
      title="Como você quer começar o time?"
      subtitle="Escolha um. Dá para adicionar ou tirar agentes depois."
      progress="Passo 3 de 5 · Seu time"
    >
      <StartStep doug={DOUG} start={start} onStart={setStart} onNext={() => {}} leaving={false} />
    </Phone>
  );
}

export function TimeDougQuem() {
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [computer, setComputer] = useState(false);
  return (
    <Phone
      title="Quem entra no seu time?"
      subtitle="Todos vêm marcados. Tire quem você não precisa."
      progress="Passo 3 de 5 · Seu time"
    >
      <MembersStep
        doug={DOUG}
        unchecked={unchecked}
        onToggle={(h) =>
          setUnchecked((s) => {
            const n = new Set(s);
            if (!n.delete(h)) n.add(h);
            return n;
          })
        }
        wantsComputer={computer}
        onWantsComputer={setComputer}
        failed={null}
        creating={false}
        onCreate={() => {}}
      />
    </Phone>
  );
}

export function TimeDougMarca() {
  return (
    <Phone
      title="Ensine a sua marca ao time"
      subtitle="Os agentes leem isto antes de escrever, desenhar ou publicar."
      progress="Passo 4 de 5 · Sua marca"
    >
      <BrandStep orgId={ORG} company="Padaria Aurora" onSaved={() => {}} />
    </Phone>
  );
}
