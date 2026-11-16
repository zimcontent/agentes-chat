import type { ReactNode } from "react";
import { useState } from "react";
import { Platform, Text as RNText, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import type { AgentLookInput } from "@/agent/looks";
import { botDoAgente, corDoBot } from "@/brand/bots";
import { DB_FONTES } from "@/brand/tokens";
import { HeaderPill } from "@/features/chat/HeaderPill";
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
import {
  RevisaoConversa,
  RevisaoDesign,
  RevisaoDesignConversa,
  RevisaoDesignEditor,
  RevisaoLista,
  RevisaoVideo,
} from "./revisao";

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
}: {
  title?: string;
  children?: ReactNode;
  tabs?: string;
  header?: ReactNode;
  bottom?: ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, 47);
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
      <View style={{ height: top }} />
      {header}
      {scroll ? (
        <ScrollView style={styles.fill} contentContainerStyle={{ paddingBottom: 24 }}>
          {body}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{body}</View>
      )}
      {bottom}
      {tabs ? <TabBar on={tabs} /> : null}
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
  const { colors } = useTheme();
  return (
    <View style={[styles.tabBar, { backgroundColor: colors.glass, borderTopColor: colors.glassEdge }]}>
      {TAB_GLYPHS.map((g) => {
        const chosen = g === on;
        const badge = TAB_BADGES[g];
        return (
          <View key={g} style={styles.tab}>
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

/** The tabs' bar: DougBot's signature alone in the middle (doug-0014). */
export function TabHeader() {
  return (
    <View style={styles.tabHeader}>
      <View style={styles.barSide} />
      <Assinatura size={15} />
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
}: {
  a: AgentLookInput;
  sub: string;
  time?: string;
  mode?: "idle" | "run" | "think" | "sleep";
  unread?: number;
  divider?: boolean;
  presence?: "online" | "away" | "busy";
}) {
  const face = <AgentAvatar agent={a} size={50} mode={mode} name={a.name} />;
  return (
    <ListRow
      leading={
        presence ? (
          <WithPresence size={50} presence={presence}>
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
}: {
  name: string;
  icon?: string | null;
  sub: string;
  time: string;
  divider?: boolean;
}) {
  return (
    <ListRow
      leading={<GroupPhoto icon={icon ?? null} size={52} />}
      title={name}
      time={time}
      sub={sub}
      subLines={1}
      divider={divider}
    />
  );
}

const TOOLS: { key: string; label: string; icon: string; count?: number; green?: boolean }[] = [
  { key: "wa", label: "WhatsApp", icon: "message", green: true, count: 5 },
  { key: "midia", label: "Mídia", icon: "image" },
  { key: "busca", label: "Buscar", icon: "search" },
  { key: "tarefas", label: "Tarefas", icon: "checkc", count: 2 },
  { key: "drive", label: "Drive", icon: "drive" },
  { key: "agentes", label: "Agentes", icon: "agent" },
  { key: "threads", label: "Threads", icon: "reply" },
  { key: "rotinas", label: "Rotinas", icon: "clock" },
  { key: "wiki", label: "Wiki", icon: "book" },
  { key: "dash", label: "Dashboards", icon: "chart" },
];

function Ferramentas() {
  const { colors, shadows } = useTheme();
  const front = [...TOOLS.slice(0, 4), { key: "mais", label: "Mais", icon: "more", count: 0, green: false }];
  return (
    <View style={styles.tools}>
      {front.map((t) => (
        <View key={t.key} style={styles.tool}>
          <View
            style={[
              styles.toolPlate,
              { backgroundColor: colors.raised, boxShadow: `0px 0px 0px 0.5px ${colors.line2}, ${shadows.e1}` },
            ]}
          >
            {t.green ? (
              <SvgXml xml={WHATSAPP_SVG} width={18} height={18} />
            ) : (
              <Icon name={t.icon as never} size={18} color={colors.ink} />
            )}
            {t.count ? (
              <View style={styles.toolBadge}>
                <Count value={t.count} size={11} inverted fill={colors.badge} color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <RNText numberOfLines={1} style={[styles.toolLabel, { color: colors.muted }]}>
            {t.label}
          </RNText>
        </View>
      ))}
    </View>
  );
}

const WHATSAPP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

const WIDGETS = [
  { key: "t", icon: "reply", title: "Threads", big: "3 novas", line: "Capa do reels da LEXEER", hot: true },
  { key: "e", icon: "play", title: "Ronny", big: "Ajustando", line: "Built_to_Endure_Ep12_Corte1", hot: false },
  { key: "c", icon: "flag", title: "Alterações", big: "4", line: "ELMX Capital, LEXEER", hot: true },
] as const;

function Widgets() {
  const { colors, shadows } = useTheme();
  return (
    <View style={styles.widgets}>
      {WIDGETS.map((x) => (
        <View
          key={x.key}
          style={[
            styles.widget,
            { backgroundColor: colors.raised, boxShadow: `0px 0px 0px 0.5px ${colors.line2}, ${shadows.e1}` },
          ]}
        >
          <View style={styles.widgetHead}>
            <Icon name={x.icon} size={14} color={colors.muted} />
            <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.widgetTitle}>
              {x.title}
            </Text>
          </View>
          <Text
            variant="subhead"
            numberOfLines={1}
            style={[styles.widgetBig, x.hot ? { color: colors.amberInk } : null]}
          >
            {x.big}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={2}>
            {x.line}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Inicio() {
  const { colors } = useTheme();
  return (
    <Frame tabs="home" header={<TabHeader />}>
      <Ferramentas />
      <Widgets />
      <SECTION count={2}>Esperando sua resposta</SECTION>
      <ListRow
        leading={<AgentAvatar agent={SONY} size={50} name={SONY.name} />}
        title="SONY espera sua resposta"
        titleLines={2}
        time="5,4 h"
        chevron
      />
      <ListRow
        leading={<AgentAvatar agent={ROSA} size={50} name={ROSA.name} />}
        title="ROSA espera sua aprovação"
        titleLines={2}
        time="12 min"
        chevron
        divider
      />
      <SECTION count={6}>Agentes</SECTION>
      <AgentRow a={JUNIN} sub="Subi o ajuste do formulário." time="09:52" presence="online" />
      <AgentRow a={SONY} sub="esperando você · 5,4 h" time="09:40" divider />
      <AgentRow a={DOUG} sub="Resumi o dia dos grupos para você." time="09:12" unread={2} presence="online" divider />
      <AgentRow a={ROSA} sub="Pergunta: qual das duas capas?" time="08:55" mode="think" divider />
      <AgentRow a={KIARA} sub="Fechei o orçamento de novembro." time="Ontem" divider />
      <SECTION count={3}>Grupos</SECTION>
      <GroupRow name="LEXEER" icon={foto("lexeer")} sub="Doug BOSS: aprovado, pode subir." time="09:30" />
      <GroupRow
        name="ELMX Capital"
        icon={foto("elmx")}
        sub="KIARA: fechei o orçamento de novembro."
        time="08:02"
        divider
      />
      <SECTION count={1}>Pessoas</SECTION>
      <ListRow
        leading={<PersonAvatar name="Letícia" size={52} photo={null} />}
        title="Letícia"
        time="Ter"
        sub="Viu o vídeo novo?"
        subLines={1}
      />
      <View style={{ height: 8, backgroundColor: colors.bg }} />
    </Frame>
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

type Msg = { who: AgentLookInput | "eu"; text: string; mode?: "run" | "think" };

function Bubble({ m }: { m: Msg }) {
  const { colors } = useTheme();
  if (m.who === "eu")
    return (
      <View style={[styles.bubble, styles.mine, { backgroundColor: colors.bubble }]}>
        <Text variant="body" style={styles.chatText}>
          {m.text}
        </Text>
      </View>
    );
  return (
    <View style={styles.theirs}>
      <AgentAvatar agent={m.who} size={32} mode={m.mode ?? "idle"} />
      <View style={[styles.bubble, styles.theirBubble, { backgroundColor: colors.raised2 }]}>
        <BotName a={m.who} />
        <Text variant="body" style={[styles.chatText, { marginTop: 4 }]}>
          {m.text}
        </Text>
      </View>
    </View>
  );
}

function Chat({ header, msgs, extra }: { header: ReactNode; msgs: Msg[]; extra?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Frame
      scroll
      header={<View style={styles.chatHeader}>{header}</View>}
      bottom={
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 34) }}>
          <Composer placeholder="Mensagem" onSend={() => {}} onPlus={() => {}} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        <View style={styles.dateWrap}>
          <Chip label="Hoje" />
        </View>
        {msgs.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sample
          <Bubble key={i} m={m} />
        ))}
        {extra}
      </View>
    </Frame>
  );
}

function Dm() {
  return (
    <Chat
      header={
        <HeaderPill
          lead={<AgentAvatar agent={DOUG} size={32} />}
          title="Doug BOSS"
          subtitle="Chefe do time · disponível"
          label="Doug BOSS"
        />
      }
      msgs={[
        { who: "eu", text: "Doug, como estão os grupos hoje?" },
        { who: DOUG, text: "Tudo andando. A LEXEER aprovou o corte e a SONY já está exportando o 1080p." },
        { who: DOUG, text: "A ROSA tem uma dúvida sobre a capa da ELMX: te mando as duas opções aqui." },
        { who: "eu", text: "Manda!" },
      ]}
    />
  );
}

function Grupo() {
  return (
    <Chat
      header={
        <HeaderPill
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
  inicio: Inicio,
  abas: Agentes,
  dm: Dm,
  grupo: Grupo,
  composer: ComposerTela,
  execucao: Execucao,
  busca: Busca,
  configuracoes: Configuracoes,
  aparencia: Aparencia,
  sobre: Sobre,
  agente: Agente,
  time: Time,
  revisao: RevisaoLista,
  "revisao-video": RevisaoVideo,
  "revisao-conversa": RevisaoConversa,
  "revisao-design": RevisaoDesign,
  "revisao-design-editor": RevisaoDesignEditor,
  "revisao-design-conversa": RevisaoDesignConversa,
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
    flexDirection: "row",
    paddingTop: 8,
    paddingBottom: 30,
    borderTopWidth: 1,
  },
  tab: { flex: 1, alignItems: "center", gap: 3 },
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
  tool: { flex: 1, alignItems: "center", gap: 5 },
  toolPlate: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolBadge: { position: "absolute", top: -5, right: -7 },
  toolLabel: { fontFamily: DB_FONTES.texto500, fontSize: 10, lineHeight: 12, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, gap: 0 },
  cell: { width: "33.33%", alignItems: "center", gap: 6, paddingVertical: 10 },
  cellSmall: { width: "20%", alignItems: "center", gap: 6, paddingVertical: 6 },
  authHero: { alignItems: "center", paddingTop: 40, paddingBottom: 16 },
  chatHeader: { alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  dateWrap: { alignItems: "center" },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, maxWidth: "82%" },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  theirs: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  theirBubble: { borderBottomLeftRadius: 6, flexShrink: 1 },
  chatText: { fontSize: 16, lineHeight: 24 },
  cardPad: { padding: 16 },
  stepMark: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  todo: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.5 },
  notice: { borderRadius: 16, borderWidth: 1, padding: 16 },
});
