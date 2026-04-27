/**
 * IORA SDK Runtime Manager
 *
 * Handles app lifecycle, communication with IORA, and permission management.
 */

import {
  AppStatus,
  LogLevel,
  PermissionToken,
  IoraMessage,
  createHeartbeatMessage,
  createStatusUpdateMessage,
  createLogMessage,
  createPermissionRequestMessage,
  isTokenExpired,
  tokenNeedsRenewal,
} from "./runtime";
import { Permission } from "./permissions";

/**
 * Configuration for the runtime manager
 */
export interface RuntimeConfig {
  appId: string;
  heartbeatInterval?: number; // seconds, default 5
  ioraEndpoint: string;
  autoHeartbeat?: boolean; // default true
  queryTimeout?: number; // seconds, default 30
}

/**
 * Query handler function type
 */
export type QueryHandler = (params?: any) => any | Promise<any>;

/**
 * Runtime manager handles app lifecycle, communication with IORA,
 * and permission management
 */
export class RuntimeManager {
  private config: RuntimeConfig;
  private status: AppStatus = AppStatus.INITIALIZING;
  private permissionTokens: Map<string, PermissionToken> = new Map();
  private queryHandlers: Map<string, QueryHandler> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private permissionRenewalTimer?: NodeJS.Timeout;
  private messageQueue: IoraMessage[] = [];

  constructor(config: RuntimeConfig) {
    this.config = {
      heartbeatInterval: 5,
      autoHeartbeat: true,
      queryTimeout: 30,
      ...config,
    };
  }

  /**
   * Create runtime manager from environment variables
   */
  static fromEnv(): RuntimeManager {
    const appId = process.env.IORA_APP_ID;
    if (!appId) {
      throw new Error("IORA_APP_ID environment variable not set");
    }

    const ioraEndpoint = process.env.IORA_ENDPOINT;
    if (!ioraEndpoint) {
      throw new Error("IORA_ENDPOINT environment variable not set");
    }

    const heartbeatInterval = parseInt(
      process.env.IORA_HEARTBEAT_INTERVAL || "5",
      10
    );

    return new RuntimeManager({
      appId,
      ioraEndpoint,
      heartbeatInterval,
      autoHeartbeat: true,
      queryTimeout: 30,
    });
  }

  /**
   * Start the runtime manager
   */
  async start(): Promise<void> {
    // Update status to idle
    await this.setStatus(AppStatus.IDLE);

    // Start heartbeat
    if (this.config.autoHeartbeat) {
      this.startHeartbeat();
    }

    // Start message processor
    this.startMessageProcessor();

    // Start permission renewal
    this.startPermissionRenewal();

    // Register default handlers
    this.registerDefaultHandlers();

    console.log(`Runtime manager started for app ${this.config.appId}`);
  }

  /**
   * Stop the runtime manager
   */
  async stop(): Promise<void> {
    await this.setStatus(AppStatus.SHUTTING_DOWN);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.permissionRenewalTimer) {
      clearInterval(this.permissionRenewalTimer);
    }

    console.log("Runtime manager stopped");
  }

  /**
   * Set app status
   */
  async setStatus(
    newStatus: AppStatus,
    details?: string
  ): Promise<void> {
    const oldStatus = this.status;
    this.status = newStatus;

    // Send status update to IORA
    const message = createStatusUpdateMessage(
      this.config.appId,
      oldStatus,
      newStatus,
      details
    );

    await this.sendMessage(message);
  }

  /**
   * Get current app status
   */
  getStatus(): AppStatus {
    return this.status;
  }

  /**
   * Log a message to IORA
   */
  async log(
    level: LogLevel,
    message: string,
    context?: any
  ): Promise<void> {
    const logMessage = createLogMessage(
      this.config.appId,
      level,
      message,
      context
    );

    await this.sendMessage(logMessage);

    // Also log locally
    const logFunc = level === LogLevel.ERROR || level === LogLevel.CRITICAL
      ? console.error
      : level === LogLevel.WARNING
      ? console.warn
      : level === LogLevel.DEBUG
      ? console.debug
      : console.log;

    logFunc(`[${level}] ${message}`, context || "");
  }

  /**
   * Request a permission from IORA
   */
  async requestPermission(
    permission: Permission,
    context: string,
    duration: number = 300
  ): Promise<PermissionToken | null> {
    const permissionStr = permission.toString();

    // Check if we already have a valid token
    const existingToken = this.permissionTokens.get(permissionStr);
    if (
      existingToken &&
      !isTokenExpired(existingToken) &&
      !tokenNeedsRenewal(existingToken)
    ) {
      return existingToken;
    }

    // Request new token from IORA
    const message = createPermissionRequestMessage(
      this.config.appId,
      permissionStr,
      context,
      duration
    );

    await this.sendMessage(message);

    // In real implementation, would wait for response
    // For now, return null to indicate pending
    console.warn(
      `Permission request sent for ${permissionStr}, awaiting response`
    );
    return null;
  }

  /**
   * Store a permission token
   */
  storePermissionToken(token: PermissionToken): void {
    this.permissionTokens.set(token.permission, token);
  }

  /**
   * Register a query handler
   */
  registerQueryHandler(command: string, handler: QueryHandler): void {
    this.queryHandlers.set(command, handler);
  }

  /**
   * Send a message to IORA
   */
  private async sendMessage(message: IoraMessage): Promise<void> {
    this.messageQueue.push(message);
  }

  /**
   * Start heartbeat loop
   */
  private startHeartbeat(): void {
    const interval = (this.config.heartbeatInterval || 5) * 1000;

    this.heartbeatTimer = setInterval(() => {
      const message = createHeartbeatMessage(
        this.config.appId,
        this.status
      );
      this.sendMessage(message);
    }, interval);
  }

  /**
   * Start message processor
   */
  private startMessageProcessor(): void {
    // Process messages from queue periodically
    setInterval(() => {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          // In real implementation, send via WebSocket/HTTP
          console.debug(
            `Sending to IORA (${this.config.ioraEndpoint}):`,
            message
          );
        }
      }
    }, 1000);
  }

  /**
   * Start permission renewal loop
   */
  private startPermissionRenewal(): void {
    this.permissionRenewalTimer = setInterval(() => {
      for (const [permission, token] of this.permissionTokens.entries()) {
        if (tokenNeedsRenewal(token)) {
          this.requestPermission(
            permission as Permission,
            "Auto-renewal",
            300
          );
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Register default query handlers
   */
  private registerDefaultHandlers(): void {
    this.registerQueryHandler("get_status", () => {
      return {
        status: this.status,
        uptime: process.uptime(),
      };
    });
  }
}
