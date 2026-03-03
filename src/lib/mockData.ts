import type { EntityState } from '@/lib/types'

export function generateMockStates(): EntityState[] {
  return [
    {
      entity_id: 'weather.home',
      state: 'sunny',
      attributes: {
        temperature: 20,
        humidity: 65,
        forecast: [
          { datetime: new Date().toISOString(), temperature: 20, condition: 'sunny' },
          { datetime: new Date(Date.now() + 86400000).toISOString(), temperature: 22, condition: 'cloudy' },
          { datetime: new Date(Date.now() + 172800000).toISOString(), temperature: 19, condition: 'rainy' },
          { datetime: new Date(Date.now() + 259200000).toISOString(), temperature: 21, condition: 'cloudy' },
          { datetime: new Date(Date.now() + 345600000).toISOString(), temperature: 23, condition: 'sunny' },
        ],
        friendly_name: 'Kissing',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'light.living_room',
      state: 'on',
      attributes: {
        brightness: 200,
        rgb_color: [255, 180, 120],
        friendly_name: 'Wohnzimmer',
        supported_features: 1,
        supported_color_modes: ['rgb', 'color_temp'],
        color_mode: 'rgb',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'light.bedroom',
      state: 'off',
      attributes: {
        brightness: 0,
        rgb_color: [255, 255, 255],
        friendly_name: 'Schlafzimmer',
        supported_features: 1,
        supported_color_modes: ['rgb', 'color_temp'],
        color_mode: 'rgb',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'light.kitchen',
      state: 'on',
      attributes: {
        brightness: 255,
        color_temp: 370,
        friendly_name: 'Küche',
        supported_features: 1,
        supported_color_modes: ['color_temp', 'rgb'],
        color_mode: 'color_temp',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'light.office',
      state: 'on',
      attributes: {
        brightness: 180,
        rgb_color: [200, 220, 255],
        friendly_name: 'Büro',
        supported_features: 1,
        supported_color_modes: ['rgb', 'color_temp'],
        color_mode: 'rgb',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'light.hallway',
      state: 'off',
      attributes: {
        brightness: 0,
        color_temp: 300,
        friendly_name: 'Flur',
        supported_features: 1,
        supported_color_modes: ['color_temp'],
        color_mode: 'color_temp',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'climate.living_room',
      state: 'heat',
      attributes: {
        temperature: 21,
        current_temperature: 20.5,
        hvac_action: 'heating',
        friendly_name: 'Heizung Wohnzimmer',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'climate.bedroom',
      state: 'auto',
      attributes: {
        temperature: 19,
        current_temperature: 19.2,
        hvac_action: 'idle',
        friendly_name: 'Heizung Schlafzimmer',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
  ]
}
