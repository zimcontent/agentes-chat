import type { Message } from "@dougbot/client";
import { type ProofItem, type ProofKind, proofLine, proofOf } from "@dougbot/client/lib/proof";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { openLink } from "../portal/PostPanel";
import { useColors } from "../shared/hooks";

const ICONS: Record<ProofKind, IconName> = {
  file: "file",
  image: "image",
  task: "issue",
  link: "link",
  action: "send",
};

/**
 * Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md) on the phone: under an agent's reply, one quiet line of
 * what its run really delivered, each opening what it names (a file's screen, the task, the page in the browser). The
 * first few, then "+N", which shows the rest. The web's `ProofLine`, with the same rules (`proofOf`, `proofLine`).
 */
export function ProofLine({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = proofOf(message.meta);
  if (message.author.type !== "agent" || items.length === 0) return null;
  const { shown, more } = proofLine(items, open);
  return (
    <View style={[styles.line, open && styles.open]} accessibilityLabel={t("deliveryProof.group")}>
      {shown.map((item) => (
        <Chip key={`${item.kind}:${item.ref ?? item.label}`} item={item} />
      ))}
      {more > 0 ? (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("deliveryProof.showAll")}
          hitSlop={HIT}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Text variant="caption" tone="faint" style={styles.tabular}>
            +{more}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Up and down to the 44 a finger needs; the chips stay a footnote's height. */
const HIT = { top: 10, bottom: 10 };

function Chip({ item }: { item: ProofItem }) {
  const { t } = useTranslation();
  const c = useColors();
  const label = item.kind === "image" ? item.label || t("deliveryProof.screenshot") : item.label;
  const ref = item.ref;
  const go =
    (item.kind === "file" || item.kind === "image") && ref
      ? () => router.push({ pathname: "/file/[id]", params: { id: ref } })
      : item.kind === "task" && ref
        ? () => router.push(`/issues/${ref}`)
        : item.kind === "link" && ref
          ? () => openLink(ref)
          : null;
  const inner = (
    <>
      <Icon name={ICONS[item.kind]} size={13} color={c.faint} />
      <Text variant="caption" tone="faint" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (!go) return <View style={styles.chip}>{inner}</View>;
  return (
    <Pressable
      onPress={go}
      accessibilityRole={item.kind === "link" ? "link" : "button"}
      accessibilityLabel={label}
      hitSlop={HIT}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", columnGap: 12, rowGap: 4, marginTop: 8, overflow: "hidden" },
  open: { flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24, flexShrink: 1, maxWidth: 200 },
  label: { flexShrink: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.6 },
});
