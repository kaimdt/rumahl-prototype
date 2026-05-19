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

  constructor(config: IoraClientConfig = {}) {
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
}
