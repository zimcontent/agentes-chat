import type { PortalColumn, PortalItem } from "@dougbot/client";
import { useApproveForClient, useSchedulePortalItem } from "@dougbot/client";
import { portalLink, portalScheduling, portalWhen } from "@dougbot/client/lib/portal";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, StyleSheet, TextInput, View } from "react-native";
import { Button, Chip, GroupedHeader, GroupedList, GroupedRow, Text, useFieldText, useToast } from "@/ui";
import { useColors, useOrgId } from "../shared/hooks";
import { successHaptic } from "../shared/parts";
import { usePortalFailed, usePortalRights, usePortalWords } from "./hooks";
import { releaseDateOf } from "./model";
import { StatusChip } from "./parts";

/** A web address the portal sent, in the in-app browser (the system's browser when that can't open). */
export const openLink = (href: string) => void openBrowserAsync(href).catch(() => Linking.openURL(href));

/**
 * A post at the portal (ADR 9001), as a card's screen or its own shows it: where it stands, what it still lacks, the
 * client's last words on it (outside text, plain words), its date, editor and caption, and what can be done from the
 * phone. "Open at the portal" (or the published post) for everyone; "Schedule for <its date>" for who may change the
 * board, on an approved post that carries a date still ahead and wasn't released yet (another date is chosen on the
 * web); "Approve for the client" for an administrator, on a post waiting on the client, with a reason.
 */
export function PostPanel({
  client,
  item,
  column,
  caption = true,
}: {
  client: string;
  item: PortalItem;
  column: Exclude<PortalColumn, "todo" | "doing">;
  /** Whether to show the caption (a card's screen already shows its own). */
  caption?: boolean;
}) {
  const w = usePortalWords();
  const { i18n } = useTranslation();
  const c = useColors();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = usePortalFailed();
  const field = useFieldText("body");
  const { changes, approves } = usePortalRights();
  const schedule = useSchedulePortalItem(orgId);
  const approve = useApproveForClient(orgId);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState("");
  const link = portalLink(item.postUrl) ?? portalLink(item.link);
  const release = changes ? releaseDateOf(item) : null;
  const releaseWhen = release ? (portalWhen(i18n.language, release) ?? release) : null;
  const day = portalWhen(i18n.language, item.scheduledFor);
  const mayApprove = approves && column === "approval";
  const asked = item.lastNote?.text ? item.lastNote : null;

  const doSchedule = () => {
    if (!release || !releaseWhen) return;
    Alert.alert(w.scheduleTitle, w.scheduleText, [
      { text: w.cancel, style: "cancel" },
      {
        text: w.confirm,
        onPress: () =>
          schedule.mutate(
            { client, itemId: item.id, scheduledFor: release },
            {
              onSuccess: () => {
                successHaptic();
                toast({ title: w.scheduled(releaseWhen), icon: "check" });
              },
              onError: failed,
            },
          ),
      },
    ]);
  };
  const doApprove = () =>
    approve.mutate(
      { client, itemId: item.id, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          successHaptic();
          setApproving(false);
          setNote("");
          toast({ title: w.approved(item.title), icon: "check" });
        },
        onError: failed,
      },
    );

  return (
    <View style={styles.part}>
      <View>
        <GroupedHeader>{w.post}</GroupedHeader>
        <GroupedList>
          <GroupedRow
            label={w.stage}
            below={
              <View style={styles.chips}>
                <StatusChip status={item.status} />
                {portalScheduling(item) ? <Chip icon="clock" label={w.scheduling} /> : null}
                {item.missing.map((m) => (
                  <Chip key={m} icon="flag" label={w.missing[m]} />
                ))}
              </View>
            }
          />
          <GroupedRow label={w.postOn} value={day ?? w.noDate} />
          {item.editor ? <GroupedRow label={w.editor} value={item.editor} /> : null}
          {asked ? (
            <GroupedRow
              label={asked.by || (column === "adjusting" ? w.clientAsked : w.lastNote)}
              sub={asked.text}
              subLines={12}
            />
          ) : null}
          {caption ? <GroupedRow label={w.caption} sub={item.caption || w.noCaption} subLines={40} /> : null}
        </GroupedList>
      </View>
      {approving ? (
        <View style={styles.approve}>
          <Text variant="footnote" tone="muted">
            {w.approveText}
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={w.approveNote}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.approveNote}
            maxLength={500}
            style={[styles.field, field, { color: c.ink, backgroundColor: c.raised }]}
          />
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                variant="secondary"
                wide
                label={w.cancel}
                onPress={() => setApproving(false)}
                disabled={approve.isPending}
              />
            </View>
            <View style={styles.grow}>
              <Button variant="primary" wide label={w.approve} onPress={doApprove} loading={approve.isPending} />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {releaseWhen ? (
            <Button
              variant="primary"
              wide
              label={w.schedule(releaseWhen)}
              onPress={doSchedule}
              loading={schedule.isPending}
            />
          ) : null}
          {mayApprove ? (
            <Button variant="secondary" wide label={w.approveForClient} onPress={() => setApproving(true)} />
          ) : null}
          {link ? (
            <Button
              variant="secondary"
              wide
              label={item.postUrl ? w.seePost : w.openAtPortal}
              onPress={() => openLink(link)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  part: { gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  actions: { gap: 8 },
  approve: { gap: 10 },
  field: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
});
