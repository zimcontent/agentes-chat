import { switchTheme } from "@dougbot/ui";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS, storage } from "./storage";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const media = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** Doug opens dark: the system's theme only when the person picked it ("system" is saved too). */
function readPreference(): ThemePreference {
  const saved = storage.get(STORAGE_KEYS.theme);
  return saved === "light" || saved === "system" ? saved : "dark";
}

/** Light/dark via `data-theme` on <html> (tokens.css), following the system unless the person picks one. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => media()?.matches ?? false);

  useEffect(() => {
    const query = media();
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useEffect(() => {
    switchTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    if (value === "dark") storage.remove(STORAGE_KEYS.theme);
    else storage.set(STORAGE_KEYS.theme, value);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
