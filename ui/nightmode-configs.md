# Night Mode Configurations — All 10 Themes

## Overview
Each theme manifest now contains a `night_mode` block inside `theme.capabilities`.
The block is inserted as the **first key** in capabilities for consistency and discoverability.
All 10 manifests remain valid JSON.

---

## Theme Configurations

### Steampunk Revolution (`steampunk-theme/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.08 0.01 80)` |
| overlay_opacity | 0.92 |
| css_filter | `saturate(0.3) brightness(0.5)` |
| transition_ms | 800 |
| vignette | true |
| blend_mode | normal |
| reduce_motion | false |

### Ocean Blue (`ocean-theme/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.03 0.02 255)` |
| overlay_opacity | 0.9 |
| css_filter | `saturate(0.4) brightness(0.55)` |
| transition_ms | 700 |
| vignette | true |
| blend_mode | normal |
| reduce_motion | false |

### Material Sidebar (`material-sidebar-theme/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.02 0.005 260)` |
| overlay_opacity | 0.88 |
| css_filter | `saturate(0.35) brightness(0.6)` |
| transition_ms | 500 |
| vignette | false |
| blend_mode | normal |
| reduce_motion | **true** |

### Three Column / Full Layout (`full-layout-theme/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.05 0.01 260)` |
| overlay_opacity | 0.85 |
| css_filter | `saturate(0.3) brightness(0.55)` |
| transition_ms | 600 |
| vignette | true |
| blend_mode | multiply |
| reduce_motion | false |

### Sidebar Dark (`sidebar-theme/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.04 0.01 260)` |
| overlay_opacity | 0.9 |
| css_filter | `saturate(0.25) brightness(0.5)` |
| transition_ms | 700 |
| vignette | true |
| blend_mode | normal |
| reduce_motion | false |

### Cyberpunk Neon (`cyberpunk-neon/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.02 0.005 290)` |
| overlay_opacity | 0.95 |
| css_filter | `saturate(0.2) brightness(0.4) contrast(1.1)` |
| transition_ms | 400 |
| vignette | true |
| blend_mode | screen |
| reduce_motion | false |

### Nordic Light (`nordic-light/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.15 0.008 80)` |
| overlay_opacity | 0.8 |
| css_filter | `saturate(0.5) brightness(0.7) sepia(0.2)` |
| transition_ms | 1000 |
| vignette | true |
| blend_mode | multiply |
| reduce_motion | **true** |

### Forest Cabin (`forest-cabin/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.05 0.02 140)` |
| overlay_opacity | 0.9 |
| css_filter | `saturate(0.3) brightness(0.45)` |
| transition_ms | 800 |
| vignette | true |
| blend_mode | overlay |
| reduce_motion | false |

### Synthwave Sunset (`synthwave-sunset/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.06 0.04 310)` |
| overlay_opacity | 0.9 |
| css_filter | `saturate(0.4) brightness(0.5)` |
| transition_ms | 500 |
| vignette | true |
| blend_mode | screen |
| reduce_motion | false |

### Monochrome Pro (`monochrome-pro/manifest.json`)
| Field | Value |
|---|---|
| overlay_color | `oklch(0.03 0 0)` |
| overlay_opacity | 0.9 |
| css_filter | `saturate(0) brightness(0.4)` |
| transition_ms | 600 |
| vignette | false |
| blend_mode | normal |
| reduce_motion | **true** |

---

## Summary
- **10/10** manifests updated with `night_mode` capability
- **JSON validity**: all 10 files parse successfully
- **reduce_motion=true**: Material, Nordic, Monochrome (3 themes)
- **vignette=false**: Material, Monochrome (2 themes)
- **Unique blend modes used**: normal (5), multiply (2), screen (2), overlay (1)
- **Transition range**: 400ms (Cyberpunk) to 1000ms (Nordic)
- **Overlay opacity range**: 0.80 (Nordic) to 0.95 (Cyberpunk)
