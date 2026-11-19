import { useApi } from "@dougbot/client";
import { editorPage, type FrameCommand, type FrameMessage } from "@dougbot/client/lib/design-bridge";
import { PAGE_SANDBOX } from "@dougbot/client/lib/isolated-page";
import { useQuery } from "@tanstack/react-query";
import { createElement, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { appHeaders, lastCookie } from "@/lib/auth";
import { Text } from "@/ui";
import { blockMayLoad } from "../blocks/logic";
import { useColors, useOrgId } from "../shared/hooks";
import { sourceUrlOf } from "./design-logic";
import { useReviewWords } from "./media";

/*
 * A design piece's own page on the phone (docs/adr/doug-0010-design-review.md): the HTML the slides were drawn from,
 * run as every agent page runs here (no cookies, storage, files or way off the page), with the editor's side in
 * first (`editorPage`). It talks to the app through the web view's channel; the app's commands go in as
 * `window.__ed(…)`. The page is the slide at its real size (1080 wide, say): the viewport scales it to the room it has.
 */

/** A version's page, as text. Read with the session like the app's files; a version never changes, so read once. */
export function usePieceSource(reviewId: string, version: number, enabled: boolean) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: ["org", orgId, "video-reviews", reviewId, "source", version, "phone"],
    enabled: enabled && Boolean(api.videoReviews?.pageUrl),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const page = api.videoReviews?.pageUrl?.(orgId, reviewId, version, 1);
      if (!page) throw new Error("This server has no design review");
      // The app's own fetch with the session's headers: a blob's `text()` isn't on every phone's fetch.
      const res = await fetch(sourceUrlOf(page), { headers: appHeaders(lastCookie()) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
  });
}

/** The page fitted to `width` screen points: its viewport, set before it draws and again once its size is known. */
const viewport = (k: number) =>
  `<meta name="viewport" content="width=device-width, initial-scale=${k}, minimum-scale=${k}, maximum-scale=${k}, user-scalable=no">`;
const setViewport = (k: number) =>
  `(function(){var m=document.querySelector('meta[name=viewport]');if(m)m.setAttribute('content',${JSON.stringify(
    viewport(k).replace(/^<meta name="viewport" content="|">$/g, ""),
  )});})();true;`;

export interface PieceHandle {
  send: (cmd: FrameCommand) => void;
}

/**
 * The piece in a web view, `width` points wide and as tall as its slide. `onMessage` hears the editor's side; on
 * "boot" the words go in, on "ready" the slide, the mode and the scale (handles that stay finger-sized).
 */
export const PieceView = forwardRef<
  PieceHandle,
  {
    html: string;
    width: number;
    slide: number;
    mode: "view" | "edit";
    onMessage: (m: FrameMessage) => void;
  }
>(function PieceView(props, ref) {
  // A browser has no native web view (the board, `prancha/`): the same page in a sandboxed frame.
  return Platform.OS === "web" ? <FramePiece {...props} ref={ref} /> : <NativePiece {...props} ref={ref} />;
});

type PieceProps = {
  html: string;
  width: number;
  slide: number;
  mode: "view" | "edit";
  onMessage: (m: FrameMessage) => void;
};

const FramePiece = forwardRef<PieceHandle, PieceProps>(function FramePiece(
  { html, width, slide, mode, onMessage },
  ref,
) {
  const frame = useRef<{ contentWindow: Window | null } | null>(null);
  const w = useReviewWords();
  const [size, setSize] = useState({ w: 1080, h: 1350 });
  const k = width / size.w;
  const state = useRef({ slide, mode, k, onMessage });
  state.current = { slide, mode, k, onMessage };
  const send = (cmd: FrameCommand) => frame.current?.contentWindow?.postMessage(cmd, "*");
  useImperativeHandle(ref, () => ({ send }));
  const url = useMemo(() => URL.createObjectURL(new Blob([editorPage(html)], { type: "text/html" })), [html]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new width asks for it
  useEffect(() => {
    send({ ed: "scale", k: width / size.w });
  }, [width]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listener reads the latest state through the ref
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FrameMessage;
      if (!m || typeof m !== "object" || !("ed" in m)) return;
      const s = state.current;
      if (m.ed === "boot") {
        send({
          ed: "words",
          words: { text: w.design.text, photo: w.design.photo, shape: w.design.shape, logo: "Logo" },
        });
      } else if (m.ed === "ready" || m.ed === "slide") {
        setSize({ w: m.w, h: m.h });
        if (m.ed === "ready") {
          send({ ed: "slide", slide: s.slide });
          send({ ed: "mode", mode: s.mode });
        }
        send({ ed: "scale", k: width / m.w });
      }
      s.onMessage(m);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [width]);
  return (
    <View style={{ width, height: size.h * k, overflow: "hidden" }}>
      {createElement("iframe", {
        ref: frame,
        src: url,
        sandbox: PAGE_SANDBOX,
        title: "piece",
        style: {
          width: size.w,
          height: size.h,
          maxWidth: "none",
          maxHeight: "none",
          flexShrink: 0,
          border: 0,
          transform: `scale(${k})`,
          transformOrigin: "0 0",
        },
      })}
    </View>
  );
});

const NativePiece = forwardRef<PieceHandle, PieceProps>(function NativePiece(
  { html, width, slide, mode, onMessage },
  ref,
) {
  const web = useRef<WebView<object>>(null);
  const w = useReviewWords();
  const c = useColors();
  const [size, setSize] = useState({ w: 1080, h: 1350 });
  const [ready, setReady] = useState(false);
  const k = width / size.w;
  const state = useRef({ slide, mode, k });
  state.current = { slide, mode, k };
  const send = (cmd: FrameCommand) =>
    web.current?.injectJavaScript(`window.__ed&&window.__ed(${JSON.stringify(cmd)});true;`);
  useImperativeHandle(ref, () => ({ send }));
  // The room changed after load (the panel grew or shrank): the same page, zoomed to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new width asks for it
  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(setViewport(width / size.w));
    send({ ed: "scale", k: width / size.w });
  }, [width]);
  // Built once per page: the first scale guesses a portrait post, corrected when the slide says its size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the width's first value only; later ones go in by script
  const page = useMemo(() => editorPage(html).replace("<head>", `<head>${viewport(width / 1080)}`), [html]);
  return (
    <View style={{ width, height: size.h * k }}>
      <WebView
        ref={web}
        source={{ html: page, baseUrl: "about:blank" }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) => blockMayLoad(request.url)}
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        domStorageEnabled={false}
        incognito
        cacheEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        geolocationEnabled={false}
        mediaCapturePermissionGrantType="deny"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        style={styles.web}
        onMessage={(e) => {
          let m: FrameMessage;
          try {
            m = JSON.parse(e.nativeEvent.data) as FrameMessage;
          } catch {
            return;
          }
          if (!m || typeof m !== "object" || !("ed" in m)) return;
          const s = state.current;
          if (m.ed === "boot") {
            send({
              ed: "words",
              words: { text: w.design.text, photo: w.design.photo, shape: w.design.shape, logo: "Logo" },
            });
          } else if (m.ed === "ready" || m.ed === "slide") {
            const next = width / m.w;
            setSize({ w: m.w, h: m.h });
            web.current?.injectJavaScript(setViewport(next));
            if (m.ed === "ready") {
              setReady(true);
              send({ ed: "slide", slide: s.slide });
              send({ ed: "mode", mode: s.mode });
            }
            send({ ed: "scale", k: next });
          }
          onMessage(m);
        }}
      />
      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: c.sunken }]}>
          <ActivityIndicator color={c.muted} />
          <Text variant="footnote" tone="muted">
            {w.design.loading}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: "transparent" },
  loading: { alignItems: "center", justifyContent: "center", gap: 8 },
});
