# Theme Integration Bugs – Frontend ↔ Backend Review

## Summary
| # | Severity | Category | Description |
|---|----------|----------|-------------|
| 1 | **HIGH** | Field Mismatch | Notification config field names differ between manifest JSON and Rust struct |
| 2 | **HIGH** | Missing Error Handling | Inline theme install bypasses manifest validation |
| 3 | **MEDIUM** | Field Mismatch | `ThemeCssResponse.animation` never populated (dead field) |
| 4 | **MEDIUM** | Missing Field (TS) | `ThemeFont` TypeScript interface missing `format` field |
| 5 | **MEDIUM** | Missing Field (TS) | `ThemeIconConfig` TypeScript interface missing `font_file` field |
| 6 | **MEDIUM** | Validation | Validator rejects child themes missing required css_variables even when `parent_theme` is set |
| 7 | **LOW** | Missing Field (TS) | `ThemeCssResponse` TypeScript interface missing `animation` field |
| 8 | **LOW** | Data Handling | Empty `css_path` in `ThemeIconConfig` produces broken asset URL |
| 9 | **LOW** | Missing Field (TS) | `InstalledTheme` TypeScript interface missing JSON fields from backend (`css_files_json`, `js_files_json`, etc.) |

---

## 1. 🚨 HIGH – Notification field name mismatch: `enter`/`exit`/`max`/`dismiss` vs Rust struct fields

**Files:**
- `iora-os/backend/shared/iora-shared/src/theme.rs` — `NotificationThemeConfig` struct (line ~476)
- `apps/examples/themes/*/manifest.json` — all sample theme manifests

**Evidence:**

Rust `NotificationThemeConfig` uses `serde::Deserialize` without `#[serde(rename)]`:
```rust
pub struct NotificationThemeConfig {
    pub position: String,
    pub enter_animation: String,   // expects "enter_animation" in JSON
    pub exit_animation: String,    // expects "exit_animation" in JSON
    pub max_visible: i32,          // expects "max_visible" in JSON
    pub auto_dismiss_ms: i32,      // expects "auto_dismiss_ms" in JSON
    ...
}
```

All sample manifests use **short names**:
```json
"notifications": {
    "position": "bottom-left",
    "enter": "slide-right",       // ❌ Rust expects "enter_animation"
    "exit": "slide-left",         // ❌ Rust expects "exit_animation"
    "max": 3,                     // ❌ Rust expects "max_visible"
    "dismiss": 8000               // ❌ Rust expects "auto_dismiss_ms"
}
```

**Impact:** These four fields silently fall back to their defaults:
- `enter_animation` → `"slide-right"` (default)
- `exit_animation` → `"slide-right"` (default)
- `max_visible` → `5` (default)
- `auto_dismiss_ms` → `5000` (default)

The steampunk manifest wants exit animation "slide-left" and dismiss timeout 8000ms, but the backend ignores those values.

**Affected manifests:** All 11 sample theme manifests in `apps/examples/themes/` that include a `notifications` section (steampunk, cyberpunk, synthwave, full-layout, and others).

**Fix:** Either:
- (A) Add `#[serde(rename = "enter")]`, `#[serde(rename = "exit")]`, `#[serde(alias = "max_visible")]`, `#[serde(alias = "auto_dismiss_ms")]` to the Rust struct
- (B) Update all manifest files to use the full field names `enter_animation`, `exit_animation`, `max_visible`, `auto_dismiss_ms`

---

## 2. 🚨 HIGH – Inline theme install (`POST /api/themes/install-from-manifest`) bypasses manifest validation

**Files:**
- `iora-os/backend/services/iora-home/src/theme_handler.rs` line ~678 – `handle_install_theme_inline`
- `iora-os/backend/services/iora-home/src/main.rs` line ~15649 – `handle_theme_zip_install`

**Evidence:**

The ZIP install handler runs validation:
```rust
// main.rs line ~15693
let validation = iora_shared::manifest_validator::validate_theme_manifest(&manifest_json);
if !validation.is_valid() { ... return error ... }
```

The inline install handler does **not** call validation:
```rust
// theme_handler.rs line ~678
pub async fn handle_install_theme_inline(
    State(gs): State<AppState>,
    Json(def): Json<iora_shared::theme::ThemeDefinition>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    gs.theme_manager.install_inline(def).await  // ← No validation step
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Install: {}", e)))?;
    Ok(Json(serde_json::json!({"status":"ok"})))
}
```

**Impact:** Any malformed `ThemeDefinition` can be installed via the inline API without required fields, invalid CSS values, missing `css_variables`, etc. This creates an inconsistency — the same manifest would be rejected via ZIP but accepted via inline.

**Fix:** Add `iora_shared::manifest_validator::validate_theme_manifest` call to `handle_install_theme_inline`, consistent with the ZIP handler.

---

## 3. MEDIUM – `ThemeCssResponse.animation` field always `None`

**Files:**
- `iora-os/backend/shared/iora-shared/src/theme.rs` line ~340 — `ThemeCssResponse` struct
- `iora-os/backend/services/iora-home/src/theme_handler.rs` — `get_theme_css1` method

**Evidence:**

`ThemeCssResponse` defines:
```rust
pub animation: Option<ThemeAnimationConfig>,  // line ~340
```

In `get_theme_css1`, **every** construction path hardcodes `animation: None`:
```rust
// "auto" path (~line 401):
return Ok(iora_shared::theme::ThemeCssResponse {
    ...
    animation: None,
});

// Cached theme path (~line 505):
return Ok(iora_shared::theme::ThemeCssResponse {
    ...
    animation: None,  // ← never populated from DB
});

// Fallback path (~line 518):
animation: None,
```

**Impact:** The `animation` config is only accessible via `capabilities.animation` (which *is* populated from the DB via `capabilities_json`). The top-level `animation` field is dead code. The frontend (`ThemeContext.tsx`) correctly reads from `capabilities?.animation`, so there's no runtime breakage — but the field is misleading.

**Fix:** Either:
- (A) Populate `animation` from the deserialized capabilities' `animation` field in `get_theme_css1`
- (B) Remove the `animation` field from `ThemeCssResponse` since `capabilities.animation` already serves this purpose

---

## 4. MEDIUM – TypeScript `ThemeFont` interface missing `format` field

**Files:**
- `iora-os/backend/shared/iora-shared/src/theme.rs` line ~22 — `ThemeFont` struct
- `frontend/src/contexts/ThemeContext.tsx` line ~13 — `ThemeFont` interface

**Evidence:**

Rust `ThemeFont`:
```rust
pub struct ThemeFont {
    pub name: String,
    pub family: String,
    pub url: String,
    pub format: String,          // ← defined in Rust
    pub weights: Option<String>,
    pub subsets: Option<String>,
    pub is_primary: bool,
    pub is_heading: bool,
    pub is_monospace: bool,
}
```

TypeScript `ThemeFont`:
```typescript
export interface ThemeFont {
  name: string
  family: string
  url: string
  // format ← MISSING
  weights?: string
  subsets?: string
  is_primary?: boolean
  is_heading?: boolean
  is_monospace?: boolean
}
```

Manifests include `"format": "woff2"` for every font.

**Impact:** The `format` field is silently dropped during JSON→TS deserialization. Since the frontend doesn't currently use `format`, there's no runtime error — but if the frontend ever needs to conditionally handle different font formats (woff2 vs truetype loading), this data is inaccessible.

**Fix:** Add `format?: string` to the TypeScript `ThemeFont` interface.

---

## 5. MEDIUM – TypeScript `ThemeIconConfig` interface missing `font_file` field

**Files:**
- `iora-os/backend/shared/iora-shared/src/theme.rs` line ~63 — `ThemeIconConfig` struct
- `frontend/src/contexts/ThemeContext.tsx` line ~22 — `ThemeIconConfig` interface

**Evidence:**

Rust `ThemeIconConfig`:
```rust
pub struct ThemeIconConfig {
    pub font_name: String,
    pub css_path: String,
    pub font_file: Option<String>,  // ← present in Rust
    pub class_prefix: String,
    pub icon_map: HashMap<String, String>,
}
```

TypeScript `ThemeIconConfig`:
```typescript
export interface ThemeIconConfig {
  font_name: string
  css_path: string
  // font_file ← MISSING
  class_prefix: string
  icon_map: Record<string, string>
}
```

**Impact:** Low. The backend resolves font file paths into `font_file` before sending the response (`get_theme_css1`), but the frontend only uses `css_path` for the stylesheet `<link>` tag. Currently no runtime impact, but type definition is incomplete.

**Fix:** Add `font_file?: string` to `ThemeIconConfig`.

---

## 6. MEDIUM – Validator rejects child themes that rely on `parent_theme` for required CSS variables

**Files:**
- `iora-os/backend/shared/iora-shared/src/manifest_validator.rs` line ~112 — `REQUIRED_THEME_VARS`
- `iora-os/backend/shared/iora-shared/src/manifest_validator.rs` line ~176 — required vars check

**Evidence:**

The validator declares these as **mandatory** in every manifest:
```rust
const REQUIRED_THEME_VARS: &[&str] = &[
    "background", "foreground", "card", "accent", "border", "muted",
];
```

And enforces them unconditionally:
```rust
for req in REQUIRED_THEME_VARS {
    if !vars.contains_key(*req) {
        missing_required.push(req);
    }
}
if !missing_required.is_empty() {
    result.add_error("css_variables", ...);
}
```

The validator does **not** check whether `parent_theme` is set. A minimal child theme like:
```json
{
    "id": "my-dark-tweak",
    "name": "Dark Tweak",
    "version": "1.0.0",
    "parent_theme": "night",
    "css_variables": {
        "accent": "oklch(0.65 0.22 195)"
    }
}
```
…would be **rejected** because it lacks `background`, `foreground`, `card`, `border`, `muted`.

**Impact:** Theme developers who want to create lightweight child themes that only override a few variables from a parent cannot pass validation. This contradicts the `parent_theme` inheritance design in the backend.

**Workaround:** All current sample manifests redundantly include all required variables even though they have `parent_theme` set — but this defeats the purpose of the inheritance system.

**Fix:** Skip the required-vars check when `parent_theme` is present and non-empty, OR reduce the requirement to only check the union of parent + child variables (requires looking up the parent definition).

---

## 7. LOW – TypeScript `ThemeCssResponse` missing `animation` field

**Files:**
- `frontend/src/contexts/ThemeContext.tsx` line ~289 — `ThemeCssResponse` interface
- `iora-os/backend/shared/iora-shared/src/theme.rs` line ~338 — Rust `ThemeCssResponse`

**Evidence:**

Rust:
```rust
pub struct ThemeCssResponse {
    ...
    pub animation: Option<ThemeAnimationConfig>,  // ← exists
}
```

TypeScript:
```typescript
export interface ThemeCssResponse {
    ...
    // animation? ← MISSING
}
```

**Impact:** Minimal. Combined with bug #3 (backend always sends `null`), this field is never needed. The frontend reads animation config from `capabilities.animation` instead.

**Fix:** Add `animation?: ThemeAnimationConfig` to the TypeScript interface, or remove from Rust (see bug #3).

---

## 8. LOW – Empty `css_path` in `ThemeIconConfig` produces broken resolved URL

**Files:**
- `iora-os/backend/services/iora-home/src/theme_handler.rs` — `get_theme_css1` path resolution
- `apps/examples/themes/*/manifest.json` — all manifests set `"css_path": ""`

**Evidence:**

All sample manifests define:
```json
"icon_font": {
    "css_path": "",
    ...
}
```

The resolution logic in `get_theme_css1`:
```rust
if !ic.css_path.starts_with("http") && !ic.css_path.starts_with("data:") {
    if let Some(ref base) = assets_base { ic.css_path = format!("{}/{}", base, ic.css_path); }
}
```

With empty `css_path` and base URL `/api/themes/assets/steampunk-revolution`, the result is:
```
/api/themes/assets/steampunk-revolution/
```

This is a directory URL, not a CSS file. The frontend injects it as a `<link rel="stylesheet">` which will 404 or return a directory listing.

**Impact:** Broken icon font loading for all themes with empty `css_path`. However, since the manifests don't include actual icon font CSS files, this likely fails silently in the browser.

**Fix:** Either:
- (A) Add a guard: skip CSS path injection when `css_path` is empty
- (B) Make `css_path` optional (`Option<String>`) in both Rust and TS, only inject when present
- (C) Remove the `""` css_path from manifests if no custom icon font is provided

---

## 9. LOW – TypeScript `InstalledTheme` interface missing backend fields

**Files:**
- `iora-os/backend/shared/iora-shared/src/theme.rs` line ~248 — `InstalledTheme` struct
- `frontend/src/contexts/ThemeContext.tsx` line ~56 — `InstalledTheme` interface

**Evidence:**

Rust `InstalledTheme` serializes (among others):
```rust
pub css_files_json: Option<String>,
pub js_files_json: Option<String>,
pub html_templates_json: Option<String>,
pub capabilities_json: Option<String>,
pub widget_templates_json: Option<String>,
pub css_variables_json: Option<String>,
```

TypeScript `InstalledTheme` only has:
```typescript
export interface InstalledTheme {
    ...
    css_variables?: string      // ← Note: string, not Record<string,string>
    additional_css?: string
    css_url?: string
    fonts_json?: string
    icon_font_json?: string
    // Missing: css_files_json, js_files_json, html_templates_json,
    //          capabilities_json, widget_templates_json
}
```

**Impact:** These fields are returned from `GET /api/themes` for the theme listing UI but silently dropped. The frontend doesn't currently use them for listing. Not a runtime bug.

**Fix:** Add missing fields if the theme listing UI needs them. Otherwise, consider omitting them from the `InstalledTheme` serialization to reduce payload size.

---

## Additional Observations (Not Categorized as Bugs)

### A. `css_url` legacy field
The TypeScript `ThemeCssResponse` includes `css_url?: string` as a legacy single-CSS-URL field alongside `css_urls: string[]`. The Rust struct only has `css_urls`. The frontend handles this gracefully with a fallback (`if css_urls.length > 0 ... else if css_url ...`). Not a bug, but cleanup candidate.

### B. `ThemeZipInstallBody` defined but unused in handler
`iora-os/backend/services/iora-home/src/theme_handler.rs` line ~638 defines `ThemeZipInstallBody` but the actual ZIP handler in `main.rs` parses JSON manually. The struct is dead code.

### C. Duplicate `oklch` check in manifest validator
`manifest_validator.rs` lines ~203-204: `starts_with("oklch(")` and `starts_with("oklch")` are both checked — the second is redundant since `oklch(` already matches the first. No functional impact.

### D. DB-specific row mapping
`map_theme_row` takes `&sqlx::postgres::PgRow` (Postgres-specific). The `DbPool` type is `Pool<Postgres>` so this is currently safe, but would break if SQLite support is added.

### E. Inline install doesn't handle `theme` wrapper
`handle_install_theme_inline` receives a `ThemeDefinition` directly. If a manifest.json with a `"theme"` wrapper object is sent (as in all sample manifests), only the top-level fields (`id`, `name`, `version`, etc.) are read. Fields nested inside `"theme"` (css_variables, css_files, capabilities, etc.) are silently ignored because serde doesn't know about the `theme` key. The ZIP path handles this via the merge logic in `extract_zip`. This is an API surface inconsistency.
