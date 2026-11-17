import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "../api/client";
import { useApi } from "../api/context";
import type {
  DesignEditInput,
  PersonWorkInput,
  ReviewPostPatch,
  VideoReviewDecision,
  VideoReviewNoteInput,
  VideoReviewVoiceInput,
} from "./types";

/*
 * Video review in the apps (docs/adr/doug-0007-video-review.md). A review has no realtime event of its own: an open one
 * is read again every few seconds, so a new version or another person's note shows up by itself.
 */

const reviewKeys = {
  all: (orgId: string) => ["org", orgId, "video-reviews"] as const,
  one: (orgId: string, reviewId: string) => ["org", orgId, "video-reviews", reviewId] as const,
};

function reviewsOf(api: ApiClient): NonNullable<ApiClient["videoReviews"]> {
  if (!api.videoReviews) throw new Error("This server has no video review");
  return api.videoReviews;
}

/** The videos in review this person may see, newest first. */
export function useVideoReviews(orgId: string) {
  const api = useApi();
  return useQuery({
    queryKey: reviewKeys.all(orgId),
    queryFn: async () => (await reviewsOf(api).list(orgId)).reviews,
    enabled: Boolean(orgId) && Boolean(api.videoReviews),
    refetchInterval: 30_000,
  });
}

export function useVideoReview(orgId: string, reviewId: string) {
  const api = useApi();
  return useQuery({
    queryKey: reviewKeys.one(orgId, reviewId),
    queryFn: () => reviewsOf(api).get(orgId, reviewId),
    enabled: Boolean(orgId) && Boolean(reviewId) && Boolean(api.videoReviews),
    refetchInterval: 8_000,
  });
}

function useReviewChange<I, O>(orgId: string, reviewId: string, run: (api: ApiClient, input: I) => Promise<O>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => run(api, input),
    // The review's own key is under the list's: both read again.
    onSettled: () =>
      qc
        .invalidateQueries({ queryKey: reviewKeys.one(orgId, reviewId) })
        .then(() => qc.invalidateQueries({ queryKey: reviewKeys.all(orgId), exact: true })),
  });
}

export const useAddReviewNote = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, input: VideoReviewNoteInput) =>
    reviewsOf(api).addNote(orgId, reviewId, input),
  );

export const useAddVoiceReviewNote = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, input: VideoReviewVoiceInput) =>
    reviewsOf(api).addVoiceNote(orgId, reviewId, input),
  );

export const useDeleteReviewNote = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, noteId: string) => reviewsOf(api).deleteNote(orgId, reviewId, noteId));

export const useDecideVideoReview = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, input: { decision: VideoReviewDecision; message?: string }) =>
    reviewsOf(api).decide(orgId, reviewId, input),
  );

/** A design version's editable page (a version never changes: read once). */
export function useDesignSource(orgId: string, reviewId: string, version: number, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...reviewKeys.one(orgId, reviewId), "source", version] as const,
    queryFn: async () => {
      const source = reviewsOf(api).source;
      if (!source) throw new Error("This server has no design review");
      return source(orgId, reviewId, version);
    },
    enabled: enabled && Boolean(orgId) && Boolean(reviewId) && Boolean(api.videoReviews?.source),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
  });
}

export const useSaveDesign = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, input: DesignEditInput) => {
    const save = reviewsOf(api).saveDesign;
    if (!save) throw new Error("This server has no design review");
    return save(orgId, reviewId, input);
  });

// ---------- an editor's delivery from a task (docs/adr/doug-0012-editor-delivery.md) ----------

const taskVideoKey = (orgId: string, issueId: string) => ["org", orgId, "issues", issueId, "video-delivery"] as const;

/** The reviews sent from this task, one per video; read again now and then so a decision shows up by itself. */
export function useTaskVideo(orgId: string, issueId: string) {
  const api = useApi();
  return useQuery({
    queryKey: taskVideoKey(orgId, issueId),
    queryFn: async () => {
      const read = reviewsOf(api).taskVideo;
      if (!read) return { reviewId: null, reviewIds: [] as string[] };
      const got = await read(orgId, issueId);
      // A server from before several videos per task answers one.
      return { ...got, reviewIds: got.reviewIds ?? (got.reviewId ? [got.reviewId] : []) };
    },
    enabled: Boolean(orgId) && Boolean(issueId) && Boolean(api.videoReviews?.taskVideo),
    refetchInterval: 30_000,
  });
}

/** Sends a video already uploaded to the task's conversation. */
export function useSendTaskVideo(orgId: string, issueId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { artifactId: string; note?: string; reviewId?: string }) => {
      const send = reviewsOf(api).sendTaskVideo;
      if (!send) throw new Error("This server has no editor delivery");
      return send(orgId, issueId, input);
    },
    onSettled: () =>
      qc
        .invalidateQueries({ queryKey: taskVideoKey(orgId, issueId) })
        .then(() => qc.invalidateQueries({ queryKey: reviewKeys.all(orgId) })),
  });
}

/** Sends work a person made for review, or its next version (docs/adr/doug-0015-team-work-review.md). */
export function useSendWork(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonWorkInput) => {
      const send = reviewsOf(api).sendWork;
      if (!send) throw new Error("This server has no team review");
      return send(orgId, input);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: reviewKeys.all(orgId) }),
  });
}

export const useSetReviewPost = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, patch: ReviewPostPatch) => {
    const set = reviewsOf(api).setPost;
    if (!set) throw new Error("This server has no editor delivery");
    return set(orgId, reviewId, patch);
  });

export const useSendToClient = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, _input: undefined) => {
    const send = reviewsOf(api).sendToClient;
    if (!send) throw new Error("This server has no editor delivery");
    return send(orgId, reviewId);
  });

export const useRetryFinal = (orgId: string, reviewId: string) =>
  useReviewChange(orgId, reviewId, (api, _input: undefined) => {
    const retry = reviewsOf(api).retryFinal;
    if (!retry) throw new Error("This server has no editor delivery");
    return retry(orgId, reviewId);
  });

/** Each person's WhatsApp conversation for the changes asked of them (doug-0012 §11). */
export function useReviewWhatsApp(orgId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ["org", orgId, "review-whatsapp"] as const,
    queryFn: async () => {
      const read = reviewsOf(api).whatsappTargets;
      return read ? (await read(orgId)).targets : [];
    },
    enabled: enabled && Boolean(orgId) && Boolean(api.videoReviews?.whatsappTargets),
  });
}

export function useSetReviewWhatsApp(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; target: { accountId: string; chatId: string } | null }) => {
      const set = reviewsOf(api).setWhatsappTarget;
      if (!set) throw new Error("This server has no review notices");
      return set(orgId, input.userId, input.target);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["org", orgId, "review-whatsapp"] }),
  });
}
