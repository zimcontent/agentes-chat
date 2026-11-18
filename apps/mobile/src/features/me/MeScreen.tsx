import { useAuthConfig, useIssues, useMe, useOverview } from "@agenteschat/client";
import { showsAbout } from "@agenteschat/client/lib/about";
import { isPersonal, modeKey } from "@agenteschat/client/lib/workspace-mode";
import { isAppLocale, localeInfo, readyLocales } from "@agenteschat/i18n/locale";
import Constants from "expo-constants";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signOut } from "@/features/account";
import { type SoundChoice, setSoundChoice, useSoundChoice } from "@/lib/sounds";
import { useOrg } from "@/providers/org";
import { WorkspaceSky } from "@/sky/Sky";
import {
  Count,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  PersonAvatar,
  PixelOrbit,
  SCREEN_X,
  Text,
  type ThemePreference,
  useTheme,
  WithPresence,
} from "@/ui";
import { CoverBarBackdrop, useCoverScroll } from "@/ui/cover";
import { router } from "@/ui/navigation";
import { AgentFace } from "../shared/Face";
import { useColors, useDirectory, useMeId } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { pickOne } from "../shared/PickerSheet";
import { goBack, MentionCount, PushedHeader } from "../shared/parts";
import { usePersonPhoto } from "../shared/photo";
import { useTasksUnreadMarks } from "../shared/queries";
import { useMyPerson, usePresenceOf } from "../status/hooks";
import { personLine } from "../status/logic";
import { openStatus } from "../status/StatusScreen";
import { AppIconPicture, useAppIconName } from "./AppIconPage";
import { useAppIcon } from "./app-icon";
import { openIssuesWithMe, workspacesBeyond } from "./logic";
import { useLanguageChoice, usePushSwitch, useSoundLabel, useStartLabel } from "./PreferencePages";
import { useChangePhoto } from "./parts";
import { useWorkspacesAcross, WorkspaceMark } from "./WorkspacesPages";

/** Under the list at a tab's root: the system's floating tab bar and its margin. */
const TAB_BAR_ROOM = 100;

/** The rows of Você's Work group. */
type WorkRow = "issues" | "proposals" | "routines" | "wiki" | "drive" | "dashboards" | "memory" | "team";
/** A team's workspace: Team is a row of Agents. Threads open from their conversation (ADR doug-0018). */
const TEAM_WORK: WorkRow[] = ["issues", "proposals", "routines", "wiki", "drive", "dashboards", "memory"];
/**
 * A personal workspace (ADR 0159): what its sidebar keeps in sight first, then the rest of its More; Team (no row in
 * Agents) lives here, last. Threads aren't a place of their own (ADR doug-0018).
 */
const PERSONAL_WORK: WorkRow[] = ["routines", "drive", "issues", "proposals", "wiki", "dashboards", "memory", "team"];

/** Opens a screen over this page with the platform's push (back comes here). */
const open = (href: string) => router.push(href as never);

/** The agents of yours Você lists before "Ver todos". */
const AGENTS_SHOWN = 3;
/** Your photo in the profile card, unframed. */
const PHOTO = 64;
/** The photo badge on its top corner and its glyph; its center sits on the photo's ring at 45°. */
const PHOTO_BADGE = 24;
const PHOTO_BADGE_ICON = 12;
const PHOTO_BADGE_AT = ((PHOTO + 6) / 2) * (1 - Math.SQRT1_2) - PHOTO_BADGE / 2;

/**
 * Você, the Ajustes tab's root and pushed from your avatar, as the phone's own settings: the bar reads "Você" with
 * Editar on the right. On top, you as one card: your photo (a tap changes it) on the workspace's sky, your name, your @
 * and workspace (a tap edits your account), and under it your status (ADR 0084). Then grouped lists on the grouped
 * gray, one value per row, each kind of row on its own colored tile: the workspace as one row (where you are, how many
 * more and the unread elsewhere, opening the list by server, ADR 0154) with the workspace's settings under it; your
 * agents, alive; your work (Tarefas, Propostas, Rotinas, Wiki, Drive, Painéis, Memória); alerts and approvals; look
 * and sound (Aparência, the app icon, Sons, the conversation, how agents talk, Idioma); Sobre; Sair alone in red. Sons,
 * Aparência and Idioma change in their row through the app's picker. A settings page is opened many times a day, so
 * nothing here animates beyond the rows' press highlight and the platform's push, and no list or card casts a shadow.
 * A personal workspace (ADR 0159) is yours: no workspace name after your @, and its work led by what its sidebar keeps
 * in sight (Routines, Drive), with Team (no row in Agents) in it.
 */
/** `tab`: the Configurações tab's root (no back button; room for the tab bar under the list). */
export function MeScreen({ tab = false }: { tab?: boolean }) {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const meId = useMeId();
  const org = useOrg();
  const personal = isPersonal(org.org);
  const { groups, elsewhere } = useWorkspacesAcross();
  const theme = useTheme();
  const appIcon = useAppIcon();
  const appIconName = useAppIconName(appIcon.icon ?? "night");
  const dir = useDirectory();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // The bar is clear over the sky and becomes its own once the page scrolls under it (as an agent's page).
  const { y, onScroll } = useCoverScroll();
  const issues = useIssues(org.orgId);
  const proposals = useOverview(org.orgId).data?.proposalsWaitingForMe ?? 0;
  const push = usePushSwitch().on;
  const about = showsAbout(useAuthConfig().data);
  const mine = meId ? dir.memberById.get(meId) : undefined;
  // How you appear (to yourself: hidden stays hidden), on your photo's corner (ADR 0084).
  const myPresence = useMyPerson()?.presence;
  const name = me.data?.user.name ?? "";
  const photo = usePersonPhoto(mine?.avatarUrl ?? mine?.image ?? me.data?.user.image);
  const { changePhoto, uploading } = useChangePhoto();
  const sounds = useSoundChoice();
  const language = useLanguageChoice();
  const styleLabel = useSoundLabel();
  const startLabel = useStartLabel();
  const withMe = openIssuesWithMe(issues.data, meId);
  // Mentions of me not read in a task's conversation: the red badge before the value, as on Conversas.
  const tasksUnread = useTasksUnreadMarks();
  // Threads with something new, the badge their tab has in a team's workspace.
  const version = Constants.expoConfig?.version ?? "";
  const myAgents = dir.agents.filter((a) => a.ownerUserId === meId);
  const handle = mine?.handle ? `@${mine.handle}` : null;
  // A personal workspace's name ("Personal") says nothing after your @.
  const headline = [handle, personal ? null : org.org?.name].filter(Boolean).join(" · ");
  const role = org.org ? t(modeKey(org.org, `mobile.me.role.${org.org.role}`)) : "";
  const beyond = workspacesBeyond(groups, org.orgId);
  const workspaceSub =
    beyond.others === 0
      ? role
      : beyond.servers === 0
        ? t("mobile.me.workspaceMore", { count: beyond.others })
        : beyond.servers === 1
          ? t("mobile.me.workspaceMoreElsewhere", { count: beyond.others })
          : t("mobile.me.workspaceMoreServers", { count: beyond.others });
  // Your work's rows, in the order of the workspace's mode (`TEAM_WORK`, `PERSONAL_WORK`).
  const work: Record<WorkRow, ReactNode> = {
    issues: (
      <GroupedRow
        key="issues"
        tint="azul"
        icon="checkc"
        label={t("mobile.me.issues")}
        {...(withMe > 0 ? { value: t("mobile.me.issuesWithMe", { count: withMe }) } : {})}
        {...(tasksUnread.mentions > 0 ? { valueLeading: <MentionCount count={tasksUnread.mentions} /> } : {})}
        chevron
        onPress={() => open("/issues")}
      />
    ),
    proposals: (
      <GroupedRow
        key="proposals"
        tint="laranja"
        icon="flag"
        label={t("shell.proposals")}
        {...(proposals > 0 ? { valueLeading: <WaitingCount count={proposals} /> } : {})}
        chevron
        onPress={() => open("/proposals")}
      />
    ),
    routines: (
      <GroupedRow
        key="routines"
        icon="clock"
        tint="violeta"
        label={t("routines.title")}
        chevron
        onPress={() => open("/routines")}
      />
    ),
    wiki: (
      <GroupedRow
        key="wiki"
        icon="file"
        tint="turquesa"
        label={t("wiki.title")}
        chevron
        onPress={() => open("/wiki")}
      />
    ),
    drive: (
      <GroupedRow
        key="drive"
        icon="doc"
        tint="ciano"
        label={t("mobile.me.drive")}
        chevron
        onPress={() => open("/drive")}
      />
    ),
    dashboards: (
      <GroupedRow
        key="dashboards"
        icon="chart"
        tint="fucsia"
        label={t("mobile.me.dashboards")}
        chevron
        onPress={() => open("/dashboards")}
      />
    ),
    memory: (
      <GroupedRow
        key="memory"
        icon="brain"
        tint="rosa"
        label={t("mobile.memory.title")}
        chevron
        onPress={() => open("/memory")}
      />
    ),
    team: (
      <GroupedRow key="team" icon="members" tint="azul" label={t("team.title")} chevron onPress={() => open("/team")} />
    ),
  };
  const soundValue = sounds === "off" ? t("mobile.me.soundsOff") : styleLabel(sounds);
  const themeValue = t(`mobile.theme.${theme.preference}`);

  // Sons, Aparência and Idioma change in their row through the app's picker (the one in use checked, the languages
  // searchable), never a screen of their own for one pick.
  const pickSound = () => {
    const choices: SoundChoice[] = ["tactile", "sky", "pixel", "off"];
    void pickOne({
      title: t("mobile.me.sounds"),
      value: sounds,
      options: choices.map((choice) => ({
        key: choice,
        label: choice === "off" ? t("mobile.me.soundsOff") : styleLabel(choice),
      })),
    }).then((key) => {
      if (key) setSoundChoice(key as SoundChoice);
    });
  };
  const pickTheme = () => {
    const choices: ThemePreference[] = ["system", "light", "dark"];
    void pickOne({
      title: t("mobile.me.appearance"),
      value: theme.preference,
      options: choices.map((choice) => ({ key: choice, label: t(`mobile.theme.${choice}`) })),
    }).then((key) => {
      if (key) theme.setPreference(key as ThemePreference);
    });
  };
  const pickLanguage = () =>
    void pickOne({
      title: t("mobile.me.language"),
      value: language.choice,
      options: readyLocales().map((l) => ({ key: l.code, label: l.native })),
      search: true,
    }).then((key) => {
      if (key) language.pick(key as Parameters<typeof language.pick>[0]);
    });
  const confirmSignOut = () =>
    Alert.alert(t("mobile.me.signOutConfirm"), t("mobile.me.signOutConfirmText"), [
      { text: t("mobile.common.cancel"), style: "cancel" },
      {
        text: t("mobile.me.signOut"),
        style: "destructive",
        onPress: () => {
          if (!tab) goBack();
          void signOut();
        },
      },
    ]);

  return (
    <View style={[styles.fill, { backgroundColor: c.grouped }]}>
      <PushedHeader
        title={t("mobile.me.title")}
        plate
        solid={false}
        grouped
        action={{ label: t("mobile.me.edit"), onPress: () => open("/me/account") }}
      />
      <Animated.ScrollView
        style={styles.fill}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + (tab ? TAB_BAR_ROOM : 24) }}
      >
        <View style={[styles.groups, { paddingTop: headerHeight + 8 }]}>
          {/* You: your photo (a tap changes it), your name, your @ and workspace (a tap edits your account), then how
              you appear (ADR 0084). */}
          <GroupedList>
            <View key="profile" style={styles.profile}>
              <WorkspaceSky fade={0.5} style={styles.profileSky} />
              <Pressable
                onPress={changePhoto}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel={t("mobile.me.account.changePhoto")}
                style={({ pressed }) => (pressed || uploading ? styles.pressed : null)}
              >
                <WithPresence size={PHOTO + 6} presence={myPresence} ring={c.raised}>
                  <View style={[styles.ring, { borderColor: c.raised }]}>
                    <PersonAvatar name={name || "?"} size={PHOTO} photo={photo} />
                  </View>
                </WithPresence>
                {/* A touch screen has no hover: the photo badge says the face changes it. */}
                <View
                  style={[styles.photoBadge, { backgroundColor: c.action, borderColor: c.raised }]}
                  pointerEvents="none"
                >
                  <Icon name="image" size={PHOTO_BADGE_ICON} color={c.onAction} />
                </View>
              </Pressable>
              <Pressable
                onPress={() => open("/me/account")}
                accessibilityRole="button"
                accessibilityLabel={[name, headline, t("mobile.me.edit")].filter(Boolean).join(", ")}
                style={({ pressed }) => [styles.profileWords, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <Text variant="title2">{name}</Text>
                  {headline ? (
                    <Text variant="subhead" tone="muted">
                      {headline}
                    </Text>
                  ) : null}
                </View>
                <Icon name="right" size={18} color={c.faint} />
              </Pressable>
            </View>
            <StatusRow key="status" />
          </GroupedList>

          <GroupedHeader>{t("mobile.me.workspace")}</GroupedHeader>
          <GroupedList>
            {org.org ? (
              <GroupedRow
                key="workspace"
                leading={<WorkspaceMark org={org.org} size={36} />}
                label={org.org.name}
                sub={workspaceSub}
                // What's unread in the other workspaces (ADR 0154).
                {...(elsewhere > 0 ? { value: String(elsewhere) } : {})}
                chevron
                onPress={() => open("/me/workspaces")}
              />
            ) : null}
            <GroupedRow
              key="settings"
              icon="sliders"
              tint="azul"
              label={t("settings.title")}
              chevron
              onPress={() => open("/settings")}
            />
          </GroupedList>

          {myAgents.length > 0 ? (
            <>
              <GroupedHeader>{`${t("mobile.me.yourAgents")} · ${myAgents.length}`}</GroupedHeader>
              <GroupedList>
                {myAgents.slice(0, AGENTS_SHOWN).map((a) => (
                  <AgentRow key={a.id} agentId={a.id} name={a.name} role={a.role} />
                ))}
                {myAgents.length > AGENTS_SHOWN ? (
                  <GroupedRow
                    key="all"
                    icon="list"
                    label={t("mobile.me.allAgents")}
                    chevron
                    onPress={() => router.navigate("/agents" as never)}
                  />
                ) : null}
              </GroupedList>
            </>
          ) : null}

          <GroupedHeader>{t("mobile.me.work")}</GroupedHeader>
          <GroupedList>{(personal ? PERSONAL_WORK : TEAM_WORK).map((key) => work[key])}</GroupedList>

          <GroupedHeader>{t("mobile.me.groupAlerts")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              key="notifications"
              icon="bell"
              tint="rosa"
              label={t("mobile.me.notifications")}
              {...(push === null ? {} : { value: push ? t("mobile.me.on") : t("mobile.me.off") })}
              chevron
              onPress={() => open("/me/notifications")}
            />
            {/* Who approves for me, and whom I approve for (ADR 0139); a personal workspace lists it in Settings ›
                Advanced instead (ADR 0159 §3). */}
            {personal ? null : (
              <GroupedRow
                key="approvals"
                icon="shield"
                tint="laranja"
                label={t("settings.section.approvals")}
                chevron
                onPress={() => open("/me/approvals")}
              />
            )}
            {/* A server from before the choice sends none and can't keep one (`PUT …/me/start` answers 404). */}
            {org.org?.start !== undefined ? (
              <GroupedRow
                key="start"
                icon="home"
                tint="azul"
                label={t("mobile.me.start")}
                value={startLabel}
                chevron
                onPress={() => open("/me/start")}
              />
            ) : null}
            {/* Likewise: a server from before the choice sends no `showActivity`. */}
            {org.org?.showActivity !== undefined ? (
              <GroupedRow
                key="activity"
                icon="eye"
                tint="turquesa"
                label={t("mobile.me.activity")}
                labelLines={2}
                value={org.org.showActivity ? t("mobile.me.on") : t("mobile.me.off")}
                chevron
                onPress={() => open("/me/activity")}
              />
            ) : null}
          </GroupedList>

          <GroupedHeader>{t("mobile.me.groupLook")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              key="appearance"
              icon={theme.scheme === "dark" ? "moon" : "sun"}
              tint="violeta"
              label={t("mobile.me.appearance")}
              value={themeValue}
              menu
              onPress={pickTheme}
            />
            {/* The app icon (ADR 0179): only where this build carries the others. */}
            {appIcon.supported && appIcon.icon ? (
              <GroupedRow
                key="appIcon"
                leading={<AppIconPicture icon={appIcon.icon} />}
                label={t("appIcon.title")}
                value={appIconName}
                chevron
                onPress={() => open("/me/app-icon")}
              />
            ) : null}
            <GroupedRow
              key="sounds"
              icon="sound"
              tint="fucsia"
              label={t("mobile.me.sounds")}
              value={soundValue}
              menu
              onPress={pickSound}
            />
            {/* Likewise: a server from before the choice sends no `chatPrefs`. */}
            {org.org?.chatPrefs !== undefined ? (
              <GroupedRow
                key="chat"
                icon="text"
                tint="ciano"
                label={t("settings.account.chat.title")}
                chevron
                onPress={() => open("/me/chat-look")}
              />
            ) : null}
            {/* Likewise: a server from before the choice sends no `agentStyle` (ADR 0147). */}
            {org.org?.agentStyle !== undefined ? (
              <GroupedRow
                key="agentStyle"
                icon="agent"
                tint="amarelo"
                label={t("mobile.me.agentStyle")}
                labelLines={2}
                value={
                  org.org.agentStyle === "technical"
                    ? t("settings.account.agentStyleTechnical")
                    : t("settings.account.agentStyleSimple")
                }
                chevron
                onPress={() => open("/me/agent-style")}
              />
            ) : null}
            <GroupedRow
              key="language"
              icon="globe"
              tint="turquesa"
              label={t("mobile.me.language")}
              value={isAppLocale(i18n.language) ? localeInfo(i18n.language).native : i18n.language}
              menu
              onPress={pickLanguage}
            />
          </GroupedList>

          <View style={styles.gapBig} />
          <GroupedList>
            {about ? (
              <GroupedRow
                key="about"
                icon="info"
                label={t("settings.section.about")}
                chevron
                onPress={() => open("/me/about")}
              />
            ) : null}
          </GroupedList>

          <View style={styles.gapBig} />
          <GroupedList>
            <GroupedRow key="signOut" label={t("mobile.me.signOut")} danger onPress={confirmSignOut} />
          </GroupedList>
          {/* Sobre says the version; without it (a server that hides it), the version stays here. */}
          {!about && version ? <GroupedFooter>{t("mobile.me.version", { version })}</GroupedFooter> : null}
        </View>
      </Animated.ScrollView>
      <CoverBarBackdrop y={y} from={0} to={12} height={headerHeight} />
    </View>
  );
}

/** Your status as a row (ADR 0084): "Definir status" or how you appear, with when it clears; a tap pushes Status. */
function StatusRow() {
  const { t, i18n } = useTranslation();
  const me = useMyPerson();
  const presence = me?.presence ?? "offline";
  const status = me?.status ?? null;
  const label = status
    ? personLine(t, i18n.language || "en", status)
    : presence === "online"
      ? t("presence.setStatus")
      : t(`presence.${presence}`);
  return <GroupedRow icon="smile" tint="amarelo" label={label} chevron onPress={openStatus} />;
}

/** One of your agents: its face in its sky at 36, its name, what it does now (its orbit turning) or its role. */
function AgentRow({ agentId, name, role }: { agentId: string; name: string; role: string | null | undefined }) {
  const dir = useDirectory();
  const shown = usePresenceOf().agent(agentId);
  const working = shown?.presence === "working" && shown.line ? shown.line.text : null;
  const look = agentLook(dir.agentById.get(agentId));
  return (
    <GroupedRow
      leading={<AgentFace agentId={agentId} size={36} />}
      label={name}
      {...(working ? { below: <WorkingLine color={look.color} text={working} /> } : role ? { sub: role } : {})}
      chevron
      onPress={() => open(`/agent/${agentId}`)}
    />
  );
}

/** How many wait on you, as a small amber count before the chevron (the label keeps its words whole). */
function WaitingCount({ count }: { count: number }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View accessible accessibilityLabel={t("mobile.me.proposalsWaiting", { count })}>
      <Count value={count} max={99} inverted fill={c.amber} color={c.onAttention} />
    </View>
  );
}

/** What a working agent does, in words with its orbit, never a label. */
function WorkingLine({ color, text }: { color: Parameters<typeof PixelOrbit>[0]["color"]; text: string }) {
  return (
    <View style={styles.working}>
      <PixelOrbit color={color} size={11} />
      <Text variant="footnote" tone="ink2" numberOfLines={1} style={styles.shrink}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // You, on top: the workspace's sky faint behind, your photo, your name and @, and Editar's way in (the chevron).
  profile: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, overflow: "hidden" },
  profileSky: { position: "absolute", top: 0, left: 0, right: 0, height: 72, opacity: 0.55 },
  profileWords: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  // A ring in the card's color lifts the photo off the sky.
  ring: { borderRadius: 999, borderWidth: 3 },
  pressed: { opacity: 0.6 },
  photoBadge: {
    position: "absolute",
    top: PHOTO_BADGE_AT,
    right: PHOTO_BADGE_AT,
    width: PHOTO_BADGE,
    height: PHOTO_BADGE,
    borderRadius: PHOTO_BADGE / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  groups: { paddingHorizontal: SCREEN_X },
  gapBig: { height: 24 },
  working: { flexDirection: "row", alignItems: "center", gap: 4 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
});
