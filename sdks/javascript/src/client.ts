import type {
  Entity,
  ServiceCall,
  NotificationPayload,
  AppSettings,
  HealthStatus,
  SettingsSchema,
  SettingsField,
  PluginExecutionRequest,
  PluginExecutionResult,
  PluginSandboxConfig,
} from './types';

/**
 * Request options for fine-grained control
 */
export interface RequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  signal?: AbortSignal;
}

/**
 * Client configuration
 */
export interface IoraClientConfig {
  baseUrl?: string;
  apiKey?: string;
  defaultTimeout?: number;
  defaultRetries?: number;
  retryDelay?: number;
  onError?: (error: IoraError) => void;
}

/**
 * Enhanced error class with context
 */
export class IoraError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public path?: string,
    public method?: string,
    public retryable: boolean = false,
    public context?: any
  ) {
    super(message);
    this.name = 'IoraError';
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return this.retryable || (this.statusCode !== undefined && [408, 429, 500, 502, 503, 504].includes(this.statusCode));
  }
}

/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by temporarily stopping requests to failing services
 */
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number = 5;
  private readonly successThreshold: number = 2;
  private readonly timeout: number = 60000; // 60 seconds

  canAttempt(): boolean {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      // Check if timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN state
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.successCount = 0;
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * IORA API Client
 *
 * Robust HTTP client for interacting with IORA APIs with:
 * - Automatic retry with exponential backoff
 * - Request timeouts
 * - Circuit breaker pattern
 * - Detailed error handling
 */
export default class IoraClient {
  private baseUrl: string;
  private apiKey?: string;
  private appId?: string;
  private defaultTimeout: number;
  private defaultRetries: number;
  private retryDelay: number;
  private onError?: (error: IoraError) => void;
  private circuitBreaker: CircuitBreaker;

  constructor(config: IoraClientConfig);
  constructor(baseUrl: string, apiKey?: string);
  constructor(configOrBaseUrl?: IoraClientConfig | string, legacyApiKey?: string) {
    // Support both new and legacy constructor signatures
    let config: IoraClientConfig;

    if (typeof configOrBaseUrl === 'string') {
      // Legacy signature: new IoraClient(baseUrl, apiKey)
      config = {
        baseUrl: configOrBaseUrl,
        apiKey: legacyApiKey
      };
    } else {
      // New signature: new IoraClient(config)
      config = configOrBaseUrl || {};
    }

    this.baseUrl = (config.baseUrl || 'http://localhost:8080').replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeout = config.defaultTimeout || 30000; // 30 seconds
    this.defaultRetries = config.defaultRetries ?? 3;
    this.retryDelay = config.retryDelay || 1000; // 1 second base delay
    this.onError = config.onError;
    this.circuitBreaker = new CircuitBreaker();
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
    if (!appId || typeof appId !== 'string') {
      throw new IoraError('Invalid app ID provided', undefined, undefined, undefined, false);
    }
    this.appId = appId;
  }

  /**
   * Get current app ID
   */
  getAppId(): string | undefined {
    return this.appId;
  }

  /** App-scoped calls need an app id; throws a clear error otherwise. */
  private requireAppId(): string {
    const id = this.getAppId();
    if (!id) {
      throw new IoraError(
        'App ID is required — call setAppId() first',
        undefined,
        undefined,
        undefined,
        false
      );
    }
    return id;
  }

  /**
   * Make an authenticated request with retry logic and timeout
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    // Validate inputs
    if (!path || typeof path !== 'string') {
      throw new IoraError('Invalid request path', undefined, path, method, false);
    }

    const timeout = options.timeout ?? this.defaultTimeout;
    const maxRetries = options.retries ?? this.defaultRetries;

    // Check circuit breaker
    if (!this.circuitBreaker.canAttempt()) {
      throw new IoraError(
        'Circuit breaker is open. Service may be unavailable.',
        503,
        path,
        method,
        true
      );
    }

    let lastError: IoraError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeRequest<T>(method, path, body, timeout, options.signal);
        this.circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = this.normalizeError(error, path, method);

        // Call error handler if provided
        if (this.onError) {
          try {
            this.onError(lastError);
          } catch (e) {
            console.warn('Error handler threw:', e);
          }
        }

        // Record failure in circuit breaker
        this.circuitBreaker.recordFailure();

        // Don't retry if not retryable or it's the last attempt
        if (!lastError.isRetryable() || attempt === maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const delay = this.retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Execute a single request attempt
   */
  private async executeRequest<T>(
    method: string,
    path: string,
    body: any,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine signals if external signal provided
    const combinedSignal = signal ? this.combineAbortSignals(signal, controller.signal) : controller.signal;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const options: RequestInit = {
        method,
        headers,
        signal: combinedSignal,
      };

      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseUrl}${path}`, options);

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new IoraError(
          `API Error: ${errorText}`,
          response.status,
          path,
          method,
          response.status >= 500 || response.status === 408 || response.status === 429
        );
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return (await response.text()) as any;
      }
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new IoraError(
          `Request timeout after ${timeout}ms`,
          408,
          path,
          method,
          true
        );
      }

      throw error;
    }
  }

  /**
   * Combine multiple abort signals
   */
  private combineAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();
    signal1.addEventListener('abort', abort);
    signal2.addEventListener('abort', abort);

    return controller.signal;
  }

  /**
   * Normalize errors into IoraError
   */
  private normalizeError(error: any, path: string, method: string): IoraError {
    if (error instanceof IoraError) {
      return error;
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      return new IoraError(
        'Network error: Unable to connect to IORA',
        undefined,
        path,
        method,
        true,
        { originalError: error.message }
      );
    }

    return new IoraError(
      error.message || 'Unknown error occurred',
      undefined,
      path,
      method,
      false,
      { originalError: error }
    );
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  /**
   * v2.2: App Configuration API
   *
   * Manage per-app settings using the app's settings_schema from its manifest.
   */
  appConfig = {
    /**
     * Get the configuration schema for the app
     */
    getSchema: async (appId?: string): Promise<SettingsSchema> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/config/schema`);
    },

    /**
     * Get current configuration values
     */
    get: async (appId?: string): Promise<Record<string, any>> => {
      const id = appId || this.appId;
      return this.request('GET', `/api/apps/${id}/config`);
    },

    /**
     * Update configuration values
     */
    update: async (config: Record<string, any>, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('PUT', `/api/apps/${id}/config`, config);
    },

    /**
     * Reset a specific config key to its default value
     */
    reset: async (key: string, appId?: string): Promise<any> => {
      const id = appId || this.appId;
      return this.request('DELETE', `/api/apps/${id}/config/${key}`);
    },
  };

  /**
   * v2.2: Plugin Execution API
   *
   * Execute plugins in the sandbox environment.
   */
  plugins = {
    /**
     * List installed plugins
     */
    list: async (): Promise<any[]> => {
      return this.request('GET', '/api/core/plugins');
    },

    /**
     * Get plugin details
     */
    get: async (pluginId: string): Promise<any> => {
      return this.request('GET', `/api/core/plugins/${pluginId}`);
    },

    /**
     * Execute a plugin in the sandbox
     */
    execute: async (pluginId: string, input: Record<string, any>, timeoutMs?: number): Promise<PluginExecutionResult> => {
      return this.request('POST', `/api/core/plugins/${pluginId}/execute`, {
        plugin_id: pluginId,
        input,
        timeout_ms: timeoutMs,
      });
    },

    /**
     * Get plugin execution logs
     */
    getLogs: async (pluginId: string): Promise<any[]> => {
      return this.request('GET', `/api/core/plugins/${pluginId}/logs`);
    },

    /**
     * Get plugin sandbox status
     */
    getSandboxStatus: async (): Promise<any> => {
      return this.request('GET', '/api/core/sandbox/status');
    },
  };

  /**
   * Voice & STT/TTS API
   *
   * Speech-to-Text via IORA STT (faster-whisper) and Text-to-Speech via IORA TTS (Kokoro).
   * The assistBase URL is used to reach the iora-assist service.
   */
  voice = {
    /**
     * Transcribe audio to text using local IORA STT (faster-whisper).
     * Falls back to the current AI provider if STT service is unavailable.
     *
     * @param audioBlob - Audio blob (WebM, WAV, MP3, etc.)
     * @param language - Optional language hint (e.g. 'en', 'de')
     * @returns Transcription result with text, language, and duration
     */
    transcribe: async (audioBlob: Blob, language?: string): Promise<{
      text: string;
      language: string | null;
      duration: number | null;
      provider: string;
      engine?: string;
    }> => {
      const formData = new FormData();
      // Determine format from blob MIME type
      const mimeToExt: Record<string, string> = {
        'audio/webm': 'webm',
        'audio/wav': 'wav',
        'audio/wave': 'wav',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
        'audio/x-m4a': 'm4a',
        'audio/mp4': 'm4a',
      };
      const ext = mimeToExt[audioBlob.type] || 'webm';

      formData.append('audio', audioBlob, `recording.${ext}`);
      formData.append('format', ext);
      if (language) {
        formData.append('language', language);
      }

      const response = await fetch(`${this.baseUrl}/api/assist/voice/stt`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`STT Error (${response.status}): ${error}`);
      }

      return response.json();
    },

    /**
     * Synthesize speech from text using local IORA TTS (Kokoro).
     * Falls back to the current AI provider if TTS service is unavailable.
     *
     * @param text - Text to synthesize
     * @param voice - Voice ID (e.g. 'af_nicole', 'am_adam', 'bf_emma')
     * @param lang - Language code (e.g. 'en-us', 'de', 'fr-fr')
     * @param speed - Playback speed (0.5 - 2.0)
     * @returns Audio blob with WAV data
     */
    synthesize: async (
      text: string,
      voice?: string,
      lang?: string,
      speed?: number,
    ): Promise<{ audioBlob: Blob; format: string; duration?: number; engine?: string }> => {
      const response = await fetch(`${this.baseUrl}/api/assist/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, lang, speed }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`TTS Error (${response.status}): ${error}`);
      }

      const audioBlob = await response.blob();
      const contentType = response.headers.get('Content-Type') || 'audio/wav';
      const format = contentType.includes('wav') ? 'wav' :
                     contentType.includes('mpeg') ? 'mp3' :
                     contentType.includes('ogg') ? 'ogg' : 'wav';
      const duration = parseFloat(response.headers.get('X-Audio-Duration') || '') || undefined;
      const engine = response.headers.get('X-TTS-Engine') || undefined;

      return { audioBlob, format, duration, engine };
    },

    /**
     * List available STT models (faster-whisper model sizes).
     */
    listSttModels: async (): Promise<{ models: Array<{ id: string; name: string; provider: string }>; provider: string }> => {
      return this.request('GET', '/api/assist/voice/stt/models');
    },

    /**
     * List available TTS voices (Kokoro voices).
     */
    listTtsVoices: async (): Promise<{ voices: Array<{ id: string; name: string; provider: string }>; provider: string }> => {
      return this.request('GET', '/api/assist/voice/tts/voices');
    },

    /**
     * Convenience: synthesize and play audio via the browser's Audio API.
     *
     * @returns Promise that resolves when playback starts
     */
    speak: async (
      text: string,
      voice?: string,
      lang?: string,
      speed?: number,
    ): Promise<void> => {
      const { audioBlob } = await this.voice.synthesize(text, voice, lang, speed);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      return new Promise((resolve, reject) => {
        audio.oncanplaythrough = () => {
          audio.play().then(resolve).catch(reject);
        };
        audio.onerror = () => reject(new Error('Audio playback failed'));
      });
    },
  };

  /**
   * System-wide Job Manager API (`ora.jobs`).
   *
   * Downloads, file operations, backups, updates and installs run as
   * background jobs that survive app switches. See the Job Center in the
   * OS shell and `iora_shared::system_jobs` for the wire format.
   */
  jobs = {
    /**
     * List system jobs. Optionally filter by status
     * (`queued | running | paused | completed | failed | cancelled`).
     */
    list: async (status?: string): Promise<{ jobs: any[] }> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
      return this.request('GET', `/api/jobs${query}`);
    },

    /**
     * Get a single job by id.
     */
    get: async (jobId: string): Promise<any> => {
      return this.request('GET', `/api/jobs/${jobId}`);
    },

    /**
     * Create a new background job (starts in `queued` state).
     */
    create: async (input: {
      name: string;
      job_type?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    }): Promise<any> => {
      return this.request('POST', '/api/jobs', input);
    },

    /**
     * Advance a job: update progress (0..100), message and/or status.
     * Used by the executing side to keep the Job Center fresh.
     */
    update: async (
      jobId: string,
      patch: { progress?: number; message?: string; status?: string },
    ): Promise<any> => {
      return this.request('POST', `/api/jobs/${jobId}/progress`, patch);
    },

    /**
     * Pause a running/queued job.
     */
    pause: async (jobId: string): Promise<any> => {
      return this.request('POST', `/api/jobs/${jobId}/pause`);
    },

    /**
     * Resume a paused job.
     */
    resume: async (jobId: string): Promise<any> => {
      return this.request('POST', `/api/jobs/${jobId}/resume`);
    },

    /**
     * Cancel a queued/running/paused job (terminal state).
     */
    cancel: async (jobId: string): Promise<any> => {
      return this.request('POST', `/api/jobs/${jobId}/cancel`);
    },

    /**
     * Delete a single job record.
     */
    remove: async (jobId: string): Promise<any> => {
      return this.request('DELETE', `/api/jobs/${jobId}`);
    },

    /**
     * Bulk-delete all terminal jobs (completed / failed / cancelled).
     */
    cleanup: async (): Promise<{ deleted: number }> => {
      return this.request('DELETE', '/api/jobs');
    },
  };

  /**
   * Clipboard Manager API (`ora.clipboard`).
   *
   * Personal clipboard history per user, shared across devices through the
   * same store. The OS shell captures copy/cut events automatically; apps
   * can read/write/pin entries programmatically.
   */
  clipboard = {
    /**
     * List clipboard history (newest first, pinned on top).
     */
    list: async (limit = 50): Promise<{ entries: any[] }> => {
      return this.request('GET', `/api/clipboard?limit=${limit}`);
    },

    /**
     * Add an entry. Identical content moves the existing entry to the top
     * instead of duplicating it.
     */
    add: async (content: string, source = 'app'): Promise<any> => {
      return this.request('POST', '/api/clipboard', { content, source });
    },

    /**
     * Toggle the pinned flag of an entry.
     */
    togglePin: async (entryId: string): Promise<{ id: string; pinned: boolean }> => {
      return this.request('POST', `/api/clipboard/${entryId}/pin`);
    },

    /**
     * Remove a single entry.
     */
    remove: async (entryId: string): Promise<{ deleted: boolean }> => {
      return this.request('DELETE', `/api/clipboard/${entryId}`);
    },

    /**
     * Clear the user's clipboard history.
     */
    clear: async (): Promise<{ deleted: number }> => {
      return this.request('DELETE', '/api/clipboard');
    },
  };

  /**
   * Permissions API (`ora.permissions`).
   *
   * Android/iOS-style runtime permission dialogs: request an OS permission
   * the user has not granted yet; the shell shows the Allow/Deny prompt and
   * approving persists the grant. Apps typically request permissions lazily
   * right before the action that needs them.
   */
  permissions = {
    /**
     * List all OS permissions with descriptions (the UI translates labels).
     */
    catalog: async (): Promise<{ permissions: Array<{ id: string; description: string }> }> => {
      return this.request('GET', '/api/os/permissions/catalog');
    },

    /**
     * Request an OS permission. Creates a pending request the user answers
     * in the shell dialog; reuse an existing pending request if one exists.
     * Rejects (409) when the permission is already granted.
     */
    request: async (input: {
      permission: string;
      reason?: string;
      requester?: string;
      scope?: string;
    }): Promise<any> => {
      return this.request('POST', '/api/os/permissions/request', input);
    },

    /**
     * List the user's permission requests, optionally filtered by status
     * (`pending | approved | denied`).
     */
    listRequests: async (status?: string): Promise<{ requests: any[] }> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
      return this.request('GET', `/api/os/permissions/requests${query}`);
    },

    /**
     * Answer a pending request: `approved: true` grants the permission and
     * persists it in `user_os_permissions`.
     */
    respond: async (requestId: string, approved: boolean): Promise<any> => {
      return this.request('POST', `/api/os/permissions/requests/${requestId}/respond`, { approved });
    },
  };

  /**
   * OS Files API (`ora.files`) — the user's personal files (iora-files).
   */
  files = {
    /**
     * List files/folders (optionally inside a folder, searchable).
     */
    list: async (opts?: {
      folderId?: string | null;
      search?: string;
      limit?: number;
      includeDeleted?: boolean;
    }): Promise<{ files: any[] }> => {
      const params = new URLSearchParams();
      if (opts?.folderId !== undefined && opts?.folderId !== null) params.set('folder_id', opts.folderId);
      if (opts?.search) params.set('search', opts.search);
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.includeDeleted) params.set('include_deleted', 'true');
      const qs = params.toString();
      return this.request('GET', `/api/files/${qs ? `?${qs}` : ''}`);
    },

    /** File metadata. */
    info: async (fileId: string): Promise<any> => {
      return this.request('GET', `/api/files/${fileId}`);
    },

    /** Absolute download URL (authenticated clients can fetch it directly). */
    downloadUrl: (fileId: string): string => {
      return `${this.baseUrl}/api/files/${fileId}/download`;
    },

    /** Soft-delete a file/folder. */
    remove: async (fileId: string): Promise<any> => {
      return this.request('DELETE', `/api/files/${fileId}`);
    },

    /** Move a file/folder into another folder (null = root). */
    move: async (fileId: string, targetFolderId: string | null): Promise<any> => {
      return this.request('PUT', `/api/files/${fileId}/move`, { target_folder_id: targetFolderId });
    },

    /** Copy a file/folder into another folder (null = root). */
    copy: async (fileId: string, targetFolderId: string | null): Promise<any> => {
      return this.request('POST', `/api/files/${fileId}/copy`, { target_folder_id: targetFolderId });
    },

    /** Rename a file/folder. */
    rename: async (fileId: string, newName: string): Promise<any> => {
      return this.request('PUT', `/api/files/${fileId}/rename`, { new_name: newName });
    },

    /** Restore a soft-deleted file/folder. */
    restore: async (fileId: string): Promise<any> => {
      return this.request('POST', `/api/files/${fileId}/restore`);
    },

    /** Storage quota for the current user. */
    quota: async (): Promise<{ quota_bytes: number; used_bytes: number; available_bytes: number; usage_percent: number }> => {
      return this.request('GET', '/api/files/quota');
    },

    /** Create a folder. */
    createFolder: async (name: string, parentFolderId: string | null = null): Promise<any> => {
      return this.request('POST', '/api/files/folders', { name, parent_folder_id: parentFolderId });
    },

    /**
     * Upload a file (multipart). Pass a File/Blob; folder defaults to root.
     */
    upload: async (
      file: File | Blob,
      opts?: { name?: string; folderId?: string | null }
    ): Promise<any> => {
      const form = new FormData();
      form.append('file', file, opts?.name || (file instanceof File ? file.name : 'upload'));
      if (opts?.folderId) form.append('folder_id', opts.folderId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.defaultTimeout);
      try {
        const headers: HeadersInit = {};
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        const res = await fetch(`${this.baseUrl}/api/files/upload`, {
          method: 'POST',
          headers,
          body: form,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new IoraError(`Upload failed: HTTP ${res.status}`, res.status, '/api/files/upload', 'POST', false);
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    },
  };

  /**
   * App Secrets API (`ora.secrets`) — credential vault entries scoped to the
   * current app (requires `setAppId`).
   */
  secrets = {
    list: async (): Promise<any[]> => {
      return this.request('GET', `/api/apps/${this.requireAppId()}/secrets`);
    },
    create: async (input: { name: string; value: string; description?: string }): Promise<any> => {
      return this.request('POST', `/api/apps/${this.requireAppId()}/secrets`, input);
    },
    update: async (secretId: string, patch: { name?: string; value?: string; description?: string }): Promise<any> => {
      return this.request('PUT', `/api/apps/${this.requireAppId()}/secrets/${secretId}`, patch);
    },
    remove: async (secretId: string): Promise<any> => {
      return this.request('DELETE', `/api/apps/${this.requireAppId()}/secrets/${secretId}`);
    },
    /** Reveal a secret's plaintext value (admin/app permission required). */
    reveal: async (secretId: string): Promise<any> => {
      return this.request('POST', `/api/apps/${this.requireAppId()}/secrets/${secretId}/reveal`);
    },
  };

  /**
   * Users API (`ora.users`) — local user accounts.
   */
  users = {
    /** List user accounts (used by the shell user switcher). */
    list: async (): Promise<Array<{ id: string; username: string; display_name?: string; avatar_url?: string; has_pin: boolean }>> => {
      return this.request('GET', '/api/auth/users');
    },
  };

  /**
   * Devices API (`ora.devices`) — local network devices (iora-network-monitor).
   */
  devices = {
    list: async (): Promise<any[]> => {
      return this.request('GET', '/api/network/devices');
    },
    active: async (): Promise<any[]> => {
      return this.request('GET', '/api/network/devices/active');
    },
    stats: async (): Promise<{ total_devices: number; active_devices: number; inactive_devices: number; last_scan?: string }> => {
      return this.request('GET', '/api/network/stats');
    },
    /** Trigger an ARP scan (admin permission required). */
    scan: async (): Promise<any> => {
      return this.request('POST', '/api/network/scan');
    },
  };

  /**
   * Universal Download Manager API (`ora.downloads`).
   *
   * Downloads run in the backend as system jobs and land in the user's
   * personal Downloads folder — they survive tab closes and app switches.
   * Progress and history appear in the Job Center automatically.
   */
  downloads = {
    /**
     * Start a backend download by URL (saved into the user's Downloads folder).
     */
    start: async (url: string, opts?: { filename?: string }): Promise<{ job_id: string; status: string }> => {
      return this.request('POST', '/api/downloads', { url, filename: opts?.filename });
    },
    /**
     * List the user's download jobs (newest first).
     */
    list: async (): Promise<{ downloads: any[] }> => {
      return this.request('GET', '/api/downloads');
    },
    /**
     * Cancel a queued/running download job.
     */
    cancel: async (jobId: string): Promise<{ cancelled: boolean }> => {
      return this.request('POST', `/api/downloads/${jobId}/cancel`);
    },
  };

  /**
   * System API (`ora.system`) — system events, stats and diagnostics.
   */
  system = {
    /** Report an error/warning/info event from this app or client. */
    reportEvent: async (event: {
      severity: 'error' | 'warning' | 'info';
      source: string;
      message: string;
      file?: string;
      line?: number;
      request_path?: string;
    }): Promise<any> => {
      return this.request('POST', '/api/system-events/client', event);
    },
    /** List system events (admin only). */
    listEvents: async (): Promise<any> => {
      return this.request('GET', '/api/admin/system-events');
    },
    /** Resolve/unresolve an event group by fingerprint (admin only). */
    resolveEvent: async (fingerprint: string, resolved: boolean): Promise<any> => {
      return this.request('POST', `/api/admin/system-events/${fingerprint}/${resolved ? 'resolve' : 'unresolve'}`);
    },
    /** Live system stats (CPU/memory/uptime — requires os.system.read). */
    stats: async (): Promise<{
      cpu_usage_percent: number;
      memory_total_bytes: number;
      memory_used_bytes: number;
      uptime_seconds: number;
      hostname: string;
    }> => {
      return this.request('GET', '/api/os/control/system');
    },
  };
}
