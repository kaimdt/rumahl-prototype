export interface ColorScene {
  id: string
  name: string
  icon: string
  settings: {
    [entityId: string]: {
      brightness: number
      rgb_color?: [number, number, number]
      color_temp?: number
    }
  }
  createdAt: string
}

export const DEFAULT_SCENES: ColorScene[] = [
  {
    id: 'relax',
    name: 'Entspannen',
    icon: '🌙',
    settings: {},
    createdAt: new Date().toISOString(),
  },
  {
    id: 'focus',
    name: 'Fokus',
    icon: '💡',
    settings: {},
    createdAt: new Date().toISOString(),
  },
  {
    id: 'party',
    name: 'Party',
    icon: '🎉',
    settings: {},
    createdAt: new Date().toISOString(),
  },
]
