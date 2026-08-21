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
	// ─── Glass & Frosted ───────────────────────────────────
	{ id: 'default',    label: 'Standard',      description: 'Classic rumahl glass-morphism' },
	{ id: 'frosted',    label: 'Frosted',       description: 'Heavy blur, milky white' },
	{ id: 'crystal',    label: 'Crystal',       description: 'Ultra-clear, sharp glass edges' },
	{ id: 'dark-glass', label: 'Dark Glass',    description: 'Deep tinted glass overlay' },
	{ id: 'ice',        label: 'Ice',           description: 'Frozen glass, blue-white tint' },
	// ─── Solid & Flat ────────────────────────────────────
	{ id: 'solid',      label: 'Solid',         description: 'Opaque, clean background' },
	{ id: 'flat',       label: 'Flat',          description: 'No shadow, no blur, modern flat' },
	{ id: 'minimal',    label: 'Minimal',       description: 'Ultra-clean, barely visible' },
	{ id: 'subtle',     label: 'Subtle',        description: 'Very light glass presence' },
	// ─── Outlined ────────────────────────────────────────
	{ id: 'outline',    label: 'Outline',       description: 'Border only, transparent bg' },
	{ id: 'bordered',   label: 'Bordered',      description: 'Double border, elegant frame' },
	{ id: 'dashed',     label: 'Dashed',        description: 'Dashed border, blueprint style' },
	// ─── Glowing ─────────────────────────────────────────
	{ id: 'neon',       label: 'Neon',          description: 'Vibrant glowing accent edge' },
	{ id: 'soft-glow',  label: 'Soft Glow',     description: 'Gentle ambient light aura' },
	{ id: 'pulse',      label: 'Pulse',         description: 'Slow pulsing glow animation' },
	// ─── Gradient ────────────────────────────────────────
	{ id: 'gradient',   label: 'Gradient',      description: 'Subtle accent gradient wash' },
	{ id: 'aurora',     label: 'Aurora',        description: 'Shimmering multi-tone accent' },
	{ id: 'sunset',     label: 'Sunset',        description: 'Warm orange-to-pink gradient' },
	{ id: 'ocean',      label: 'Ocean',         description: 'Deep blue-to-teal gradient' },
	// ─── Material ────────────────────────────────────────
	{ id: 'elevated',   label: 'Elevated',      description: 'Strong shadow, floating card' },
	{ id: 'metallic',   label: 'Metallic',      description: 'Brushed metal shimmer' },
	{ id: 'paper',      label: 'Paper',         description: 'Paper-like texture & shadow' },
	{ id: 'velvet',     label: 'Velvet',        description: 'Soft, matte, luxurious feel' },
	// ─── Retro ───────────────────────────────────────────
	{ id: 'retro',      label: 'Retro',         description: '80s synthwave vibes' },
	{ id: 'noir',       label: 'Noir',          description: 'Film noir, high contrast' },
]

export function getCardStyleClass(style?: string): string {
	if (!style || style === 'default') return ''
	return `card-style-${style}`
}
