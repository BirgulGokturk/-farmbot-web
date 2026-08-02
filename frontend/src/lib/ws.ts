/**
 * Robotun canlı durumunu taşıyan WebSocket bağlantısı.
 *
 * Bağlantı koparsa üstel geri çekilmeyle kendi kendini onarır; sekme arka plana
 * alınıp geri gelince anında yeniden bağlanır.
 */

import type { SocketMessage } from "./types";
import { API_BASE, tokenStore } from "./api";

type Listener = (message: SocketMessage) => void;
type StateListener = (connected: boolean) => void;

const MAX_BACKOFF_MS = 20_000;
const HEARTBEAT_MS = 20_000;

/**
 * WebSocket adresini REST kök adresinden türetir — ayrı bir ortam değişkeni
 * tutmaya gerek kalmaz, ikisi hiçbir zaman birbirinden ayrı düşmez.
 * http → ws, https → wss.
 */
function socketUrl(deviceId: string): string {
  const token = tokenStore.access ?? "";

  const absolute = /^https?:\/\//i.test(API_BASE)
    ? API_BASE
    : `${window.location.origin}${API_BASE}`;

  const wsBase = absolute.replace(/^http/i, "ws");
  return `${wsBase}/ws/devices/${deviceId}?token=${encodeURIComponent(token)}`;
}

export class DeviceSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private attempt = 0;
  private closedByUs = false;

  constructor(private deviceId: string) {}

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.closedByUs = false;

    try {
      this.socket = new WebSocket(socketUrl(this.deviceId));
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.attempt = 0;
      this.emitState(true);
      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      let message: SocketMessage;
      try {
        message = JSON.parse(event.data as string) as SocketMessage;
      } catch {
        return; // bozuk kare — yok say
      }
      // Sunucu canlılık yoklaması yaptıysa cevapla
      if (message.type === "ping") {
        this.send("pong");
        return;
      }
      for (const listener of this.listeners) listener(message);
    };

    this.socket.onclose = () => {
      this.stopHeartbeat();
      this.emitState(false);
      if (!this.closedByUs) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onclose zaten arkasından gelir; burada ek iş yok
    };
  }

  disconnect(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.emitState(false);
  }

  send(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private emitState(connected: boolean): void {
    for (const listener of this.stateListeners) listener(connected);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    // 1s, 2s, 4s ... en fazla 20s
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => this.send("ping"), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
