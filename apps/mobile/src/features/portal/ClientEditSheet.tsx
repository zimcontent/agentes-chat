import type { PortalClientColor } from "@agenteschat/client";
import {
  usePortalOverview,
  useSetPortalClientColor,
  useSetPortalClientHidden,
  useSetPortalClientLogo,
  useSetPortalClientName,
} from "@agenteschat/client";
import {
  PORTAL_CLIENT_COLORS,
  portalClientColors,
  portalClientLogos,
  portalClientName,
  portalClientSlugName,
} from "@agenteschat/client/lib/portal";
import * as ImagePicker from "expo-image-picker";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { GroupedList, GroupedRow, Icon, Text, useTheme, useToast } from "@/ui";
import { PHOTO_MAX_BASE64, photoContentType } from "../me/logic";
import { useOrgId } from "../shared/hooks";
import { PromptForm, SheetTitle } from "../shared/PromptForm";
import { errorHaptic, successHaptic } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { usePortalFailed, usePortalWords } from "./hooks";
import { CLIENT_COLOR } from "./model";
import { ClientMark } from "./parts";

/** The longest name the team may give a client (`PORTAL_CLIENT_NAME_MAX` on the server). */
const NAME_MAX = 60;

/**
 * A client's own sheet on the Portal tab (ADR 9001, addendum 2026-11-18), for who may change the portal: its name,
 * its picture (from the photo library, cropped square, or removed) and its colour, as the web's client menu, and
 * "Remove client", which hides it from every list after a confirmation that names it. The portal has no rename or
 * delete for a client: the name and the removal are kept on this side; the picture and colour are the portal's.
 */
export function ClientEditSheet({ client }: { client: string }) {
  const w = usePortalWords();
  const e = w.clientEdit;
  const orgId = useOrgId();
  const sheet = useSheet();
  const toast = useToast();
  const failed = usePortalFailed();
  const { colors: c } = useTheme();
  const clients = usePortalOverview(orgId).data?.clients;
  const logo = portalClientLogos(clients).get(client);
  const color = portalClientColors(clients).get(client);
  const rename = useSetPortalClientName(orgId);
  const setColor = useSetPortalClientColor(orgId);
  const setLogo = useSetPortalClientLogo(orgId, client);
  const hide = useSetPortalClientHidden(orgId);
  const name = portalClientName(client);
  const slugName = portalClientSlugName(client);

  const askName = () =>
    sheet.open(
      <PromptForm
        leading={<ClientMark client={client} logo={logo} color={color} size={36} />}
        title={e.renameTitle}
        intro={e.renameIntro(slugName)}
        placeholder={slugName}
        submitLabel={w.save}
        icon="check"
        initial={name}
        allowEmpty
        limit={{ max: NAME_MAX }}
        onSubmit={async (typed) => {
          try {
            // The id's own reading is no name of the team's.
            await rename.mutateAsync({ client, name: typed && typed !== slugName ? typed : null });
            sheet.close();
            successHaptic();
            toast({ title: e.renamed, icon: "check" });
          } catch (error) {
            errorHaptic();
            failed(error);
          }
        }}
      />,
    );

  // The library opens once the sheet is gone: iOS presents one thing at a time.
  const pickPicture = () =>
    sheet.close(async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset?.base64) return;
      if (asset.base64.length > PHOTO_MAX_BASE64) {
        toast({ title: e.pictureTooBig, icon: "x" });
        return;
      }
      try {
        await setLogo.mutateAsync({
          imageBase64: asset.base64,
          contentType: photoContentType(asset.mimeType, asset.fileName, asset.base64),
        });
        successHaptic();
        toast({ title: e.pictureSaved, icon: "check" });
      } catch (error) {
        errorHaptic();
        failed(error);
      }
    });

  const removePicture = () =>
    setLogo.mutate(null, {
      onSuccess: () => toast({ title: e.pictureRemoved, icon: "check" }),
      onError: failed,
    });

  const pickColor = (next: PortalClientColor | null) => {
    if (next === (color ?? null)) return;
    setColor.mutate({ client, color: next }, { onError: failed });
  };

  const askRemove = () =>
    Alert.alert(e.removeTitle(name), e.removeText, [
      { text: w.cancel, style: "cancel" },
      {
        text: e.remove,
        style: "destructive",
        onPress: () =>
          hide.mutate(
            { client, hidden: true },
            {
              onSuccess: () => {
                sheet.close();
                successHaptic();
                toast({ title: e.removed(name), icon: "check" });
              },
              onError: failed,
            },
          ),
      },
    ]);

  return (
    <>
      <SheetTitle
        leading={<ClientMark client={client} logo={logo} color={color} size={44} />}
        title={name}
        subtitle={e.title}
      />
      <GroupedList>
        <GroupedRow key="name" label={e.name} value={name} chevron onPress={askName} />
        <GroupedRow
          key="picture"
          icon="image"
          label={e.choosePicture}
          disabled={setLogo.isPending}
          onPress={pickPicture}
        />
        {logo ? (
          <GroupedRow
            key="unpicture"
            icon="trash"
            label={e.removePicture}
            disabled={setLogo.isPending}
            onPress={removePicture}
          />
        ) : null}
      </GroupedList>
      <View style={styles.colors}>
        <Text variant="footnote" tone="muted">
          {e.color}
        </Text>
        <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={e.color}>
          <Swatch label={e.noColor} on={!color} onPress={() => pickColor(null)} fill={c.chip} ink={c.muted} none />
          {PORTAL_CLIENT_COLORS.map((value) => (
            <Swatch
              key={value}
              label={e.colors[value]}
              on={color === value}
              onPress={() => pickColor(value)}
              fill={CLIENT_COLOR[value].bg}
              ink={CLIENT_COLOR[value].ink}
            />
          ))}
        </View>
      </View>
      <GroupedList>
        <GroupedRow key="remove" icon="trash" label={e.remove} danger disabled={hide.isPending} onPress={askRemove} />
      </GroupedList>
    </>
  );
}

/** One colour to pick: a dot a finger's 44 points wide, a check on the chosen one; "no colour" (`none`) has an ×. */
function Swatch({
  label,
  on,
  fill,
  ink,
  none = false,
  onPress,
}: {
  label: string;
  on: boolean;
  fill: string;
  ink: string;
  none?: boolean;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.swatch, pressed ? styles.pressed : null]}
    >
      <View style={[styles.dot, { backgroundColor: fill, borderColor: on ? c.ink : c.line }, on ? styles.dotOn : null]}>
        {on ? <Icon name="check" size={16} color={ink} /> : none ? <Icon name="x" size={14} color={ink} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  colors: { gap: 8 },
  swatches: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  swatch: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  dotOn: { borderWidth: 2 },
  pressed: { opacity: 0.6 },
});
