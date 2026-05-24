# IORA Backend Audit Progress

## Status
- **Task:** Bug scan of Rust backend codebase
- **Started:** 2026-05-23
- **Scope:** `iora-os/backend/services/iora-home/src/` and `iora-os/backend/shared/iora-shared/src/`
- **Completed:** 2026-05-23

## Summary
Scanned all `.rs` files in the main service (`iora-home`) and shared library (`iora-shared`). 
Found 22 issues: 3 Critical, 7 High, 7 Medium, 5 Low.

## Key Findings
1. **CRITICAL:** Migration 028 not registered – widget_templates_json column never created
2. **CRITICAL:** Theme `system` column always hardcoded to `false` – system themes can be deleted
3. **CRITICAL:** PostgreSQL code assumption vs SQLite default URL – startup crash on default config
4. **HIGH:** MQTT password stored in plaintext in system_preferences
5. **HIGH:** Hardcoded default JWT secrets (2 different ones)
6. **HIGH:** Multiple `.expect()` and `.unwrap()` calls in production code paths

## Output
Full report written to: `bugs/backend-bugs.md`
