import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "../api/client";
import { useApi } from "../api/context";
import type { VideoReviewDecision, VideoReviewNoteInput, VideoReviewVoiceInput } from "./types";

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
