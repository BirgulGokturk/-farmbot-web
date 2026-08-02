import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui/primitives";
import { BotLogo } from "@/components/layout/BotLogo";
import { useAuth } from "@/store/useAuth";

export default function Login() {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const error = useAuth((s) => s.error);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, fullName || undefined);
    } catch {
      // Hata mesajı store'da tutuluyor, aşağıda gösteriliyor
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BotLogo />
        </div>

        <div className="animate-fade-up rounded-[var(--radius-panel)] border border-line bg-surface p-7 shadow-float ring-inset-light">
          <h1 className="font-display text-2xl font-semibold text-content">
            {mode === "login" ? "Tekrar hoş geldiniz" : "Hesap oluştur"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {mode === "login"
              ? "Robotunuzu yönetmek için giriş yapın."
              : "Birkaç saniyede hesabınızı açın."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "register" && (
              <Input
                name="full_name"
                label="Ad Soyad"
                placeholder="Adınız"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            )}

            <Input
              name="email"
              type="email"
              label="E-posta"
              placeholder="ornek@eposta.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <Input
              name="password"
              type="password"
              label="Parola"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              hint={mode === "register" ? "En az 8 karakter" : undefined}
              required
            />

            {error && (
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
              {mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
            </Button>
          </form>

          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="mt-5 w-full text-center text-sm text-muted transition-soft hover:text-brand"
          >
            {mode === "login"
              ? "Hesabınız yok mu? Kayıt olun"
              : "Zaten hesabınız var mı? Giriş yapın"}
          </button>
        </div>

        {/* Geliştirme kolaylığı: seed ile oluşturulan demo hesap */}
        <div className="mt-4 rounded-xl border border-line bg-surface-2/60 p-4 text-center">
          <p className="text-xs text-subtle">Demo hesap</p>
          <p className="mt-1 font-mono text-xs text-muted">demo@farmbot.dev · farmbot123</p>
          <button
            onClick={() => {
              setEmail("demo@farmbot.dev");
              setPassword("farmbot123");
              setMode("login");
            }}
            className="mt-2 text-xs font-medium text-brand transition-soft hover:underline"
          >
            Bilgileri doldur
          </button>
        </div>
      </div>
    </div>
  );
}
