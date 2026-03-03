export type ThemeMode = 'day' | 'evening' | 'night' | 'sleep'

export interface HomeAssistantConfig {
  url: string
  token: string
}

export interface EntityState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
  last_updated: string
}

export interface LightEntity extends EntityState {
  attributes: {
    brightness?: number
    color_temp?: number
    rgb_color?: [number, number, number]
    hs_color?: [number, number]
    xy_color?: [number, number]
    friendly_name?: string
    supported_features?: number
    supported_color_modes?: string[]
    color_mode?: string
  }
}

export interface ClimateEntity extends EntityState {
  attributes: {
    temperature?: number
    current_temperature?: number
    target_temp_high?: number
    target_temp_low?: number
    hvac_action?: string
    friendly_name?: string
  }
}

export interface SensorEntity extends EntityState {
  attributes: {
    unit_of_measurement?: string
    device_class?: string
    friendly_name?: string
  }
}

export interface WeatherEntity extends EntityState {
  attributes: {
    temperature?: number
    humidity?: number
    pressure?: number
    wind_speed?: number
    wind_bearing?: number
    forecast?: Array<{
      datetime: string
      temperature: number
      condition: string
      precipitation?: number
    }>
    friendly_name?: string
  }
}

export interface MediaPlayerEntity extends EntityState {
  attributes: {
    volume_level?: number
    media_title?: string
    media_artist?: string
    media_album_name?: string
    entity_picture?: string
    friendly_name?: string
  }
}

export interface DashboardWidget {
  id: string
  type: 'light' | 'climate' | 'sensor' | 'weather' | 'media_player' | 'switch' | 'greeting' | 'custom'
  entity_id?: string
  position: { x: number; y: number }
  size: { w: number; h: number }
  config?: Record<string, unknown>
}

export interface DashboardPage {
  id: string
  name: string
  icon: string
  widgets: DashboardWidget[]
}

export interface DashboardConfig {
  pages: DashboardPage[]
  userName: string
  location: string
}
