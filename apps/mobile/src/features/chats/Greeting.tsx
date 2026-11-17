import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { AgentAvatar, Button, CARD_PAD, Card, Icon, Sky, Text } from "@/ui";
import { useCreateAgent } from "../agents/elsewhere";
import { mayCreate } from "../new/logic";
import { FirstUse } from "../shared/FirstUse";
import { useColors } from "../shared/hooks";
import { Tile, useSurface } from "../shared/parts";
import { FIRST_AGENT_EXAMPLES } from "./examples";

/** The look of an agent still to be born (the new-agent sheet and the empty state). */
export const NEWBORN = { color: "indigo", eyes: "round" } as const;

/**
 * Conversas with nothing in it yet: the sky with an agent about to
 * be born, one primary "Criar meu primeiro agente", and examples of what an agent can do (each opens "Novo
 * agente" with "o que faz" filled in). Who can't create agents gets the place's line instead.
 */
export function FirstAgentEmpty() {
  const { t } = useTranslation();
  const c = useColors();
  const surface = useSurface();
  const { org } = useOrg();
  // A first agent is asked of the right hand, the example's words already in its field.
  const newAgent = useCreateAgent();
  if (!mayCreate(org, "agent")) return <FirstUse place="agents" acts={false} />;
  return (
    <View>
      <View style={[styles.empty, surface]}>
        <View style={styles.emptySky}>
          <Sky color="indigo" depth={0.9} surface="raised" style={StyleSheet.absoluteFill} />
          <AgentAvatar agent={NEWBORN} size={78} />
        </View>
        <Text variant="display2" style={styles.center} accessibilityRole="header">
          {t("mobile.chats.first.title")}
        </Text>
        <Text variant="small" tone="muted" style={[styles.center, styles.emptyText]}>
          {t("mobile.homeNow.first.subtitle")}
        </Text>
        <View style={styles.acts}>
          <Button
            variant="primary"
            wide
            icon="plus"
            label={t("mobile.homeNow.first.create")}
            onPress={() => newAgent()}
          />
        </View>
      </View>
      <View style={styles.ideas}>
        <Text variant="label" style={styles.ideasTitle}>
          {t("mobile.homeNow.first.examples")}
        </Text>
        <Card>
          {FIRST_AGENT_EXAMPLES.map((ex, i) => (
            <Pressable
              key={ex.key}
              onPress={() => newAgent(t(`mobile.chats.first.example.${ex.key}.what`))}
              accessibilityRole="button"
              style={({ pressed }) => [styles.idea, pressed && { backgroundColor: c.sunken }]}
            >
              {i > 0 ? <View style={[styles.sep, { backgroundColor: c.line2 }]} /> : null}
              <Tile icon={ex.icon} size={IDEA_TILE} />
              <View style={styles.grow}>
                <Text variant="callout" style={styles.bold}>
                  {t(`mobile.chats.first.example.${ex.key}.title`)}
                </Text>
                <Text variant="footnote" tone="muted" numberOfLines={1}>
                  {t(`mobile.chats.first.example.${ex.key}.hint`)}
                </Text>
              </View>
              <Icon name="right" size={16} color={c.faint} />
            </Pressable>
          ))}
        </Card>
      </View>
    </View>
  );
}

/** The empty state's card: its padding, which the sky runs past to the card's edges. */
const EMPTY_PAD = CARD_PAD;
/** An example's row: its inset, the tile and the gap to the words (the hairline starts at the words). */
const IDEA_INSET = 14;
const IDEA_TILE = 36;
const IDEA_GAP = 12;

const styles = StyleSheet.create({
  empty: {
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 20,
    overflow: "hidden",
    padding: EMPTY_PAD,
    paddingTop: 0,
  },
  emptySky: {
    height: 150,
    marginHorizontal: -EMPTY_PAD,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  center: { textAlign: "center" },
  emptyText: { marginTop: 6, marginBottom: 20 },
  acts: { gap: 8 },
  ideas: { paddingHorizontal: 16, paddingTop: 20 },
  ideasTitle: { paddingHorizontal: 4, paddingBottom: 8 },
  idea: {
    flexDirection: "row",
    alignItems: "center",
    gap: IDEA_GAP,
    paddingHorizontal: IDEA_INSET,
    paddingVertical: 12,
    minHeight: 56,
  },
  // Between rows, inset to the text, as every list's hairline.
  sep: {
    position: "absolute",
    top: 0,
    left: IDEA_INSET + IDEA_TILE + IDEA_GAP,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
});
