/**
 * App Manifest Builder and Types
 */

import { Permission } from './permissions';

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  developer: string;
  description: string;
  type: 'app' | 'plugin';
  plugin_type?: PluginType;
  permissions: Permission[];
  icon?: string;
  docker?: DockerConfig;
  sandbox?: SandboxConfig;
  endpoints?: ApiEndpoint[];
  widgets?: WidgetDefinition[];
  custom_pages?: CustomPage[];
  settings_schema?: SettingsSchema;
  network_access?: NetworkAccessConfig;
  store_metadata?: StoreMetadata;
}

export type PluginType = 'widget' | 'service' | 'api' | 'integration' | 'theme' | 'automation' | 'data_processor';

export interface DockerConfig {
  auto_build: boolean;
  base_image: string;
  working_dir: string;
  install_cmd: string;
  start_cmd: string;
  internal_ports: PortConfig[];
  environment?: Record<string, string>;
  volumes?: string[];
  health_check?: HealthCheck;
}

export interface PortConfig {
  port: number;
  protocol: 'tcp' | 'udp';
  assignment_mode: 'random' | 'fixed';
  description: string;
}

export interface HealthCheck {
  endpoint: string;
  interval: number;
  timeout: number;
  retries: number;
}

export interface SandboxConfig {
  max_execution_time_ms: number;
  max_memory_mb: number;
  allow_network: boolean;
  allow_file_system: boolean;
}

export interface ApiEndpoint {
  path: string;
  method: string;
  description: string;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  type: string;
  component_url: string;
  description: string;
  default_config?: any;
}

export interface CustomPage {
  id: string;
  title: string;
  icon: string;
  url: string;
  show_in_nav?: boolean;
  order?: number;
  parent_page_id?: string;
  iframe?: boolean;
  iframe_config?: IframeConfig;
}

export interface IframeConfig {
  sandbox: string[];
  allow: string[];
  security_token: boolean;
}

export interface SettingsSchema {
  title: string;
  description: string;
  fields: SettingsField[];
}

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'url' | 'email' | 'color';
  default?: any;
  required?: boolean;
  validation?: FieldValidation;
  options?: SelectOption[];
}

export interface FieldValidation {
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  pattern?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface NetworkAccessConfig {
  allowed_domains?: string[];
  allow_user_domains?: boolean;
  allowed_local_ips?: string[];
  allow_user_local_ips?: boolean;
  allow_network_scan?: boolean;
}

export interface StoreMetadata {
  category: string;
  tags: string[];
  screenshots: string[];
  homepage?: string;
}

/**
 * Manifest Builder for creating app manifests programmatically
 */
export class ManifestBuilder {
  private manifest: Partial<AppManifest>;

  constructor(id: string, name: string) {
    this.manifest = {
      id,
      name,
      version: '1.0.0',
      developer: '',
      description: '',
      type: 'app',
      permissions: [],
      custom_pages: [],
      widgets: [],
      endpoints: [],
    };
  }

  version(version: string): this {
    this.manifest.version = version;
    return this;
  }

  developer(developer: string): this {
    this.manifest.developer = developer;
    return this;
  }

  description(description: string): this {
    this.manifest.description = description;
    return this;
  }

  plugin(pluginType: PluginType): this {
    this.manifest.type = 'plugin';
    this.manifest.plugin_type = pluginType;
    return this;
  }

  permission(permission: Permission): this {
    if (!this.manifest.permissions) {
      this.manifest.permissions = [];
    }
    this.manifest.permissions.push(permission);
    return this;
  }

  permissions(permissions: Permission[]): this {
    this.manifest.permissions = permissions;
    return this;
  }

  docker(config: DockerConfig): this {
    this.manifest.docker = config;
    return this;
  }

  customPage(page: CustomPage): this {
    if (!this.manifest.custom_pages) {
      this.manifest.custom_pages = [];
    }
    this.manifest.custom_pages.push(page);
    return this;
  }

  widget(widget: WidgetDefinition): this {
    if (!this.manifest.widgets) {
      this.manifest.widgets = [];
    }
    this.manifest.widgets.push(widget);
    return this;
  }

  networkAccess(config: NetworkAccessConfig): this {
    this.manifest.network_access = config;
    return this;
  }

  settingsSchema(schema: SettingsSchema): this {
    this.manifest.settings_schema = schema;
    return this;
  }

  build(): AppManifest {
    if (!this.manifest.id || !this.manifest.name) {
      throw new Error('id and name are required');
    }
    return this.manifest as AppManifest;
  }

  toJSON(): string {
    return JSON.stringify(this.build(), null, 2);
  }
}
