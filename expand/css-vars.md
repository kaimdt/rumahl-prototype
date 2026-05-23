# CSS Variables Expansion — Findings

## Summary
Added 22 new CSS variables to all 10 IORA theme `manifest.json` files under `theme.css_variables`.

## Files Changed (10)
| Theme | Path | Theme Type | Shadow Strategy |
|-------|------|------------|----------------|
| Steampunk Revolution | `apps/examples/steampunk-theme/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Ocean Blue | `apps/examples/ocean-theme/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Material Sidebar | `apps/examples/material-sidebar-theme/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Full Layout | `apps/examples/full-layout-theme/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Sidebar Navigation | `apps/examples/sidebar-theme/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Cyberpunk Neon | `apps/examples/cyberpunk-neon/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Nordic Light | `apps/examples/nordic-light/manifest.json` | Light | rgba(0,0,0,0.03-0.08) |
| Forest Cabin | `apps/examples/forest-cabin/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Synthwave Sunset | `apps/examples/synthwave-sunset/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |
| Monochrome Pro | `apps/examples/monochrome-pro/manifest.json` | Dark | rgba(255,255,255,0.03-0.08) |

## Variables Added (22 total)
| Variable | Dark Theme Value | Light Theme (Nordic) Value |
|----------|-----------------|---------------------------|
| `shadow-sm` | `0 1px 2px rgba(255,255,255,0.03)` | `0 1px 2px rgba(0,0,0,0.03)` |
| `shadow-md` | `0 4px 6px rgba(255,255,255,0.05)` | `0 4px 6px rgba(0,0,0,0.05)` |
| `shadow-lg` | `0 10px 25px rgba(255,255,255,0.08)` | `0 10px 25px rgba(0,0,0,0.08)` |
| `shadow-xl` | `0 20px 50px rgba(255,255,255,0.08)` | `0 20px 50px rgba(0,0,0,0.08)` |
| `selection-bg` | `var(--accent)` | `var(--accent)` |
| `selection-fg` | `var(--accent-foreground)` | `var(--accent-foreground)` |
| `scrollbar-width` | `6px` | `6px` |
| `scrollbar-track` | `transparent` | `transparent` |
| `scrollbar-thumb` | `var(--border)` | `var(--border)` |
| `scrollbar-thumb-hover` | `var(--muted-foreground)` | `var(--muted-foreground)` |
| `focus-ring-width` | `2px` | `2px` |
| `focus-ring-offset` | `2px` | `2px` |
| `content-max-width` | `1500px` | `1500px` |
| `header-height` | `56px` | `56px` |
| `nav-icon-size` | `20px` | `20px` |
| `badge-radius` | `9999px` | `9999px` |
| `tooltip-bg` | `var(--card)` | `var(--card)` |
| `tooltip-fg` | `var(--card-foreground)` | `var(--card-foreground)` |
| `input-bg` | `var(--muted)` | `var(--muted)` |
| `input-border` | `var(--border)` | `var(--border)` |
| `overlay-bg` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.5)` |
| `skeleton-shimmer` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.05)` |

## Validation
- All 10 JSON files parse as valid JSON
- All 22 new variables present in every theme
- Dark themes use `rgba(255,255,255,...)` shadows + `rgba(255,255,255,0.05)` skeleton-shimmer
- Nordic Light uses `rgba(0,0,0,...)` shadows + `rgba(0,0,0,0.05)` skeleton-shimmer

## Open Risks
- Forest Cabin manifest has a pre-existing duplicate `"keyframes"` key in `capabilities.animation` (not introduced by this change)
- Design-mode `css_variables` overrides in each theme were **not** updated — shadows will be inherited from the base css_variables unless explicitly overridden per mode
