/**
 * Tip güvenli REST istemcisi.
 *
 * Tüm ağ erişimi buradan geçer; token yenileme, hata normalizasyonu ve
 * uç nokta adresleri tek yerde toplanır. Expo istemcisi ileride bu dosyayı
 * neredeyse olduğu gibi tekrar kullanabilir.
 */

import type {
  AgentStatus,
  AgentTokenResponse,
  AlertRule,
  AlertRuleInput,
  AppNotification,
  CalendarOccurrence,
  CapturedImage,
  CommandResponse,
  Curve,
  CurveType,
  Device,
  NotificationSummary,
  DeviceStatus,
  FarmEvent,
  LogEntry,
  Page,
  Peripheral,
  PeripheralRoleValue,
  PlantSpecies,
  GantryStatus,
  PairingCode,
  Point,
  ScatterResult,
  PointCreate,
  PointUpdate,
  Sensor,
  SensorSeries,
  Sequence,
  SpatialReading,
  TokenPair,
  Tool,
  User,
} from "./types";

/**
 * API kök adresini çözer.
 *
 * Boşsa aynı origin kullanılır (geliştirmede Vite vekili, Docker'da nginx).
 * Bulut sağlayıcıları (Render Blueprint gibi) servis adresini şemasız,
 * sadece "farmbot-api.onrender.com" biçiminde verebildiği için eksik şemayı
 * ve `/api/v1` son ekini burada tamamlıyoruz — böylece dağıtımda tek bir
 * VITE_API_URL yeterli oluyor.
 */
function resolveApiBase(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();
  if (!raw) return "/api/v1";

  let base = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (!base.endsWith("/api/v1")) base = `${base}/api/v1`;
  return base;
}

export const API_BASE = resolveApiBase();

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

/**
 * İkili içerik indirir (fotoğraf karesi).
 *
 * `request` yanıtı metin okuyup JSON'a çevirdiği için ikili veriyi bozardı.
 * Ayrı bir yol gerekiyor ama kimlik doğrulama ve token yenileme aynı kalmalı:
 * fotoğraf uç noktası da oturum ister.
 *
 * Neden `<img src>` yetmiyor: tarayıcı `<img>` isteğine `Authorization`
 * başlığı eklemiyor. Uç noktayı herkese açmak yerine kareyi burada indirip
 * `blob:` adresi üretiyoruz.
 */
async function requestBlob(path: string, retried = false): Promise<Blob> {
  const headers = new Headers();
  if (tokenStore.access) headers.set("Authorization", `Bearer ${tokenStore.access}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.");
  }

  if (res.status === 401 && !retried && (await refreshTokens())) {
    return requestBlob(path, true);
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Görüntü alınamadı (${res.status})`);
  }
  return res.blob();
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
    /** Yumuşak silinmiş noktayı geri getirir — geri alma bunu kullanır. */
    restore: (deviceId: string, pointId: string) =>
      request<Point>(`/devices/${deviceId}/points/${pointId}/restore`, { method: "POST" }),
    /** Ekim alanına rastgele, üst üste binmeyecek şekilde bitki serpiştirir. */
    scatter: (
      deviceId: string,
      input: {
        species_id: string;
        count?: number;
        spread_mm?: number;
        avoid_existing?: boolean;
      },
    ) =>
      request<ScatterResult>(`/devices/${deviceId}/points/scatter`, {
        method: "POST",
        body: input,
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

    curves: (deviceId: string) => request<Curve[]>(`/devices/${deviceId}/curves`),
    createCurve: (
      deviceId: string,
      input: { name: string; curve_type: CurveType; data: Record<string, number> },
    ) => request<Curve>(`/devices/${deviceId}/curves`, { method: "POST", body: input }),
    updateCurve: (
      deviceId: string,
      id: string,
      input: { name?: string; data?: Record<string, number> },
    ) =>
      request<Curve>(`/devices/${deviceId}/curves/${id}`, {
        method: "PATCH",
        body: input,
      }),
    removeCurve: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/curves/${id}`, {
        method: "DELETE",
      }),
  },

  agent: {
    status: (deviceId: string) =>
      request<AgentStatus>(`/devices/${deviceId}/agent-status`),
    createToken: (deviceId: string) =>
      request<AgentTokenResponse>(`/devices/${deviceId}/agent-token`, { method: "POST" }),
    revokeToken: (deviceId: string) =>
      request<AgentStatus>(`/devices/${deviceId}/agent-token`, { method: "DELETE" }),
    /** Kısa ömürlü eşleştirme kodu — 56 karakterlik token'ı elle taşımaya gerek kalmasın. */
    createPairingCode: (deviceId: string) =>
      request<PairingCode>(`/devices/${deviceId}/pairing-code`, { method: "POST" }),
  },

  gantry: {
    /** Sekme gösterilsin mi? Vekil yapılandırılmamışsa menüde yer almıyor. */
    status: () => request<GantryStatus>("/gantry/status"),
    /**
     * Gömülü sayfanın kullanacağı çerezi alır.
     *
     * `credentials: "include"` şart: çerez ancak böyle yerleşiyor ve sonraki
     * çerçeve istekleriyle birlikte gidiyor.
     */
    session: () =>
      request<{ url: string; expires_minutes: number }>("/gantry/session", {
        method: "POST",
        credentials: "include",
      }),
  },

  alerts: {
    rules: (deviceId: string) => request<AlertRule[]>(`/devices/${deviceId}/alert-rules`),
    createRule: (deviceId: string, input: AlertRuleInput) =>
      request<AlertRule>(`/devices/${deviceId}/alert-rules`, {
        method: "POST",
        body: input,
      }),
    updateRule: (deviceId: string, id: string, input: Partial<AlertRuleInput>) =>
      request<AlertRule>(`/devices/${deviceId}/alert-rules/${id}`, {
        method: "PATCH",
        body: input,
      }),
    removeRule: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/alert-rules/${id}`, {
        method: "DELETE",
      }),

    notifications: (deviceId: string, limit = 30) =>
      request<NotificationSummary>(`/devices/${deviceId}/notifications`, {
        query: { limit },
      }),
    markRead: (deviceId: string, id: number) =>
      request<AppNotification>(`/devices/${deviceId}/notifications/${id}/read`, {
        method: "POST",
      }),
    markAllRead: (deviceId: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/notifications/read-all`, {
        method: "POST",
      }),
  },

  hardware: {
    peripherals: (deviceId: string) => request<Peripheral[]>(`/devices/${deviceId}/peripherals`),
    createPeripheral: (
      deviceId: string,
      input: {
        label: string;
        pin: number;
        icon?: string;
        role?: PeripheralRoleValue;
        flow_rate_ml_per_s?: number;
      },
    ) =>
      request<Peripheral>(`/devices/${deviceId}/peripherals`, { method: "POST", body: input }),
    removePeripheral: (deviceId: string, id: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/peripherals/${id}`, { method: "DELETE" }),

    sensors: (deviceId: string) => request<Sensor[]>(`/devices/${deviceId}/sensors`),
    updateSensor: (deviceId: string, sensorId: string, input: Partial<Sensor>) =>
      request<Sensor>(`/devices/${deviceId}/sensors/${sensorId}`, {
        method: "PATCH",
        body: input,
      }),
    createSensor: (deviceId: string, input: { label: string; pin: number; unit?: string }) =>
      request<Sensor>(`/devices/${deviceId}/sensors`, { method: "POST", body: input }),
    series: (deviceId: string, sensorId: string, hours = 24) =>
      request<SensorSeries>(`/devices/${deviceId}/sensors/${sensorId}/series`, {
        query: { hours },
      }),
    latestReadings: (deviceId: string) =>
      request<import("./types").SensorReading[]>(`/devices/${deviceId}/readings/latest`),

    /** Ölçüm geçmişini siler — simülatör verisini temizlemek için. */
    clearReadings: (deviceId: string, params?: { sensor_id?: string; before?: string }) =>
      request<{ detail: string }>(`/devices/${deviceId}/readings`, {
        method: "DELETE",
        query: params,
      }),

    /** Isı haritası için konumlu ölçümler. */
    spatialReadings: (
      deviceId: string,
      params?: { sensor_id?: string; hours?: number; limit?: number },
    ) => request<SpatialReading[]>(`/devices/${deviceId}/readings/spatial`, { query: params }),
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
    /** Karenin kendisi. Kimlik doğrulaması gerektiği için blob olarak iniyor. */
    file: (deviceId: string, imageId: string) =>
      requestBlob(`/devices/${deviceId}/images/${imageId}/file`),
    remove: (deviceId: string, imageId: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/images/${imageId}`, {
        method: "DELETE",
      }),
    clear: (deviceId: string) =>
      request<{ detail: string }>(`/devices/${deviceId}/images`, { method: "DELETE" }),
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
    /** Servoyu belirtilen açıya götürür (SG-5010: 0–180°). */
    setServo: (deviceId: string, pin: number, angle: number) =>
      request<CommandResponse>(`/devices/${deviceId}/control/servo`, {
        method: "POST",
        body: { pin, angle },
      }),
    /** Vakumlu uçla tohum eker. `point_ids` boşsa planlanan tüm bitkiler. */
    sow: (
      deviceId: string,
      input: { point_ids?: string[]; speed?: number; mark_planted?: boolean } = {},
    ) =>
      request<CommandResponse>(`/devices/${deviceId}/control/sow`, {
        method: "POST",
        body: input,
      }),
    water: (
      deviceId: string,
      input: { point_id: string; duration_ms?: number; volume_ml?: number; pump_pin?: number },
    ) =>
      request<CommandResponse>(`/devices/${deviceId}/control/water`, {
        method: "POST",
        body: input,
      }),
    /** Isı haritası için ızgara taraması: robot gezip her durakta ölçüm alır. */
    survey: (
      deviceId: string,
      input: { sensor_id: string; columns?: number; rows?: number; speed?: number },
    ) =>
      request<CommandResponse>(`/devices/${deviceId}/control/survey`, {
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
