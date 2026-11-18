import { useIssues } from "@agenteschat/client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Icon, type IconName, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { pillSurface, surfaceStyle } from "@/ui/surfaces";
import { useCreateAgent } from "../agents/elsewhere";
import { openIssuesWithMe } from "../me/logic";
import { useMediaOn } from "../media-gen/logic";
import { mayCreate } from "../new/logic";
import { useColors, useMeId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { MentionCount } from "../shared/parts";
import { useWhatsAppShown } from "../whatsapp/logic";

/** One tool on Início's grid: where it opens, its glyph, and how many wait in it (0: no badge). */
export interface Tool {
  key: string;
  label: string;
  href: string;
  icon: IconName | ReactNode;
  count?: number;
}

/** WhatsApp's own mark (the web sidebar's), in its green: a tool of another service reads as that service. */
const WHATSAPP_GREEN = "#25D366";
const WHATSAPP_PATH =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

export function WhatsAppMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={WHATSAPP_PATH} fill={WHATSAPP_GREEN} />
    </Svg>
  );
}

/** This fork's own words, beside it in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: { search: "Buscar", newAgent: "Novo agente", newChat: "Nova conversa" },
  en: { search: "Search", newAgent: "New agent", newChat: "New conversation" },
} as const;

/** Up to five to the row (four tools and "Mais"), each a round glass plate (the site's pill) with its name under it. */
const FRONT = 4;
const PLATE = 52;
const GLYPH = 21;

/**
 * Início's tools: one row of small plates under the bar. In front what the team opens all day (WhatsApp, Mídia,
 * Buscar, Tarefas), the rest behind "Mais", which opens with "Novo agente" and "Nova conversa" (the bar keeps no "+")
 * and holds Drive and Agentes (the agents are already Início's list). WhatsApp and Mídia only where the server has them
 * (as the web's sidebar), their places taken by the next tools when they're off. Threads aren't a tool: work is in
 * Tarefas, missions included, and a thread opens from its conversation (ADR doug-0018).
 */
export function HomeTools() {
  const { t, i18n } = useTranslation();
  const w = WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const { org, orgId } = useOrg();
  const meId = useMeId();
  const whatsapp = useWhatsAppShown();
  const media = useMediaOn();
  const issues = useIssues(orgId);
  const createAgent = useCreateAgent();
  const tools: Tool[] = [
    ...(whatsapp
      ? [{ key: "whatsapp", label: "WhatsApp", href: "/whatsapp", icon: <WhatsAppMark size={GLYPH} /> }]
      : []),
    ...(media ? [{ key: "media", label: t("shell.media"), href: "/media", icon: "image" as const }] : []),
    { key: "search", label: w.search, href: "/search", icon: "search" },
    {
      key: "issues",
      label: t("mobile.me.issues"),
      href: "/issues",
      icon: "checkc",
      count: openIssuesWithMe(issues.data, meId),
    },
    { key: "drive", label: t("mobile.me.drive"), href: "/drive", icon: "drive" },
    { key: "team", label: t("mobile.agents.title"), href: "/agents", icon: "agent" },
    { key: "routines", label: t("routines.title"), href: "/routines", icon: "clock" },
    { key: "wiki", label: t("wiki.title"), href: "/wiki", icon: "book" },
    { key: "dashboards", label: t("mobile.me.dashboards"), href: "/dashboards", icon: "chart" },
  ];
  // The tools an admin took out of the workspace for everyone (Settings › General) leave here too, as on the web.
  const hidden = org?.hiddenTools ?? [];
  const shown = tools.filter((tool) => !hidden.includes(tool.key));
  const front = shown.slice(0, FRONT);
  // Creating comes first in "Mais": the bar's "+" lives here now.
  const create: Tool[] = [
    ...(mayCreate(org, "agent")
      ? [{ key: "new-agent", label: w.newAgent, href: "/new-agent", icon: "plus" as const }]
      : []),
    { key: "new", label: w.newChat, href: "/new", icon: "compose" },
  ];
  const rest = [...create, ...shown.slice(front.length)];
  const restCount = rest.reduce((n, tool) => n + (tool.count ?? 0), 0);
  const more = () =>
    void pickOne({
      title: t("mobile.homeTools.title"),
      options: rest.map((tool) => ({
        key: tool.key,
        label: (tool.count ?? 0) > 0 ? `${tool.label} · ${tool.count}` : tool.label,
        ...(typeof tool.icon === "string" ? { leading: { kind: "icon" as const, name: tool.icon as IconName } } : {}),
      })),
    }).then((key) => {
      const tool = rest.find((x) => x.key === key);
      // A new agent is asked of the right hand (the phone has no form for it).
      if (tool?.key === "new-agent") createAgent();
      else if (tool) router.push(tool.href as never);
    });
  return (
    <View style={styles.row} accessibilityLabel={t("mobile.homeTools.title")}>
      {front.map((tool) => (
        <ToolTile key={tool.key} tool={tool} onPress={() => router.push(tool.href as never)} />
      ))}
      <ToolTile
        tool={{ key: "more", label: t("mobile.homeTools.more"), href: "", icon: "more", count: restCount }}
        onPress={more}
      />
    </View>
  );
}

export function ToolTile({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const c = useColors();
  const { scheme } = useTheme();
  const count = tool.count ?? 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${tool.label}, ${count}` : tool.label}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.plate, surfaceStyle(pillSurface(scheme), PLATE / 2)]}>
        {typeof tool.icon === "string" ? <Icon name={tool.icon as IconName} size={GLYPH} color={c.ink} /> : tool.icon}
        {count > 0 ? (
          <View style={styles.badge}>
            <MentionCount count={count} />
          </View>
        ) : null}
      </View>
      <Text variant="footnote" tone="muted" style={styles.label} numberOfLines={1}>
        {tool.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Room above and below: the plates' hairline and shadow are never cut.
  row: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 16, paddingBottom: 4 },
  tile: { flex: 1, alignItems: "center", gap: 6 },
  pressed: { opacity: 0.7 },
  plate: { width: PLATE, height: PLATE, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -4 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "500", textAlign: "center" },
});
