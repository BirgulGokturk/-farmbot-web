import { create } from "zustand";

type Theme = "light" | "dark";

const STORAGE_KEY = "farmbot-theme";

function readInitial(): Theme {
  // index.html içindeki betik <html>'e sınıfı zaten uyguladı; onu okuyoruz
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readInitial(),

  set(theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* özel sekmede localStorage kapalı olabilir */
    }
    set({ theme });
  },

  toggle() {
    get().set(get().theme === "dark" ? "light" : "dark");
  },
}));
