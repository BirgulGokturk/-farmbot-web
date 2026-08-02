/**
 * Paletten tuvale sürükle-bırak.
 *
 * Dinleyiciler `useEffect` ile değil, sürükleme başlar başlamaz **imperatif
 * olarak** bağlanır. Efekte bağlanmış olsaydı, hızlı bir sürüklemede
 * (özellikle otomasyon veya dokunmatik jestlerde) pointerup React yeniden
 * render edip dinleyiciyi bağlamadan gelebilir ve bırakma kaçırılabilirdi.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlantSpecies } from "@/lib/types";

export interface DragGhost {
  species: PlantSpecies;
  clientX: number;
  clientY: number;
}

interface Options {
  /** İşaretçi bırakıldığında çağrılır. Tuvalin dışındaysa çağrılmaz. */
  onDrop: (species: PlantSpecies, clientX: number, clientY: number) => void;
  /** Bırakma noktası geçerli mi (tuvalin üzerinde mi)? */
  canDrop: (clientX: number, clientY: number) => boolean;
}

export function usePaletteDrag({ onDrop, canDrop }: Options) {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Geri çağrıların en güncel sürümü kullanılsın
  const handlers = useRef({ onDrop, canDrop });
  handlers.current = { onDrop, canDrop };

  const start = useCallback((species: PlantSpecies, clientX: number, clientY: number) => {
    cleanupRef.current?.();
    setGhost({ species, clientX, clientY });

    const move = (event: PointerEvent) => {
      setGhost({ species, clientX: event.clientX, clientY: event.clientY });
    };

    const end = (event: PointerEvent) => {
      cleanup();
      if (handlers.current.canDrop(event.clientX, event.clientY)) {
        handlers.current.onDrop(species, event.clientX, event.clientY);
      }
    };

    const cancel = () => cleanup();

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      cleanupRef.current = null;
      setGhost(null);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    cleanupRef.current = cleanup;
  }, []);

  // Bileşen sürükleme sırasında kaldırılırsa dinleyiciler sızmasın
  useEffect(() => () => cleanupRef.current?.(), []);

  return { ghost, start, dragging: ghost !== null };
}
