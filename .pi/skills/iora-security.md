# IORA Security & Deployment Skill

You are working on IORA security hardening, deployment, or DevOps tasks.

## Security Rules
- **Path traversal**: Always canonicalize user-supplied paths. Use `.canonicalize()` + `starts_with(base_dir)`.
- **SQL injection**: Never split SQL by raw `;`. Use quote-aware parsers (see `split_sql_statements` in iora-core).
- **XSS**: Never use `dangerouslySetInnerHTML` without DOMPurify sanitization.
- **Command injection**: Never pass user input directly to `Command::new().arg()`. Validate and sanitize.

## Backup Enforcement
- Before destructive operations: create `.bak.{YYYYMMDD}` copy
- Backup files must NOT be committed to git
- Never use `git clean -fd` or `git reset --hard` without explicit permission

## Deployment
- `deploy/docker-compose.yml` — Standard Docker Compose
- `deploy/docker-compose.minimal.yml` — Minimal deployment
- `iora-os/dev-local.ps1` / `.sh` — Local dev VM scripts
- Services use systemd in IORA OS appliance mode

## Port Map
| Service | Dev | Prod |
|---|---|---|
| iora-home | 3001 | 8126 |
| iora-core | 8090 | 8090 |
| iora-assist | 8092 | 8092 |
| iora-supervisor | 8097 | 8097 |
| iora-appstore | 8098 | 8098 |

## Dependency Management
- NEVER add new crates to Cargo.toml without asking
- Pin `libsqlite3-sys` in workspace Cargo.toml
- Check for version conflicts with `cargo tree -d`

## Cross-Platform
- Paths: use `std::path::PathBuf`, not hardcoded `/` or `\`
- macOS: `/var` canonicalizes to `/private/var` — always canonicalize both sides
- Windows: raw terminal mode fixes in `iora-dev-watch`
