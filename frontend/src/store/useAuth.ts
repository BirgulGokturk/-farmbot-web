import { create } from "zustand";

import { ApiError, api, tokenStore } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  error: string | null;

  /** Sayfa açılışında saklanan token ile oturumu geri yükler. */
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  error: null,

  async restore() {
    if (!tokenStore.access) {
      set({ status: "anonymous", user: null });
      return;
    }
    try {
      const user = await api.auth.me();
      set({ user, status: "authenticated", error: null });
    } catch {
      tokenStore.clear();
      set({ user: null, status: "anonymous" });
    }
  },

  async login(email, password) {
    set({ error: null });
    try {
      const pair = await api.auth.login(email, password);
      set({ user: pair.user, status: "authenticated" });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Giriş başarısız";
      set({ error: message });
      throw err;
    }
  },

  async register(email, password, fullName) {
    set({ error: null });
    try {
      const pair = await api.auth.register({ email, password, full_name: fullName });
      set({ user: pair.user, status: "authenticated" });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Kayıt başarısız";
      set({ error: message });
      throw err;
    }
  },

  logout() {
    api.auth.logout();
    set({ user: null, status: "anonymous", error: null });
  },
}));
