import { Image } from "expo-image";
import { useMemo } from "react";
import { appHeaders, lastCookie } from "@/lib/auth";
import { photoSource } from "@/lib/photo";
import { placeKey } from "@/lib/server";
import { serverOf } from "@/lib/server-choice";
import { LogoMark } from "@/ui";

/**
 * A workspace's face: its logo in the Doug's frame (rounded square), else DougBot's mark (the Doug, drawn by code).
 * The logo is cached in memory and on disk (its address changes with its content) and drawn with no fade, as the bars
 * and lists show it again and again.
 */
export function OrgAvatar({
  logo,
  size = 30,
  server,
}: {
  logo?: string | null | undefined;
  size?: number;
  /** The place the logo is read from (another server or account signed in to, in Workspaces); the current one by default. */
  server?: string;
}) {
  // Stable per logo, so the image isn't fetched again on every render.
  const source = useMemo(() => {
    const on = server ?? placeKey();
    return photoSource(logo, serverOf(on), appHeaders(lastCookie(on)));
  }, [logo, server]);
  if (!source) return <LogoMark size={size} />;
  // DougBot: the logo in the Doug's glass frame's corner (28 of 100), every corner the same.
  return (
    <Image
      source={source}
      cachePolicy="memory-disk"
      recyclingKey={source.uri}
      transition={0}
      contentFit="cover"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      accessibilityIgnoresInvertColors
    />
  );
}
