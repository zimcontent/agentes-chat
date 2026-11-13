import { useLocalSearchParams } from "expo-router";
import { type ComponentType, useEffect, useState } from "react";
import { Platform, View } from "react-native";

/**
 * One screen of the board. On the web, Skia (the composer's hold ring, a few charts) needs CanvasKit before any module
 * that draws with it is evaluated, so the screens load only after it (`LoadSkiaWeb`, `canvaskit.wasm` served at the root).
 */
export default function TelaRoute() {
  const { tela } = useLocalSearchParams<{ tela: string }>();
  const [Tela, setTela] = useState<ComponentType<{ tela: string | undefined }> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (Platform.OS === "web") {
        const { LoadSkiaWeb } = await import("@shopify/react-native-skia/lib/module/web");
        await LoadSkiaWeb({ locateFile: () => "/canvaskit.wasm" });
      }
      const mod = await import("../prancha-src/telas");
      if (alive) setTela(() => mod.Tela);
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);
  return Tela ? <Tela tela={tela} /> : <View />;
}
