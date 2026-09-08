import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  client_id: string;
  client_name: string;
  lm_studio_url: string;
  lm_studio_api_key: string;
  selected_model: string;
  rumahl_backend_url: string;
  auto_start_proxy: boolean;
  proxy_port: number;
  health_poll_interval_secs: number;
  rumahl_home_url: string;
  auth_token: string;
  auth_username: string;
  auth_user_id: string;
  ha_enabled: boolean;
  ha_update_interval_secs: number;
  autostart_enabled: boolean;
  autostart_minimized: boolean;
  autostart_hidden: boolean;
  notification_sound: boolean;
  notifications_enabled: boolean;
  rumahl_privacy_mode: boolean;
  rumahl_autopilot: boolean;
  rumahl_allow_control: boolean;
  screen_saver_enabled: boolean;
  screen_saver_timeout_secs: number;
  wake_on_motion: boolean;
  display_brightness: number;
  always_on_top: boolean;
  kiosk_mode: boolean;
  send_diagnostics: boolean;
  network_profiles: NetworkProfile[];
  network_auto_switch: boolean;
}

export interface Model {
  id: string;
  object: string;
  owned_by?: string;
}

export interface ConnectionResult {
  connected: boolean;
  error?: string;
}

export interface ClientInfo {
  client_id: string;
  client_name: string;
  lm_studio_url: string;
  selected_model: string;
  online: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name?: string;
  role: string;
  is_admin: boolean;
}

export interface rumahlHomeStatus {
  online: boolean;
  ha_connected: boolean;
  entity_count: number;
  person_count: number;
  url: string;
}

export type Platform = "windows" | "macos" | "linux";

export interface SystemMetrics {
  timestamp: string;
  hostname: string;
  os: string;
  cpu_usage: number;
  cpu_temp: number | null;
  memory_total_gb: number;
  memory_used_gb: number;
  memory_percent: number;
  swap_total_gb: number;
  swap_used_gb: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  network_rx_mb: number;
  network_tx_mb: number;
  battery_percent: number | null;
  battery_state: string | null;
  is_charging: boolean | null;
  screen_on: boolean;
}

// ─── Network profile types ──────────────────────────────────────────

export type NetworkType = "ethernet" | "wifi" | "mobile" | "vpn" | "unknown";

export interface NetworkProfile {
  name: string;
  network_type: NetworkType;
  rumahl_home_url: string;
  rumahl_backend_url?: string;
  priority: number;
}

export interface NetworkInfo {
  interface_name: string;
  network_type: NetworkType;
  local_ip: string | null;
  is_active: boolean;
}

export interface NetworkStatus {
  active: NetworkInfo;
  interfaces: NetworkInfo[];
  matched_profile: NetworkProfile | null;
  current_home_url: string;
  fingerprint: string | null;
}

export const tauriApi = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) =>
    invoke<void>("save_config", { newConfig: config }),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  setAutostartOptions: (minimized: boolean, hidden: boolean) =>
    invoke<void>("set_autostart_options", { minimized, hidden }),
  applyWindowSettings: (alwaysOnTop: boolean, kioskMode: boolean) =>
    invoke<void>("apply_window_settings", { alwaysOnTop, kioskMode }),
  testConnection: () => invoke<ConnectionResult>("test_connection"),
  listModels: () => invoke<Model[]>("list_models"),
  sendChat: (
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number
  ) => invoke<string>("send_chat", { messages, temperature, maxTokens }),
  /** Returns the cached (no network call) connectivity status. */
  getStatus: () => invoke<ConnectionResult>("get_status"),
  /** Returns this client's identity — used for multi-client routing. */
  getClientInfo: () => invoke<ClientInfo>("get_client_info"),
  /** Log in with username and password; returns the authenticated user. */
  login: (username: string, password: string) =>
    invoke<AuthUser>("login", { username, password }),
  /** Log out and clear stored credentials. */
  logout: () => invoke<void>("logout"),
  /** Returns the current user from memory or persisted config. Null if not logged in. */
  getCurrentUser: () => invoke<AuthUser | null>("get_current_user"),
  /** Quick reachability check for rumahl Home backend. */
  pingrumahlHome: () => invoke<boolean>("ping_rumahl_home"),
  /** Fetch HA connection info and entity counts from rumahl Home. */
  getrumahlHomeStatus: () => invoke<rumahlHomeStatus>("get_rumahl_home_status"),
  /** Collect local system metrics (CPU, RAM, disk, battery). */
  getSystemMetrics: () => invoke<SystemMetrics>("get_system_metrics"),
  // ── Network profile commands ──────────────────────────────────────
  /** Get full network status: active interface, profiles, current URL. */
  getNetworkStatus: () => invoke<NetworkStatus>("get_network_status"),
  /** Detect current network type and IP. */
  detectCurrentNetwork: () => invoke<NetworkInfo>("detect_current_network"),
  /** List all detected network interfaces. */
  listNetworkInterfaces: () => invoke<NetworkInfo[]>("list_network_interfaces_cmd"),
  /** Get configured network profiles. */
  getNetworkProfiles: () => invoke<NetworkProfile[]>("get_network_profiles"),
  /** Save network profiles. */
  saveNetworkProfiles: (profiles: NetworkProfile[]) =>
    invoke<void>("save_network_profiles", { profiles }),
  /** Enable/disable automatic network switching. */
  setNetworkAutoSwitch: (enabled: boolean) =>
    invoke<void>("set_network_auto_switch", { enabled }),
  /** Manually switch to a network profile by index. */
  switchToProfile: (profileIndex: number) =>
    invoke<void>("switch_to_profile", { profileIndex }),
  /** Get the current OS platform. */
  getPlatform: () => invoke<Platform>("get_platform"),
  // ── Window control commands ──────────────────────────────────────
  /** Tile the window (left, right, top, bottom, maximize, center). */
  tileWindow: (direction: string) => invoke<void>("tile_window", { direction }),
  /** Enable window shadow (rounded corners on Windows 11). */
  applyWindowShadow: () => invoke<void>("apply_window_shadow"),
  /** Start window dragging. */
  startWindowDrag: () => invoke<void>("start_window_drag"),
  /** Show tile/snap menu at given coordinates. */
  showTileMenu: (x: number, y: number) => invoke<void>("show_tile_menu", { x, y }),
  /** Save window position and size for persistence. */
  saveWindowState: (x: number | null, y: number | null, width: number | null, height: number | null) =>
    invoke<void>("save_window_state", { x, y, width, height }),
  /** Trigger native Windows 11 snap layout at window-relative position. */
  triggerWindowsSnap: (x: number, y: number) =>
    invoke<void>("trigger_windows_snap", { x, y }),
  /** Trigger native macOS window constraints menu (macOS 15+ only). */
  triggerNativeWindowMenu: () => invoke<void>("trigger_native_window_menu"),
};
