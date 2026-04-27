export const DEFAULT_DASHBOARD_BACKGROUND_URL = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2070'

export const DEFAULT_BACKGROUND_PRESETS = [
	{
		id: 'living-room',
		name: 'Living Room',
		url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2070',
	},
	{
		id: 'ambient-lamp',
		name: 'Ambient Lamp',
		url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=2070',
	},
	{
		id: 'minimal-interior',
		name: 'Minimal Interior',
		url: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?q=80&w=2070',
	},
	{
		id: 'cozy-evening',
		name: 'Cozy Evening',
		url: 'https://images.unsplash.com/photo-1616594039964-3f0d0b5f54f8?q=80&w=2070',
	},
	{
		id: 'modern-kitchen',
		name: 'Modern Kitchen',
		url: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?q=80&w=2070',
	},
] as const

/**
 * Card style presets – each maps to a CSS class `card-style-{id}`
 * defined in index.css. Widgets apply the class via config.cardStyle.
 */
export interface CardStylePreset {
	id: string
	label: string
	description: string
}

export const CARD_STYLE_PRESETS: CardStylePreset[] = [
	{ id: 'default',    label: 'Standard',      description: 'Glass-Morphismus Standard' },
	{ id: 'subtle',     label: 'Dezent',         description: 'Leichterer Glass-Effekt' },
	{ id: 'solid',      label: 'Solide',         description: 'Undurchsichtiger Hintergrund' },
	{ id: 'outline',    label: 'Umriss',         description: 'Nur Rahmen, kein Hintergrund' },
	{ id: 'neon',       label: 'Neon',           description: 'Leuchtender Akzent-Rand' },
	{ id: 'minimal',    label: 'Minimal',        description: 'Ultra-clean, kaum sichtbar' },
	{ id: 'elevated',   label: 'Erhaben',        description: 'Stärkerer Schatten, leichter Lift' },
	{ id: 'frosted',    label: 'Frost',          description: 'Starker Blur, milchig' },
	{ id: 'gradient',   label: 'Gradient',       description: 'Sanfter Akzent-Verlauf' },
	{ id: 'flat',       label: 'Flach',          description: 'Kein Schatten, kein Blur' },
	{ id: 'aurora',     label: 'Aurora',         description: 'Schimmernder Akzent-Hintergrund' },
	{ id: 'dark-glass', label: 'Dunkles Glas',   description: 'Dunkler getöntes Glas' },
	{ id: 'metallic',   label: 'Metallic',       description: 'Metallischer Schimmer-Effekt' },
	{ id: 'soft-glow',  label: 'Sanftes Leuchten', description: 'Dezenter Lichtschein rundherum' },
	{ id: 'bordered',   label: 'Gerahmt',        description: 'Doppelter Rahmen, elegant' },
]

export function getCardStyleClass(style?: string): string {
	if (!style || style === 'default') return ''
	return `card-style-${style}`
}
