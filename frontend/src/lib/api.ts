/**
 * Tip güvenli REST istemcisi.
 *
 * Tüm ağ erişimi buradan geçer; token yenileme, hata normalizasyonu ve
 * uç nokta adresleri tek yerde toplanır. Expo istemcisi ileride bu dosyayı
 * neredeyse olduğu gibi tekrar kullanabilir.
 */

import type {
  CalendarOccurrence,
  CapturedImage,
  CommandResponse,
  Device,
  DeviceStatus,
  FarmEvent,
  LogEntry,
  Page,
  Peripheral,
  PlantSpecies,
  Point,
  PointCreate,
  PointUpdate,
  Sensor,
  SensorSeries,
  Sequence,
  TokenPair,
  Tool,
  User,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

const ACCESS_KEY = "farmbot-access-token";
const REFRESH_KEY = "farmbot-refresh-token";

/** Sunucudan dönen hatayı anlamlı bir mesajla taşır. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(pair: TokenPair) {
    localStorage.setItem(ACCESS_KEY, pair.access_token);
    localStorage.setItem(REFRESH_KEY, pair.refresh_token);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Aynı anda birden fazla 401 gelirse tek bir yenileme isteği yapılsın. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      tokenStore.save((await res.json()) as TokenPair);
      return true;
    } catch {
      return false;
    } finally {
      // Sonraki 401'de yeniden denenebilsin
      setTimeout(() => (refreshInFlight = null), 0);
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** true ise Authorization başlığı eklenmez (giriş/kayıt için) */
  anonymous?: boolean;
  /** Dahili: 401 sonrası sonsuz döngüyü önler */
  _retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, anonymous, _retried, headers, ...rest } = options;

  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const finalHeaders = new Headers(headers);
  if (!anonymous && tokenStore.access) {
    finalHeaders.set("Authorization", `Bearer ${tokenStore.access}`);
  }

  let payload: BodyInit | undefined;
  if (body instanceof URLSearchParams || body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: finalHeaders, body: payload });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.");
  }

  // Token süresi dolmuşsa bir kez yenileyip isteği tekrarla
  if (res.status === 401 && !anonymous && !_retried) {
    if (await refreshTokens()) {
      return request<T>(path, { ...options, _retried: true });
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeParse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(data, res.status), data);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** FastAPI hata gövdesini okunur tek satıra indirger. */
function extractMessage(data: unknown, status: number): string {
  if (typeof data === "string" && data) return data;

  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // Pydantic doğrulama hatası: [{loc, msg, type}, ...]
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : String(item),
        )
        .join(" · ");
    }
  }

  const fallbacks: Record<number, string> = {
    401: "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
    403: "Bu işlem için yetkiniz yok.",
    404: "Kayıt bulunamadı.",
    423: "Robot acil durdurma kilidinde.",
    503: "Robot şu anda erişilebilir değil.",
    504: "Robot zamanında yanıt vermedi.",
  };
  return fallbacks[status] ?? `Beklenmeyen hata (${status})`;
}

// =========================================================================== //
// Uç noktalar
// =========================================================================== //

export const api = {
  auth: {
    async login(email: string, password: string): Promise<TokenPair> {
      // OAuth2 parola akışı form-encoded bekler
      const form = new URLSearchParams({ username: email, password });
      const pair = await request<TokenPair>("/auth/login", {
        method: "POST",
        body: form,
        anonymous: true,
      });
      tokenStore.save(pair);
      return pair;
    },

    async register(input: {
      email: string;
      password: string;
      full_name?: string;
    }): Promise<TokenPair> {
      const pair = await request<TokenPair>("/auth/register", {
        method: "POST",
        body: input,
        anonymous: true,
      });
      tokenStore.save(pair);
      return pair;
    },

    me: () => request<User>("/auth/me"),

    logout() {
      tokenStore.clear();
    },
  },

  devices: {
    list: () => request<Device[]>("/devices"),
    get: (id: string) => request<Device>(`/devices/${id}`),
    create: (input: Partial<Device> & { name: string }) =>
      request<Device>("/devices", { method: "POST", body: input }),
    update: (id: string, input: Partial<Device>) =>
      request<Device>(`/devices/${id}`, { method: "PATCH", body: input }),
    remove: (id: string) => request<{ detail: string }>(`/devices/${id}`, { method: "DELETE" }),
    status: (id: string) => request<DeviceStatus>(`/devices/${id}/status`),
    requestSync: (id: string) =>
      request<{ detail: string }>(`/devices/${id}/sync`, { method: "POST" }),
  },

  points: {
    list: (deviceId: string, params?: { point_type?: string; include_discarded?: boolean }) =>
      request<Point[]>(`/devices/${deviceId}/points`, { query: params }),
    create: (deviceId: string, input: PointCreate) =>
      request<Point>(`/devices/${deviceId}/points`, { method: "POST", body: input }),
    update: (deviceId: string, pointId: string, input: PointUpdate) =>
      request<Point>(`/devices/${deviceId}/points/${pointId}`, {
        method: "PATCH",
        body: input,
      }),
    bulkMove: (deviceId: string, moves: { id: string; x: number; y: number; z?: number }[]) =>
      request<Point[]>(`/devices/${deviceId}/points/bulk-move`, {
        method: "POST",
        body: { moves },
      }),
    remove: (deviceId: string, pointId: string, permanent = false) =>
      request<{ detail: string }>(`/devices/${deviceId}/points/${pointId}`, {
        method: "DELETE",
        query: { permanent },
      }),
  },

  catalog: {
    species: (search?: string) =>
      request<PlantSpecies[]>("/plant-species", { query: { search } }),
    createSpecies: (input: Partial<PlantSpecies> & { slug: string; name_tr: string }) =>
      request<PlantSpecies>("/plant-species", { method: "POST", body: input }),
    tools: (deviceId: string) => request<Tool[]>(`/devices/${deviceId}/tools`),
    createTool: (deviceId: string, input: { name: string; icon?: string }) =>
      request<Tool>(`/devices/${deviceId}/tools`, { method: "POST", body: input }),
  },

  hardware: {
    peripherals: (deviceId: string) => request<Peripheral[]>(`/devices/${deviceId}/peripherals`),
    createPeripheral: (deviceId: string, input: { label: string; pin: number; icon?: string }) =>
      request<Peripheral>(`/devices/${deviceId}/peripherals`, { method: "POST", body: input }),
    removePeripheral: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/peripherals/${id}`, { method: "DELETE" }),

    sensors: (deviceId: string) => request<Sensor[]>(`/devices/${deviceId}/sensors`),
    createSensor: (deviceId: string, input: { label: string; pin: number; unit?: string }) =>
      request<Sensor>(`/devices/${deviceId}/sensors`, { method: "POST", body: input }),
    series: (deviceId: string, sensorId: string, hours = 24) =>
      request<SensorSeries>(`/devices/${deviceId}/sensors/${sensorId}/series`, {
        query: { hours },
      }),
    latestReadings: (deviceId: string) =>
      request<import("./types").SensorReading[]>(`/devices/${deviceId}/readings/latest`),
  },

  sequences: {
    list: (deviceId: string) => request<Sequence[]>(`/devices/${deviceId}/sequences`),
    create: (deviceId: string, input: Partial<Sequence> & { name: string }) =>
      request<Sequence>(`/devices/${deviceId}/sequences`, { method: "POST", body: input }),
    update: (deviceId: string, id: string, input: Partial<Sequence>) =>
      request<Sequence>(`/devices/${deviceId}/sequences/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/sequences/${id}`, { method: "DELETE" }),
  },

  events: {
    list: (deviceId: string, onlyActive = false) =>
      request<FarmEvent[]>(`/devices/${deviceId}/events`, {
        query: { only_active: onlyActive },
      }),
    create: (
      deviceId: string,
      input: {
        title?: string;
        executable_id: string;
        executable_type?: string;
        start_time: string;
        end_time?: string | null;
        repeat_every?: number;
        time_unit?: string;
      },
    ) => request<FarmEvent>(`/devices/${deviceId}/events`, { method: "POST", body: input }),
    update: (deviceId: string, id: string, input: Partial<FarmEvent>) =>
      request<FarmEvent>(`/devices/${deviceId}/events/${id}`, { method: "PATCH", body: input }),
    remove: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/events/${id}`, { method: "DELETE" }),
    calendar: (deviceId: string, start: Date, end: Date) =>
      request<CalendarOccurrence[]>(`/devices/${deviceId}/events/calendar`, {
        query: { start: start.toISOString(), end: end.toISOString() },
      }),
  },

  logs: {
    list: (deviceId: string, params?: { level?: string; search?: string; limit?: number }) =>
      request<Page<LogEntry>>(`/devices/${deviceId}/logs`, { query: params }),
    clear: (deviceId: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/logs`, { method: "DELETE" }),
  },

  images: {
    list: (deviceId: string, limit = 48) =>
      request<Page<CapturedImage>>(`/devices/${deviceId}/images`, { query: { limit } }),
  },

  /** Robotu doğrudan süren komutlar. */
  control: {
    moveRelative: (deviceId: string, input: { x?: number; y?: number; z?: number; speed?: number }) =>
      request<CommandResponse>(`/devices/${deviceId}/control/move-relative`, {
        method: "POST",
        body: input,
      }),
    moveAbsolute: (deviceId: string, input: { x: number; y: number; z: number; speed?: number }) =>
      request<CommandResponse>(`/devices/${deviceId}/control/move-absolute`, {
        method: "POST",
        body: input,
      }),
    home: (deviceId: string, input: { axis?: string; speed?: number; find?: boolean } = {}) =>
      request<CommandResponse>(`/devices/${deviceId}/control/home`, {
        method: "POST",
        body: input,
      }),
    calibrate: (deviceId: string, axis = "all") =>
      request<CommandResponse>(`/devices/${deviceId}/control/calibrate`, {
        method: "POST",
        body: { axis },
      }),
    writePin: (deviceId: string, input: { pin: number; value: number; mode?: number }) =>
      request<CommandResponse>(`/devices/${deviceId}/control/pin/write`, {
        method: "POST",
        body: input,
      }),
    readPin: (deviceId: string, pin: number, mode = 1) =>
      request<CommandResponse>(`/devices/${deviceId}/control/pin/read`, {
        method: "POST",
        body: { pin, mode },
      }),
    water: (
      deviceId: string,
      input: { point_id: string; duration_ms?: number; volume_ml?: number; pump_pin?: number },
    ) =>
      request<CommandResponse>(`/devices/${deviceId}/control/water`, {
        method: "POST",
        body: input,
      }),
    takePhoto: (deviceId: string) =>
      request<CommandResponse>(`/devices/${deviceId}/control/take-photo`, { method: "POST" }),
    emergencyLock: (deviceId: string) =>
      request<CommandResponse>(`/devices/${deviceId}/control/emergency-lock`, {
        method: "POST",
      }),
    emergencyUnlock: (deviceId: string) =>
      request<CommandResponse>(`/devices/${deviceId}/control/emergency-unlock`, {
        method: "POST",
      }),
    executeSequence: (deviceId: string, sequenceId: string) =>
      request<CommandResponse>(`/devices/${deviceId}/control/execute`, {
        method: "POST",
        body: { sequence_id: sequenceId },
      }),
  },
};
