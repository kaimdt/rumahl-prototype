# Backend Bug Report – rumahl OS Rust Codebase

**Date:** 2026-05-23
**Scope:** `rumahl-os/backend/` – services/rumahl-home/src/ and shared/rumahl-shared/src/
**Methodology:** Static analysis of `.rs` files for compilation errors, unwrap/expect on error paths, SQL injection, auth bypass, missing migrations, dead code, and serde mismatches.

---

## 🔴 CRITICAL

### 1. Migration 028 Not Registered – `widget_templates_json` Column Will Never Be Created
- **Files:** `db/mod.rs` (line ~63), `migrations/028_theme_widget_templates.sql`
- **Issue:** Migration `028_theme_widget_templates.sql` exists in the filesystem but is **not included** in the migration list in `db/mod.rs`. The migration adds:
  ```sql
  ALTER TABLE installed_themes ADD COLUMN IF NOT EXISTS widget_templates_json TEXT DEFAULT NULL;
  ```
  Yet `theme_handler.rs` reads from and writes to this column in `store_theme()`, `install_inline()`, and `get_theme_css1()`. On a fresh DB, the column will not exist, causing runtime SQL errors on every theme install or CSS fetch.
- **Severity:** Critical – Runtime crash
- **Fix:** Add `("028_theme_widget_templates", include_str!("../../migrations/028_theme_widget_templates.sql"))` to the migrations vector in `db/mod.rs` around line 63.

### 2. Theme `system` Column Always Hardcoded to `false`
- **Files:** `theme_handler.rs` lines ~248, ~281 (both `store_theme` and `install_inline`)
- **Issue:** Both functions bind `false` (not `def.system`) to the `system` column:
  ```rust
  .bind(false)   // system column always hardcoded to false
  ```
  Theme definitions can declare `system: true` (e.g., built-in themes), but the DB always stores `false`. This also means **no theme can be protected from uninstall** – the uninstall guard in `uninstall()` (line ~285) checks the DB row's `system` flag, which is always false.
- **Severity:** Critical – Logic bug; system themes can be deleted, and theme definitions are silently corrupted
- **Fix:** Change `.bind(false)` to `.bind(def.system)` in both `store_theme` and `install_inline`.

### 3. PostgreSQL Hard-Assumption vs SQLite Default URL
- **Files:** `db/mod.rs` line 5: `use sqlx::{postgres::PgPool, Pool, Postgres};`, `system_config.rs` line ~69: `"sqlite:./data/rumahl.db?mode=rwc"`
- **Issue:** `init_db()` uses `PgPool::connect()` which expects a PostgreSQL connection string. However, the default `database_url()` returns `"sqlite:./data/rumahl.db?mode=rwc"`. If `DATABASE_URL` env var is not set, the server will crash on startup with a connection error. The theme_handler also hardcodes `sqlx::postgres::PgRow` in `map_theme_row()`.
- **Severity:** Critical – Startup crash on default config
- **Fix:** Either change the default URL to a PostgreSQL-compatible string, or switch to a feature-gated backend (e.g., `#[cfg]` blocks for sqlite vs postgres). Alternatively, document that `DATABASE_URL` is mandatory for development.

---

## 🟠 HIGH

### 4. MQTT Password Stored in Plaintext in System Preferences
- **Files:** `main.rs` lines ~10620-10635
- **Issue:** When an MQTT connection succeeds, the entire config (including cleartext password) is serialized to JSON and saved to `system_preferences`:
  ```rust
  let config_value = serde_json::json!({
      "host": req.host,
      "password": req.password,  // CLEARTEXT!
      ...
  });
  ```
  While the GET endpoint masks the password before returning, it remains stored in plaintext in the DB. Anyone with DB access can read it.
- **Severity:** High – Credential leak
- **Fix:** Encrypt the password before storage using `rumahl-shared` encryption utilities, or use the existing `rumahl-secrets` service. At minimum, document this in a security note.

### 5. Default JWT Secret is Hardcoded and Predictable
- **Files:** `auth.rs` line 9: `"your-secret-key-change-in-production"`, `system_config.rs` line ~107: `"rumahl-dev-jwt-change-in-production"`
- **Issue:** Two different default JWT secrets exist. If the `rumahl_JWT_SECRET` env var is not set, the JWT secret falls back to a well-known string that anyone can find in the source code. This allows attackers to forge valid JWT tokens and gain admin access.
- **Severity:** High – Auth bypass
- **Fix:** Remove hardcoded defaults. On startup, if no JWT secret exists, generate a random one (e.g., 64 bytes of crypto-random hex) and log it. Store it in the DB or a secure file. **Never use a code-literal default.**

### 6. Hardcoded Default Encryption Key for Security DB
- **Files:** `system_config.rs` line ~114: `env_or("SECURITY_DB_KEY", "")`
- **Issue:** The `security_db_key()` function returns an empty string as default. The rumahl-security service uses this key for encryption. An empty encryption key means data is effectively unencrypted.
- **Severity:** High – Data not encrypted
- **Fix:** Generate a random key on first startup and persist it. Fail explicitly if no key is configured.

### 7. `.expect()` Calls in Production Startup Code
- **Files:** 
  - `main.rs` line 627: `.expect("Failed to build HTTP client")`
  - `main.rs` line 696: `.expect("fallback local-appstore init in temp dir")`
  - `main.rs` line 714: `.expect("plugin-sandbox tmp init")`
  - `ha_client.rs` lines 68, 75: `.expect("Failed to create poll/cmd HTTP client")`
  - `local_appstore.rs` lines 884, 900, 906: `.expect("app_logs mutex poisoned")`
- **Issue:** `.expect()` panics the entire process if these fail. While HTTP client construction failure is unlikely, a poisoned mutex or I/O error on temp dir creation should be handled gracefully (log + retry or degraded mode) rather than a full process crash.
- **Severity:** High – Process crash in production
- **Fix:** Convert `.expect()` calls to proper error handling with `?` and `anyhow::Context`. For the mutex, use `.lock().unwrap_or_else(|poisoned| poisoned.into_inner())` to recover from poisoning.

### 8. Multiple `.unwrap()` Calls on `serde_json::to_value()` That Silently Panic
- **Files:** `main.rs` lines 8431, 10588, 10779, 10806, 10832, 10842, 10854, 10877, 10887, 10899, 10922, 10932, 10944, 10966, 10976, 10988, 11007
- **Issue:** Pattern like:
  ```rust
  Ok(Json(serde_json::to_value(status).unwrap()))
  ```
  `serde_json::to_value()` returns a `Result`. While it rarely fails for simple structs, it CAN fail for structs containing non-string keys in maps or NaN values. A panic here will crash the HTTP handler thread.
- **Severity:** High – Panic in request handler
- **Fix:** Replace `.unwrap()` with `.unwrap_or(serde_json::Value::Null)` or `.map_err(|e| ErrorResponse::internal(...))?`.

### 9. `.unwrap()` on HTTP Response Construction
- **Files:** `main.rs` lines 5586, 6718, 6726, 6734, 7047, 7059, 7075
- **Issue:** Pattern like:
  ```rust
  Response::builder()
      .body(Body::from(data))
      .unwrap()
  ```
  `Response::builder().body()` returns a `Result`. It fails if the headers contain invalid values. While unlikely with hardcoded headers, a future code change adding dynamic headers could panic.
- **Severity:** High – Panic in request handler
- **Fix:** Use `.unwrap_or_else(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())` or proper error handling.

### 10. `theme_handler.rs.tmp` – Image File Left in Source Tree
- **Files:** `services/rumahl-home/src/theme_handler.rs.tmp`
- **Issue:** A `.tmp` file containing image data was left in the source directory. This is likely an accidental artifact (perhaps a pasted screenshot) and should not be committed.
- **Severity:** Medium-High – Code hygiene / potential information leak
- **Fix:** Delete `theme_handler.rs.tmp` and add `*.tmp` to `.gitignore`.

---

## 🟡 MEDIUM

### 11. `tm()` Helper Function Defined But Never Used
- **Files:** `theme_handler.rs` line 111
- **Issue:** The function `fn tm(state: &AppState) -> &ThemeState` is defined but never called anywhere in the codebase. All theme handlers access `state.theme_manager` directly.
- **Severity:** Low – Dead code
- **Fix:** Remove the function or use it consistently.

### 12. `extract_claims()` Uses Different Auth Flow Than Middleware
- **Files:** `main.rs` lines 8327, 8354 (in `set_user_pin`, `remove_user_pin`), `main.rs` line 8468 (definition)
- **Issue:** The PIN handlers use `extract_claims()` to extract JWT claims directly from headers rather than going through `try_authenticate()`. This means:
  - API key authentication is NOT supported for PIN endpoints (only JWT)
  - The `X-Action-Intent` header check from `require_auth` middleware is skipped
- **Severity:** Medium – Inconsistent auth; API keys silently rejected
- **Fix:** Use `middleware::try_authenticate()` consistently or document that PIN endpoints are JWT-only.

### 13. Admin Password Length Relaxed to 5 Characters on Dev Images
- **Files:** `main.rs` lines 2017-2019
- **Issue:** 
  ```rust
  let min_password_len: usize = if is_os_dev { 5 } else { 8 };
  ```
  On dev images, passwords as short as 5 characters (e.g., "12345") are accepted. This is documented as intentional but creates a weak default for development.
- **Severity:** Medium – Weak security for dev environments
- **Fix:** At minimum, log a prominent warning when a short password is used. Consider requiring 8 characters even on dev images but providing a bypass via explicit env var (`rumahl_DEV_INSECURE_PASSWORDS=1`).

### 14. Unsafe Code in rumahl-security for Disk Stats
- **Files:** `services/rumahl-security/src/main.rs` lines 751-769
- **Issue:**
  ```rust
  unsafe {
      let mut stat: libc::statvfs = std::mem::zeroed();
      if libc::statvfs(path.as_ptr(), &mut stat) != 0 { ... }
  }
  ```
  The `unsafe` block is for FFI call to `libc::statvfs`. While the usage appears correct (null-terminated CString, properly sized output buffer), any misuse could cause UB.
- **Severity:** Medium – Unsafe code in security-critical service
- **Fix:** Add a `// SAFETY:` comment documenting why the unsafe block is sound. Consider using the `nix` crate or `std::fs` equivalent if available.

### 15. `extract_zip()` Path Contains ".." Check but Only in `serve_asset`
- **Files:** `theme_handler.rs` line ~497 (`serve_asset`), `theme_handler.rs` line ~199 (`extract_zip`)
- **Issue:** The `serve_asset` handler checks for `..` in paths, but the `extract_zip` function's path validation uses `matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir)`. While both provide protection, the difference in approach could lead to subtle bypasses (e.g., symlinks in ZIP are not checked).
- **Severity:** Medium – Potential path traversal in theme ZIP
- **Fix:** Add symlink checks in `extract_zip`. Consider using a common path validation function.

### 16. `admin_ha_config` Returns Raw HA API Response Without Filtering
- **Files:** `main.rs` lines 10312-10325
- **Issue:** The handler proxies the full `/api/config` response from Home Assistant. This could expose sensitive HA configuration details (e.g., internal IPs, integration secrets visible in HA config). While this is an admin-only endpoint, it should still filter sensitive fields.
- **Severity:** Medium – Information disclosure (admin-only)
- **Fix:** Filter or sanitize the HA config response before returning it, removing fields like `latitude`, `longitude`, `external_url` if they should not be visible.

### 17. `validate_theme_manifest` Error Message Contains Raw User Input
- **Files:** `main.rs` lines ~15690-15695
- **Issue:**
  ```rust
  format!("Manifest enthält Fehler:\n{}", errors.join("\n"))
  ```
  Error messages from validation include field names and messages from the user-supplied manifest. While returned as JSON, this might expose implementation details.
- **Severity:** Low – Information disclosure
- **Fix:** Sanitize error messages or log detailed messages server-side while returning generic user-facing messages.

---

## 🟢 LOW / INFORMATIONAL

### 18. `PluginSandbox` Executes Arbitrary JS/Python Without Container Isolation (Fallback Path)
- **Files:** `main.rs` lines 7430-7520
- **Issue:** The plugin sandbox runs Node.js and Python3 as child processes with plugin code. The code sets environment variables to restrict networking but does not use container isolation or seccomp. In the fallback path (when Docker sandbox fails), arbitrary code execution is possible.
- **Severity:** Low – Only in fallback path, and plugins are trusted code
- **Fix:** Document the security boundary. Consider using `seccomp` or `pledge` on Linux.

### 19. `serde_json::from_str().unwrap_or_default()` Silent Data Loss
- **Files:** `theme_handler.rs` lines ~330-370 (multiple uses in `get_theme_css1`)
- **Issue:** When parsing JSON fields (css_variables, fonts, capabilities, etc.), `.unwrap_or_default()` silently returns empty data on parse failure. A corrupted theme JSON would appear as "no data" rather than returning an error to the frontend.
- **Severity:** Low – Silent data corruption
- **Fix:** Log a warning when JSON parsing fails, so operators can identify corrupted themes.

### 20. `generate_token()` Uses `expect("valid timestamp")` on Date Math
- **Files:** `auth.rs` line 35
- **Issue:**
  ```rust
  chrono::Utc::now()
      .checked_add_signed(chrono::Duration::days(expiration_days.clamp(1, 90)))
      .expect("valid timestamp")
  ```
  While the clamping makes overflow unlikely, `expect()` in a library utility function is risky. If something changes upstream, this panics the token generation.
- **Severity:** Low – Panic in auth utility
- **Fix:** Return an error instead of panicking: `.ok_or_else(|| jsonwebtoken::errors::Error::from(...))?`.

### 21. Theme `assets_base_url` Never Resolved for Inline Themes Without `source = "file"`
- **Files:** `theme_handler.rs` line ~343
- **Issue:** `assets_base_url` is set to `None` for inline themes. This is by design (inline themes have no files to serve), but if an inline theme specifies `css_files` or `fonts` with relative paths, they will be served as raw relative paths and the frontend won't be able to load them.
- **Severity:** Low – Misconfiguration possible
- **Fix:** Validate that inline themes don't have `css_files`/`fonts` with relative paths, or document the restriction.

### 22. `list_themes` Performs SQL Query on Every Request Without Pagination
- **Files:** `theme_handler.rs` lines ~420-455
- **Issue:** The `list_themes` handler fetches ALL installed themes on every request. With a large number of themes (100+), this could impact performance.
- **Severity:** Low – Performance concern
- **Fix:** Add pagination or rely on the theme cache for listing instead of direct SQL.

---

## 📊 Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| Critical | 3     | Missing migration, theme system bug, DB adapter mismatch |
| High     | 7     | Credential leaks, hardcoded secrets, panics in production |
| Medium   | 7     | Inconsistent auth, unsafe code, info disclosure |
| Low      | 5     | Dead code, silent data loss, performance |

## 🔍 Areas NOT Found to Have Issues
- **SQL injection:** All queries use parameterized bindings (`$1`, `$2`, etc.) – no string concatenation found
- **Race conditions in entity cache:** Uses `Arc<RwLock>` with appropriate lock scopes
- **Broken serde field names:** Theme types appear consistent between backend and shared types
- **Missing error handling on network calls:** Most HA API calls use proper `?` and `map_err`

---

## 🎯 Priority Fixes (Recommended Order)

1. **Register migration 028** in db/mod.rs (15 min fix)
2. **Fix `system: false` hardcode** in theme_handler.rs (5 min fix)
3. **Generate random JWT secret on first boot** instead of hardcoded default (30 min)
4. **Convert `.expect()` and `.unwrap()` calls** to proper error handling (2 hrs)
5. **Encrypt MQTT password** before storage (1 hr)
6. **Delete `theme_handler.rs.tmp`** (1 min)
7. **Remove unused `tm()` function** (1 min)
