import { ApiError, useVaultItem, type VaultItemDetail } from "@dougbot/client";
import { relativeTime } from "@dougbot/client/lib/format";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, Text as RNText, StyleSheet, View } from "react-native";
import { Icon, PressScale, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { Face } from "../shared/Face";
import { useNow, useOrgId } from "../shared/hooks";
import { genderOf } from "../shared/logic";
import { MONO, successHaptic } from "../shared/parts";
import { CATEGORY_COLOR, CONTACT_FIELDS, hostOf, lastUse, vaultHref } from "./logic";
import { copyForAMinute, ItemTile, StarGlyph, useVaultFavorites, useVaultLook, vaultText } from "./look";
import { useVaultNames } from "./parts";

/**
 * An item opened over Senhas (ADR 0144), as the password managers open one: its tile, name and kind with "Editar",
 * its fields in one card with a copy button each (the clipboard clears itself a minute later), who may use it (people
 * and agents) and its last use. A saved password or key never comes back to a screen (§2): it shows as dots, said to
 * be kept for the agents, and changes on the item's page. No one-time codes: the Vault keeps no second factor (§1).
 */
export function VaultSheet({ id }: { id: string }) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const item = useVaultItem(useOrgId(), id);
  if (!item.data)
    return (
      <View style={[styles.sheet, styles.center, { backgroundColor: look.sheet }]}>
        {item.isError ? (
          <RNText style={[styles.small, { color: look.sub }]}>
            {item.error instanceof ApiError && item.error.status === 404
              ? t("mobile.vault.item.gone")
              : t("common.loadFailed")}
          </RNText>
        ) : (
          <ActivityIndicator color={look.sub} />
        )}
      </View>
    );
  return <ItemSheet item={item.data} />;
}

export function ItemSheet({ item }: { item: VaultItemDetail }) {
  const { t, i18n } = useTranslation();
  const look = useVaultLook();
  const toast = useToast();
  const orgId = useOrgId();
  const names = useVaultNames();
  const now = useNow(60_000);
  const favorites = useVaultFavorites(orgId);
  const starred = favorites.ids.has(item.id);
  const kindName = t(`mobile.vault.kind.${item.kind}`);
  const scopeName = item.scope === "personal" ? t("mobile.vault.tab.personal") : t("mobile.vault.tab.team");
  const copy = async (label: string, value: string) => {
    if (await copyForAMinute(value)) {
      successHaptic();
      toast({
        title: t("mobile.vault.sheet.copied", { label }),
        subtitle: t("mobile.vault.sheet.clears"),
        icon: "copy",
      });
    } else toast({ title: t("mobile.vault.sheet.copyFailed"), icon: "x" });
  };
  const open = () => router.push(vaultHref.item(item.id) as never);

  const fields: ReactNode[] = [];
  const add = (key: string, node: ReactNode) => fields.push(<View key={key}>{node}</View>);
  if (item.kind === "login") {
    if (item.username)
      add("user", <Field label={t("mobile.vault.sheet.username")} value={item.username} onCopy={copy} />);
    if (item.hasSecret) add("secret", <Sealed label={t("mobile.vault.sheet.password")} />);
    if (item.website)
      add(
        "site",
        <Field label={t("mobile.vault.sheet.site")} value={hostOf(item.website)} link={item.website} onCopy={copy} />,
      );
  }
  if (item.kind === "key") {
    if (item.keyName)
      add("name", <Field label={t("mobile.vault.sheet.keyName")} value={item.keyName} mono onCopy={copy} />);
    if (item.hasSecret)
      add(
        "secret",
        <Sealed
          label={t("mobile.vault.sheet.value")}
          {...(item.keyHint ? { hint: t("mobile.vault.sheet.endsIn", { hint: item.keyHint }) } : {})}
        />,
      );
  }
  if (item.kind === "contact")
    for (const f of CONTACT_FIELDS) {
      const value = item.contact?.[f];
      if (value) add(f, <Field label={t(`mobile.vault.contact.${f}`)} value={value} onCopy={copy} />);
    }
  if (item.description) add("note", <Field label={t("mobile.vault.sheet.note")} value={item.description} lines={3} />);

  const used = lastUse(item);
  const usedText = used
    ? used.agentId
      ? t(`mobile.vault.sheet.usedBy${genderOf(names.agent(used.agentId))}`, {
          name: names.agent(used.agentId),
          when: relativeTime(t, i18n.language, used.at, new Date(now)),
        })
      : t("mobile.vault.sheet.used", { when: relativeTime(t, i18n.language, used.at, new Date(now)) })
    : t("mobile.vault.sheet.neverUsed");

  return (
    <View style={[styles.sheet, { backgroundColor: look.sheet }]}>
      <View style={styles.head}>
        <ItemTile item={item} size={44} />
        <View style={styles.headText}>
          <RNText numberOfLines={2} style={[styles.name, { color: look.ink }]}>
            {item.title}
          </RNText>
          <RNText numberOfLines={1} style={[styles.small, { color: look.sub }]}>
            {`${kindName} · ${scopeName}`}
          </RNText>
        </View>
        <PressScale
          to={0.9}
          onPress={() => favorites.toggle(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: starred }}
          accessibilityLabel={starred ? t("mobile.vault.sheet.unstar") : t("mobile.vault.sheet.star")}
          hitSlop={8}
          style={styles.star}
          contentStyle={styles.centered}
        >
          <StarGlyph color={starred ? CATEGORY_COLOR.favorites : look.sub} size={20} filled={starred} />
        </PressScale>
        <PressScale to={0.95} onPress={open} accessibilityRole="button" hitSlop={10}>
          <RNText style={[styles.edit, { color: look.link }]}>
            {item.can.edit ? t("mobile.vault.sheet.edit") : t("mobile.vault.sheet.details")}
          </RNText>
        </PressScale>
      </View>
      {fields.length > 0 ? (
        <View style={[styles.fields, { backgroundColor: look.field }]}>
          {fields.map((f, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: the fields' order is fixed by the item's kind
              key={i}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: look.fieldSep } : null}
            >
              {f}
            </View>
          ))}
        </View>
      ) : null}
      <Who item={item} onAdd={item.can.edit ? () => router.push(vaultHref.itemAccess(item.id) as never) : null} />
      <View style={styles.foot}>
        <Icon name="clock" size={15} color={look.sub} />
        <RNText numberOfLines={1} style={[styles.small, styles.grow, { color: look.sub }]}>
          {usedText}
        </RNText>
        <PressScale to={0.95} onPress={open} accessibilityRole="button" hitSlop={10}>
          <RNText style={[styles.history, { color: look.link }]}>{t("mobile.vault.sheet.history")}</RNText>
        </PressScale>
      </View>
    </View>
  );
}

/** A field: its label in the accent, the value, and its copy button. */
function Field({
  label,
  value,
  link,
  mono = false,
  lines = 1,
  onCopy,
}: {
  label: string;
  value: string;
  link?: string;
  mono?: boolean;
  lines?: number;
  onCopy?: (label: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const text = (
    <RNText
      numberOfLines={lines}
      selectable
      style={[styles.value, { color: link ? look.link : look.ink }, mono && { fontFamily: MONO, fontSize: 15 }]}
    >
      {value}
    </RNText>
  );
  return (
    <View style={styles.field}>
      <RNText style={[styles.label, { color: look.label }]}>{label}</RNText>
      <View style={styles.valueRow}>
        {link ? (
          <PressScale
            to={0.98}
            fill={false}
            onPress={() => void Linking.openURL(link)}
            accessibilityRole="link"
            style={styles.grow}
          >
            {text}
          </PressScale>
        ) : (
          <View style={styles.grow}>{text}</View>
        )}
        {onCopy ? (
          <PressScale
            to={0.85}
            onPress={() => onCopy(label, value)}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.vault.sheet.copy", { label })}
            hitSlop={10}
            style={styles.action}
            contentStyle={styles.centered}
          >
            <Icon name="copy" size={18} color={look.sub} />
          </PressScale>
        ) : null}
      </View>
    </View>
  );
}

/** A saved password or key: dots, kept for the agents. It never comes back to a screen (ADR 0144 §2). */
function Sealed({ label, hint }: { label: string; hint?: string }) {
  const { t } = useTranslation();
  const look = useVaultLook();
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}, ${t("mobile.vault.sheet.sealed")}`}>
      <RNText style={[styles.label, { color: look.label }]}>{label}</RNText>
      <View style={styles.valueRow}>
        <RNText numberOfLines={1} style={[styles.value, styles.dots, styles.grow, { color: look.ink }]}>
          ••••••••••••
        </RNText>
        <Icon name="lock" size={15} color={look.sub} />
        <RNText numberOfLines={1} style={[styles.small, { color: look.sub }]}>
          {hint ?? t("mobile.vault.sheet.agentsOnly")}
        </RNText>
      </View>
    </View>
  );
}

/** "Quem pode usar": the people (or everyone) and the agents, each a chip with a face; "+" changes it. */
function Who({ item, onAdd }: { item: VaultItemDetail; onAdd: (() => void) | null }) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const names = useVaultNames();
  const a = item.access;
  const chips: ReactNode[] = [];
  const chip = (key: string, face: ReactNode, label: string) =>
    chips.push(
      <View key={key} style={[styles.chip, { backgroundColor: look.chip }]}>
        {face}
        <RNText numberOfLines={1} style={[styles.chipText, { color: look.ink }]}>
          {label}
        </RNText>
      </View>,
    );
  if (item.scope === "personal" && item.ownerUserId)
    chip(
      "owner",
      <Face who={{ type: "person", id: item.ownerUserId }} size={22} live={false} />,
      t("mobile.vault.sheet.onlyYou"),
    );
  if (item.scope === "team") {
    if (a.everyone) chip("all", <Icon name="members" size={16} color={look.sub} />, t("mobile.vault.sheet.everyone"));
    for (const id of a.userIds)
      chip(`u${id}`, <Face who={{ type: "person", id }} size={22} live={false} />, names.person(id));
    for (const id of a.roleIds) chip(`r${id}`, <Icon name="members" size={16} color={look.sub} />, names.role(id));
  }
  if (a.allAgents) chip("agents", <Icon name="agent" size={16} color={look.sub} />, t("mobile.vault.access.allAgents"));
  else
    for (const id of a.agentIds)
      chip(`a${id}`, <Face who={{ type: "agent", id }} size={22} live={false} />, names.agent(id));
  return (
    <View style={styles.who}>
      <RNText style={[styles.small, styles.whoLabel, { color: look.sub }]}>{t("mobile.vault.sheet.who")}</RNText>
      <View style={styles.chips}>
        {chips}
        {onAdd ? (
          <PressScale
            to={0.9}
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.vault.sheet.changeWho")}
            hitSlop={6}
            style={[styles.add, { backgroundColor: look.chip }]}
            contentStyle={styles.centered}
          >
            <Icon name="plus" size={15} color={look.sub} />
          </PressScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingTop: 25, paddingBottom: 16 },
  center: { alignItems: "center", justifyContent: "center", minHeight: 160 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 },
  headText: { flex: 1, minWidth: 0 },
  name: { fontFamily: vaultText.semibold, fontSize: 18, lineHeight: 23 },
  small: { fontFamily: vaultText.regular, fontSize: 13, lineHeight: 18 },
  star: { width: 32, height: 32 },
  centered: { alignItems: "center", justifyContent: "center" },
  edit: { fontFamily: vaultText.semibold, fontSize: 15 },
  fields: { marginTop: 14, borderRadius: 16, paddingHorizontal: 14 },
  field: { paddingVertical: 9 },
  label: { fontFamily: vaultText.medium, fontSize: 12, lineHeight: 16 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 2, minHeight: 24 },
  value: { fontFamily: vaultText.regular, fontSize: 16, lineHeight: 21 },
  dots: { letterSpacing: 2 },
  grow: { flex: 1, minWidth: 0 },
  action: { width: 24, height: 24 },
  who: { marginTop: 12, paddingHorizontal: 4 },
  whoLabel: { fontFamily: vaultText.medium, fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: {
    height: 32,
    borderRadius: 16,
    paddingLeft: 6,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: 200,
  },
  chipText: { fontFamily: vaultText.medium, fontSize: 13.5, flexShrink: 1 },
  add: { width: 32, height: 32, borderRadius: 16 },
  foot: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12, paddingHorizontal: 4, minHeight: 32 },
  history: { fontFamily: vaultText.semibold, fontSize: 13.5 },
});
