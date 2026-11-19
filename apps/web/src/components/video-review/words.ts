import { type ReviewWords, reviewWords } from "@dougbot/client";
import { useTranslation } from "react-i18next";

export { frameCode, type ReviewWords, timecode } from "@dougbot/client";

/** The review's words in the page's language (they live in `@dougbot/client`, shared with the phone). */
export function useReviewWords(): ReviewWords {
  const { i18n } = useTranslation();
  return reviewWords(i18n.language);
}
