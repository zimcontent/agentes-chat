import { type ReviewWords, reviewWords } from "@agenteschat/client";
import { useTranslation } from "react-i18next";

export { frameCode, type ReviewWords, timecode } from "@agenteschat/client";

/** The review's words in the page's language (they live in `@agenteschat/client`, shared with the phone). */
export function useReviewWords(): ReviewWords {
  const { i18n } = useTranslation();
  return reviewWords(i18n.language);
}
