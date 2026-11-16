import { router } from "@/ui/navigation";

/** Opens Mídia's form; `prefill` starts it from a generation's choices ("Usar este prompt"). */
export const openNewMedia = (prefill?: { kind: string; model: string; prompt: string }) =>
  prefill ? router.push({ pathname: "/media/new", params: prefill }) : router.push("/media/new");

/** Opens one generation's screen. */
export const openGeneration = (id: string) => router.push(`/media/${id}`);
