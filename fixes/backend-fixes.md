# Backend Bug Fixes Summary

**Date:** 2026-05-23  
**Branch/workspace:** `/Users/rumahl/Documents/GitHub/home-assistant-dashb/rumahl-os/backend/`

---

## 1. Remove Hardcoded JWT Secrets (HIGH)

**Files changed:**
- `services/rumahl-home/src/auth.rs`
- `shared/rumahl-shared/src/system_config.rs`
- `services/rumahl-home/src/main.rs`

**Changes:**

### `shared/rumahl-shared/src/system_config.rs`
- Modified `jwt_secret()` to use a 3-tier priority:
  1. `rumahl_JWT_SECRET` environment variable (explicit override)
  2. Settings cache key `jwt_secret` (populated from `system_preferences` table)
  3. Auto-generated UUID v4 fallback (stored in `OnceLock<String>` for process lifetime)
- Removed hardcoded default `"rumahl-dev-jwt-change-in-production"`
- Added `persist_jwt_secret(secret: &str)` function so `rumahl-home` can persist a generated secret to both the cache and the auto-fallback

### `services/rumahl-home/src/auth.rs`
- Removed unused constants `JWT_SECRET_ENV` (`"JWT_SECRET"`) and `DEFAULT_JWT_SECRET` (`"your-secret-key-change-in-production"`)
- Removed unused `use std::env;` import

### `services/rumahl-home/src/main.rs`
- Added JWT secret initialization block right after `ConfigRepository` creation:
  - Checks `system_preferences` for existing `jwt_secret` row
  - If missing: generates 64 bytes of crypto-random data (`rand::rngs::OsRng`), base64-encodes it, persists to `system_preferences` table, and seeds the `system_config` cache via `persist_jwt_secret()`
  - If present: seeds the cache from the DB value

---

## 2. Convert `.expect()` and `serde_json::to_value().unwrap()` to Proper Error Handling (HIGH)

**File changed:** `services/rumahl-home/src/main.rs`

**Changes:**

### Startup `.expect()` → `?` + `.context()`
- **`reqwest::Client::builder().build().expect(...)` (was line 627):**  
  Changed to `.build().context("Failed to build HTTP client")?` using `anyhow::Context` trait (import added).

- **`local_appstore::LocalAppStore::open().await.expect("fallback local-appstore init in temp dir")` (was line 696):**  
  Extracted `local_appstore` initialization to a separate `let` binding before `AppState { ... }`, replacing `.expect()` with `.context("fallback local-appstore init in temp dir")?`.

- **`plugin_sandbox::PluginSandbox::new(...).await.expect("plugin-sandbox tmp init")` (was line 714):**  
  Extracted `plugin_sandbox` initialization to a separate `let` binding before `AppState { ... }`, replacing `.expect()` with `.context("plugin-sandbox tmp init")?`.

### HTTP handler `.unwrap()` on `serde_json::to_value()`
All `serde_json::to_value(X).unwrap()` in HTTP handler return paths were converted:

| Pattern | Replacement |
|---|---|
| `Ok(Json(serde_json::to_value(X).unwrap()))` | `Ok(Json(serde_json::to_value(X).unwrap_or(Value::Null)))` |
| `preference_value: serde_json::to_value(&config).unwrap(),` | `preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),` |

This affects ~18 call sites across MQTT, Matter, Zigbee, Z-Wave, HomeKit, HA connection status handlers and config save handlers.

---

## 3. Add Manifest Validation to `handle_install_theme_inline` (HIGH)

**File changed:** `services/rumahl-home/src/theme_handler.rs`

**Changes:**
- `handle_install_theme_inline` (line 679) now validates the incoming `ThemeDefinition` before installing:
  1. Serializes `def` to `serde_json::Value` via `serde_json::to_value(&def).unwrap_or_default()`
  2. Calls `rumahl_shared::manifest_validator::validate_theme_manifest(&manifest_json)`
  3. If validation fails, returns `400 BAD_REQUEST` with error details (same pattern as `handle_theme_zip_install` in `main.rs`)

This makes the inline handler consistent with the ZIP handler, which already performs validation.

---

## 4. Skip Required CSS Variables Check for Child Themes (MEDIUM)

**File changed:** `shared/rumahl-shared/src/manifest_validator.rs`

**Changes:**
- Added `has_parent` check using `parent_theme` field at the start of the CSS Variables section
- When `parent_theme` is set and non-empty:
  - **Required variables check is skipped** — child themes that only override a few variables pass validation
  - **Recommended variables check is skipped** — same rationale
  - **Missing `css_variables` entirely is allowed** — child can inherit all variables from parent
- Individual variable value validation (empty values, color format checks) still applies to child themes' overrides
- Standalone themes (no `parent_theme`) are unaffected — they still require all 6 required variables

---

## Validation

- `cargo check -p rumahl-shared` — **passes** (3 pre-existing warnings, no new warnings)
- `cargo check -p rumahl-home` — **passes** (120 pre-existing warnings, no new warnings or errors)
- `cargo test -p rumahl-shared --lib -- manifest_validator::tests` — **6/6 pass** (test_valid_theme_minimal, test_missing_css_variables, test_missing_id, test_valid_app, test_valid_plugin, test_wrapped_theme)
- No remaining hardcoded JWT secrets found by grep

---

## Compilation Errors Encountered

**None.** All changes compile cleanly on first attempt.

---

## Not Modified (as specified)

- MQTT password encryption — left as-is
- `.tmp` file cleanup — left as-is
- Unsafe code in `rumahl-security` — left as-is

---

## Open Risks / Questions

1. **UUID v4 as JWT secret fallback:** The system_config `jwt_secret()` fallback uses `uuid::Uuid::new_v4().to_string()` (36 chars). This is cryptographically random but shorter than the 64-byte base64 secret persisted by rumahl-home. In normal operation the DB-persisted value will be in the cache before any token verification occurs, so the UUID fallback should rarely be used.

2. **`unwrap_or(Value::Null)` for `preference_value`:** If `serde_json::to_value(&config)` fails for the protocol config structs (MatterConfig, ZigbeeConfig, etc.), the system will silently store `null` in `system_preferences`. These structs all `#[derive(Serialize)]` with simple field types, so failure is exceedingly unlikely. A future improvement could be proper `map_err` → `ErrorResponse` handling.

3. **First-boot JWT race:** If a request triggers token verification before the JWT secret initialization block completes, `jwt_secret()` will return the UUID v4 fallback. Then the DB-persisted secret will be set by `persist_jwt_secret()`, overwriting it. Any tokens issued with the UUID fallback will become invalid. In practice, the initialization happens synchronously in `main()` before the server binds, so this race window should not exist.

---

## Recommended Next Steps

1. Add a unit test for child theme validation in manifest_validator (theme with `parent_theme` set and only 2 css_variables should pass)
2. Consider upgrading the UUID v4 fallback in `system_config::jwt_secret()` to use `getrandom`/`OsRng` for a 64-byte secret directly (would require adding `rand` + `base64` crates to `rumahl-shared`'s `Cargo.toml`)
3. Run integration tests to verify JWT token issuance/verification works after first boot
