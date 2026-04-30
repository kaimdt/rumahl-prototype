import type {
  Plugin,
  PluginConfig,
  PluginContext,
  WidgetPlugin,
  APIPlugin,
  ServicePlugin,
  ThemePlugin,
  PluginManifest,
} from './types'
import { toast } from 'sonner'

/**
 * Plugin Registry
 * Central registry for all plugins in the application
 */
class PluginRegistry {
  private widgetPlugins = new Map<string, WidgetPlugin>()
  private apiPlugins = new Map<string, APIPlugin>()
  private servicePlugins = new Map<string, ServicePlugin>()
  private themePlugins = new Map<string, ThemePlugin>()
  private pluginConfigs = new Map<string, PluginConfig>()
  private context: PluginContext | null = null

  /**
   * Initialize the plugin registry with context
   */
  initialize(context: PluginContext) {
    this.context = context
  }

  /**
   * Register a widget plugin
   */
  registerWidget(plugin: WidgetPlugin) {
    if (this.widgetPlugins.has(plugin.metadata.id)) {
      console.warn(`Widget plugin ${plugin.metadata.id} is already registered`)
      return
    }

    this.widgetPlugins.set(plugin.metadata.id, plugin)
    console.log(`Registered widget plugin: ${plugin.metadata.name} (${plugin.metadata.id})`)
  }

  /**
   * Register an API plugin
   */
  registerAPI(plugin: APIPlugin) {
    if (this.apiPlugins.has(plugin.metadata.id)) {
      console.warn(`API plugin ${plugin.metadata.id} is already registered`)
      return
    }

    this.apiPlugins.set(plugin.metadata.id, plugin)
    console.log(`Registered API plugin: ${plugin.metadata.name} at ${plugin.endpoint}`)
  }

  /**
   * Register a service plugin
   */
  async registerService(plugin: ServicePlugin) {
    if (this.servicePlugins.has(plugin.metadata.id)) {
      console.warn(`Service plugin ${plugin.metadata.id} is already registered`)
      return
    }

    try {
      await plugin.initialize()
      this.servicePlugins.set(plugin.metadata.id, plugin)
      console.log(`Registered service plugin: ${plugin.metadata.name}`)
    } catch (error) {
      console.error(`Failed to initialize service plugin ${plugin.metadata.id}:`, error)
      throw error
    }
  }

  /**
   * Register a theme plugin
   */
  registerTheme(plugin: ThemePlugin) {
    if (this.themePlugins.has(plugin.metadata.id)) {
      console.warn(`Theme plugin ${plugin.metadata.id} is already registered`)
      return
    }

    this.themePlugins.set(plugin.metadata.id, plugin)
    this.applyTheme(plugin)
    console.log(`Registered theme plugin: ${plugin.metadata.name}`)
  }

  /**
   * Apply theme CSS variables
   */
  private applyTheme(plugin: ThemePlugin) {
    const root = document.documentElement
    Object.entries(plugin.cssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    if (plugin.cssUrl) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = plugin.cssUrl
      link.id = `theme-${plugin.metadata.id}`
      document.head.appendChild(link)
    }
  }

  /**
   * Unregister a plugin
   */
  async unregister(pluginId: string) {
    // Check and remove from each registry
    if (this.widgetPlugins.has(pluginId)) {
      this.widgetPlugins.delete(pluginId)
    }

    if (this.apiPlugins.has(pluginId)) {
      this.apiPlugins.delete(pluginId)
    }

    if (this.servicePlugins.has(pluginId)) {
      const service = this.servicePlugins.get(pluginId)
      if (service) {
        await service.destroy()
      }
      this.servicePlugins.delete(pluginId)
    }

    if (this.themePlugins.has(pluginId)) {
      const themeLink = document.getElementById(`theme-${pluginId}`)
      if (themeLink) {
        themeLink.remove()
      }
      this.themePlugins.delete(pluginId)
    }

    this.pluginConfigs.delete(pluginId)
    console.log(`Unregistered plugin: ${pluginId}`)
  }

  /**
   * Get widget plugin by ID
   */
  getWidget(pluginId: string): WidgetPlugin | undefined {
    return this.widgetPlugins.get(pluginId)
  }

  /**
   * Get widget plugin by entity domain
   */
  getWidgetForDomain(domain: string): WidgetPlugin | undefined {
    for (const plugin of this.widgetPlugins.values()) {
      if (plugin.metadata.supportedDomains?.includes(domain)) {
        return plugin
      }
    }
    return undefined
  }

  /**
   * Get all widget plugins
   */
  getAllWidgets(): WidgetPlugin[] {
    return Array.from(this.widgetPlugins.values())
  }

  /**
   * Get API plugin by endpoint
   */
  getAPIForEndpoint(endpoint: string): APIPlugin | undefined {
    for (const plugin of this.apiPlugins.values()) {
      if (endpoint.startsWith(plugin.endpoint)) {
        return plugin
      }
    }
    return undefined
  }

  /**
   * Get all API plugins
   */
  getAllAPIs(): APIPlugin[] {
    return Array.from(this.apiPlugins.values())
  }

  /**
   * Get all service plugins
   */
  getAllServices(): ServicePlugin[] {
    return Array.from(this.servicePlugins.values())
  }

  /**
   * Get all theme plugins
   */
  getAllThemes(): ThemePlugin[] {
    return Array.from(this.themePlugins.values())
  }

  /**
   * Load plugin from manifest
   */
  async loadPlugin(manifest: PluginManifest): Promise<void> {
    try {
      // Dynamically import the plugin module
      const module = await import(/* @vite-ignore */ manifest.entry)
      const plugin = module.default as Plugin

      // Validate plugin matches manifest
      if (plugin.metadata.id !== manifest.metadata.id) {
        throw new Error('Plugin ID mismatch')
      }

      // Register based on type
      switch (manifest.type) {
        case 'widget':
          this.registerWidget(plugin as WidgetPlugin)
          break
        case 'api':
          this.registerAPI(plugin as APIPlugin)
          break
        case 'service':
          await this.registerService(plugin as ServicePlugin)
          break
        case 'theme':
          this.registerTheme(plugin as ThemePlugin)
          break
        default:
          throw new Error(`Unknown plugin type: ${manifest.type}`)
      }

      toast.success(`Plugin ${manifest.metadata.name} loaded successfully`)
    } catch (error) {
      console.error(`Failed to load plugin from ${manifest.entry}:`, error)
      toast.error(`Failed to load plugin ${manifest.metadata.name}`)
      throw error
    }
  }

  /**
   * Save plugin configuration
   */
  setPluginConfig(pluginId: string, config: Partial<PluginConfig>) {
    const existing = this.pluginConfigs.get(pluginId)
    const updated: PluginConfig = {
      pluginId,
      enabled: config.enabled ?? existing?.enabled ?? true,
      config: config.config ?? existing?.config ?? {},
      installedAt: existing?.installedAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    this.pluginConfigs.set(pluginId, updated)
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginId: string): PluginConfig | undefined {
    return this.pluginConfigs.get(pluginId)
  }

  /**
   * Get all plugin configurations
   */
  getAllConfigs(): PluginConfig[] {
    return Array.from(this.pluginConfigs.values())
  }

  /**
   * Check if plugin is enabled
   */
  isPluginEnabled(pluginId: string): boolean {
    const config = this.pluginConfigs.get(pluginId)
    return config?.enabled ?? true
  }

  /**
   * Get plugin context
   */
  getContext(): PluginContext {
    if (!this.context) {
      throw new Error('Plugin registry not initialized')
    }
    return this.context
  }

  /**
   * Clear all plugins (for testing)
   */
  clear() {
    this.widgetPlugins.clear()
    this.apiPlugins.clear()
    this.servicePlugins.clear()
    this.themePlugins.clear()
    this.pluginConfigs.clear()
  }
}

// Export singleton instance
export const pluginRegistry = new PluginRegistry()

// Helper function to create plugin context
export function createPluginContext(services: {
  callService: PluginContext['callService']
  getStates: PluginContext['getStates']
  getState: PluginContext['getState']
  storage: PluginContext['storage']
  notify: PluginContext['notify']
  subscribe: PluginContext['subscribe']
  ai?: PluginContext['ai']
}): PluginContext {
  return {
    ...services,
    ai: services.ai ?? ({
      chat: async () => ({ success: false, message: 'AI not available' }),
      streamChat: async function*() {},
      registerTool: () => {},
      unregisterTool: () => {},
    } as unknown as PluginContext['ai']),
  }
}
