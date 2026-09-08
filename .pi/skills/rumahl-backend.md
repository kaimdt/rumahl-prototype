# rumahl Backend Skill

You are working on the rumahl Rust backend (Axum + SQLx + Tokio).

## Structure
- `rumahl-os/backend/shared/rumahl-shared/src/` — Shared types, traits, permissions
- `rumahl-os/backend/services/rumahl-home/src/` — Main API (12k+ line main.rs)
- `rumahl-os/backend/services/rumahl-assist/src/` — AI/Ora Assist service
- `rumahl-os/backend/services/rumahl-core/src/` — Service discovery, registry
- `rumahl-os/backend/services/rumahl-supervisor/src/` — Docker management
- `rumahl-os/backend/services/rumahl-connector/src/` — Cloud tunnel connector

## CRITICAL: main.rs
- **NEVER read main.rs completely** (12k+ lines). Use targeted grep/read.
- New routes are registered in the router chain in `main()`.
- Each handler module is in a separate file (e.g., `app_storage_handler.rs`).

## Standard Workflow (new feature)
1. Define types in `rumahl-shared/src/`
2. Write handler in `rumahl-home/src/<name>_handler.rs`
3. Register route in `main.rs` (targeted edit)
4. Create SQL migration in `migrations/` (new file, sequential number)

## Permissions
- Enum: `Permission` in `rumahl-shared/src/permissions.rs`
- Each new permission needs: variant, description, risk level, plugin allowance
- Check `is_plugin_allowed()`, `requires_user_consent()`, `requires_developer_mode()`

## Build & Test
```bash
cargo build -p rumahl-home                        # build main service
cargo test -p rumahl-shared --lib                 # run shared tests
cargo test --workspace                          # all tests
cargo check -p rumahl-assist                      # fast check (no binary)
```

## Migrations
- Located in `rumahl-os/backend/services/rumahl-home/migrations/`
- NEVER modify existing migrations — always create new sequential files
- Naming: `###_description.sql` (e.g., `032_add_new_table.sql`)

## API Documentation
- Swagger UI: `http://localhost:3001/api/docs`
- Ports: 3001 (dev) / 8126 (prod), 8090 (core), 8092 (assist), 8097 (supervisor)
