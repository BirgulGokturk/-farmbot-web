/**
 * Backend Pydantic şemalarının TypeScript karşılıkları.
 * backend/app/schemas/* ile birebir eşleşir — biri değişirse diğeri de değişmeli.
 */

export type PointType = "plant" | "weed" | "tool_slot" | "marker";

export type PlantStage =
  | "planned"
  | "planted"
  | "sprouted"
  | "active"
  | "harvested"
  | "removed";

export type SunRequirement = "full" | "partial" | "shade";
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";
export type TimeUnit =
  | "never"
  | "minutely"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly";
export type ExecutableType = "sequence" | "regimen";
export type Axis = "x" | "y" | "z" | "all";

// --------------------------------------------------------------------------- //
// Kimlik
// --------------------------------------------------------------------------- //

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

// --------------------------------------------------------------------------- //
// Cihaz
// --------------------------------------------------------------------------- //

export interface Device {
  id: string;
  name: string;
  serial_number: string | null;
  model: string;
  firmware_version: string | null;
  timezone: string;
  lat: number | null;
  lng: number | null;
  indoor: boolean;

  bed_width_mm: number;
  bed_length_mm: number;
  max_z_mm: number;
  safe_height_mm: number;
  soil_height_mm: number;

  camera_stream_url: string | null;
  settings: Record<string, unknown>;

  last_seen_at: string | null;
  is_locked: boolean;
  last_x: number;
  last_y: number;
  last_z: number;
  is_online: boolean;
  created_at: string;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface DeviceStatus {
  device_id: string;
  online: boolean;
  locked: boolean;
  busy: boolean;
  sync_status: string;
  position: Position;
  axis_states: Record<string, string>;
  pins: Record<string, { mode: number; value: number }>;
  informational: {
    firmware_version?: string;
    soc_temp?: number;
    wifi_level?: number;
    uptime?: number;
    cpu_usage?: number;
    memory_usage?: number;
    disk_usage?: number;
    [key: string]: unknown;
  };
  last_seen_at: string | null;
}

// --------------------------------------------------------------------------- //
// Bahçe
// --------------------------------------------------------------------------- //

export interface PlantSpecies {
  id: string;
  slug: string;
  name_tr: string;
  name_en: string | null;
  icon: string;
  color: string;
  spread_mm: number;
  sow_depth_mm: number;
  days_to_harvest: number;
  water_ml_per_day: number;
  sun_requirement: SunRequirement;
  notes: string | null;
}

export interface Point {
  id: string;
  device_id: string;
  point_type: PointType;
  name: string;
  x: number;
  y: number;
  z: number;
  radius_mm: number;
  meta: Record<string, unknown>;

  species_id: string | null;
  species: PlantSpecies | null;
  stage: PlantStage;
  planted_at: string | null;
  depth_mm: number | null;

  tool_id: string | null;
  pullout_direction: number;
  gantry_mounted: boolean;

  created_at: string;
  updated_at: string;
}

export interface PointCreate {
  name: string;
  x: number;
  y: number;
  z?: number;
  radius_mm?: number;
  point_type?: PointType;
  species_id?: string | null;
  stage?: PlantStage;
  depth_mm?: number | null;
  meta?: Record<string, unknown>;
}

export interface PointUpdate {
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  radius_mm?: number;
  stage?: PlantStage;
  species_id?: string | null;
  planted_at?: string | null;
}

export interface Tool {
  id: string;
  device_id: string;
  name: string;
  icon: string;
  flow_rate_ml_per_s: number | null;
  status: "active" | "inactive";
  created_at: string;
}

// --------------------------------------------------------------------------- //
// Donanım
// --------------------------------------------------------------------------- //

export interface Peripheral {
  id: string;
  device_id: string;
  label: string;
  pin: number;
  mode: number;
  icon: string;
}

export interface Sensor {
  id: string;
  device_id: string;
  label: string;
  pin: number;
  mode: number;
  unit: string;
  icon: string;
  min_value: number;
  max_value: number;
}

export interface SensorReading {
  id: number;
  device_id: string;
  sensor_id: string | null;
  pin: number | null;
  value: number;
  x: number | null;
  y: number | null;
  z: number | null;
  read_at: string;
}

export interface SensorSeries {
  sensor_id: string;
  label: string;
  unit: string;
  points: { t: string; v: number }[];
}

// --------------------------------------------------------------------------- //
// Otomasyon
// --------------------------------------------------------------------------- //

export interface CeleryScriptStep {
  kind: string;
  args: Record<string, unknown>;
  body?: CeleryScriptStep[];
}

export interface Sequence {
  id: string;
  device_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  body: CeleryScriptStep[];
  args: Record<string, unknown>;
  pinned: boolean;
  folder: string | null;
  created_at: string;
  updated_at: string;
}

export interface FarmEvent {
  id: string;
  device_id: string;
  title: string;
  executable_type: ExecutableType;
  executable_id: string;
  start_time: string;
  end_time: string | null;
  repeat_every: number;
  time_unit: TimeUnit;
  body: Record<string, unknown>;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface CalendarOccurrence {
  event_id: string;
  title: string;
  executable_type: ExecutableType;
  executable_id: string;
  occurs_at: string;
}

// --------------------------------------------------------------------------- //
// Kayıtlar ve görüntüler
// --------------------------------------------------------------------------- //

export interface LogEntry {
  id: number;
  device_id: string;
  message: string;
  level: LogLevel;
  channels: string[];
  x: number | null;
  y: number | null;
  z: number | null;
  created_at: string;
}

export interface CapturedImage {
  id: string;
  device_id: string;
  url: string;
  thumbnail_url: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  captured_at: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CommandResponse {
  ok: boolean;
  label: string | null;
  detail: string | null;
  response: Record<string, unknown> | null;
}

// --------------------------------------------------------------------------- //
// WebSocket mesajları
// --------------------------------------------------------------------------- //

export type SocketMessage =
  | { type: "status"; payload: DeviceStatus }
  | { type: "log"; payload: Omit<LogEntry, "id" | "device_id"> }
  | { type: "rpc"; payload: Record<string, unknown> }
  | { type: "reading"; payload: { sensor_id: string | null; value: number; read_at: string } }
  | { type: "image"; payload: { id: string; url: string } }
  | { type: "telemetry"; payload: Record<string, unknown> }
  | { type: "ping" }
  | { type: "pong" };
