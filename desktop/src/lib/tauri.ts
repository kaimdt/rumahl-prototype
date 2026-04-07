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

export const tauriApi = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) =>
    invoke<void>("save_config", { newConfig: config }),
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
};
