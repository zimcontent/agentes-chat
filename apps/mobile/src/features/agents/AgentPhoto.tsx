import { keys, useApi } from "@agenteschat/client";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";

/** A picked photo as the multipart upload's `file` part (React Native's FormData takes `{ uri, name, type }`). */
export function photoForm(asset: { uri: string; mimeType?: string | null; fileName?: string | null }): FormData {
  const type = asset.mimeType && /^image\/(jpeg|png|webp)$/.test(asset.mimeType) ? asset.mimeType : "image/jpeg";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.append("file", { uri: asset.uri, name: asset.fileName || `foto.${ext}`, type } as unknown as Blob);
  return form;
}

/**
 * An agent's real photo (this fork: `PUT`/`DELETE …/organizations/{orgId}/agents/{agentId}/photo`, the same contract as the
 * web): picked from the library or taken with the camera, cropped square by the system (`allowsEditing`, 1:1), sent as
 * a JPEG (the picker exports one, so a HEIC photo arrives as JPEG). Removing it brings the DougBot drawn by code back.
 * Who may: the same people as the agent's look (its owner, or `manage_agents`).
 */
export function useAgentPhoto(agentId: string) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.agents(orgId) });

  const upload = async (from: "library" | "camera") => {
    if (from === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toast({ title: t("mobile.me.account.noCamera"), icon: "camera" });
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    const res =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    setBusy(true);
    try {
      await api.agents.setAgentPhoto(orgId, agentId, photoForm(asset));
      await refresh();
    } catch {
      toast({ title: t("mobile.photo.failed"), icon: "x" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.agents.removeAgentPhoto(orgId, agentId);
      await refresh();
    } catch {
      toast({ title: t("mobile.app.failed"), icon: "x" });
    } finally {
      setBusy(false);
    }
  };

  /** "Enviar foto": the library or the camera, as the system's own sheet. */
  const pick = () => {
    const labels = [t("mobile.photo.fromLibrary"), t("mobile.photo.fromCamera")];
    const run = (i: number) => {
      if (i === 0) void upload("library");
      else if (i === 1) void upload("camera");
    };
    if (Platform.OS === "ios")
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, t("mobile.common.cancel")], cancelButtonIndex: labels.length },
        run,
      );
    else
      Alert.alert(t("mobile.photo.upload"), undefined, [
        ...labels.map((text, i) => ({ text, onPress: () => run(i) })),
        { text: t("mobile.common.cancel"), style: "cancel" as const },
      ]);
  };

  return { pick, remove: () => void remove(), busy };
}

/** The agent's "Foto" block on its edit screen: "Enviar foto" and, with a photo, "Usar avatar do DougBot". */
export function AgentPhotoSection({ agentId, photo }: { agentId: string; photo: string | null | undefined }) {
  const { t } = useTranslation();
  const { pick, remove, busy } = useAgentPhoto(agentId);
  return (
    <>
      <GroupedHeader>{t("mobile.photo.section")}</GroupedHeader>
      <GroupedList>
        <GroupedRow icon="image" label={t("mobile.photo.upload")} onPress={pick} disabled={busy} chevron />
        {photo ? <GroupedRow icon="agent" label={t("mobile.photo.useBot")} onPress={remove} disabled={busy} /> : null}
      </GroupedList>
      <GroupedFooter>{t("mobile.photo.agentHint")}</GroupedFooter>
    </>
  );
}
