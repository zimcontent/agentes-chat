import { useVideoReviews } from "@agenteschat/client";
import { NativeTabs } from "expo-router/native-tabs";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { usePortalOn, usePortalWords } from "@/features/portal/hooks";
import { useReviewWords } from "@/features/review/media";
import { useUnreadConversations, useUnreadThreads, useWaitingCount } from "@/features/shared/queries";
import { ALONG_STRIP, alongInAccessory } from "@/features/work-along/logic";
import { AccessoryLine, AlongStrip, useWorkAlong } from "@/features/work-along/WorkAlong";
import { TAB_BADGE, tabBadge } from "@/lib/nav";
import { useOrg } from "@/providers/org";
import { haptics, TabFoot, useTheme } from "@/ui";
import { type TabGlyph, tabGlyphKey } from "@/ui/tabGlyphs";
import { tabGlyphFamily } from "@/ui/tabIcons";

/**
 * The bar's own short names, one word each so the five sit evenly (this fork's words, Portuguese and English; any
 * other language reads English). Each screen keeps its full title ("Esperando você", "Configurações").
 */
const TAB_WORDS = {
  pt: { activity: "Pendentes", you: "Ajustes" },
  en: { activity: "Pending", you: "Settings" },
} as const;

const TABS: { name: string; glyph: TabGlyph; label: string }[] = [
  { name: "(chats)", glyph: "home", label: "shell.home" },
  { name: "activity", glyph: "waiting", label: "shell.waiting" },
  { name: "portal", glyph: "portal", label: "portal" },
  { name: "reviews", glyph: "review", label: "review" },
  { name: "you", glyph: "settings", label: "shell.settings" },
];

/**
 * The web sidebar's five rows, in its order, in the system tab bar (UITabBarController on iOS, Liquid Glass on iOS 26;
 * Material bottom navigation on Android): Início, Pendentes (Esperando você), Portal, Revisão and Ajustes
 * (Configurações), each a short word. Everything else
 * (WhatsApp, Mídia, Drive, Agentes, Tarefas, Threads, Buscar…) is in Início's tools, as the web's grid. Our own glyphs
 * (the sidebar's icons; outline, filled or bolder when selected), drawn as template images the bar tints. Badges: what
 * waits on you on Esperando você, unread conversations on Início, videos to review on Revisão. Every tab holds a
 * stack with a native header. Portal shows only where the approval portal is this workspace's.
 */
export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const short = TAB_WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const { colors } = useTheme();
  const unread = useUnreadConversations();
  const unreadThreads = useUnreadThreads();
  const waiting = useWaitingCount();
  const reviewWords = useReviewWords();
  const portalWords = usePortalWords();
  const toReview = (useVideoReviews(useOrg().orgId).data ?? []).filter((r) => r.status === "in_review").length;
  const portalOn = usePortalOn();
  const counts: Record<string, number> = { "(chats)": unread + unreadThreads, activity: waiting, reviews: toReview };
  // Long work and what waits on you go with you across the tabs, the phone's Agora (iOS 26: the bar's accessory, the
  // system's glass; Android and older iOS: a strip over the bar, on the tab roots). "Esperando você" only where
  // something really waits on me (the home's strip and Atividade read the same list).
  const along = useWorkAlong();
  const accessory = alongInAccessory(Platform.OS, Platform.Version);
  // The strip is redrawn only when what it says changes: the tab roots read it.
  const shown = along ? `${along.lead.key}:${along.lead.waiting}:${along.lead.what}:${along.others}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` is what the strip says of `along`
  const foot = useMemo(
    () =>
      along && !accessory
        ? { node: <AlongStrip lead={along.lead} others={along.others} />, height: ALONG_STRIP }
        : null,
    [shown, accessory],
  );
  return (
    <TabFoot.Provider value={foot}>
      <NativeTabs
        tintColor={colors.ink}
        iconColor={{ default: colors.faint, selected: colors.ink }}
        labelStyle={{ default: { color: colors.faint }, selected: { color: colors.ink } }}
        backgroundColor={colors.bg}
        // iOS draws badge text in white whatever we ask: a red dark enough for it, in both themes.
        badgeBackgroundColor={TAB_BADGE.background}
        badgeTextColor={TAB_BADGE.text}
        indicatorColor={colors.sunken}
        rippleColor={colors.plate}
        labelVisibilityMode="labeled"
        // iOS 26: reading down a list, the bar folds to the current tab and comes back on the way up (the system's own).
        minimizeBehavior="onScrollDown"
        // The system tab bars give no haptic on a tab change; ours did.
        screenListeners={{ tabPress: () => haptics.selection() }}
      >
        {along && accessory ? (
          <NativeTabs.BottomAccessory>
            <AccessoryLine lead={along.lead} others={along.others} />
          </NativeTabs.BottomAccessory>
        ) : null}
        {TABS.map((tab) => {
          const label =
            tab.name === "reviews"
              ? reviewWords.title
              : tab.name === "portal"
                ? portalWords.title
                : tab.name === "activity" || tab.name === "you"
                  ? short[tab.name]
                  : t(tab.label);
          const count = counts[tab.name] ?? 0;
          const badge = tabBadge(count);
          return (
            <NativeTabs.Trigger
              key={tab.name}
              name={tab.name}
              hidden={tab.name === "portal" && !portalOn}
              accessibilityLabel={badge ? t("mobile.tabs.withCount", { label, count }) : label}
              contentStyle={{ backgroundColor: colors.bg }}
            >
              <NativeTabs.Trigger.Icon
                renderingMode="template"
                src={{
                  default: (
                    <NativeTabs.Trigger.VectorIcon family={tabGlyphFamily} name={tabGlyphKey(tab.glyph, false)} />
                  ),
                  selected: (
                    <NativeTabs.Trigger.VectorIcon family={tabGlyphFamily} name={tabGlyphKey(tab.glyph, true)} />
                  ),
                }}
              />
              <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
              {badge ? <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge> : null}
            </NativeTabs.Trigger>
          );
        })}
      </NativeTabs>
    </TabFoot.Provider>
  );
}
