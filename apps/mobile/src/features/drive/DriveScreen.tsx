import { type Artifact, type ArtifactAuthor, type ArtifactFilters, useArtifacts } from "@agenteschat/client";
import { relativeTime } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, Text as RNText, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Button, EmptyState, Icon, IconButton, PressScale, SkeletonList } from "@/ui";
import { router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { Face } from "../shared/Face";
import { FirstUse } from "../shared/FirstUse";
import { useDirectory, useMeId, useNow, useOrgId, usePullRefresh } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import { ScreenTopBar } from "../shared/ScreenTopBar";
import { DriveCard, openDriveItem } from "./DriveCard";
import {
  changedWithin,
  changeKey,
  DRIVE_TYPES,
  DRIVE_WHENS,
  type DriveFolder,
  type DriveOrder,
  type DriveType,
  type DriveWhen,
  driveFolders,
  fileMark,
  gridRows,
  matchesType,
  orderFiles,
  suggestedFiles,
} from "./logic";
import { DriveRow, driveText, FileTile, FilterChip, NewGlyph, SuggestedCard, useDriveLook, ViewGlyph } from "./parts";
import { useDriveUpload } from "./useDriveUpload";

/** Rows shown at first and added by "Mostrar mais". */
const PAGE = 30;
/** Folders shown at the top before "Mais pastas". */
const FOLDERS = 3;

/**
 * Arquivos, pushed from Você: the workspace's files the way the phone's file apps show them. A big search, three
 * filters (Tipo, Pessoas, Modificado), "Sugeridos" (the two changed last, with their picture), then the list: the
 * conversations the files came from as folders, and each file with its type's tile, who changed it and when, and its
 * menu. "Novo" sends a file from the phone. `highlightId`: the item "Ver nos arquivos" came from, marked.
 */
export function DriveScreen({ highlightId = null }: { highlightId?: string | null }) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const look = useDriveLook();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const meId = useMeId();
  const now = useNow(60_000);
  const [q, setQ] = useState("");
  const [type, setType] = useState<DriveType>("all");
  const [who, setWho] = useState<ArtifactAuthor | null>(null);
  const [when, setWhen] = useState<DriveWhen>("any");
  const [folder, setFolder] = useState<DriveFolder | null>(null);
  const [order, setOrder] = useState<DriveOrder>("name");
  const [grid, setGrid] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [allFolders, setAllFolders] = useState(false);
  const search = useDeferredValue(q.trim());
  const filters = useMemo<ArtifactFilters>(
    () => ({
      ...(search ? { q: search } : {}),
      ...(who ? { author: who, changed: true } : {}),
      ...(folder ? { channelId: folder.id } : {}),
    }),
    [search, who, folder],
  );
  const list = useArtifacts(orgId, filters);
  const pull = usePullRefresh(list.refetch);
  const mayUpload = can(useOrg().org, "upload_files");
  const uploader = useDriveUpload(list.refetch);
  const filtered = Boolean(search) || type !== "all" || who !== null || when !== "any";
  const all = useMemo(
    () => (list.artifacts ?? []).filter((a) => matchesType(a, type) && changedWithin(a.updatedAt, when, new Date(now))),
    [list.artifacts, type, when, now],
  );
  const files = useMemo(() => {
    const sorted = orderFiles(all, order, i18n.language);
    const at = highlightId ? sorted.findIndex((a) => a.id === highlightId) : -1;
    return sorted.slice(0, Math.max(shown, at + 1));
  }, [all, order, i18n.language, shown, highlightId]);
  const nameOf = useCallback(
    (who: ArtifactAuthor) => {
      if (who.type === "person" && who.id === meId) return t("mobile.drive.you");
      return dir.nameOf(who) || t(who.type === "agent" ? "channel.unknownAgent" : "channel.unknownPerson");
    },
    [meId, dir, t],
  );
  const folderName = useCallback((f: DriveFolder) => f.name ?? (f.dmWith ? dir.nameOf(f.dmWith) : ""), [dir]);
  // Folders only at the top level and with no filter: inside one, or while looking for something, only files.
  const folders = useMemo(
    () => (folder || filtered ? [] : orderFiles(driveFolders(list.artifacts ?? []), order, i18n.language, folderName)),
    [folder, filtered, list.artifacts, order, i18n.language, folderName],
  );
  const suggested = folder || filtered ? [] : suggestedFiles(list.artifacts ?? []);

  const ago = (iso: string) => relativeTime(t, i18n.language, iso, new Date(now));
  const fileLine = (a: Artifact) =>
    `${t(`mobile.drive.change.${changeKey(a)}`, { name: nameOf(a.updatedBy) })} · ${ago(a.updatedAt)}`;

  const total = all.length;
  const more = () => {
    setShown((n) => n + PAGE);
    if (files.length + PAGE > total && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };
  const clear = () => {
    setQ("");
    setType("all");
    setWho(null);
    setWhen("any");
  };
  const back = () => {
    if (folder) {
      setFolder(null);
      setShown(PAGE);
    } else router.back();
  };

  const pickType = async () => {
    const key = await pickOne({
      title: t("mobile.drive.filter.type"),
      options: DRIVE_TYPES.map((k) => ({ key: k, label: t(`mobile.drive.type.${k}`) })),
      value: type,
    });
    if (key) setType(key as DriveType);
  };
  // The people and agents who changed something here, me first.
  const people = useMemo(() => {
    const seen = new Map<string, ArtifactAuthor>();
    for (const a of list.artifacts ?? []) for (const w of [a.updatedBy, a.createdBy]) seen.set(`${w.type}:${w.id}`, w);
    if (meId) seen.set(`person:${meId}`, { type: "person", id: meId });
    return [...seen.values()].sort((x, y) =>
      x.id === meId ? -1 : y.id === meId ? 1 : nameOf(x).localeCompare(nameOf(y), i18n.language),
    );
  }, [list.artifacts, meId, nameOf, i18n.language]);
  const pickWho = async () => {
    const key = await pickOne({
      title: t("mobile.drive.filter.people"),
      options: [
        { key: "any", label: t("mobile.drive.anyone") },
        ...people.map((w) => ({
          key: `${w.type}:${w.id}`,
          label: nameOf(w),
          leading:
            w.type === "agent" ? { kind: "agent" as const, agentId: w.id } : { kind: "person" as const, userId: w.id },
        })),
      ],
      value: who ? `${who.type}:${who.id}` : "any",
    });
    if (!key) return;
    if (key === "any") return setWho(null);
    const [kind, id] = key.split(":");
    if (id) setWho({ type: kind === "agent" ? "agent" : "person", id });
  };
  const pickWhen = async () => {
    const key = await pickOne({
      title: t("mobile.drive.filter.modified"),
      options: DRIVE_WHENS.map((k) => ({ key: k, label: t(`mobile.drive.when.${k}`) })),
      value: when,
    });
    if (key) setWhen(key as DriveWhen);
  };
  const fileMenu = (a: Artifact) => {
    const place = a.channelId && openable(a) ? a.channelId : null;
    showActionSheet(a.title, [
      { label: t("mobile.drive.open"), onPress: () => openDriveItem(a) },
      ...(a.inDrive !== false
        ? [{ label: t("share.button"), onPress: () => router.push({ pathname: "/file-share", params: { id: a.id } }) }]
        : []),
      ...(place ? [{ label: t("mobile.drive.goToChat"), onPress: () => router.push(chatHref(place) as never) }] : []),
    ]);
  };
  const folderMenu = (f: DriveFolder) =>
    showActionSheet(folderName(f), [
      { label: t("mobile.drive.open"), onPress: () => setFolder(f) },
      { label: t("mobile.drive.goToChat"), onPress: () => router.push(chatHref(f.id) as never) },
    ]);
  const moreMenu = () =>
    showActionSheet(t("mobile.drive.title"), [
      ...(mayUpload ? [{ label: t("files.upload"), onPress: uploader.pick }] : []),
      { label: t("mobile.drive.order.recent"), checked: order === "recent", onPress: () => setOrder("recent") },
      { label: t("mobile.drive.order.name"), checked: order !== "recent", onPress: () => setOrder("name") },
      {
        label: grid ? t("mobile.drive.view.list") : t("mobile.drive.view.grid"),
        onPress: () => setGrid((g) => !g),
      },
    ]);

  const typeLabel = type === "all" ? t("mobile.drive.filter.type") : t(`mobile.drive.type.${type}`);
  const whoLabel = who ? nameOf(who) : t("mobile.drive.filter.people");
  const whenLabel = when === "any" ? t("mobile.drive.filter.modified") : t(`mobile.drive.when.${when}`);
  const shownFolders = allFolders ? folders : folders.slice(0, FOLDERS);
  const empty = total === 0 && folders.length === 0 && !list.hasNextPage;

  return (
    <View style={[styles.fill, { backgroundColor: look.bg }]}>
      <ScreenTopBar
        onBack={back}
        middle={
          <View style={styles.title} accessibilityRole="header">
            <Icon name="drive" size={22} color={look.ink} />
            <RNText numberOfLines={1} style={[styles.titleText, { color: look.ink }]}>
              {t("mobile.drive.title")}
            </RNText>
          </View>
        }
        right={<IconButton icon="more" plate label={t("mobile.drive.more2")} onPress={moreMenu} />}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <View style={[styles.search, { backgroundColor: look.search }]}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("mobile.drive.search")}
            placeholderTextColor={look.searchInk}
            accessibilityLabel={t("mobile.drive.search")}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: look.ink }]}
          />
          {q ? (
            <IconButton icon="x" small label={t("filters.clearSearch")} onPress={() => setQ("")} />
          ) : (
            <View style={styles.me}>
              <Face who={meId ? { type: "person", id: meId } : null} size={34} live={false} />
            </View>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <FilterChip label={typeLabel} on={type !== "all"} onPress={() => void pickType()} />
          <FilterChip label={whoLabel} on={who !== null} onPress={() => void pickWho()} />
          <FilterChip label={whenLabel} on={when !== "any"} onPress={() => void pickWhen()} />
        </ScrollView>

        {list.isLoading ? (
          <View style={styles.loading}>
            <SkeletonList rows={5} />
          </View>
        ) : list.isError && !list.data ? (
          <View style={styles.center}>
            <RNText style={[styles.centerText, { color: look.sub }]}>{t("mobile.drive.loadFailed")}</RNText>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void list.refetch()}
            />
          </View>
        ) : empty ? (
          filtered || folder ? (
            <EmptyState
              size="inline"
              title={t("mobile.drive.noResults")}
              action={<Button variant="secondary" size="sm" label={t("filters.clearAll")} onPress={clear} />}
            />
          ) : (
            <FirstUse
              place="drive"
              acts={mayUpload}
              label={t("files.upload")}
              busy={uploader.busy}
              onPress={uploader.pick}
            />
          )
        ) : (
          <>
            {suggested.length > 0 ? (
              <>
                <RNText accessibilityRole="header" style={[styles.heading, { color: look.ink }]}>
                  {t("mobile.drive.suggested")}
                </RNText>
                <View style={styles.suggested}>
                  {suggested.map((a) => (
                    <SuggestedCard
                      key={a.id}
                      artifact={a}
                      mark={fileMark(a)}
                      sub={`${t(`mobile.drive.change.${changeKey(a)}`, { name: nameOf(a.updatedBy) })} ${ago(a.updatedAt)}`}
                      label={`${a.title}, ${fileLine(a)}`}
                      onPress={() => openDriveItem(a)}
                    />
                  ))}
                  {suggested.length === 1 ? <View style={styles.fill} /> : null}
                </View>
              </>
            ) : null}
            <View style={styles.listHead}>
              <RNText accessibilityRole="header" numberOfLines={1} style={[styles.headingText, { color: look.ink }]}>
                {folder ? folderName(folder) : t("mobile.drive.list")}
              </RNText>
              <PressScale
                to={0.95}
                onPress={() => setOrder((o) => (o === "name" ? "nameDesc" : o === "nameDesc" ? "recent" : "name"))}
                accessibilityRole="button"
                accessibilityLabel={t("mobile.drive.order.label", {
                  order: t(`mobile.drive.order.${order === "recent" ? "recent" : "name"}`),
                })}
                hitSlop={8}
                contentStyle={styles.sort}
              >
                <RNText style={[styles.sortText, { color: look.sub }]}>
                  {order === "recent" ? t("mobile.drive.order.short.recent") : t("mobile.drive.order.short.name")}
                </RNText>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" accessible={false}>
                  <Path
                    d={order === "nameDesc" ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"}
                    stroke={look.sub}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </PressScale>
              <PressScale
                to={0.9}
                onPress={() => setGrid((g) => !g)}
                accessibilityRole="button"
                accessibilityLabel={grid ? t("mobile.drive.view.list") : t("mobile.drive.view.grid")}
                hitSlop={8}
                style={styles.viewToggle}
                contentStyle={styles.centered}
              >
                <ViewGlyph grid={grid} color={look.sub} />
              </PressScale>
            </View>
            {shownFolders.map((f) => (
              <DriveRow
                key={f.id}
                tile={<FileTile mark="folder" />}
                title={folderName(f)}
                sub={`${nameOf(f.updatedBy)} · ${ago(f.updatedAt)}`}
                label={`${folderName(f)}, ${t("mobile.drive.folder", { count: f.count })}`}
                menuLabel={t("mobile.drive.menu", { name: folderName(f) })}
                onPress={() => {
                  setFolder(f);
                  setShown(PAGE);
                }}
                onMenu={() => folderMenu(f)}
              />
            ))}
            {folders.length > FOLDERS && !allFolders ? (
              <PressScale
                to={0.98}
                onPress={() => setAllFolders(true)}
                accessibilityRole="button"
                contentStyle={styles.moreFolders}
              >
                <RNText style={[styles.sortText, { color: look.sub }]}>
                  {t("mobile.drive.moreFolders", { count: folders.length - FOLDERS })}
                </RNText>
              </PressScale>
            ) : null}
            {grid ? (
              <View style={styles.grid}>
                {gridRows(files).map((row) => (
                  <View key={row.map((a) => a.id).join(":")} style={styles.gridRow}>
                    {row.map((a) => (
                      <DriveCard key={a.id} artifact={a} highlighted={a.id === highlightId} />
                    ))}
                    {row.length === 1 ? <View style={styles.fill} /> : null}
                  </View>
                ))}
              </View>
            ) : (
              files.map((a) => (
                <DriveRow
                  key={a.id}
                  tile={<FileTile mark={fileMark(a)} />}
                  title={a.title}
                  sub={fileLine(a)}
                  label={`${a.title}, ${fileLine(a)}`}
                  menuLabel={t("mobile.drive.menu", { name: a.title })}
                  highlighted={a.id === highlightId}
                  onPress={() => openDriveItem(a)}
                  onMenu={() => fileMenu(a)}
                />
              ))
            )}
            {files.length < total || list.hasNextPage ? (
              <View style={styles.more}>
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("mobile.drive.more")}
                  loading={list.isFetchingNextPage}
                  onPress={more}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {mayUpload ? (
        <PressScale
          to={0.95}
          onPress={uploader.pick}
          disabled={uploader.busy}
          accessibilityRole="button"
          accessibilityLabel={t("files.upload")}
          style={[styles.fab, { backgroundColor: look.fab, bottom: Math.max(insets.bottom + 2, 16) }]}
          contentStyle={styles.fabIn}
        >
          <NewGlyph />
          <RNText style={[styles.fabText, { color: look.ink }]}>{t("mobile.drive.new")}</RNText>
        </PressScale>
      ) : null}
    </View>
  );
}

/** A file whose conversation I can open (not one shared with me from a conversation I'm not in). */
function openable(a: Artifact): boolean {
  const au = a.audience;
  if (au.kind === "channel") return !au.outside;
  if (au.kind === "dm") return !au.between && !au.gone;
  return true;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { flexDirection: "row", alignItems: "center", gap: 8, height: 40 },
  titleText: { fontFamily: driveText.semibold, fontSize: 17, flexShrink: 1 },
  search: {
    marginTop: 14,
    marginHorizontal: 16,
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 7,
  },
  searchInput: { flex: 1, minWidth: 0, height: 48, fontFamily: driveText.regular, fontSize: 16, padding: 0 },
  me: { width: 34, height: 34, borderRadius: 17, overflow: "hidden" },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  heading: { fontFamily: driveText.medium, fontSize: 15, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 },
  suggested: { flexDirection: "row", gap: 10, paddingHorizontal: 16 },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 18,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headingText: { flex: 1, minWidth: 0, fontFamily: driveText.medium, fontSize: 15 },
  sort: { flexDirection: "row", alignItems: "center", gap: 4, height: 32 },
  sortText: { fontFamily: driveText.medium, fontSize: 13.5 },
  viewToggle: { width: 32, height: 32 },
  centered: { alignItems: "center", justifyContent: "center" },
  moreFolders: { height: 44, justifyContent: "center", paddingLeft: 60 },
  grid: { paddingHorizontal: 16, gap: 16, paddingTop: 8 },
  gridRow: { flexDirection: "row", gap: 12 },
  loading: { paddingTop: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 48, paddingHorizontal: 24 },
  centerText: { textAlign: "center", fontFamily: driveText.regular, fontSize: 15 },
  more: { alignItems: "center", paddingTop: 20 },
  fab: {
    position: "absolute",
    right: 18,
    height: 58,
    borderRadius: 18,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  fabIn: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 18, paddingRight: 22 },
  fabText: { fontFamily: driveText.semibold, fontSize: 15 },
});
