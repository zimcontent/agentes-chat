import { Redirect } from "expo-router";

/** Revisão is a tab now (the web sidebar's row): the old address lands there. */
export default function ReviewsRoute() {
  return <Redirect href="/reviews" />;
}
