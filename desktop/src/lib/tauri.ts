import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  lm_studio_url: string;
  lm_studio_api_key: string;
  selected_model: string;
  iora_backend_url: string;
  auto_start_proxy: boolean;
  proxy_port: number;
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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const tauriApi = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { newConfig: config }),
  testConnection: () => invoke<ConnectionResult>("test_connection"),
  listModels: () => invoke<Model[]>("list_models"),
  sendChat: (messages: ChatMessage[], temperature?: number, maxTokens?: number) =>
    invoke<string>("send_chat", { messages, temperature, maxTokens }),
  getStatus: () => invoke<ConnectionResult>("get_status"),
};
