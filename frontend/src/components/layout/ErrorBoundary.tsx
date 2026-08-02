import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button, Card } from "@/components/ui/primitives";

interface Props {
  children: ReactNode;
  /** Değiştiğinde hata durumu sıfırlanır — sayfa değişince temiz başlasın. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Bir sayfada beklenmeyen hata olursa tüm uygulamanın beyaz ekrana düşmesini
 * engeller; kullanıcıya anlaşılır bir mesaj ve kurtarma yolu gösterir.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Geliştirme sırasında yığın izini görebilmek için
    console.error("Sayfa hatası:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Card className="mx-auto mt-10 max-w-lg text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
          <AlertTriangle className="size-7" />
        </span>
        <h2 className="mt-4 font-display text-xl font-semibold text-content">
          Bu bölüm yüklenemedi
        </h2>
        <p className="mt-2 text-sm text-muted">
          Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyin; sorun sürerse
          kayıtlar bölümünden ayrıntılara bakabilirsiniz.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-surface-2 p-3 text-left font-mono text-xs text-subtle">
          {error.message}
        </pre>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => this.setState({ error: null })} icon={<RotateCcw className="size-4" />}>
            Tekrar Dene
          </Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Sayfayı Yenile
          </Button>
        </div>
      </Card>
    );
  }
}
