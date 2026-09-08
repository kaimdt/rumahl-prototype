import type { EntityState } from '@/lib/types'

/**
 * Returns a hard-coded set of demo entities. Intended ONLY for local
 * development and Storybook-style previews. Production builds must never
 * call this; use the real `useEntities()` / `rumahl` REST/WS clients instead.
 *
 * To guard against accidental shipping, this helper logs a warning when
 * it runs in a non-development build.
 */
export function generateMockStates(): EntityState[] {
  const isDev =
    typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } }).env?.DEV === true
  if (!isDev) {
    // eslint-disable-next-line no-console
    console.warn(
      '[rumahl] generateMockStates() called outside development mode – returning empty list. ' +
        'Wire up the real Home Assistant / rumahl-home backend instead.'
    )
    return []
  }
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
    {
      entity_id: 'switch.living_room_outlet',
      state: 'on',
      attributes: {
        friendly_name: 'Steckdose Wohnzimmer',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'switch.coffee_maker',
      state: 'off',
      attributes: {
        friendly_name: 'Kaffeemaschine',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'sensor.living_room_temperature',
      state: '22.5',
      attributes: {
        unit_of_measurement: '°C',
        device_class: 'temperature',
        friendly_name: 'Temperatur Wohnzimmer',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'sensor.living_room_humidity',
      state: '58',
      attributes: {
        unit_of_measurement: '%',
        device_class: 'humidity',
        friendly_name: 'Luftfeuchtigkeit Wohnzimmer',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
    {
      entity_id: 'sensor.energy_consumption',
      state: '1.2',
      attributes: {
        unit_of_measurement: 'kW',
        device_class: 'power',
        friendly_name: 'Energieverbrauch',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    },
  ]
}
