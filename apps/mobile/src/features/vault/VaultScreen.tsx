import { useVault, type VaultConnection, type VaultItem, type VaultOverview } from "@agenteschat/client";
import { joinNames } from "@agenteschat/client/lib/format";
import { webSettingsUrl } from "@agenteschat/client/lib/server";
import { vaultNoAgents } from "@agenteschat/client/lib/vault";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  RefreshControl,
  Text as RNText,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { serverUrl } from "@/lib/server";
import {
  Button,
  Chip,
  EmptyState,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  type IconName,
  PressScale,
  SCREEN_X,
  Text,
} from "@/ui";
import { router } from "@/ui/navigation";
import { Note, openPage } from "../ai/parts";
import { FirstUse } from "../shared/FirstUse";
import { useNow, useOrgId, usePullRefresh } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import { ScreenTopBar } from "../shared/ScreenTopBar";
import {
  CATEGORY_COLOR,
  connectionLine,
  connectionState,
  firstTab,
  itemLine,
  VAULT_KINDS,
  type VaultTab,
  type VaultView,
  vaultCounts,
  vaultHref,
  viewItems,
} from "./logic";
import { ItemTile, StarGlyph, useVaultFavorites, useVaultLook, vaultText } from "./look";

/** Each category's glyph: a login's key, a key's lock, a contact's person; the managers' lightning. */
const CATEGORY_ICON: Record<"login" | "key" | "contact" | "connections", IconName> = {
  login: "key",
  key: "lock",
  contact: "person",
  connections: "bolt",
};

/**
 * Senhas (the Vault, ADR 0144) the way the password managers people know open: the vault on top (Equipe or Pessoal,
 * with its count), the search, Favoritos, then the categories of the Vault's own model (Logins, Chaves, Contatos) with
 * their counts, and the password managers connected. Tapping the search lists everything, and the words narrow it; a
 * category lists its items. An item opens in a sheet over the list.
 */
export function VaultScreen({ start = "home" }: { start?: VaultView } = {}) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const insets = useSafeAreaInsets();
  const orgId = useOrgId();
  const vault = useVault(orgId);
  const pull = usePullRefresh(vault.refetch);
  const favorites = useVaultFavorites(orgId);
  const [tab, setTab] = useState<Exclude<VaultTab, "connections"> | null>(null);
  const [view, setView] = useState<VaultView>(start);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const data = vault.data;
  const current = tab ?? (data ? (firstTab(data) === "personal" ? "personal" : "team") : "team");
  const counts = vaultCounts(data);
  // A new item starts where the person is: the team's vault adds to the team when they may.
  const mayAdd = current === "personal" || (data?.canManageTeam ?? false);
  const newItem = () => router.push(vaultHref.create(current) as never);

  const switchVault = async () => {
    const key = await pickOne({
      title: t("mobile.vault.home.vaults"),
      options: (["team", "personal"] as const).map((k) => ({
        key: k,
        label: t(`mobile.vault.tab.${k}`),
        sub: t("mobile.vault.home.items", { count: counts[k] }),
        leading: { kind: "icon" as const, name: (k === "team" ? "members" : "lock") as IconName },
      })),
      value: current,
    });
    if (key === "team" || key === "personal") {
      setTab(key);
      setView((v) => (v === "connections" ? v : "home"));
    }
  };
  const plus = () =>
    showActionSheet(t("mobile.vault.newItem"), [
      ...(mayAdd ? [{ label: t("mobile.vault.newItem"), onPress: newItem }] : []),
      ...(mayAdd ? [{ label: t("vault.env.open"), onPress: () => router.push(vaultHref.env(current) as never) }] : []),
      { label: t("mobile.vault.import.title"), onPress: () => openPage(webSettingsUrl(serverUrl(), orgId, "vault")) },
    ]);
  const back = () => {
    if (searching || q) {
      setQ("");
      setSearching(false);
    } else if (view !== "home") setView("home");
    else router.back();
  };

  const title =
    view === "home"
      ? t("mobile.vault.home.title")
      : view === "favorites"
        ? t("mobile.vault.home.favorites")
        : view === "connections"
          ? t("mobile.vault.home.connections")
          : t(`mobile.vault.kinds.${view}`);
  const listing = searching || q.trim() !== "" || (view !== "home" && view !== "connections");

  return (
    <View style={[styles.fill, { backgroundColor: look.bg }]}>
      <ScreenTopBar
        onBack={back}
        middle={
          <PressScale
            to={0.96}
            onPress={() => void switchVault()}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.vault.home.switch", {
              name: t(`mobile.vault.tab.${current}`),
              count: counts[current],
            })}
            style={[styles.switcher, { backgroundColor: look.pill }]}
            contentStyle={styles.switcherIn}
          >
            <Icon name={current === "team" ? "members" : "lock"} size={17} color={look.pillInk} />
            <RNText numberOfLines={1} style={[styles.switchName, { color: look.ink }]}>
              {t(`mobile.vault.tab.${current}`)}
            </RNText>
            <RNText numberOfLines={1} style={[styles.switchCount, { color: look.pillInk }]}>
              {t("mobile.vault.home.items", { count: counts[current] })}
            </RNText>
            <Icon name="chev" size={14} color={look.pillInk} />
          </PressScale>
        }
        right={<IconButton icon="plus" plate label={t("mobile.vault.newItem")} onPress={plus} />}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <RNText accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: look.ink }]}>
          {title}
        </RNText>
        {view !== "connections" ? (
          <View style={[styles.search, { backgroundColor: look.pill }]}>
            <Icon name="search" size={17} color={look.sub} />
            <TextInput
              value={q}
              onChangeText={setQ}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(q.trim() !== "")}
              placeholder={t("mobile.vault.home.search")}
              placeholderTextColor={look.sub}
              accessibilityLabel={t("mobile.vault.home.search")}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.searchInput, { color: look.ink }]}
            />
            {q ? <IconButton icon="x" small label={t("filters.clearSearch")} onPress={() => setQ("")} /> : null}
          </View>
        ) : null}
        {!data ? (
          vault.isError ? (
            <View style={styles.note}>
              <Note icon="x">{t("common.loadFailed")}</Note>
            </View>
          ) : (
            <ActivityIndicator color={look.sub} style={styles.loading} />
          )
        ) : view === "connections" ? (
          <View style={styles.pad}>
            <Connections data={data} />
          </View>
        ) : listing ? (
          <Items
            data={data}
            tab={current}
            view={searching && view === "home" ? "home" : view}
            q={q}
            favorites={favorites.ids}
            mayAdd={mayAdd}
            onNew={newItem}
            onClear={() => setQ("")}
          />
        ) : (
          <Home data={data} tab={current} favorites={favorites.ids} mayAdd={mayAdd} onNew={newItem} onView={setView} />
        )}
      </ScrollView>
    </View>
  );
}

/** Favoritos, the categories with their counts and the managers connected; the vault's first item when empty. */
function Home({
  data,
  tab,
  favorites,
  mayAdd,
  onNew,
  onView,
}: {
  data: VaultOverview;
  tab: "team" | "personal";
  favorites: ReadonlySet<string>;
  mayAdd: boolean;
  onNew: () => void;
  onView: (view: VaultView) => void;
}) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const orgId = useOrgId();
  const items = data.items.filter((i) => i.scope === tab);
  const favCount = items.filter((i) => favorites.has(i.id)).length;
  if (items.length === 0 && data.connections.length === 0)
    return (
      <View style={styles.pad}>
        <FirstUse
          place={tab === "personal" ? "vaultPersonal" : "vaultTeam"}
          size="panel"
          acts={mayAdd}
          label={t("mobile.vault.newItem")}
          onPress={onNew}
        />
      </View>
    );
  return (
    <>
      <CategoryRow
        loose
        tile={<StarGlyph color="#FFFFFF" />}
        color={CATEGORY_COLOR.favorites}
        label={t("mobile.vault.home.favorites")}
        count={favCount}
        onPress={() => onView("favorites")}
      />
      <View style={[styles.card, { backgroundColor: look.card }]}>
        {VAULT_KINDS.map((k, i) => (
          <CategoryRow
            key={k}
            first={i === 0}
            tile={<Icon name={CATEGORY_ICON[k]} size={17} color="#FFFFFF" />}
            color={CATEGORY_COLOR[k]}
            label={t(`mobile.vault.kinds.${k}`)}
            count={items.filter((x) => x.kind === k).length}
            onPress={() => onView(k)}
          />
        ))}
        <CategoryRow
          tile={<Icon name={CATEGORY_ICON.connections} size={17} color="#FFFFFF" />}
          color={CATEGORY_COLOR.connections}
          label={t("mobile.vault.home.connections")}
          count={data.connections.length}
          onPress={() => onView("connections")}
        />
      </View>
      <RNText style={[styles.foot, { color: look.sub }]}>
        {tab === "personal"
          ? t("mobile.vault.personalText")
          : data.canManageTeam
            ? t("mobile.vault.teamText")
            : t("mobile.vault.teamReadText")}
      </RNText>
      <View style={styles.pad}>
        <GroupedList>
          <GroupedRow
            icon="laptop"
            label={t("mobile.vault.import.title")}
            sub={t("mobile.vault.import.text")}
            subLines={4}
            media
            chevron
            onPress={() => openPage(webSettingsUrl(serverUrl(), orgId, "vault"))}
          />
        </GroupedList>
      </View>
    </>
  );
}

function CategoryRow({
  tile,
  color,
  label,
  count,
  onPress,
  first = false,
  loose = false,
}: {
  tile: ReactNode;
  color: string;
  label: string;
  count: number;
  onPress: () => void;
  first?: boolean;
  /** Outside the card (Favoritos): the screen's own inset. */
  loose?: boolean;
}) {
  const look = useVaultLook();
  return (
    <PressScale
      to={0.98}
      haptic={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      style={[loose && styles.loose, !first && !loose && { borderTopWidth: 1, borderTopColor: look.sep }]}
      contentStyle={[styles.category, loose ? styles.looseIn : styles.inCard]}
    >
      <View style={[styles.catTile, { backgroundColor: color }]}>{tile}</View>
      <RNText numberOfLines={1} style={[styles.catLabel, { color: look.ink }]}>
        {label}
      </RNText>
      <RNText style={[styles.catCount, { color: look.sub }]}>{count}</RNText>
      <Icon name="right" size={15} color={look.sub} />
    </PressScale>
  );
}

/** The items of a category, the favorites, or what the search finds: tile, name, site and user. */
function Items({
  data,
  tab,
  view,
  q,
  favorites,
  mayAdd,
  onNew,
  onClear,
}: {
  data: VaultOverview;
  tab: "team" | "personal";
  view: VaultView;
  q: string;
  favorites: ReadonlySet<string>;
  mayAdd: boolean;
  onNew: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const shown = viewItems(data.items, tab, view, q, favorites);
  if (shown.length === 0)
    return q.trim() ? (
      <EmptyState
        size="inline"
        title={t("mobile.vault.noResults", { q: q.trim() })}
        action={<Button variant="secondary" size="sm" label={t("filters.clearSearch")} onPress={onClear} />}
      />
    ) : view === "favorites" ? (
      <EmptyState size="inline" title={t("mobile.vault.home.noFavorites")} />
    ) : (
      <View style={styles.pad}>
        <FirstUse
          place={tab === "personal" ? "vaultPersonal" : "vaultTeam"}
          size="panel"
          acts={mayAdd}
          label={t("mobile.vault.newItem")}
          onPress={onNew}
        />
      </View>
    );
  return (
    <View style={[styles.card, { backgroundColor: look.card }]}>
      {shown.map((item, i) => (
        <ItemRow key={item.id} item={item} first={i === 0} starred={favorites.has(item.id)} />
      ))}
    </View>
  );
}

function ItemRow({ item, first, starred }: { item: VaultItem; first: boolean; starred: boolean }) {
  const { t } = useTranslation();
  const look = useVaultLook();
  const line = itemLine(item) || t(`mobile.vault.kind.${item.kind}`);
  return (
    <PressScale
      to={0.98}
      haptic={false}
      onPress={() => router.push(vaultHref.sheet(item.id) as never)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${line}`}
      style={!first && { borderTopWidth: 1, borderTopColor: look.sep }}
      contentStyle={styles.item}
    >
      <ItemTile item={item} size={34} />
      <View style={styles.itemText}>
        <RNText numberOfLines={1} style={[styles.itemTitle, { color: look.ink }]}>
          {item.title}
        </RNText>
        <RNText numberOfLines={1} style={[styles.itemSub, { color: look.sub }]}>
          {line}
        </RNText>
      </View>
      {starred ? <StarGlyph color={CATEGORY_COLOR.favorites} size={15} filled /> : null}
      {item.missing ? <Icon name="wait" size={16} color={look.sub} /> : null}
    </PressScale>
  );
}

/** The password managers this person sees connected, then one row per source to connect. */
function Connections({ data }: { data: VaultOverview }) {
  const { t } = useTranslation();
  const now = useNow(60_000);
  return (
    <>
      <GroupedFooter>{t("mobile.vault.connections.text")}</GroupedFooter>
      {data.connections.length > 0 ? (
        <>
          <GroupedHeader>{t("mobile.vault.connections.connected")}</GroupedHeader>
          <GroupedList>
            {data.connections.map((conn) => (
              <ConnectionRow key={conn.id} icon="bolt" conn={conn} now={now} />
            ))}
          </GroupedList>
        </>
      ) : null}
      <GroupedHeader
        hint={{
          name: t("common.about", { label: t("mobile.vault.connections.add") }),
          text: t("mobile.vault.connections.help"),
        }}
      >
        {t("mobile.vault.connections.add")}
      </GroupedHeader>
      {data.sources.length === 0 ? (
        <GroupedFooter>{t("mobile.vault.connections.none")}</GroupedFooter>
      ) : (
        <GroupedList>
          {data.sources.map((s) => (
            <GroupedRow
              key={s.kind}
              icon="bolt"
              label={t("mobile.vault.connect.title", { name: s.name })}
              sub={joinNames(
                s.kinds.map((k) => t(`mobile.vault.kinds.${k}`)),
                t,
              )}
              chevron
              onPress={() => router.push(vaultHref.connect(s.kind) as never)}
            />
          ))}
        </GroupedList>
      )}
    </>
  );
}

function ConnectionRow({ icon, conn, now }: { icon: IconName; conn: VaultConnection; now: number }) {
  const { t, i18n } = useTranslation();
  const state = connectionState(conn);
  return (
    <GroupedRow
      icon={icon}
      label={conn.name}
      sub={connectionLine(t, i18n.language, conn, new Date(now))}
      subLines={2}
      media
      below={
        <>
          <View style={styles.chips}>
            <Chip icon={state.icon} label={t(state.key)} />
            <Chip
              icon={conn.scope === "personal" ? "lock" : "members"}
              label={conn.scope === "personal" ? t("mobile.vault.tab.personal") : t("mobile.vault.tab.team")}
            />
          </View>
          {vaultNoAgents(conn.access) ? (
            <Text variant="small" tone="muted">
              {t("vault.connections.noAgents")}
            </Text>
          ) : null}
        </>
      }
      chevron
      onPress={() => router.push(vaultHref.connection(conn.id) as never)}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  switcher: { height: 40, borderRadius: 20, maxWidth: "100%" },
  switcherIn: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12 },
  switchName: { fontFamily: vaultText.semibold, fontSize: 14, flexShrink: 1 },
  switchCount: { fontFamily: vaultText.regular, fontSize: 13.5, flexShrink: 1 },
  title: {
    fontFamily: vaultText.bold,
    fontSize: 30,
    letterSpacing: -0.6,
    paddingHorizontal: SCREEN_X,
    paddingTop: 14,
    paddingBottom: 10,
  },
  search: {
    marginHorizontal: 16,
    height: 40,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
  },
  searchInput: { flex: 1, minWidth: 0, height: 40, fontFamily: vaultText.regular, fontSize: 15.5, padding: 0 },
  note: { paddingHorizontal: SCREEN_X, paddingTop: 10 },
  loading: { marginVertical: 24 },
  pad: { paddingHorizontal: 16, paddingTop: 8 },
  card: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, overflow: "hidden" },
  category: { flexDirection: "row", alignItems: "center", gap: 14, height: 52 },
  loose: { marginTop: 10 },
  looseIn: { paddingLeft: SCREEN_X, paddingRight: 18 },
  inCard: { paddingHorizontal: 14 },
  catTile: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  catLabel: { flex: 1, minWidth: 0, fontFamily: vaultText.medium, fontSize: 16 },
  catCount: { fontFamily: vaultText.medium, fontSize: 14 },
  foot: { fontFamily: vaultText.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: SCREEN_X, paddingTop: 12 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontFamily: vaultText.medium, fontSize: 16, lineHeight: 21 },
  itemSub: { fontFamily: vaultText.regular, fontSize: 13.5, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 4 },
});
