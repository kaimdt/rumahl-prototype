/**
 * Common types used across the SDK
 */

export interface Entity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

export interface ServiceCall {
  domain: string;
  service: string;
  entity_id: string;
  service_data?: Record<string, any>;
}

export interface NotificationPayload {
  title: string;
  message: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  icon?: string;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  action: string;
  title: string;
}

export interface AppSettings {
  app_id: string;
  settings: Record<string, any>;
}

/** v2.2: App Configuration Field definition */
export interface SettingsField {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'password' | 'url' | 'email' | 'color';
  default?: any;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    min?: number;
    max?: number;
    min_length?: number;
    max_length?: number;
    pattern?: string;
  };
}

/** v2.2: App Configuration Schema */
export interface SettingsSchema {
  title: string;
  description: string;
  fields: SettingsField[];
}

/** v2.2: Plugin Execution Request */
export interface PluginExecutionRequest {
  plugin_id: string;
  input: Record<string, any>;
  timeout_ms?: number;
}

/** v2.2: Plugin Execution Result */
export interface PluginExecutionResult {
  success: boolean;
  duration_ms: number;
  output: any;
  error?: string;
}

/** v2.2: Plugin sandbox configuration */
export interface PluginSandboxConfig {
  max_execution_time_ms: number;
  max_memory_mb: number;
  allow_network: boolean;
  allow_file_system: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  details?: Record<string, any>;
}

export interface rumahlEvent {
  type: string;
  data: any;
  timestamp: number;
}

export interface IframeMessage {
  type: 'request' | 'response' | 'event';
  id?: string;
  method?: string;
  params?: any[];
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  event?: rumahlEvent;
}

export type EventHandler = (event: rumahlEvent) => void;

export interface OsFileOpenResult {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
}

export interface OsFileSaveRequest {
  name: string;
  mimeType?: string;
  dataBase64: string;
}

export interface OsFileSaveResult {
  id: string;
  name: string;
}

// ─── Voice / STT / TTS Types ───────────────────────────────────────────────

export interface SttTranscriptionResult {
  text: string;
  language: string | null;
  duration: number | null;
  provider: string;
  engine?: string;  // 'faster-whisper' when using local STT
}

export interface TtsSynthesisResult {
  audioBlob: Blob;
  format: string;    // 'wav', 'mp3', 'ogg'
  duration?: number;
  engine?: string;   // 'kokoro' when using local TTS
}

export interface SttModel {
  id: string;
  name: string;
  provider: string;
}

export interface TtsVoice {
  id: string;
  name: string;
  provider: string;
}
