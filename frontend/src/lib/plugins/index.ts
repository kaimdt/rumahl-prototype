/**
 * Plugin System Exports
 *
 * This file provides a centralized export point for the plugin system.
 */

// Core plugin types
export type {
  Plugin,
  PluginMetadata,
  PluginContext,
  PluginConfig,
  PluginManifest,
  WidgetPlugin,
  WidgetPluginProps,
  APIPlugin,
  APIRequest,
  APIResponse,
  ServicePlugin,
  ThemePlugin,
} from './types'

// Plugin registry
export { pluginRegistry, createPluginContext } from './registry'

// Example plugins
export { weatherWidgetPlugin } from './examples/weather-widget'
