import { Stack } from "expo-router";
import { coverBarOptions, usePushedOptions } from "@/ui";

/** Configurações: Você at the tab's root, its clear bar over the sky (as when it was pushed). */
export default function YouStack() {
  const pushed = usePushedOptions();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ ...pushed, ...coverBarOptions }} />
    </Stack>
  );
}
