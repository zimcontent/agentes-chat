import {
  MEDIA_RUNNING_POLL_MS,
  type MediaGenerationView,
  mediaKeys,
  useApi,
  useMediaTopup,
  useMediaTopupStatus,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import { useToast } from "@/ui";
import { pickOne } from "../shared/PickerSheet";
import { useMediaWords } from "./words";

/**
 * One generation (docs/adr/doug-0011), asked again while it runs: the server checks it with the service and saves
 * its file. It starts from the gallery's copy, so the screen opens at once.
 */
export function useMediaGeneration(orgId: string, id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: [...mediaKeys.all(orgId), "generation", id] as const,
    queryFn: async () => {
      if (!api.media) throw new Error("media.off");
      const g = await api.media.generation(orgId, id);
      // It just ended: the wallet and the gallery read it.
      if (g.status !== "running") void qc.invalidateQueries({ queryKey: mediaKeys.overview(orgId) });
      return g;
    },
    placeholderData: () => {
      for (const mine of [true, false]) {
        const hit = qc
          .getQueryData<MediaGenerationView[]>(mediaKeys.generations(orgId, mine))
          ?.find((g) => g.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
    refetchInterval: (q) => (q.state.data?.status === "running" ? MEDIA_RUNNING_POLL_MS : false),
    retry: false,
  });
}

/**
 * "Comprar créditos": a pack from the app's own sheet, then Mercado Pago's checkout in the in-app browser (the web
 * opens it in a tab). Back from it, the top-up is checked until Mercado Pago says yes or no, and the toast says so.
 */
export function useTopUp(orgId: string, packs: readonly { id: string; brl: number; credits: number }[]) {
  const { t, i18n } = useTranslation();
  const w = useMediaWords();
  const toast = useToast();
  const buy = useMediaTopup(orgId);
  const [id, setId] = useState<string | null>(null);
  const status = useMediaTopupStatus(orgId, id);
  const told = useRef<string | null>(null);
  const state = status.data?.topup.status;
  const credits = status.data?.topup.credits ?? 0;
  useEffect(() => {
    if (!id || !state || state === "pending" || told.current === id) return;
    told.current = id;
    toast(
      state === "approved"
        ? { title: t("mediaGen.topup.approved", { credits: credits.toLocaleString(i18n.language) }), icon: "check" }
        : { title: t("mediaGen.topup.rejected"), icon: "x" },
    );
  }, [id, state, credits, toast, t, i18n.language]);

  const start = async () => {
    if (packs.length === 0) {
      toast({ title: w.noPack, icon: "info" });
      return;
    }
    const brl = (n: number) => n.toLocaleString(i18n.language, { style: "currency", currency: "BRL" });
    const pack = await pickOne({
      title: t("mediaGen.topup.title"),
      note: t("mediaGen.topup.text"),
      options: packs.map((p) => ({
        key: p.id,
        label: t("mediaGen.credits", { count: p.credits, formatted: p.credits.toLocaleString(i18n.language) }),
        sub: brl(p.brl),
        leading: { kind: "icon" as const, name: "wallet" as const },
      })),
    });
    if (!pack) return;
    try {
      const { topup, checkoutUrl } = await buy.mutateAsync(pack);
      await openBrowserAsync(checkoutUrl).catch(() => Linking.openURL(checkoutUrl));
      setId(topup.id);
      toast({ title: w.topupBack, icon: "clock" });
    } catch (error) {
      toast({ title: errorText(t, error, i18n.language), icon: "x" });
    }
  };
  return { start: () => void start(), busy: buy.isPending, pending: state === "pending" };
}
