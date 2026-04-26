import type { ComponentType } from 'react'
import type { EntityState } from '@/lib/types'
import type { PluginAIClient } from './ai-integration'

/**
 * Plugin Metadata
 * Describes a plugin's identity and capabilities
 */
export interface PluginMetadata {
  /** Unique identifier for the plugin */
  id: string
  /** Display name */
  name: string
  /** Plugin version (semver) */
  version: string
  /** Plugin description */
  description: string
  /** Plugin author */
  author: string
  /** Supported entity domains (e.g., ['light', 'switch']) */
  supportedDomains?: string[]
  /** Plugin icon (Phosphor icon name) */
  icon?: string
  /** Plugin configuration schema */
  configSchema?: Record<string, unknown>
}

/**
 * Widget Plugin Component Props
 */
export interface WidgetPluginProps {
  /** Entity data from Home Assistant */
  entity: EntityState
  /** Widget-specific configuration */
  config?: Record<string, unknown>
  /** Callback when entity needs refresh */
  onUpdate?: () => void
  /** Callback to call HA service */
  onCallService?: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>
}

/**
 * Widget Plugin Definition
 */
export interface WidgetPlugin {
  /** Plugin metadata */
  metadata: PluginMetadata
  /** Widget component */
  component: ComponentType<WidgetPluginProps>
  /** Optional settings component */
  settingsComponent?: ComponentType<{ config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void }>
}

/**
 * API Plugin Definition
 * Allows plugins to register custom API endpoints
 */
export interface APIPlugin {
  /** Plugin metadata */
  metadata: PluginMetadata
  /** API endpoint prefix (e.g., '/weather') */
  endpoint: string
  /** Handler function */
  handler: (request: APIRequest) => Promise<APIResponse>
}

export interface APIRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
}

export interface APIResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

/**
 * Service Plugin Definition
 * Allows plugins to register background services
 */
export interface ServicePlugin {
  /** Plugin metadata */
  metadata: PluginMetadata
  /** Service initialization */
  initialize: () => Promise<void>
  /** Service cleanup */
  destroy: () => Promise<void>
  /** Service health check */
  healthCheck?: () => Promise<boolean>
}

/**
 * Theme Plugin Definition
 * Allows plugins to register custom themes
 */
export interface ThemePlugin {
  /** Plugin metadata */
  metadata: PluginMetadata
  /** Theme name */
  themeName: string
  /** CSS variables */
  cssVariables: Record<string, string>
  /** Optional CSS file URL */
  cssUrl?: string
}

/**
 * Plugin Type Union
 */
export type Plugin = WidgetPlugin | APIPlugin | ServicePlugin | ThemePlugin

/**
 * Plugin Context
 * Provides plugins with access to app services
 */
export interface PluginContext {
  /** Call Home Assistant service */
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>
  /** Get entity states */
  getStates: () => Promise<EntityState[]>
  /** Get single entity state */
  getState: (entityId: string) => Promise<EntityState | undefined>
  /** Store plugin data */
  storage: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  /** Show notification */
  notify: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void
  /** Subscribe to entity changes */
  subscribe: (entityId: string, callback: (entity: EntityState) => void) => () => void
  /** ORA AI Integration - Call AI, register tools, and more */
  ai: PluginAIClient
}

/**
 * Plugin Configuration
 * Stored configuration for an installed plugin
 */
export interface PluginConfig {
  /** Plugin ID */
  pluginId: string
  /** Is plugin enabled */
  enabled: boolean
  /** Plugin-specific configuration */
  config: Record<string, unknown>
  /** Installation timestamp */
  installedAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Plugin Manifest
 * Used for plugin discovery and installation
 */
export interface PluginManifest {
  /** Plugin metadata */
  metadata: PluginMetadata
  /** Plugin entry point URL */
  entry: string
  /** Plugin type */
  type: 'widget' | 'api' | 'service' | 'theme'
  /** Dependencies */
  dependencies?: Record<string, string>
  /** Permissions required */
  permissions?: ('storage' | 'network' | 'notifications' | 'homeassistant')[]
}
