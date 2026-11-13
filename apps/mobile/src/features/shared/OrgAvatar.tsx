import { useMemo } from "react";
import { Image } from "react-native";
import { appHeaders, lastCookie } from "@/lib/auth";
import { photoSource } from "@/lib/photo";
import { serverUrl } from "@/lib/server";
import { LogoMark } from "@/ui";

/**
 * A workspace's face: its logo in the Doug's frame (rounded square), else DougBot's mark (the Doug, drawn by code).
 */
export function OrgAvatar({
  logo,
  size = 30,
  server,
}: {
  logo?: string | null | undefined;
  size?: number;
  /** The server the logo is on (another one signed in to, in Workspaces: ADR 0154); the current one by default. */
  server?: string;
}) {
  // Stable per logo, so the image isn't fetched again on every render.
  const source = useMemo(() => {
    const on = server ?? serverUrl();
    return photoSource(logo, on, appHeaders(lastCookie(on)));
  }, [logo, server]);
  if (!source) return <LogoMark size={size} />;
  // DougBot: the logo in the Doug's glass frame's corner (28 of 100), every corner the same.
  return (
    <Image
      source={source}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      accessibilityIgnoresInvertColors
    />
  );
}
