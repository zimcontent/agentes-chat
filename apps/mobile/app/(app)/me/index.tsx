import { Redirect } from "expo-router";

/** Você is the Configurações tab now: an old link to it lands there. */
export default function MeRoute() {
  return <Redirect href="/you" />;
}
