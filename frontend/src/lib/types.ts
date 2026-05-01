export type ThemeMode = 'day' | 'day-classic' | 'light' | 'evening' | 'night' | 'sleep'

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
    color_temp_kelvin?: number
    min_mireds?: number
    max_mireds?: number
    min_color_temp_kelvin?: number
    max_color_temp_kelvin?: number
    rgb_color?: [number, number, number]
    rgbw_color?: [number, number, number, number]
    rgbww_color?: [number, number, number, number, number]
    hs_color?: [number, number]
    xy_color?: [number, number]
    friendly_name?: string
    supported_features?: number
    supported_color_modes?: string[]
    color_mode?: string
    entity_id?: string[] // Present when this is a light group
    entities?: string[] | string
    members?: string[] | string
    effect_list?: string[]
    effect?: string
  }
}

export interface ClimateEntity extends EntityState {
  attributes: {
    temperature?: number
    current_temperature?: number
    target_temp_high?: number
    target_temp_low?: number
    min_temp?: number
    max_temp?: number
    target_temp_step?: number
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

export interface SwitchEntity extends EntityState {
  attributes: {
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
      templow?: number
      condition: string
      precipitation?: number
      precipitation_probability?: number
      humidity?: number
      wind_speed?: number
    }>
    friendly_name?: string
  }
}

export interface MediaPlayerEntity extends EntityState {
  attributes: {
    volume_level?: number
    is_volume_muted?: boolean
    media_title?: string
    media_artist?: string
    media_album_name?: string
    media_duration?: number
    media_position?: number
    media_position_updated_at?: string
    entity_picture?: string
    friendly_name?: string
  }
}

export type WidgetType =
  | 'light' | 'climate' | 'sensor' | 'weather' | 'media_player' | 'switch'
  | 'input_boolean' | 'input_number' | 'input_select' | 'binary_sensor' | 'cover'
  | 'fan' | 'lock' | 'automation' | 'script' | 'button' | 'scene_entity'
  | 'number' | 'select' | 'input_text' | 'text' | 'input_datetime'
  | 'person' | 'device_tracker' | 'timer' | 'counter' | 'group' | 'camera'
  | 'vacuum' | 'humidifier' | 'alarm_control_panel'
  | 'greeting'
  | 'chat_card' | 'dynamic_text'
  | 'analog_clock' | 'digital_clock' | 'calendar' | 'scene_selector'
  | 'spacer' | 'section_header'
  | 'widget_group'
  | 'custom'
  // Premium widgets
  | 'entity_history' | 'energy_monitor' | 'entity_statistics'
  | 'quick_actions' | 'system_monitor' | 'scene_manager'
  | 'room_summary' | 'notification_log' | 'water_usage'
  | 'statistics_chart'
  | 'waste_collection'
  | 'widget_carousel'
  | 'page_link'
  | 'nina_warnings'
  | 'map'
  | 'iframe'
  | 'stream'

export interface DashboardWidget {
  id: string
  type: WidgetType
  entity_id?: string
  position: { x: number; y: number }
  size: { w: number; h: number }
  config?: Record<string, unknown>
  label?: string
}

export interface ModalSettings {
  size?: 'small' | 'medium' | 'large' | 'fullscreen'
  backdropBlur?: boolean
  closeOnBackdropClick?: boolean
  showCloseButton?: boolean
  rounded?: boolean
}

export interface DashboardPage {
  id: string
  name: string
  icon: string
  widgets: DashboardWidget[]
  // Logical page classification used for routing/render behavior.
  pageType?: 'dashboard' | 'app' | 'system' | 'custom'
  // Optional source metadata (e.g. app-id for app pages).
  pageSource?: {
    kind: 'app' | 'iora' | 'user' | 'external'
    id?: string
  }
  showInNav?: boolean // Whether to show in navigation bar
  order?: number // Display order in navigation
  displayMode?: 'page' | 'modal' // full page or modal overlay
  parentPageId?: string // If set, this is a sub-page of the parent
  modalSettings?: ModalSettings // Configuration when displayMode is 'modal'
}

export interface DashboardConfig {
  pages: DashboardPage[]
  userName: string
  location: string
}
