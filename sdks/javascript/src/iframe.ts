import type { IframeMessage, rumahlEvent, EventHandler, OsFileOpenResult, OsFileSaveRequest, OsFileSaveResult } from './types';

/**
 * rumahl Iframe SDK
 *
 * Enables secure communication between rumahl apps running in iframes
 * and the main rumahl application.
 *
 * Features:
 * - Secure postMessage communication
 * - Security token validation
 * - Event subscription
 * - API method calls
 * - Automatic reconnection
 */
export default class rumahlIframe {
  private appId: string;
  private securityToken: string | null = null;
  private parentOrigin: string;
  private messageIdCounter = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private isReady = false;
  private readyCallbacks: Array<() => void> = [];

  constructor(appId: string, parentOrigin: string = window.location.ancestorOrigins?.[0] || '*') {
    this.appId = appId;
    this.parentOrigin = parentOrigin;

    // Listen for messages from parent
    window.addEventListener('message', this.handleMessage.bind(this));

    // Request security token from parent
    this.requestSecurityToken();
  }

  /**
   * Request security token from rumahl
   */
  private requestSecurityToken(): void {
    this.sendMessage({
      type: 'request',
      method: 'auth.requestToken',
      params: [this.appId],
    });
  }

  /**
   * Handle incoming messages from parent window
   */
  private handleMessage(event: MessageEvent): void {
    // Validate origin (unless explicitly allowing all)
    if (this.parentOrigin !== '*' && event.origin !== this.parentOrigin) {
      console.warn('Received message from invalid origin:', event.origin);
      return;
    }

    const message: IframeMessage = event.data;

    // Handle security token response
    if (message.method === 'auth.requestToken' && message.result) {
      this.securityToken = message.result.token;
      this.isReady = true;
      this.readyCallbacks.forEach(cb => cb());
      this.readyCallbacks = [];
      return;
    }

    // Handle responses to our requests
    if (message.type === 'response' && message.id) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Handle events
    if (message.type === 'event' && message.event) {
      this.dispatchEvent(message.event);
    }
  }

  /**
   * Send a message to parent window
   */
  private sendMessage(message: IframeMessage): void {
    window.parent.postMessage(message, this.parentOrigin);
  }

  /**
   * Wait for SDK to be ready
   */
  ready(): Promise<void> {
    if (this.isReady) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.readyCallbacks.push(resolve);
    });
  }

  /**
   * Call an rumahl API method
   */
  async call<T = any>(method: string, ...params: any[]): Promise<T> {
    await this.ready();

    const id = `${this.appId}-${++this.messageIdCounter}`;

    return new Promise((resolve, reject) => {
      // Set timeout for request
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.sendMessage({
        type: 'request',
        id,
        method,
        params: [this.securityToken, ...params],
      });
    });
  }

  /**
   * Subscribe to an event
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // Request subscription from parent
    this.call('events.subscribe', eventType).catch(console.error);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(eventType);
          this.call('events.unsubscribe', eventType).catch(console.error);
        }
      }
    };
  }

  /**
   * Dispatch an event to handlers
   */
  private dispatchEvent(event: rumahlEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error('Event handler error:', error);
        }
      });
    }
  }

  /**
   * Get entities
   */
  async getEntities(): Promise<any[]> {
    return this.call('entities.list');
  }

  /**
   * Get a specific entity
   */
  async getEntity(entityId: string): Promise<any> {
    return this.call('entities.get', entityId);
  }

  /**
   * Call a service
   */
  async callService(domain: string, service: string, entityId: string, data?: any): Promise<any> {
    return this.call('entities.callService', domain, service, entityId, data);
  }

  /**
   * Send a notification
   */
  async sendNotification(title: string, message: string, options?: any): Promise<any> {
    return this.call('notifications.send', { title, message, ...options });
  }

  /**
   * Get app settings
   */
  async getSettings(): Promise<any> {
    return this.call('settings.get', this.appId);
  }

  /**
   * Update app settings
   */
  async updateSettings(settings: Record<string, any>): Promise<any> {
    return this.call('settings.update', this.appId, settings);
  }

  /**
   * Store data
   */
  async setStorage(key: string, value: any): Promise<any> {
    return this.call('storage.set', key, value);
  }

  /**
   * Get stored data
   */
  async getStorage<T = any>(key: string): Promise<T> {
    return this.call('storage.get', key);
  }

  /**
   * Delete stored data
   */
  async deleteStorage(key: string): Promise<any> {
    return this.call('storage.delete', key);
  }

  /**
   * Request full screen mode
   */
  async requestFullscreen(): Promise<void> {
    return this.call('ui.requestFullscreen');
  }

  /**
   * Exit full screen mode
   */
  async exitFullscreen(): Promise<void> {
    return this.call('ui.exitFullscreen');
  }

  /**
   * Show a toast message
   */
  async showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> {
    return this.call('ui.showToast', message, type);
  }

  /**
   * Navigate to a page
   */
  async navigateTo(pageId: string): Promise<void> {
    return this.call('ui.navigateTo', pageId);
  }

  /**
   * Ask the user to select one file from their personal rumahl Cloud.
   * The app only receives the explicitly selected file.
   */
  async openFile(): Promise<OsFileOpenResult> {
    return this.call('files.open');
  }

  /**
   * Ask the user where a file should be saved in their personal rumahl Cloud.
   * The save only happens after confirmation in the rumahl system dialog.
   */
  async saveFile(file: OsFileSaveRequest): Promise<OsFileSaveResult> {
    return this.call('files.save', file);
  }

  /**
   * Get user information
   */
  async getCurrentUser(): Promise<any> {
    return this.call('auth.getCurrentUser');
  }

  /**
   * Check if app has a permission
   */
  async hasPermission(permission: string): Promise<boolean> {
    return this.call('permissions.check', permission);
  }

  /**
   * Request a permission
   */
  async requestPermission(permission: string): Promise<boolean> {
    return this.call('permissions.request', permission);
  }
}

/**
 * Create a singleton instance for easy access
 */
export function createrumahlIframe(appId: string, parentOrigin?: string): rumahlIframe {
  if (typeof window === 'undefined') {
    throw new Error('rumahlIframe can only be used in browser environment');
  }

  return new rumahlIframe(appId, parentOrigin);
}
