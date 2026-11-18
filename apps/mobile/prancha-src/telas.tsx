import type { HexColor } from "@agenteschat/ui/agent/engine";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Text as RNText,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import type { AgentLookInput } from "@/agent/looks";
import { botDoAgente, corDoBot } from "@/brand/bots";
import { DB_FONTES } from "@/brand/tokens";
import { botColor } from "@/features/agents/ProfileView";
import { AgentCallView } from "@/features/call/AgentCallView";
import { ChatBackdrop } from "@/features/chat/ChatBackdrop";
import { HeaderPill } from "@/features/chat/HeaderPill";
import { ownBubble } from "@/features/chat/logic";
import { DougIcon, DougPinnedCard, useDougWords } from "@/features/chats/DougPinnedCard";
import { GlanceCard } from "@/features/chats/HomeGlance";
import { CollapsibleSection } from "@/features/chats/HomeSection";
import { ToolTile, WhatsAppMark } from "@/features/chats/HomeTools";
import { GroupPhoto } from "@/features/shared/GroupPhoto";
import {
  AgentAvatar,
  Assinatura,
  Button,
  Card,
  Chip,
  Composer,
  Count,
  Filters,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  InkOrbit,
  ListRow,
  PersonAvatar,
  PixelDone,
  SearchField,
  Segmented,
  Text,
  WithPresence,
} from "@/ui";
import { TAB_GLYPHS, type TabGlyph, tabGlyphSvg } from "@/ui/tabGlyphs";
import { useTheme } from "@/ui/theme";
import { AgentePerfil, TimeAgora } from "./agentes";
import { Arquivos, Senhas, SenhasItem, SenhasLogins } from "./arquivos-senhas";
import { IlhaCena } from "./ilha";
import { Paineis, Paineis320, PaineisFormas } from "./paineis";
import { PainelIa, PainelIa320, PainelIaFolha, PainelIaFolha320 } from "./painel-ia";
import { Ajustes, AjustesSobre, Pendentes, PendentesAgendar, PendentesVazio } from "./pendentes-ajustes";
import {
  PortalAgendar,
  PortalAgendarPost,
  PortalCartao,
  PortalCartaoLongo,
  PortalClienteEditar,
  PortalClientes,
  PortalCronograma,
  PortalCronograma320,
  PortalCronogramaPostados320,
  PortalPostados,
  PortalQuadro,
  PortalQuadro320,
} from "./portal";
import {
  RevisaoConversa,
  RevisaoDesign,
  RevisaoDesignConversa,
  RevisaoDesignEditor,
  RevisaoLista,
  RevisaoVideo,
} from "./revisao";
import { TarefasEquipe, TarefasEquipeAberta, TarefasEquipeVazia, TarefasMinhas } from "./tarefas";
import { ConversaOpcoes, Tudo } from "./tudo";
import { TimeDougComo, TimeDougMarca, TimeDougQuem } from "./time-doug";
import { WhatsAppConversa, WhatsAppLista } from "./whatsapp";

/** Sample photos served beside the board (`doug-mobile/fotos`): a person's and the groups' (JPG, as people send). */
const foto = (name: string) => (Platform.OS === "web" ? `${window.location.origin}/fotos/${name}.jpg` : null);

const bot = (name: string, role = "", photo?: string | null): AgentLookInput => ({
  color: "sky",
  eyes: "round",
  id: name,
  name,
  role,
  ...(photo ? { photo } : {}),
});
const DOUG = bot("Doug BOSS", "Chefe do time");
const ROSA = bot("ROSA", "Design");
const SONY = bot("SONY", "Vídeo");
const MARK = bot("MARK", "Marketing");
const CHESS = bot("CHESS", "Estratégia");
const KIARA = bot("KIARA", "Financeiro");
const JUNIN = bot("JUNIN", "Código");
const LIA = bot("Lia", "Atendimento ao cliente", foto("lia"));
const NOVO = bot("Pesquisa", "Pesquisa de mercado");

/** One screen of the board by its name (`/inicio`, `/dm`…), the index otherwise. */
export function Tela({ tela }: { tela: string | undefined }) {
  const Screen = TELAS[tela ?? ""] ?? Indice;
  return <Screen />;
}

function Indice() {
  return (
    <Frame title="Prancha DougBot">
      {Object.keys(TELAS).map((k) => (
        <Text key={k} variant="body">
          /{k}
        </Text>
      ))}
    </Frame>
  );
}

/** A phone screen: the status bar's room, a large title, the content and, on tab screens, the tab bar. */
function Frame({
  title,
  children,
  tabs,
  header,
  bottom,
  scroll = true,
  scrolledBy,
  topInset,
  over,
  behind,
}: {
  title?: string;
  children?: ReactNode;
  tabs?: string;
  header?: ReactNode;
  bottom?: ReactNode;
  scroll?: boolean;
  /** The list already scrolled this far under a clear bar (the header lies over the content, as in the app). */
  scrolledBy?: number;
  /** The phone's top inset (59 with the camera's island, 47 with a notch). */
  topInset?: number;
  /** Drawn over everything (the island, the status bar, the camera). */
  over?: ReactNode;
  /** Drawn under everything but the screen's color (a conversation's texture). */
  behind?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = topInset ?? Math.max(insets.top, 47);
  const list = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (scrolledBy) list.current?.scrollTo({ y: scrolledBy, animated: false });
  }, [scrolledBy]);
  if (scrolledBy !== undefined)
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <ScrollView
          ref={list}
          style={styles.fill}
          contentContainerStyle={{ paddingTop: top + 44, paddingBottom: tabs ? 110 : 24 }}
        >
          {children}
        </ScrollView>
        <View pointerEvents="box-none" style={[styles.overBar, { paddingTop: top }]}>
          {header}
        </View>
        {tabs ? <TabBar on={tabs} /> : null}
        {over}
      </View>
    );
  const body = (
    <>
      {title ? (
        <View style={styles.largeTitle}>
          <Text variant="display" accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      {children}
    </>
  );
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      {behind}
      <View style={{ height: top }} />
      {header}
      {scroll ? (
        <ScrollView style={styles.fill} contentContainerStyle={{ paddingBottom: tabs ? 110 : 24 }}>
          {body}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{body}</View>
      )}
      {bottom}
      {tabs ? <TabBar on={tabs} /> : null}
      {over}
    </View>
  );
}

/** The system tab bar, as the app sets it (`(tabs)/_layout.tsx`): the web sidebar's five, its own glyphs. */
const TAB_LABEL: Record<TabGlyph, string> = {
  home: "Início",
  waiting: "Pendentes",
  portal: "Portal",
  review: "Revisão",
  settings: "Ajustes",
};
const TAB_BADGES: Partial<Record<TabGlyph, number>> = { home: 3, waiting: 2, review: 4 };

export function TabBar({ on }: { on: string }) {
  const { colors, scheme } = useTheme();
  // iOS 26 draws the bar as a floating pill of Liquid Glass over the list; the board draws that glass.
  const glass =
    scheme === "dark"
      ? {
          backgroundColor: "rgba(22, 22, 22, 0.86)",
          boxShadow:
            "inset 0px 1px 0px rgba(255, 255, 255, 0.16), inset 0px 0px 0px 1px rgba(255, 255, 255, 0.085), 0px 24px 56px -16px rgba(0, 0, 0, 0.75)",
        }
      : {
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          boxShadow: "inset 0px 0px 0px 1px rgba(10, 10, 10, 0.08), 0px 12px 32px -12px rgba(0, 0, 0, 0.25)",
        };
  return (
    <View style={[styles.tabBar, glass]}>
      {TAB_GLYPHS.map((g) => {
        const chosen = g === on;
        const badge = TAB_BADGES[g];
        return (
          <View
            key={g}
            style={[
              styles.tab,
              chosen
                ? { backgroundColor: scheme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(10, 10, 10, 0.06)" }
                : null,
            ]}
          >
            <View>
              <SvgXml xml={tabGlyphSvg(g, chosen, chosen ? colors.ink : colors.faint)} width={26} height={26} />
              {badge ? (
                <View style={styles.tabBadge}>
                  <Count value={badge} size={11} inverted fill={colors.badge} color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <RNText
              numberOfLines={1}
              style={{
                fontFamily: chosen ? DB_FONTES.texto600 : DB_FONTES.texto500,
                fontSize: 10,
                lineHeight: 12,
                color: chosen ? colors.ink : colors.faint,
              }}
            >
              {TAB_LABEL[g]}
            </RNText>
          </View>
        );
      })}
    </View>
  );
}

/** The tabs' bar: its middle empty, DougBot's signature resting in the island above it (`ilha.tsx`). */
export function TabHeader() {
  return (
    <View style={styles.tabHeader}>
      <View style={styles.barSide} />
      <View style={styles.barSide} />
    </View>
  );
}

const SECTION = ({ children, count }: { children: string; count?: number }) => (
  <View style={styles.section}>
    <Text variant="label" tone="muted">
      {children}
    </Text>
    {count !== undefined ? <Count value={count} size={13} weight="500" /> : null}
  </View>
);

function AgentRow({
  a,
  sub,
  time,
  mode = "idle",
  unread,
  divider,
  presence,
  compact = false,
}: {
  a: AgentLookInput;
  compact?: boolean;
  sub: string;
  time?: string;
  mode?: "idle" | "run" | "think" | "sleep";
  unread?: number;
  divider?: boolean;
  presence?: "online" | "away" | "busy";
}) {
  const size = compact ? 40 : 50;
  const face = <AgentAvatar agent={a} size={size} mode={mode} name={a.name} />;
  return (
    <ListRow
      leading={
        presence ? (
          <WithPresence size={size} presence={presence}>
            {face}
          </WithPresence>
        ) : (
          face
        )
      }
      title={a.name ?? ""}
      time={time ?? null}
      sub={sub}
      subLines={1}
      unread={Boolean(unread)}
      divider={divider}
      compact={compact}
      trailing={unread ? <Count value={unread} size={13} inverted /> : undefined}
    />
  );
}

function GroupRow({
  name,
  icon,
  sub,
  time,
  divider,
  compact = false,
}: {
  name: string;
  icon?: string | null;
  sub: string;
  time: string;
  divider?: boolean;
  compact?: boolean;
}) {
  return (
    <ListRow
      leading={<GroupPhoto icon={icon ?? null} size={compact ? 44 : 52} />}
      title={name}
      time={time}
      sub={sub}
      subLines={1}
      divider={divider}
      compact={compact}
    />
  );
}

// The app's glance (`HomeGlance`): the editor and the clients' changes. Threads have no card there (ADR doug-0018).
const WIDGETS = [
  { key: "e", icon: "play", title: "Ronny", big: "Ajustando", line: "Built_to_Endure_Ep12_Corte1", hot: false },
  { key: "c", icon: "flag", title: "Alterações", big: "4", line: "ELMX Capital, LEXEER", hot: true },
] as const;

export function Inicio({
  scrolledBy,
  topInset,
  over,
}: {
  scrolledBy?: number;
  topInset?: number;
  over?: ReactNode;
} = {}) {
  const { colors } = useTheme();
  const w = useDougWords();
  const noop = () => {};
  return (
    <Frame tabs="home" header={<TabHeader />} scrolledBy={scrolledBy} topInset={topInset} over={over}>
      {/* Doug pinned on top (docs/adr/doug-0016-doug-pinned.md), the same card the app draws. */}
      <DougPinnedCard
        face={<DougIcon />}
        name="Doug"
        status={w.waiting(2)}
        greeting=""
        working={5}
        words={w}
        onTalk={noop}
        onCall={noop}
        onDecisions={noop}
        onStatus={noop}
      />
      <View style={styles.tools9}>
        {[
          { key: "wa", label: "WhatsApp", href: "", icon: <WhatsAppMark size={21} />, count: 5 },
          { key: "midia", label: "Mídia", href: "", icon: "image" as const },
          { key: "busca", label: "Buscar", href: "", icon: "search" as const },
          { key: "tarefas", label: "Tarefas", href: "", icon: "checkc" as const, count: 2 },
          { key: "mais", label: "Mais", href: "", icon: "more" as const },
        ].map((tool) => (
          <ToolTile key={tool.key} tool={tool} onPress={noop} />
        ))}
      </View>
      <View style={styles.widgets}>
        {WIDGETS.map((x) => (
          <GlanceCard
            key={x.key}
            card={{ key: x.key, icon: x.icon, title: x.title, big: x.big, line: x.line, hot: x.hot, onPress: noop }}
          />
        ))}
      </View>
      <CollapsibleSection title="Esperando sua resposta" count={2} collapsed={false} onToggle={noop} panel>
        <ListRow
          leading={<AgentAvatar agent={SONY} size={40} name={SONY.name} />}
          title="SONY espera sua resposta"
          titleLines={2}
          time="5,4 h"
          chevron
          compact
        />
        <ListRow
          leading={<AgentAvatar agent={ROSA} size={40} name={ROSA.name} />}
          title="ROSA espera sua aprovação"
          titleLines={2}
          time="12 min"
          chevron
          divider
          compact
        />
      </CollapsibleSection>
      <CollapsibleSection title="Agentes" count={5} collapsed={false} onToggle={noop} panel>
        <AgentRow a={JUNIN} sub="Subi o ajuste do formulário." time="09:52" presence="online" compact />
        <AgentRow a={SONY} sub="esperando você · 5,4 h" time="09:40" divider compact />
        <AgentRow a={ROSA} sub="Pergunta: qual das duas capas?" time="08:55" mode="think" divider compact />
        <AgentRow a={KIARA} sub="Fechei o orçamento de novembro." time="Ontem" divider compact />
      </CollapsibleSection>
      <CollapsibleSection title="Grupos" count={3} collapsed={false} onToggle={noop} panel>
        <GroupRow name="LEXEER" icon={foto("lexeer")} sub="Doug BOSS: aprovado, pode subir." time="09:30" compact />
        <GroupRow
          name="ELMX Capital"
          icon={foto("elmx")}
          sub="KIARA: fechei o orçamento de novembro."
          time="08:02"
          divider
          compact
        />
      </CollapsibleSection>
      <View style={{ height: 8, backgroundColor: colors.bg }} />
    </Frame>
  );
}

/** A call with Doug (docs/adr/doug-0006-live-voice.md): talking with captions, or ringing. */
function Ligacao({ ringing = false }: { ringing?: boolean }) {
  const noop = () => {};
  return (
    <AgentCallView
      name="Doug"
      face={(size) => <AgentAvatar agent={DOUG} size={size} mode={ringing ? "idle" : "run"} name="Doug" />}
      since="0:48"
      connecting={ringing}
      failed={null}
      level={0.4}
      caption={
        ringing
          ? null
          : {
              who: "agent",
              text: "Agora a proposta da Connor & Michelle: conferi preço e prazo, está tudo certo. Posso mandar?",
            }
      }
      micOn
      speaker={false}
      onMinimize={noop}
      onMic={noop}
      onSpeaker={noop}
      onWrite={noop}
      onHangUp={noop}
      hangUpWord="Desligar"
      micWords={{ on: "Mudo", off: "Mudo", turnOff: "Desligar o microfone", turnOn: "Ligar o microfone" }}
      speakerWords={{
        speaker: "Alto-falante",
        earpiece: "Fone",
        toSpeaker: "Usar o alto-falante",
        toEarpiece: "Usar o fone",
      }}
      minimizeLabel="Continuar trabalhando"
    />
  );
}

const TEAM: { a: AgentLookInput; mode: "idle" | "run" | "think" | "sleep"; state: string; expression?: "happy" }[] = [
  { a: DOUG, mode: "idle", state: "Disponível" },
  { a: ROSA, mode: "run", state: "Trabalhando" },
  { a: SONY, mode: "think", state: "Perguntando" },
  { a: MARK, mode: "idle", state: "Terminou", expression: "happy" },
  { a: CHESS, mode: "sleep", state: "Dormindo" },
  { a: KIARA, mode: "idle", state: "Disponível" },
  { a: JUNIN, mode: "run", state: "Trabalhando" },
  { a: NOVO, mode: "idle", state: "Disponível" },
];

/** Doug pinned in its states: nothing waiting with the greeting and nobody working, one agent, many and a long count. */
function DougFixado() {
  const w = useDougWords();
  const noop = () => {};
  const card = (
    key: string,
    o: { left: AgentLookInput[]; right: AgentLookInput[]; more: number; waiting: number; greeting: string },
  ) => (
    <DougPinnedCard
      key={key}
      face={<DougIcon />}
      name="Doug"
      status={o.waiting > 0 ? w.waiting(o.waiting) : w.nothingWaiting}
      greeting={o.greeting}
      working={o.left.length + o.right.length + o.more}
      words={w}
      onTalk={noop}
      onCall={noop}
      onDecisions={noop}
      {...(o.waiting > 0 ? { onStatus: noop } : {})}
    />
  );
  return (
    <Frame title="Doug fixado">
      {card("calmo", { left: [], right: [], more: 0, waiting: 0, greeting: "Boa noite, Gabriel." })}
      {card("um", { left: [], right: [SONY], more: 0, waiting: 1, greeting: "" })}
      {card("muitos", { left: [ROSA, MARK], right: [SONY, JUNIN], more: 7, waiting: 12, greeting: "" })}
    </Frame>
  );
}

function Agentes() {
  return (
    <Frame title="Agentes">
      <SECTION count={TEAM.length}>Time</SECTION>
      {TEAM.map((m, i) => (
        <ListRow
          key={m.a.name}
          leading={
            <AgentAvatar
              agent={m.a}
              size={46}
              mode={m.mode}
              name={m.a.name}
              {...(m.expression ? { expression: m.expression } : {})}
            />
          }
          title={<BotName a={m.a} />}
          sub={`${m.a.role} · ${m.state}`}
          subLines={1}
          divider={i > 0}
        />
      ))}
    </Frame>
  );
}

/** A bot's name: Manrope 800, caps, 13/16, +0.05em, in the bot's own color (IDENTIDADE.md §5–6). */
function BotName({ a, big }: { a: AgentLookInput; big?: boolean }) {
  const { scheme, colors } = useTheme();
  const cor = corDoBot(botDoAgente({ name: a.name, role: a.role }));
  return (
    <RNText
      style={{
        fontFamily: DB_FONTES.titulo800,
        fontSize: big ? 15 : 13,
        lineHeight: big ? 20 : 16,
        letterSpacing: 0.65,
        textTransform: "uppercase",
        // On the light stage a bot's color is too light for words: the name in ink there (AA).
        color: scheme === "dark" ? cor : colors.ink,
      }}
    >
      {a.name}
    </RNText>
  );
}

function Time() {
  const { colors } = useTheme();
  const estados = [
    ["idle", undefined, "ok"],
    ["run", undefined, "trabalhando"],
    ["think", undefined, "pedindo"],
    ["idle", "happy", "terminou"],
    ["sleep", undefined, "dormindo"],
  ] as const;
  return (
    <Frame title="O time">
      <View style={styles.grid}>
        {[DOUG, ROSA, SONY, MARK, CHESS, KIARA, JUNIN, NOVO, LIA].map((a) => (
          <View key={a.name} style={styles.cell}>
            <AgentAvatar agent={a} size={96} name={a.name} />
            <BotName a={a} />
          </View>
        ))}
      </View>
      <GroupedHeader>Estados</GroupedHeader>
      <View style={[styles.grid, { paddingTop: 4 }]}>
        {estados.map(([mode, expression, label]) => (
          <View key={label} style={styles.cellSmall}>
            <AgentAvatar agent={DOUG} size={56} mode={mode} {...(expression ? { expression } : {})} />
            <AgentAvatar agent={ROSA} size={44} mode={mode} {...(expression ? { expression } : {})} />
            <Text variant="caption" tone="muted">
              {label}
            </Text>
          </View>
        ))}
      </View>
      <GroupedHeader>Tamanhos</GroupedHeader>
      <View style={[styles.rowGap8, styles.pad, { alignItems: "flex-end" }]}>
        {[20, 32, 44, 60, 96].map((s) => (
          <AgentAvatar key={s} agent={DOUG} size={s} />
        ))}
      </View>
      <View style={[styles.pad, { gap: 16, paddingTop: 16 }]}>
        <Assinatura size={22} />
        <Assinatura size={15} />
        <View style={{ height: 1, backgroundColor: colors.line }} />
      </View>
    </Frame>
  );
}

function Login() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("gabriel@zimcontent.com");
  return (
    <Frame scroll={false}>
      <View style={styles.authHero}>
        <AgentAvatar agent={{ ...DOUG, name: "Doug" }} size={96} />
      </View>
      <View style={styles.pad}>
        <Text variant="display" style={styles.center}>
          Entrar
        </Text>
        <Text variant="subhead" tone="muted" style={[styles.center, { marginTop: 8 }]}>
          dougbot.app
        </Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <Field value={email} onChange={setEmail} label="E-mail" />
          <Button variant="primary" label="Continuar" onPress={() => {}} wide />
          <Button variant="secondary" label="Entrar com a Apple" onPress={() => {}} wide />
          <Button variant="secondary" label="Entrar com o Google" onPress={() => {}} wide />
        </View>
      </View>
      <View style={[styles.fill, { justifyContent: "flex-end", alignItems: "center", paddingBottom: 34 }]}>
        <Assinatura size={15} />
        <Text variant="caption" tone="faint" style={{ marginTop: 8, color: colors.faint }}>
          Trocar de servidor
        </Text>
      </View>
    </Frame>
  );
}

/** A form field as the app's: 52 tall, radius 12, on the glass, its edge green at 35% while active. */
function Field({
  value,
  onChange,
  label,
  active,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  active?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={colors.faint}
      style={{
        height: 52,
        borderRadius: 12,
        paddingHorizontal: 16,
        backgroundColor: colors.raised2,
        borderWidth: 1,
        borderColor: active ? colors.greenGlow : colors.glassEdge,
        color: colors.ink,
        fontFamily: DB_FONTES.texto400,
        fontSize: 16,
      }}
    />
  );
}

function Servidor() {
  const [url, setUrl] = useState("dougbot.app");
  return (
    <Frame scroll={false}>
      <View style={styles.authHero}>
        <AgentAvatar agent={{ ...DOUG, name: "Doug" }} size={96} mode="think" />
      </View>
      <View style={styles.pad}>
        <Text variant="display" style={styles.center}>
          Onde fica o seu DougBot?
        </Text>
        <Text variant="subhead" tone="muted" style={[styles.center, { marginTop: 8 }]}>
          O endereço do servidor do seu time.
        </Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <Field value={url} onChange={setUrl} label="Endereço" active />
          <Button variant="primary" label="Conectar" onPress={() => {}} wide />
          <Button variant="text" label="Ler QR code" onPress={() => {}} />
        </View>
      </View>
    </Frame>
  );
}

type Msg = { who: AgentLookInput | "eu"; text: string; mode?: "run" | "think"; time?: string };

/** A bubble's time, at the end of its last line (the app's `stamp`). */
function Stamp({ time, ink }: { time: string; ink?: string | null }) {
  return (
    <Text variant="caption" tone="muted" style={[styles.stamp, ink ? { color: ink } : null]}>
      {time}
    </Text>
  );
}

function Bubble({ m, dm = false, tone = "light" }: { m: Msg; dm?: boolean; tone?: "light" | "strong" }) {
  const { colors } = useTheme();
  const time = m.time ?? "14:30";
  if (m.who === "eu") {
    // As the app's own: the brand's lime (`ownBubble`), its rim a border.
    const own = ownBubble(tone, colors);
    return (
      <View style={[styles.bubble, styles.mine, { backgroundColor: own.fill, borderColor: own.edge }]}>
        <View style={styles.bubbleLine}>
          <Text variant="body" style={[styles.chatText, own.ink ? { color: own.ink } : null]}>
            {m.text}
          </Text>
          <Stamp time={time} ink={own.ink} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.theirs}>
      <AgentAvatar agent={m.who} size={30} mode={m.mode ?? "idle"} />
      <View
        style={[
          styles.bubble,
          styles.theirBubble,
          { backgroundColor: colors.bubbleTheirs, borderColor: colors.bubbleTheirsEdge },
        ]}
      >
        {/* A DM's bubble has no name: the header already says who it is (as the app's \`MessageRow\`). */}
        {dm ? null : <BotName a={m.who} />}
        <View style={[styles.bubbleLine, dm ? null : { marginTop: 2 }]}>
          <Text variant="body" style={styles.chatText}>
            {m.text}
          </Text>
          <Stamp time={time} />
        </View>
      </View>
    </View>
  );
}

/** The bar's buttons beside the pill, as the conversation's own (`barButtons`): the call, then "…". */
function BarButtons() {
  const { colors } = useTheme();
  return (
    <View style={styles.barSideRight}>
      <View style={[styles.barCapsule, { backgroundColor: colors.glassSolid, borderColor: colors.line2 }]}>
        <IconButton icon="handset" label="Ligar" onPress={() => {}} />
        <IconButton icon="more" label="Opções" onPress={() => {}} />
      </View>
    </View>
  );
}

function Chat({
  header,
  msgs,
  extra,
  dm = false,
  accent,
  tone,
  over,
}: {
  header: ReactNode;
  msgs: Msg[];
  extra?: ReactNode;
  dm?: boolean;
  /** The conversation's bot color (the texture's glow). */
  accent?: string;
  tone?: "light" | "strong";
  over?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <Frame
      scroll
      behind={<ChatBackdrop accent={accent ?? null} />}
      over={over}
      header={
        // The bar's back and actions are the system's (iOS 26 glass): the board draws them beside the pill.
        <View style={styles.chatHeader}>
          <View
            style={[
              styles.barSideLeft,
              styles.barBack,
              { backgroundColor: colors.glassSolid, borderColor: colors.line2 },
            ]}
          >
            <Icon name="back" size={20} color={colors.ink} />
          </View>
          {header}
          <BarButtons />
        </View>
      }
      bottom={
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 34) }}>
          <Composer placeholder="Mensagem" onSend={() => {}} onPlus={() => {}} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        <View style={styles.dateWrap}>
          <Chip label="Hoje" />
        </View>
        {msgs.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sample
          <Bubble key={i} m={m} dm={dm} {...(tone ? { tone } : {})} />
        ))}
        {extra}
      </View>
    </Frame>
  );
}

function Dm({ tone, over }: { tone?: "light" | "strong"; over?: ReactNode } = {}) {
  const accent = botColor(DOUG);
  return (
    <Chat
      dm
      accent={accent}
      over={over}
      {...(tone ? { tone } : {})}
      header={
        <HeaderPill
          // The board's capsule is a little wider than the system's: the pill keeps clear of it.
          extraActions={2}
          color={accent as HexColor}
          lead={<AgentAvatar agent={DOUG} size={32} />}
          title="Doug BOSS"
          subtitle="Chefe do time · disponível"
          label="Doug BOSS"
        />
      }
      msgs={[
        { who: "eu", text: "Doug, como estão os grupos hoje?", time: "14:30" },
        {
          who: DOUG,
          text: "Tudo andando. A LEXEER aprovou o corte e a SONY já está exportando o 1080p.",
          time: "14:31",
        },
        {
          who: DOUG,
          text: "A ROSA tem uma dúvida sobre a capa da ELMX: te mando as duas opções aqui.",
          time: "14:31",
        },
        { who: "eu", text: "Manda!", time: "14:32" },
      ]}
    />
  );
}

function Grupo() {
  return (
    <Chat
      header={
        <HeaderPill
          extraActions={2}
          color={botColor(SONY) as HexColor}
          lead={<GroupPhoto icon={foto("lexeer")} size={32} />}
          title="LEXEER"
          subtitle="6 aqui"
          label="LEXEER"
        />
      }
      msgs={[
        { who: SONY, text: "Subi a versão 2 do reels com a trilha nova.", mode: "run" },
        { who: ROSA, text: "Ficou ótimo. Ajustei o lettering para não cobrir a boca." },
        { who: "eu", text: "Perfeito, time. Pode publicar amanhã às 9h." },
        { who: DOUG, text: "Agendado. Aviso aqui quando sair." },
      ]}
    />
  );
}

function ComposerTela() {
  return (
    <Frame title="Composer">
      <View style={[styles.pad, { gap: 24 }]}>
        <Text variant="footnote" tone="muted">
          Vazio
        </Text>
        <Composer placeholder="Mensagem" onSend={() => {}} onPlus={() => {}} />
        <Text variant="footnote" tone="muted">
          Com texto (enviar em verde: a ação principal)
        </Text>
        <Composer
          placeholder="Mensagem"
          onSend={() => {}}
          onPlus={() => {}}
          prefill={{ text: "Doug, prepara o resumo da semana para o cliente", at: 1 }}
        />
        <Text variant="footnote" tone="muted">
          Com sugestões
        </Text>
        <Composer
          placeholder="Mensagem"
          onSend={() => {}}
          onPlus={() => {}}
          suggestions={[
            { icon: "doc", label: "Resumir o dia" },
            { icon: "chart", label: "Ver números" },
          ]}
        />
      </View>
    </Frame>
  );
}

function Execucao() {
  const { colors } = useTheme();
  const steps: { text: string; state: "done" | "doing" | "todo" }[] = [
    { text: "Baixei os brutos do Drive", state: "done" },
    { text: "Cortei pela forma de onda", state: "done" },
    { text: "Exportando o 1080p", state: "doing" },
    { text: "Subir no Frame.io", state: "todo" },
  ];
  const rosa = corDoBot(botDoAgente({ name: "ROSA" }));
  return (
    <Frame title="Trabalho" tabs="waiting">
      <View style={[styles.pad, { gap: 16 }]}>
        <Card>
          <View style={styles.cardPad}>
            <View style={styles.rowGap12}>
              <AgentAvatar agent={SONY} size={44} mode="run" />
              <View style={styles.fill}>
                <BotName a={SONY} />
                <Text variant="subhead" tone="muted">
                  Reels LEXEER · 3 de 4
                </Text>
              </View>
              <Button variant="secondary" size="sm" label="Parar" onPress={() => {}} />
            </View>
            <View style={{ gap: 10, marginTop: 16 }}>
              {steps.map((s) => (
                <View key={s.text} style={styles.rowGap8}>
                  <View style={styles.stepMark}>
                    {s.state === "done" ? (
                      <PixelDone size={14} />
                    ) : s.state === "doing" ? (
                      <InkOrbit size={14} />
                    ) : (
                      <View style={[styles.todo, { borderColor: colors.line2 }]} />
                    )}
                  </View>
                  <Text variant="subhead" tone={s.state === "todo" ? "faint" : "ink"}>
                    {s.text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Card>
        {/* A bot asking: the notice's edge takes its color at 44% (IDENTIDADE.md §6 "Aviso"). */}
        <View style={[styles.notice, { backgroundColor: colors.raised, borderColor: `${rosa}70` }]}>
          <View style={styles.rowGap12}>
            <AgentAvatar agent={ROSA} size={44} mode="think" />
            <View style={styles.fill}>
              <BotName a={ROSA} />
              <Text variant="subhead">Qual capa vai para a ELMX: a clara ou a escura?</Text>
            </View>
          </View>
          <Text variant="footnote" tone="muted" style={{ marginTop: 12 }}>
            Responda na conversa da ROSA.
          </Text>
        </View>
        <Card>
          <View style={[styles.cardPad, styles.rowGap12]}>
            <AgentAvatar agent={MARK} size={44} expression="happy" />
            <View style={styles.fill}>
              <BotName a={MARK} />
              <Text variant="subhead" tone="muted">
                Terminou · campanha de novembro
              </Text>
            </View>
            <Chip icon="check" label="Pronto" />
          </View>
        </Card>
        <Button variant="primary" label="Ver tudo que está rodando" onPress={() => {}} wide />
      </View>
    </Frame>
  );
}

function Busca() {
  const [q, setQ] = useState("doug");
  const [f, setF] = useState("tudo");
  return (
    <Frame title="Buscar">
      <View style={[styles.pad, { gap: 12 }]}>
        <SearchField value={q} onChangeText={setQ} placeholder="Buscar conversas, agentes, mensagens" />
        <Filters
          items={[
            { key: "tudo", label: "Tudo" },
            { key: "agentes", label: "Agentes", count: 2 },
            { key: "grupos", label: "Grupos", count: 1 },
            { key: "mensagens", label: "Mensagens" },
          ]}
          value={f}
          onChange={setF}
        />
      </View>
      <SECTION>Agentes</SECTION>
      <AgentRow a={DOUG} sub="Chefe do time" />
      <ListRow
        leading={<AgentAvatar agent={bot("Doug Antigo", "Arquivo")} size={50} />}
        title="Doug Antigo"
        sub="Oculto na sua lista · a busca encontra"
        subLines={1}
        divider
        trailing={<Chip icon="eyeoff" label="Oculto" />}
      />
      <SECTION>Grupos</SECTION>
      <GroupRow name="LEXEER" icon={foto("lexeer")} sub="#lexeer · 6 membros" time="" />
      <SECTION>Mensagens</SECTION>
      <ListRow
        leading={<AgentAvatar agent={DOUG} size={50} />}
        title="Doug BOSS em LEXEER"
        time="09:30"
        sub="…aprovado, pode subir. O Doug avisa quando sair."
        subLines={2}
      />
    </Frame>
  );
}

function Configuracoes() {
  return (
    <Frame title="Você">
      <View style={[styles.pad, styles.rowGap12, { paddingBottom: 8 }]}>
        <PersonAvatar
          name="Gabriel Zim"
          size={64}
          photo={foto("gabriel") ? { uri: foto("gabriel") as string } : null}
        />
        <View style={styles.fill}>
          <Text variant="title2">Gabriel Zim</Text>
          <Text variant="subhead" tone="muted">
            @gabriel · Time Zim
          </Text>
        </View>
      </View>
      <View style={styles.pad}>
        <GroupedList>
          <GroupedRow icon="image" label="Mudar foto" chevron onPress={() => {}} />
          <GroupedRow icon="person" label="Conta" chevron onPress={() => {}} />
          <GroupedRow icon="bell" label="Notificações" chevron onPress={() => {}} />
        </GroupedList>
        <GroupedHeader>Preferências</GroupedHeader>
        <GroupedList>
          <GroupedRow icon="moon" label="Aparência" value="Sistema" chevron onPress={() => {}} />
          <GroupedRow icon="globe" label="Idioma" value="Português (Brasil)" chevron onPress={() => {}} />
          <GroupedRow icon="sound" label="Sons" chevron onPress={() => {}} />
        </GroupedList>
        <GroupedHeader>DougBot</GroupedHeader>
        <GroupedList>
          <GroupedRow icon="server" label="Servidor" value="dougbot.app" chevron onPress={() => {}} />
          <GroupedRow icon="info" label="Sobre o DougBot" chevron onPress={() => {}} />
        </GroupedList>
      </View>
    </Frame>
  );
}

function Aparencia() {
  const theme = useTheme();
  const [modo, setModo] = useState<"dark" | "light" | "system">("system");
  return (
    <Frame title="Aparência">
      <View style={styles.pad}>
        <GroupedHeader>Tema</GroupedHeader>
        <GroupedList>
          {(["dark", "light", "system"] as const).map((k) => (
            <GroupedRow
              key={k}
              label={{ dark: "Escuro", light: "Claro", system: "Sistema" }[k]}
              checked={modo === k}
              onPress={() => setModo(k)}
            />
          ))}
        </GroupedList>
        <GroupedFooter>
          {`O padrão segue o sistema do celular. Agora: ${theme.scheme === "dark" ? "escuro" : "claro"}.`}
        </GroupedFooter>
        <View style={{ marginTop: 24 }}>
          <Segmented
            wide
            items={[
              { key: "dark", label: "Escuro" },
              { key: "light", label: "Claro" },
              { key: "system", label: "Sistema" },
            ]}
            value={modo}
            onChange={(k) => setModo(k as typeof modo)}
          />
        </View>
      </View>
    </Frame>
  );
}

function Sobre() {
  return (
    <Frame title="Sobre">
      <View style={[styles.pad, { alignItems: "center", paddingVertical: 24 }]}>
        <Assinatura size={28} />
      </View>
      <View style={styles.pad}>
        <GroupedList>
          <GroupedRow label="Versão" value="0.1.0 (1)" />
          <GroupedRow
            label="Código-fonte do DougBot"
            value="github.com/zimcontent/dougbot"
            chevron
            onPress={() => {}}
          />
        </GroupedList>
        <GroupedFooter>
          {
            "Baseado no agentes.chat da Codari Global, LLC · AGPL-3.0\n\nSoftware livre sob a GNU Affero General Public License v3, sem garantia.\n\nCopyright © 2026 Codari Global, LLC e colaboradores"
          }
        </GroupedFooter>
      </View>
    </Frame>
  );
}

function Agente() {
  return (
    <Frame title="Editar agente">
      <View style={[styles.pad, { alignItems: "center", gap: 8, paddingVertical: 16 }]}>
        <AgentAvatar agent={LIA} size={96} name="Lia" />
        <Text variant="footnote" tone="muted">
          @lia
        </Text>
      </View>
      <View style={styles.pad}>
        <GroupedHeader>Nome</GroupedHeader>
        <GroupedList>
          <GroupedRow label="Lia" />
        </GroupedList>
        <GroupedHeader>Foto</GroupedHeader>
        <GroupedList>
          <GroupedRow icon="image" label="Enviar foto" chevron onPress={() => {}} />
          <GroupedRow icon="agent" label="Usar avatar do DougBot" onPress={() => {}} />
        </GroupedList>
        <GroupedFooter>A foto aparece no lugar do bot desenhado, para todo o time.</GroupedFooter>
        <GroupedHeader>Sem foto, o bot desenhado</GroupedHeader>
        <View style={[styles.rowGap12, { paddingVertical: 8 }]}>
          <AgentAvatar agent={{ ...LIA, photo: null }} size={60} />
          <AgentAvatar agent={LIA} size={60} />
          <AgentAvatar agent={{ ...LIA, photo: "/api/app/foto-que-falha.jpg" }} size={60} />
        </View>
      </View>
    </Frame>
  );
}

export const TELAS: Record<string, () => ReactNode> = {
  login: Login,
  servidor: Servidor,
  inicio: () => <Inicio />,
  /** Doug pinned on Início in its states (docs/adr/doug-0016-doug-pinned.md). */
  doug: DougFixado,
  /** "Tudo": from Início's "Mais", from a conversation's "+", and choosing the pins. */
  tudo: () => <Tudo from="home" />,
  "tudo-conversa": () => <Tudo from="conversation" />,
  "tudo-editar": () => <Tudo from="home" editing />,
  /** The island resting as the signature, and grown into an agent's notice: with the camera's island, with a notch. */
  "ilha-camera": () => <IlhaCena kind="camera" />,
  "ilha-camera-aviso": () => <IlhaCena kind="camera" notice />,
  "ilha-entalhe": () => <IlhaCena kind="notch" />,
  "ilha-entalhe-aviso": () => <IlhaCena kind="notch" notice />,
  ligacao: () => <Ligacao />,
  chamando: () => <Ligacao ringing />,
  abas: Agentes,
  dm: () => <Dm />,
  /** My bubbles with Tom forte: the green itself, its own ink. */
  "dm-forte": () => <Dm tone="strong" />,
  /** The conversation's "…": the quick tiles (Ligar first) and the rest as a list. */
  "conversa-opcoes": () => <Dm over={<ConversaOpcoes />} />,
  grupo: Grupo,
  composer: ComposerTela,
  execucao: Execucao,
  busca: Busca,
  configuracoes: Configuracoes,
  aparencia: Aparencia,
  sobre: Sobre,
  /** The real tab screens over a fake server: Pendentes (with requests, and clear) and Ajustes. */
  pendentes: Pendentes,
  "pendentes-vazio": PendentesVazio,
  "pendentes-agendar": PendentesAgendar,
  ajustes: Ajustes,
  "ajustes-sobre": AjustesSobre,
  agente: Agente,
  time: Time,
  revisao: RevisaoLista,
  "revisao-video": RevisaoVideo,
  "revisao-conversa": RevisaoConversa,
  "revisao-design": RevisaoDesign,
  "revisao-design-editor": RevisaoDesignEditor,
  "revisao-design-conversa": RevisaoDesignConversa,
  "portal-cronograma": PortalCronograma,
  "portal-cronograma-320": PortalCronograma320,
  "portal-cartao": PortalCartao,
  "portal-cartao-longo": PortalCartaoLongo,
  "portal-quadro": PortalQuadro,
  "portal-quadro-320": PortalQuadro320,
  "portal-postados": PortalPostados,
  "portal-clientes": PortalClientes,
  "portal-cliente-editar": PortalClienteEditar,
  "portal-agendar": PortalAgendar,
  "portal-agendar-post": PortalAgendarPost,
  "portal-postados-320": PortalCronogramaPostados320,
  /** Tarefas opening on Equipe: who is doing what and what comes next; Minhas for who doesn't administer. */
  "tarefas-equipe": TarefasEquipe,
  "tarefas-equipe-aberta": TarefasEquipeAberta,
  "tarefas-equipe-vazia": TarefasEquipeVazia,
  "tarefas-minhas": TarefasMinhas,
  "time-doug-como": TimeDougComo,
  "time-doug-quem": TimeDougQuem,
  "time-doug-marca": TimeDougMarca,
  whatsapp: WhatsAppLista,
  "whatsapp-conversa": WhatsAppConversa,
  arquivos: Arquivos,
  senhas: Senhas,
  "senhas-item": SenhasItem,
  "senhas-logins": SenhasLogins,
  paineis: Paineis,
  "paineis-formas": PaineisFormas,
  "paineis-320": Paineis320,
  "painel-ia": PainelIa,
  "painel-ia-folha": PainelIaFolha,
  "painel-ia-320": PainelIa320,
  "painel-ia-folha-320": PainelIaFolha320,
  "agente-perfil": AgentePerfil,
  "time-agora": TimeAgora,
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overBar: { position: "absolute", top: 0, left: 0, right: 0 },
  pad: { paddingHorizontal: 16 },
  center: { textAlign: "center" },
  largeTitle: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  section: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  rowGap8: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  rowGap12: { flexDirection: "row", alignItems: "center", gap: 12 },
  tabBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 26,
    height: 64,
    borderRadius: 32,
    flexDirection: "row",
    padding: 5,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 27 },
  tabBadge: { position: "absolute", top: -4, right: -10 },
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 44,
  },
  barSide: { width: 88, flexDirection: "row", alignItems: "center", gap: 8 },
  widgets: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  widget: { flex: 1, minHeight: 92, borderRadius: 16, padding: 10, gap: 4 },
  widgetHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  widgetTitle: { flexShrink: 1, fontWeight: "500" },
  widgetBig: { fontWeight: "700" },
  tools: { flexDirection: "row", paddingHorizontal: 6, paddingTop: 12, paddingBottom: 4 },
  tools9: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 16, paddingBottom: 4 },
  panel: { marginHorizontal: 16, overflow: "hidden" },
  tool: { flex: 1, alignItems: "center", gap: 5 },
  toolPlate: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolBadge: { position: "absolute", top: -5, right: -7 },
  toolLabel: { fontFamily: DB_FONTES.texto500, fontSize: 10, lineHeight: 12, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, gap: 0 },
  cell: { width: "33.33%", alignItems: "center", gap: 6, paddingVertical: 10 },
  cellSmall: { width: "20%", alignItems: "center", gap: 6, paddingVertical: 6 },
  authHero: { alignItems: "center", paddingTop: 40, paddingBottom: 16 },
  // The pill centered on the screen's axis (as iOS centers a bar's title), the back and the buttons at the ends.
  chatHeader: { alignItems: "center", justifyContent: "center", height: 52, paddingBottom: 8 },
  barSideLeft: { position: "absolute", left: 12, top: 0 },
  barSideRight: { position: "absolute", right: 12, top: 0 },
  barBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  barCapsule: { flexDirection: "row", borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2 },
  bubbleLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "flex-end",
    columnGap: 8,
  },
  stamp: { marginLeft: "auto", lineHeight: 16 },
  dateWrap: { alignItems: "center" },
  // The app's `lookRows.bubble`: 22 round, 9 and 14 inside a 1 px rim, the turn's last corner cut to 8.
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, borderWidth: 1, maxWidth: "82%" },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 8 },
  theirs: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  theirBubble: { borderBottomLeftRadius: 8, flexShrink: 1 },
  chatText: { fontSize: 16, lineHeight: 24 },
  cardPad: { padding: 16 },
  stepMark: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  todo: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.5 },
  notice: { borderRadius: 16, borderWidth: 1, padding: 16 },
});
