import { useCallback, useEffect, useState } from "react";

const KEY = "localchat-theme";            // "system" | "light" | "dark"
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readSaved() {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
}

/** Light/dark theme. "system" follows the Windows setting. index.html applies the saved value before load. */
export function useTheme() {
  const [theme, setThemeState] = useState(readSaved);
  const [systemDark, setSystemDark] = useState(media.matches);

  useEffect(() => {
    const onChange = e => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* not saved, still applied */ }
  }, [theme]);

  const setTheme = useCallback(next => {
    // Brief cross-fade, skipped for people who prefer reduced motion.
    const root = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-switching");
      setTimeout(() => root.classList.remove("theme-switching"), 250);
    }
    setThemeState(next);
  }, []);

  const effective = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const toggle = useCallback(() => setTheme(effective === "dark" ? "light" : "dark"), [effective, setTheme]);

  return { theme, effective, setTheme, toggle };
}
