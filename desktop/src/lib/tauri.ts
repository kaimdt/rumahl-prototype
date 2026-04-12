import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  client_id: string;
  client_name: string;
  lm_studio_url: string;
  lm_studio_api_key: string;
  selected_model: string;
  iora_backend_url: string;
  auto_start_proxy: boolean;
  proxy_port: number;
  health_poll_interval_secs: number;
  iora_home_url: string;
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
  screen_saver_enabled: boolean;
  screen_saver_timeout_secs: number;
  wake_on_motion: boolean;
  display_brightness: number;
  always_on_top: boolean;
  kiosk_mode: boolean;
  send_diagnostics: boolean;
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

export interface IoraHomeStatus {
  online: boolean;
  ha_connected: boolean;
  entity_count: number;
  person_count: number;
  url: string;
}

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
  /** Quick reachability check for IORA Home backend. */
  pingIoraHome: () => invoke<boolean>("ping_iora_home"),
  /** Fetch HA connection info and entity counts from IORA Home. */
  getIoraHomeStatus: () => invoke<IoraHomeStatus>("get_iora_home_status"),
  /** Collect local system metrics (CPU, RAM, disk, battery). */
  getSystemMetrics: () => invoke<SystemMetrics>("get_system_metrics"),
};
