import type {
  Entity,
  ServiceCall,
  NotificationPayload,
  AppSettings,
  HealthStatus,
} from './types';

/**
 * IORA API Client
 *
 * HTTP client for interacting with IORA APIs
 */
export default class IoraClient {
  private baseUrl: string;
  private apiKey?: string;
  private appId?: string;

  constructor(baseUrl: string = 'http://localhost:8080', apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  /**
   * Set API key for authentication
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Set the app ID (used for app-specific API calls)
   */
  setAppId(appId: string): void {
    this.appId = appId;
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Entity API
   */
  entities = {
    /**
     * Get all entities
     */
    list: async (): Promise<Entity[]> => {
      return this.request('GET', '/api/states');
    },

    /**
     * Get a specific entity
     */
    get: async (entityId: string): Promise<Entity> => {
      return this.request('GET', `/api/states/${entityId}`);
    },

    /**
     * Call a service on an entity
     */
    callService: async (call: ServiceCall): Promise<any> => {
      return this.request(
        'POST',
        `/api/services/${call.domain}/${call.service}`,
        {
          entity_id: call.entity_id,
          service_data: call.service_data || {},
        }
      );
    },

    /**
     * Turn on a device
     */
    turnOn: async (entityId: string, data?: Record<string, any>): Promise<any> => {
      const domain = entityId.split('.')[0];
      return this.entities.callService({
        domain,
        service: 'turn_on',
        entity_id: entityId,
        service_data: data,
      });
    },

    /**
     * Turn off a device
     */
    turnOff: async (entityId: string): Promise<any> => {
      const domain = entityId.split('.')[0];
      return this.entities.callService({
        domain,
        service: 'turn_off',
        entity_id: entityId,
      });
    },
  };

  /**
   * Notifications API
   */
  notifications = {
    /**
     * Send a notification
     */
    send: async (notification: NotificationPayload): Promise<any> => {
      return this.request('POST', '/api/notifications/send', notification);
    },

    /**
     * Get all notifications
     */
    list: async (): Promise<any[]> => {
      return this.request('GET', '/api/notifications');
    },
  };

  /**
   * Storage API
   */
  storage = {
    /**
     * Store a value
     */
    set: async (key: string, value: any): Promise<any> => {
      return this.request('PUT', `/api/storage/${key}`, value);
    },

    /**
     * Get a value
     */
    get: async <T = any>(key: string): Promise<T> => {
      return this.request('GET', `/api/storage/${key}`);
    },

    /**
     * Delete a value
     */
    delete: async (key: string): Promise<any> => {
      return this.request('DELETE', `/api/storage/${key}`);
    },
  };

  /**
   * Settings API
   */
  settings = {
    /**
     * Get app settings
     */
    get: async (appId: string): Promise<AppSettings> => {
      return this.request('GET', `/api/appstore/apps/${appId}/settings`);
    },

    /**
     * Update app settings
     */
    update: async (appId: string, settings: Record<string, any>): Promise<any> => {
      return this.request('POST', '/api/appstore/settings', {
        app_id: appId,
        settings,
      });
    },
  };

  // ────────────────────────────────────────────────────────────
  // New in v2.1: Extended App Capabilities
  // ────────────────────────────────────────────────────────────

  /**
   * App File & KV Storage API
   *
   * Store and retrieve files and key-value data scoped to your app.
   */
  appStorage = {
    /**
     * List stored files
     */
    listFiles: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/storage/files`);
    },

    /**
     * Upload a file (base64-encoded)
     */
    uploadFile: async (name: string, content: string, mimeType: string = 'application/octet-stream', metadata?: any, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/storage/files`, { name, content, mime_type: mimeType, metadata });
    },

    /**
     * Download a file (returns base64 content)
     */
    getFile: async (fileId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/storage/files/${fileId}`);
    },

    /**
     * Delete a file
     */
    deleteFile: async (fileId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/storage/files/${fileId}`);
    },

    /**
     * List all key-value entries
     */
    listKv: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/storage/kv`);
    },

    /**
     * Set a key-value entry
     */
    setKv: async (key: string, value: any, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('PUT', `/api/apps/${id}/storage/kv/${key}`, { key, value });
    },

    /**
     * Get a key-value entry
     */
    getKv: async (key: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/storage/kv/${key}`);
    },

    /**
     * Delete a key-value entry
     */
    deleteKv: async (key: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/storage/kv/${key}`);
    },

    /**
     * Get storage usage statistics
     */
    getUsage: async (appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/storage/usage`);
    },
  };

  /**
   * App SQLite Database API
   *
   * Provision and use a per-app SQLite database.
   */
  appDatabase = {
    /**
     * Provision a new SQLite database for your app
     */
    provision: async (config?: {
      wal_mode?: boolean;
      max_size_bytes?: number;
      init_sql?: string[];
      auto_backup?: boolean;
    }, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/database/provision`, config || {});
    },

    /**
     * Drop the app's database
     */
    drop: async (appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/database`);
    },

    /**
     * Get database status
     */
    status: async (appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/database/status`);
    },

    /**
     * Execute SQL on the app's database
     */
    execute: async (sql: string, params?: any[], appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/database/execute`, { sql, params: params || [] });
    },

    /**
     * Trigger a database backup
     */
    backup: async (appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/database/backup`);
    },

    /**
     * List database backups
     */
    listBackups: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/database/backups`);
    },
  };

  /**
   * App Scheduler API
   *
   * Create and manage cron / scheduled tasks.
   */
  appScheduler = {
    /**
     * List all scheduled tasks
     */
    list: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/schedules`);
    },

    /**
     * Create a scheduled task
     */
    create: async (task: {
      name: string;
      schedule_type: 'cron' | 'interval' | 'one_shot';
      cron_expression?: string;
      interval_seconds?: number;
      run_at?: string;
      payload?: any;
      enabled?: boolean;
      max_retries?: number;
      tags?: string[];
    }, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/schedules`, task);
    },

    /**
     * Get a specific scheduled task
     */
    get: async (taskId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/schedules/${taskId}`);
    },

    /**
     * Update a scheduled task
     */
    update: async (taskId: string, updates: any, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('PUT', `/api/apps/${id}/schedules/${taskId}`, updates);
    },

    /**
     * Delete a scheduled task
     */
    delete: async (taskId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/schedules/${taskId}`);
    },

    /**
     * Manually trigger a task
     */
    trigger: async (taskId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/schedules/${taskId}/trigger`);
    },

    /**
     * Get execution logs for a task
     */
    getLogs: async (taskId: string, appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/schedules/${taskId}/logs`);
    },
  };

  /**
   * App Webhooks API
   *
   * Create and manage webhook endpoints for external integrations.
   */
  appWebhooks = {
    /**
     * List all webhooks
     */
    list: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/webhooks`);
    },

    /**
     * Create a new webhook
     */
    create: async (config: {
      name: string;
      description?: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      target_url: string;
      verify_signature?: boolean;
      enabled?: boolean;
      max_retries?: number;
      timeout_seconds?: number;
    }, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/webhooks`, config);
    },

    /**
     * Get a webhook
     */
    get: async (hookId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/webhooks/${hookId}`);
    },

    /**
     * Update a webhook
     */
    update: async (hookId: string, updates: any, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('PUT', `/api/apps/${id}/webhooks/${hookId}`, updates);
    },

    /**
     * Delete a webhook
     */
    delete: async (hookId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/webhooks/${hookId}`);
    },

    /**
     * Test a webhook
     */
    test: async (hookId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/webhooks/${hookId}/test`);
    },

    /**
     * Get delivery logs
     */
    getLogs: async (hookId: string, appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/webhooks/${hookId}/logs`);
    },

    /**
     * Get webhook statistics
     */
    getStats: async (hookId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/webhooks/${hookId}/stats`);
    },
  };

  /**
   * App Messaging API
   *
   * Publish/subscribe channels and direct messaging between apps.
   */
  appMessaging = {
    /**
     * List available message channels
     */
    listChannels: async (): Promise<any[]> => {
      return this.request('GET', '/api/apps/messaging/channels');
    },

    /**
     * Register a new channel
     */
    registerChannel: async (channel: {
      name: string;
      channel_type?: 'public' | 'protected' | 'system';
      description?: string;
      allowed_publishers?: string[];
      allowed_subscribers?: string[];
      retention_seconds?: number;
    }): Promise<any> => {
      return this.request('POST', '/api/apps/messaging/channels', channel);
    },

    /**
     * Publish a message to a channel
     */
    publish: async (channel: string, payload: any, priority?: 'low' | 'normal' | 'high' | 'critical'): Promise<any> => {
      return this.request('POST', '/api/apps/messaging/publish', { channel, payload, priority });
    },

    /**
     * Subscribe to a channel
     */
    subscribe: async (channel: string, filter?: string, webhookUrl?: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/messaging/subscribe`, { channel, filter, webhook_url: webhookUrl });
    },

    /**
     * List subscriptions
     */
    listSubscriptions: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/messaging/subscriptions`);
    },

    /**
     * Unsubscribe from a channel
     */
    unsubscribe: async (subId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/messaging/subscriptions/${subId}`);
    },

    /**
     * Send a direct message to another app
     */
    sendDirect: async (to: string, payload: any, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/messaging/direct`, { to, payload });
    },

    /**
     * Get inbox (direct messages)
     */
    getInbox: async (appId?: string): Promise<any[]> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/messaging/inbox`);
    },

    /**
     * Mark a direct message as read
     */
    markRead: async (msgId: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('POST', `/api/apps/${id}/messaging/inbox/${msgId}/read`);
    },
  };
}
