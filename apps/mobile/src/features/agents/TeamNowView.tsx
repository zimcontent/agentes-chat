import type { ReactNode } from "react";
import { Pressable, Text as RNText, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AgentLookInput } from "@/agent/looks";
import { DB_FONTES } from "@/brand/tokens";
import { AgentAvatar, type AgentMode } from "@/ui";
import { useColors } from "../shared/hooks";
import { card } from "./ProfileView";

/*
 * "Seu time agora" on the phone: the right hand on top with how many agents it coordinates, then each agent with its
 * face, name and trade, what it is on now and how far (a bar when its work has a plan), or that it waits on you or is
 * stopped. Drawn from plain values (the screen reads them; the board shows samples).
 */

export interface TeamNowRow {
  key: string;
  look: AgentLookInput;
  mode: AgentMode;
  name: string;
  /** Its trade in plain words ("design"). */
  trade: string | null;
  /** What it is on, or its state ("Parada"). */
  line: string;
  /** Under it: since when, "espera você" (amber) or why it stopped. */
  sub: string | null;
  waiting: boolean;
  /** 0–1: its work's plan done. Null: no bar. */
  progress: number | null;
  onPress: () => void;
}

export interface TeamNowViewProps {
  lead: { look: AgentLookInput; title: string; sub: string | null; onPress?: () => void } | null;
  rows: TeamNowRow[];
  /** Words for a team with no agents yet. */
  empty: string;
  /** Room above the content for the bar. */
  top?: number;
  header?: ReactNode;
}

export function TeamNowView({ lead, rows, empty, top = 0, header }: TeamNowViewProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.page, { paddingTop: top + 12, paddingBottom: insets.bottom + 24 }]}
      >
        {lead ? (
          <Pressable
            onPress={lead.onPress}
            disabled={!lead.onPress}
            accessibilityRole={lead.onPress ? "button" : undefined}
            style={({ pressed }) => [styles.lead, pressed ? styles.pressed : null]}
          >
            <AgentAvatar agent={lead.look} size={46} name={lead.look.name} />
            <View style={styles.grow}>
              <RNText style={[styles.leadTitle, { color: c.ink }]}>{lead.title}</RNText>
              {lead.sub ? <RNText style={[styles.leadSub, { color: c.muted }]}>{lead.sub}</RNText> : null}
            </View>
          </Pressable>
        ) : null}
        <View style={[styles.list, card(c)]}>
          {rows.length === 0 ? (
            <View style={styles.row}>
              <RNText style={[styles.sub, { color: c.muted }]}>{empty}</RNText>
            </View>
          ) : (
            rows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={r.onPress}
                accessibilityRole="button"
                accessibilityLabel={[r.name, r.trade, r.line, r.sub].filter(Boolean).join(", ")}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: c.line } : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <AgentAvatar agent={r.look} size={38} mode={r.mode} name={r.name} />
                <View style={styles.grow}>
                  <RNText numberOfLines={1} style={[styles.name, { color: c.ink }]}>
                    {r.name}
                    {r.trade ? <RNText style={[styles.trade, { color: c.muted }]}>{` · ${r.trade}`}</RNText> : null}
                  </RNText>
                  <RNText numberOfLines={2} style={[styles.line, { color: c.ink }]}>
                    {r.line}
                  </RNText>
                  {r.sub ? (
                    <RNText numberOfLines={1} style={[styles.sub, { color: r.waiting ? c.amberInk : c.muted }]}>
                      {r.sub}
                    </RNText>
                  ) : null}
                  {r.progress !== null ? (
                    <View style={[styles.bar, { backgroundColor: c.plate }]}>
                      <View
                        style={[styles.done, { width: `${Math.round(r.progress * 100)}%`, backgroundColor: c.ink }]}
                      />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
      {header}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: 16, gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  lead: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, paddingHorizontal: 4 },
  leadTitle: { fontFamily: DB_FONTES.titulo700, fontSize: 16, lineHeight: 22 },
  leadSub: { fontFamily: DB_FONTES.texto400, fontSize: 13, lineHeight: 18 },
  list: { borderRadius: 22, paddingHorizontal: 14, paddingVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, minHeight: 60 },
  name: { fontFamily: DB_FONTES.titulo700, fontSize: 15, lineHeight: 19 },
  trade: { fontFamily: DB_FONTES.texto400, fontSize: 13 },
  line: { fontFamily: DB_FONTES.texto400, fontSize: 13.5, lineHeight: 17, marginTop: 1 },
  sub: { fontFamily: DB_FONTES.texto400, fontSize: 12.5, lineHeight: 16 },
  bar: { height: 4, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  done: { height: "100%", borderRadius: 2 },
});
