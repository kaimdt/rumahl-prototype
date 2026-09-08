/**
 * rumahl SDK Runtime Components
 *
 * This module provides the runtime infrastructure for rumahl apps including:
 * - Status management
 * - Heartbeat system
 * - Logging integration
 * - Permission management
 */

/**
 * App runtime status
 */
export enum AppStatus {
  INITIALIZING = "INITIALIZING",
  IDLE = "IDLE",
  ACTIVE = "ACTIVE",
  BACKGROUND_TASK = "BACKGROUND_TASK",
  PROCESSING = "PROCESSING",
  BUSY = "BUSY",
  ERROR = "ERROR",
  SHUTTING_DOWN = "SHUTTING_DOWN",
}

/**
 * Log level for app logging
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

/**
 * Permission token with expiration
 */
export interface PermissionToken {
  token: string;
  permission: string;
  expiresAt: number;
  grantedAt: number;
}

/**
 * Check if permission token is expired
 */
export function isTokenExpired(token: PermissionToken): boolean {
  return Date.now() / 1000 >= token.expiresAt;
}

/**
 * Check if permission token needs renewal (within 30 seconds of expiration)
 */
export function tokenNeedsRenewal(token: PermissionToken): boolean {
  return (token.expiresAt - Date.now() / 1000) < 30;
}

/**
 * Base rumahl message
 */
export interface rumahlMessage {
  type: string;
  timestamp: number;
}

/**
 * Heartbeat signal from app to rumahl
 */
export interface HeartbeatMessage extends rumahlMessage {
  type: "heartbeat";
  appId: string;
  status: AppStatus;
}

/**
 * Status update from app to rumahl
 */
export interface StatusUpdateMessage extends rumahlMessage {
  type: "status_update";
  appId: string;
  oldStatus: AppStatus;
  newStatus: AppStatus;
  details?: string;
}

/**
 * Log entry from app to rumahl
 */
export interface LogMessage extends rumahlMessage {
  type: "log";
  appId: string;
  level: LogLevel;
  message: string;
  context?: any;
}

/**
 * Permission request from app to rumahl
 */
export interface PermissionRequestMessage extends rumahlMessage {
  type: "permission_request";
  appId: string;
  permission: string;
  context: string;
  duration: number;
}

/**
 * Permission grant from rumahl to app
 */
export interface PermissionGrantMessage extends rumahlMessage {
  type: "permission_grant";
  token: string;
  expiresAt: number;
  permission: string;
}

/**
 * Permission denial from rumahl to app
 */
export interface PermissionDeniedMessage extends rumahlMessage {
  type: "permission_denied";
  permission: string;
  reason: string;
}

/**
 * Query from rumahl to app
 */
export interface QueryMessage extends rumahlMessage {
  type: "query";
  queryId: string;
  command: string;
  params?: any;
}

/**
 * Response from app to rumahl
 */
export interface ResponseMessage extends rumahlMessage {
  type: "response";
  queryId: string;
  data: any;
}

/**
 * Error response from app to rumahl
 */
export interface ErrorResponseMessage extends rumahlMessage {
  type: "error_response";
  queryId: string;
  error: string;
}

/**
 * Helper to create heartbeat message
 */
export function createHeartbeatMessage(
  appId: string,
  status: AppStatus
): HeartbeatMessage {
  return {
    type: "heartbeat",
    appId,
    status,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Helper to create status update message
 */
export function createStatusUpdateMessage(
  appId: string,
  oldStatus: AppStatus,
  newStatus: AppStatus,
  details?: string
): StatusUpdateMessage {
  return {
    type: "status_update",
    appId,
    oldStatus,
    newStatus,
    details,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Helper to create log message
 */
export function createLogMessage(
  appId: string,
  level: LogLevel,
  message: string,
  context?: any
): LogMessage {
  return {
    type: "log",
    appId,
    level,
    message,
    context,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Helper to create permission request message
 */
export function createPermissionRequestMessage(
  appId: string,
  permission: string,
  context: string,
  duration: number
): PermissionRequestMessage {
  return {
    type: "permission_request",
    appId,
    permission,
    context,
    duration,
    timestamp: Math.floor(Date.now() / 1000),
  };
}
