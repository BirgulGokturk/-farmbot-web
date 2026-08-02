/**
 * Geri al / yinele.
 *
 * Anlık görüntü (snapshot) yerine **ters işlem** yaklaşımı kullanıyoruz:
 * her değişiklik, kendisini geri alacak ve yeniden uygulayacak iki fonksiyonla
 * birlikte yığına eklenir. Sunucu tarafında kimlikler değiştiği için snapshot
 * almak güvenilir olmazdı; ters işlem var olan uç noktalarla birebir çalışır
 * (silme → geri yükleme, taşıma → eski konuma taşıma).
 */

import { useCallback, useRef, useState } from "react";

export interface HistoryEntry {
  /** Kullanıcıya gösterilecek kısa açıklama, ör. "3 bitki taşındı" */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_ENTRIES = 50;

export function useHistory() {
  // Yığınlar ref'te: eş zamanlı iki işlemde React'in toplu güncellemesi
  // birbirinin üzerine yazmasın.
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);

  const [state, setState] = useState({ canUndo: false, canRedo: false, busy: false });

  const sync = useCallback((busy = false) => {
    setState({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      busy,
    });
  }, []);

  /** Uygulanmış bir değişikliği geçmişe ekler. Yeni işlem yineleme zincirini kırar. */
  const push = useCallback(
    (entry: HistoryEntry) => {
      past.current.push(entry);
      if (past.current.length > MAX_ENTRIES) past.current.shift();
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(async (): Promise<string | null> => {
    const entry = past.current.pop();
    if (!entry) return null;

    sync(true);
    try {
      await entry.undo();
      future.current.push(entry);
      return entry.label;
    } catch (error) {
      // Geri alınamadıysa yığına iade et; kullanıcı tekrar deneyebilsin
      past.current.push(entry);
      throw error;
    } finally {
      sync();
    }
  }, [sync]);

  const redo = useCallback(async (): Promise<string | null> => {
    const entry = future.current.pop();
    if (!entry) return null;

    sync(true);
    try {
      await entry.redo();
      past.current.push(entry);
      return entry.label;
    } catch (error) {
      future.current.push(entry);
      throw error;
    } finally {
      sync();
    }
  }, [sync]);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    busy: state.busy,
    /** Bir sonraki geri alma işleminin açıklaması (ipucu metni için) */
    nextUndoLabel: past.current.at(-1)?.label ?? null,
    nextRedoLabel: future.current.at(-1)?.label ?? null,
  };
}
