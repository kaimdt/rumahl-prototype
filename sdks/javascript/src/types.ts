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

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  details?: Record<string, any>;
}

export interface IoraEvent {
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
  event?: IoraEvent;
}

export type EventHandler = (event: IoraEvent) => void;
