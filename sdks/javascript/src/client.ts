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
}
