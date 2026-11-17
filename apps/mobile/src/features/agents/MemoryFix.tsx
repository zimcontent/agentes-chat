import type { Memory } from "@agenteschat/client";
import { useMemoryAction } from "@agenteschat/client";
import { FIELD_LIMITS } from "@agenteschat/client/lib/field-limits";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Icon, Locked, Text, useToast } from "@/ui";
import { useColors, useErrorToast, useOrgId } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { overLimit, TextArea } from "../shared/TextArea";

const MEMORY_LIMIT = { max: FIELD_LIMITS.memory };

/** "Corrigir uma memória": edit the text (the old one stays in the history) or forget it (archived). */
export function MemoryFix({
  memory: m,
  agentId,
  agentName,
  g,
  source,
  onSee,
  onDone,
  title,
}: {
  memory: Memory;
  agentId: string;
  agentName: string;
  g: string;
  source: string;
  onSee: (() => void) | undefined;
  onDone: () => void;
  /** In place of "Corrigir a memória de…" (the team's memory, ADR 0167). */
  title?: string;
}) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const toast = useToast();
  const action = useMemoryAction(orgId, agentId);
  const [text, setText] = useState(m.text);
  const changed = text.trim() !== "" && text.trim() !== m.text.trim() && !overLimit(text, MEMORY_LIMIT);
  const failed = useErrorToast();
  const save = () =>
    action.mutate(
      { type: "edit", id: m.id, text: text.trim() },
      {
        onSuccess: () => {
          toast({ title: t("mobile.intentAgents.fix.saved"), agentId });
          onDone();
        },
        onError: failed,
      },
    );
  const forget = () =>
    action.mutate(
      { type: "archive", id: m.id, archived: true },
      {
        onSuccess: () => {
          toast({ title: t("mobile.intentAgents.fix.forgotten"), agentId });
          onDone();
        },
        onError: failed,
      },
    );
  return (
    <>
      <SheetTitle title={title ?? t(`mobile.intentAgents.fix.title${g}`, { name: agentName })} />
      <Locked when={action.isPending}>
        <TextArea value={text} onChangeText={setText} autoFocus limit={MEMORY_LIMIT} />
      </Locked>
      <View style={styles.src}>
        <Icon name="chat" size={15} color={c.muted} />
        <Text variant="small" tone="muted" numberOfLines={1} style={styles.grow}>
          {source}
        </Text>
        {onSee ? (
          <Pressable
            onPress={onSee}
            accessibilityRole="link"
            hitSlop={12}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text variant="small" tone="ink2" style={styles.bold}>
              {t("mobile.intentAgents.fix.see")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Button
        variant="primary"
        wide
        icon="check"
        label={t("mobile.intentAgents.fix.save")}
        disabled={!changed || action.isPending}
        onPress={save}
      />
      <Button
        variant="ghost"
        wide
        label={t("mobile.intentAgents.fix.forget")}
        disabled={action.isPending}
        onPress={forget}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  pressed: { opacity: 0.6 },
  src: { flexDirection: "row", alignItems: "center", gap: 6 },
});
