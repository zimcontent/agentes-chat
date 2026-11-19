import {
  type Dashboard,
  type DashboardSummary,
  editorsSummary,
  editorsText,
  useDecideDashboardProposal,
  type WidgetFormat,
  type WidgetSchedule,
  withEditRoles,
} from "@dougbot/client";
import { WIDGET_SCHEDULES, WIDGET_SIZES, type WidgetSize } from "@dougbot/ui/widgets/spec";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import {
  Button,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  type IconName,
  MEDIA_ROW,
  MediaRow,
  PressScale,
  RoleMark,
  Segmented,
  Text,
  useTheme,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { useFailed } from "../routines/hooks";
import { AgentFace } from "../shared/Face";
import { useOrgId } from "../shared/hooks";
import { successHaptic, useSurface } from "../shared/parts";
import { closeEditRoles, openEditRoles } from "./edit-roles";
import { useAgentLook, useCustomRoles } from "./hooks";
import { type AudienceDraft, editorsChoices, roleNamesOf, toggleRole, withAudience, withEditors } from "./logic";
import { usePickMenu } from "./menu";

/** Pieces the dashboards' screens share (ADR 0135). */

/**
 * "Created by Theo · 4 widgets", "Created by you · 1 widget"; with `count` false only who made it (a board's bar,
 * where its meta line already counts the widgets).
 */
export function useBoardByline() {
  const { t } = useTranslation();
  return (board: Pick<DashboardSummary, "owner" | "mine" | "widgetCount">, count = true) => {
    const by = board.owner
      ? board.owner.kind === "person" && board.mine
        ? t("dashboards.meta.byYou")
        : t("dashboards.meta.by", { name: board.owner.name })
      : null;
    const widgets = count ? t("dashboards.meta.widgets", { count: board.widgetCount }) : null;
    return [by, widgets].filter(Boolean).join(" · ");
  };
}

/**
 * An agent asks to show this board to more people (ADR 0135 §11): only the person it asked decides, here or in
 * Activity. Publish shows it to the workspace (or the roles it named); Keep only for me leaves it private.
 */
export function ProposalBanner({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = useFailed();
  const surface = useSurface("e2");
  const roles = useCustomRoles();
  const decide = useDecideDashboardProposal(orgId);
  const p = board.proposal;
  const look = useAgentLook(p?.agentId);
  if (!p?.canDecide) return null;
  const names = roleNamesOf(p.roleIds, roles).join(", ");
  const toRoles = p.audience === "roles" && names.length > 0;
  const publish = toRoles
    ? t("dashboards.proposal.publishRoles", { roles: names })
    : t("dashboards.proposal.publishWorkspace");
  const send = (decision: "publish" | "keep") =>
    decide.mutate(
      { dashboardId: board.id, decision },
      {
        onSuccess: () => {
          successHaptic();
          toast({
            title:
              decision === "publish"
                ? t("dashboards.proposal.published", { title: board.title })
                : t("dashboards.proposal.kept", { title: board.title }),
          });
        },
        onError: failed,
      },
    );
  return (
    <View style={[styles.proposal, surface]}>
      {/* The agent's face and what it asks on one line; who would see it and why under them, whole. */}
      <MediaRow
        size="row"
        face={<AgentFace agentId={p.agentId} size={MEDIA_ROW.row.face} live={false} />}
        name={t("dashboards.proposal.title", { name: look.name })}
      >
        <Text variant="footnote" tone="muted">
          {toRoles ? t("dashboards.proposal.roles", { roles: names }) : t("dashboards.proposal.workspace")}
        </Text>
        {p.why ? (
          <Text variant="footnote" tone="faint">
            {p.why}
          </Text>
        ) : null}
      </MediaRow>
      <View style={styles.proposalActions}>
        <Button
          size="sm"
          variant="secondary"
          label={t("dashboards.proposal.keep")}
          disabled={decide.isPending}
          onPress={() => send("keep")}
        />
        <Button
          size="sm"
          variant="primary"
          label={publish}
          loading={decide.isPending}
          onPress={() => send("publish")}
        />
      </View>
    </View>
  );
}

/** Line glyphs of the formats that have no icon of their own: a number, a goal's track, a line over time. */
const KIND_PATHS: Partial<Record<WidgetFormat, { d: string; w?: number }[]>> = {
  kpi: [{ d: "M6.5 8.5 9 6.5v11" }, { d: "M13 8.5a2.6 2.6 0 0 1 5.2 0c0 2.6-5.2 4.6-5.2 9h5.4" }],
  goal: [{ d: "M6 12h7", w: 3.2 }],
  line: [{ d: "M4 16.5 9 11l4 3.2L20 7" }, { d: "M4 20h16" }],
};
const KIND_ICONS: Partial<Record<WidgetFormat, IconName>> = {
  auto: "sparkle",
  bars: "chart",
  list: "list",
  text: "text",
};

/** A format's small glyph (the format chips): the line icons' style. */
export function KindGlyph({ kind, size = 16, color }: { kind: WidgetFormat; size?: number; color: string }) {
  const icon = KIND_ICONS[kind];
  if (icon) return <Icon name={icon} size={size} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {kind === "goal" ? (
        <Rect x={3.5} y={8.5} width={17} height={7} rx={2.5} stroke={color} strokeWidth={1.7} />
      ) : null}
      {(KIND_PATHS[kind] ?? []).map((p) => (
        <Path key={p.d} d={p.d} stroke={color} strokeWidth={p.w ?? 1.7} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** Pills to pick one of, each with its glyph; the picked one in ink. One row that scrolls sideways. */
export function ChoiceChips<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string; icon?: (color: string) => ReactNode }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chips}
    >
      {items.map((item) => {
        const on = item.key === value;
        const ink = on ? c.bg : c.ink2;
        return (
          <PressScale
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            fill={false}
            // 34 tall: the slop gives it a finger's 44 without spacing the row out.
            hitSlop={{ top: 5, bottom: 5 }}
            contentStyle={[styles.chip, { backgroundColor: on ? c.ink : c.chip }]}
          >
            {item.icon ? item.icon(ink) : null}
            <Text variant="subhead" numberOfLines={1} style={[styles.semibold, { color: ink }]}>
              {item.label}
            </Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

/** How often it updates: the five schedules, the shortest words, in a row that scrolls on a small phone. */
export function ScheduleChoice({
  value,
  onChange,
  without,
}: {
  value: WidgetSchedule;
  onChange: (schedule: WidgetSchedule) => void;
  /** A schedule left out ("only pin" stands for `manual` when pinning). */
  without?: WidgetSchedule;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.segments}
    >
      <Segmented
        items={WIDGET_SCHEDULES.filter((s) => s !== without).map((s) => ({
          key: s,
          label: t(`widgets.schedulesShort.${s}`),
        }))}
        value={value}
        onChange={(k) => onChange(k as WidgetSchedule)}
      />
    </ScrollView>
  );
}

/** A widget's size: S (half a row on the phone), M (the row), L (the row, drawn big), with what each means under it. */
export function SizeChoice({ value, onChange }: { value: WidgetSize; onChange: (size: WidgetSize) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Segmented
        items={WIDGET_SIZES.map((s) => ({ key: s, label: t(`widgets.sizes.${s}`) }))}
        value={value}
        onChange={(k) => onChange(k as WidgetSize)}
      />
      <GroupedFooter>{t(`mobile.dashboards.sizeHint.${value}`)}</GroupedFooter>
    </>
  );
}

/**
 * Who sees and who edits a board (Share and New dashboard): the whole workspace, some roles (picked as chips), or only
 * you; then, unless it's only yours, who edits it: a row saying who that opens a pick menu (whoever sees it, only you
 * and admins, or "Some roles…", a pushed screen to check them). Under it, what showing a board exposes.
 */
export function AudienceFields({
  draft,
  onChange,
  members,
}: {
  draft: AudienceDraft;
  onChange: (draft: AudienceDraft) => void;
  /** People in the workspace now (the workspace option's hint). */
  members: number;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const roles = useCustomRoles();
  const pickMenu = usePickMenu();
  const pick = (audience: AudienceDraft["audience"]) => onChange(withAudience(draft, audience));
  // The roles' screen writes back here while it is open; leaving the form ends it.
  useEffect(() => () => closeEditRoles(), []);
  const openRoles = () => {
    openEditRoles({
      audience: draft.audience,
      roleIds: draft.roleIds,
      editRoleIds: draft.editPolicy === "roles" ? draft.editRoleIds : [],
      apply: (ids) => onChange(withEditRoles(draft, ids)),
    });
    router.push("/board-edit-roles");
  };
  const openEditors = () =>
    pickMenu(
      t("dashboards.edit.label"),
      editorsChoices(roles.length).map((key) => ({
        key,
        label: key === "roles" ? t("dashboards.edit.someRoles") : t(`dashboards.edit.${key}`),
      })),
      draft.editPolicy,
      (key) => (key === "roles" ? openRoles() : onChange(withEditors(draft, key))),
    );
  return (
    <>
      <GroupedHeader>{t("dashboards.audience.label")}</GroupedHeader>
      <GroupedList>
        <GroupedRow
          icon="globe"
          label={t("dashboards.audience.workspace")}
          sub={t("dashboards.audience.workspaceHint", { count: members })}
          subLines={2}
          checked={draft.audience === "workspace"}
          onPress={() => pick("workspace")}
        />
        <GroupedRow
          icon="members"
          label={t("dashboards.audience.roles")}
          sub={t("dashboards.audience.rolesHint")}
          subLines={2}
          checked={draft.audience === "roles"}
          onPress={() => pick("roles")}
        />
        {draft.audience === "roles" ? (
          <View style={styles.roles}>
            {roles.length === 0 ? (
              <Text variant="footnote" tone="faint">
                {t("dashboards.audience.noRoles")}
              </Text>
            ) : (
              roles.map((r) => {
                const on = draft.roleIds.includes(r.id);
                return (
                  <PressScale
                    key={r.id}
                    onPress={() => onChange(toggleRole(draft, r.id))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    fill={false}
                    contentStyle={[styles.roleChip, { backgroundColor: on ? c.ink : c.chip }]}
                  >
                    <View style={on ? null : styles.faded}>
                      <RoleMark color={r.color} icon={r.icon} size={18} />
                    </View>
                    <Text variant="subhead" style={[styles.semibold, { color: on ? c.bg : c.ink2 }]}>
                      {r.name}
                    </Text>
                  </PressScale>
                );
              })
            )}
          </View>
        ) : null}
        <GroupedRow
          icon="lock"
          label={t("dashboards.audience.private")}
          sub={t("dashboards.audience.privateHint")}
          subLines={2}
          checked={draft.audience === "private"}
          onPress={() => pick("private")}
        />
      </GroupedList>
      {draft.audience === "private" ? null : (
        <>
          <GroupedHeader>{t("dashboards.edit.label")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              icon={draft.editPolicy === "viewers" ? "eye" : draft.editPolicy === "owner" ? "lock" : "members"}
              label={editorsText(t, editorsSummary(draft, roles))}
              chevron
              onPress={openEditors}
            />
          </GroupedList>
        </>
      )}
      {/* A footer like the others, from the section's edge: an icon before it set it in from them. */}
      <GroupedFooter
        hint={{ name: t("common.about", { label: t("dashboards.audience.label") }), text: t("widgets.exposure") }}
      >
        {t("widgets.exposureShort")}
      </GroupedFooter>
    </>
  );
}

const styles = StyleSheet.create({
  semibold: { fontWeight: "600" },
  proposal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 6,
    padding: 12,
    gap: 10,
  },
  proposalActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  chips: { gap: 6, paddingHorizontal: 16 },
  // Min heights: with a large text size the label grows past them instead of being clipped.
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34, paddingHorizontal: 12, borderRadius: 17 },
  segments: { paddingHorizontal: 16 },
  // In GroupedRow's text column: its 14 side, the 32 leading column and the 12 gap.
  roles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingLeft: 14 + 32 + 12,
    paddingRight: 14,
    paddingBottom: 12,
  },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  faded: { opacity: 0.35 },
});
