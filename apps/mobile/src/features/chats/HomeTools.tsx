import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName, Text, useTheme } from "@/ui";
import { pillSurface, surfaceStyle } from "@/ui/surfaces";
import { useColors } from "../shared/hooks";
import { MentionCount } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { WhatsAppMark } from "../whatsapp/look";
import { AllSheet, openTool, useAllTools } from "./AllSheet";
import { waitingBehind } from "./all-tools";

export { WhatsAppMark };

/** One tool on Início's grid: where it opens, its glyph, and how many wait in it (0: no badge). */
export interface Tool {
  key: string;
  label: string;
  href: string;
  icon: IconName | ReactNode;
  count?: number;
}

/** Up to five to the row (four tools and "Mais"), each a round glass plate (the site's pill) with its name under it. */
const PLATE = 52;
const GLYPH = 21;

/**
 * Início's tools: one row of small plates under the bar. In front the four the person pinned in "Tudo" ("Editar
 * atalhos"); before anyone chose, what the team opens all day (WhatsApp, Mídia, Buscar, Tarefas), the next tools
 * taking the places of the ones this workspace lacks. "Mais" opens "Tudo": every tool, Buscar, and what to create
 * (the bar keeps no "+"). Threads aren't a tool: work is in Tarefas, missions included (ADR doug-0018).
 */
export function HomeTools() {
  const { t } = useTranslation();
  const sheet = useSheet();
  const { tools, front, counts } = useAllTools({ whatsappCount: true });
  const shown = front.flatMap((key) => tools.filter((tool) => tool.key === key));
  const waiting = waitingBehind(tools, front, counts);
  return (
    <View style={styles.row} accessibilityLabel={t("mobile.homeTools.title")}>
      {shown.map((tool) => (
        <ToolTile
          key={tool.key}
          tool={{
            key: tool.key,
            label: tool.label,
            href: tool.href,
            icon: tool.icon === "whatsapp" ? <WhatsAppMark size={GLYPH} /> : tool.icon,
            count: tool.count,
          }}
          onPress={() => openTool(tool)}
        />
      ))}
      <ToolTile
        tool={{ key: "more", label: t("mobile.homeTools.more"), href: "", icon: "more", count: waiting }}
        onPress={() => sheet.open(<AllSheet />)}
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
