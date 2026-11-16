import { useIssues } from "@agenteschat/client";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Icon, type IconName, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { openIssuesWithMe } from "../me/logic";
import { useMediaOn } from "../media-gen/logic";
import { useColors, useMeId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { MentionCount } from "../shared/parts";
import { useUnreadThreads } from "../shared/queries";
import { useWhatsAppShown } from "../whatsapp/logic";

/** One tool on Início's grid: where it opens, its glyph, and how many wait in it (0: no badge). */
interface Tool {
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

function WhatsAppMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={WHATSAPP_PATH} fill={WHATSAPP_GREEN} />
    </Svg>
  );
}

/** Five to the row (four tools and "Mais"), each a small plate with its name under it. */
const ROW = 5;
const PLATE = 44;
const GLYPH = 20;

/**
 * Início's tools, in place of the widgets: everything the web keeps beside its five sidebar rows, summed up as one
 * row of small plates under the greeting: the first four, and "Mais" with the rest in a list. WhatsApp and Mídia only where the server has them
 * (as the web's sidebar); Threads only in a team's workspace (a personal one keeps it in Configurações).
 */
export function HomeTools() {
  const { t } = useTranslation();
  const { org, orgId } = useOrg();
  const meId = useMeId();
  const whatsapp = useWhatsAppShown();
  const media = useMediaOn();
  const issues = useIssues(orgId);
  const threads = useUnreadThreads();
  const tools: Tool[] = [
    ...(whatsapp
      ? [{ key: "whatsapp", label: "WhatsApp", href: "/whatsapp", icon: <WhatsAppMark size={GLYPH} /> }]
      : []),
    ...(media ? [{ key: "media", label: t("shell.media"), href: "/media", icon: "image" as const }] : []),
    { key: "drive", label: t("mobile.me.drive"), href: "/drive", icon: "drive" },
    { key: "team", label: t("mobile.agents.title"), href: "/agents", icon: "agent" },
    {
      key: "issues",
      label: t("mobile.me.issues"),
      href: "/issues",
      icon: "checkc",
      count: openIssuesWithMe(issues.data, meId),
    },
    ...(isPersonal(org)
      ? []
      : [
          {
            key: "threads",
            label: t("mobile.threads.title"),
            href: "/threads",
            icon: "reply" as const,
            count: threads,
          },
        ]),
    { key: "routines", label: t("routines.title"), href: "/routines", icon: "clock" },
    { key: "wiki", label: t("wiki.title"), href: "/wiki", icon: "book" },
    { key: "dashboards", label: t("mobile.me.dashboards"), href: "/dashboards", icon: "chart" },
  ];
  // The tools an admin took out of the workspace for everyone (Settings › General) leave here too, as on the web.
  const hidden = org?.hiddenTools ?? [];
  const shown = tools.filter((tool) => !hidden.includes(tool.key));
  // One row: the first four in sight, the rest behind "Mais" (with how many wait in them), so the home stays short.
  const front = shown.length > ROW ? shown.slice(0, ROW - 1) : shown;
  const rest = shown.slice(front.length);
  const restCount = rest.reduce((n, tool) => n + (tool.count ?? 0), 0);
  const more = () =>
    void pickOne({
      title: t("mobile.homeTools.title"),
      options: rest.map((tool) => ({
        key: tool.key,
        label: (tool.count ?? 0) > 0 ? `${tool.label} · ${tool.count}` : tool.label,
      })),
    }).then((key) => {
      const tool = rest.find((x) => x.key === key);
      if (tool) router.push(tool.href as never);
    });
  return (
    <View style={styles.row} accessibilityLabel={t("mobile.homeTools.title")}>
      {front.map((tool) => (
        <ToolTile key={tool.key} tool={tool} onPress={() => router.push(tool.href as never)} />
      ))}
      {rest.length > 0 ? (
        <ToolTile
          tool={{ key: "more", label: t("mobile.homeTools.more"), href: "", icon: "more", count: restCount }}
          onPress={more}
        />
      ) : null}
    </View>
  );
}

function ToolTile({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const c = useColors();
  const { shadows } = useTheme();
  const count = tool.count ?? 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${tool.label}, ${count}` : tool.label}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View
        style={[styles.plate, { backgroundColor: c.raised, boxShadow: `0px 0px 0px 0.5px ${c.line2}, ${shadows.e1}` }]}
      >
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
  row: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4 },
  tile: { flex: 1, alignItems: "center", gap: 5 },
  pressed: { opacity: 0.7 },
  plate: { width: PLATE, height: PLATE, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -5, right: -7 },
  label: { fontSize: 11, lineHeight: 13, fontWeight: "500", textAlign: "center" },
});
