import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "../api/client";
import { useApi } from "../api/context";
import { ApiError } from "../api/http";
import type { MediaGenerateInput, MediaGenerationView } from "./types";

/** Media generation (ADR doug-0010): the wallet, the models and the generations, through the server only. */

export const mediaKeys = {
  all: (orgId: string) => ["org", orgId, "media"] as const,
  overview: (orgId: string) => ["org", orgId, "media", "overview"] as const,
  generations: (orgId: string, mine: boolean) => ["org", orgId, "media", "generations", mine] as const,
  topup: (orgId: string, id: string) => ["org", orgId, "media", "topup", id] as const,
};

/** While one runs, the list asks again this often: the server checks it with the service and saves the file. */
export const MEDIA_RUNNING_POLL_MS = 5_000;

const mediaOf = (api: ApiClient) => {
  if (!api.media) throw new ApiError(404, "media.off", "This server has no media generation");
  return api.media;
};

export const useMediaOverview = (orgId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: mediaKeys.overview(orgId),
    queryFn: () => mediaOf(api).overview(orgId),
    enabled,
    retry: false,
  });
};

/** The latest generations, asked again while any is running; each running one is checked so its file lands. */
export const useMediaGenerations = (orgId: string, mine: boolean) => {
  const api = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: mediaKeys.generations(orgId, mine),
    queryFn: async () => {
      const list = await mediaOf(api).generations(orgId, mine);
      const running = list.filter((g) => g.status === "running").slice(0, 6);
      if (!running.length) return list;
      const fresh = await Promise.all(
        running.map((g) =>
          mediaOf(api)
            .generation(orgId, g.id)
            .catch(() => g),
        ),
      );
      const byId = new Map(fresh.map((g) => [g.id, g]));
      if (fresh.some((g) => g.status !== "running")) void qc.invalidateQueries({ queryKey: mediaKeys.overview(orgId) });
      return list.map((g) => byId.get(g.id) ?? g);
    },
    refetchInterval: (q) =>
      q.state.data?.some((g: MediaGenerationView) => g.status === "running") ? MEDIA_RUNNING_POLL_MS : false,
    meta: { quiet: true },
  });
};

export const useUploadMediaRef = (orgId: string) => {
  const api = useApi();
  return useMutation({ mutationFn: (file: File) => mediaOf(api).uploadRef(orgId, file) });
};

export const useGenerateMedia = (orgId: string) => {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MediaGenerateInput) => mediaOf(api).generate(orgId, input),
    onSettled: () => qc.invalidateQueries({ queryKey: mediaKeys.all(orgId) }),
  });
};

export const useMediaTopup = (orgId: string) => {
  const api = useApi();
  return useMutation({ mutationFn: (pack: string) => mediaOf(api).topup(orgId, pack) });
};

/** A top-up back from Mercado Pago: checked until Mercado Pago says yes or no (the server asks it). */
export const useMediaTopupStatus = (orgId: string, id: string | null) => {
  const api = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: mediaKeys.topup(orgId, id ?? ""),
    queryFn: async () => {
      const r = await mediaOf(api).topupStatus(orgId, id ?? "");
      if (r.topup.status !== "pending") void qc.invalidateQueries({ queryKey: mediaKeys.overview(orgId) });
      return r;
    },
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data?.topup.status === "pending" ? 4_000 : false),
    retry: false,
  });
};
