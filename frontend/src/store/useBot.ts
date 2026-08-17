/**
 * Robotun canlı durumu.
 *
 * Konum saniyede birkaç kez değiştiği için bu veri React Query'de değil,
 * doğrudan WebSocket'ten beslenen bu store'da tutulur.
 */

import { create } from "zustand";

import { DeviceSocket } from "@/lib/ws";
import { toast } from "@/components/ui/toast";
import type { DeviceStatus, LogEntry, SocketMessage } from "@/lib/types";

/** Kayıtlar ekranı açılmadan da son olaylar elde kalsın diye tutulan tampon. */
const LOG_BUFFER_SIZE = 200;

type LiveLog = Omit<LogEntry, "id" | "device_id"> & { id: string };

interface BotState {
  deviceId: string | null;
  socket: DeviceSocket | null;
  connected: boolean;
  status: DeviceStatus | null;
  logs: LiveLog[];
  lastReadings: Record<string, { value: number; read_at: string }>;
  /** Yeni bildirim geldiğinde artan sayaç — çan ikonu bunu izleyip listeyi tazeler. */
  notificationTick: number;

  attach: (deviceId: string) => void;
  detach: () => void;
  clearLogs: () => void;
}

let logCounter = 0;

export const useBot = create<BotState>((set, get) => ({
  deviceId: null,
  socket: null,
  connected: false,
  status: null,
  logs: [],
  lastReadings: {},
  notificationTick: 0,

  attach(deviceId) {
    const current = get();
    if (current.deviceId === deviceId && current.socket) return;

    current.socket?.disconnect();

    const socket = new DeviceSocket(deviceId);

    socket.onStateChange((connected) => set({ connected }));

    socket.onMessage((message: SocketMessage) => {
      switch (message.type) {
        case "status":
          set({ status: message.payload });
          break;

        case "log": {
          const entry: LiveLog = { ...message.payload, id: `live-${++logCounter}` };
          set((state) => ({ logs: [entry, ...state.logs].slice(0, LOG_BUFFER_SIZE) }));

          // Robot bir komutu reddettiğinde kullanıcı bunu hemen görmeli.
          // Hareket komutları yanıt beklemeden gönderildiği için hata mesajı
          // istek yanıtında dönmüyor; robottan log olarak geliyor.
          if (entry.channels?.includes("toast")) {
            if (entry.level === "error") toast.error("Robot", entry.message);
            else if (entry.level === "warn") toast.warning("Robot", entry.message);
          }
          break;
        }

        case "reading": {
          const { sensor_id, value, read_at } = message.payload;
          if (!sensor_id) break;
          set((state) => ({
            lastReadings: { ...state.lastReadings, [sensor_id]: { value, read_at } },
          }));
          break;
        }

        case "notification":
          set((state) => ({ notificationTick: state.notificationTick + 1 }));
          break;

        default:
          break;
      }
    });

    socket.connect();
    set({ deviceId, socket, status: null, logs: [], lastReadings: {}, notificationTick: 0 });
  },

  detach() {
    get().socket?.disconnect();
    set({ deviceId: null, socket: null, connected: false, status: null, logs: [] });
  },

  clearLogs() {
    set({ logs: [] });
  },
}));

/**
 * Konum bilinmiyorken kullanılan sabit.
 *
 * Modül düzeyinde tanımlı olması ŞART: seçici içinde `?? { x: 0, ... }` yazmak
 * her render'da yeni bir nesne üretir, Zustand bunu "durum değişti" sanar ve
 * React sonsuz render döngüsüne girer.
 */
export const ORIGIN: Readonly<{ x: number; y: number; z: number }> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
});

/** Konum bilinmiyorsa başlangıç noktasını döndürür. */
export function useBotPosition() {
  return useBot((s) => s.status?.position) ?? ORIGIN;
}
