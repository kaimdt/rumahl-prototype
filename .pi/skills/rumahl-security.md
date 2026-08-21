# rumahl Security & Deployment Skill

You are working on rumahl security hardening, deployment, or DevOps tasks.

## Security Rules
- **Path traversal**: Always canonicalize user-supplied paths. Use `.canonicalize()` + `starts_with(base_dir)`.
- **SQL injection**: Never split SQL by raw `;`. Use quote-aware parsers (see `split_sql_statements` in rumahl-core).
- **XSS**: Never use `dangerouslySetInnerHTML` without DOMPurify sanitization.
- **Command injection**: Never pass user input directly to `Command::new().arg()`. Validate and sanitize.

## Backup Enforcement
- Before destructive operations: create `.bak.{YYYYMMDD}` copy
- Backup files must NOT be committed to git
- Never use `git clean -fd` or `git reset --hard` without explicit permission

## Deployment
- `deploy/docker-compose.yml` — Standard Docker Compose
- `deploy/docker-compose.minimal.yml` — Minimal deployment
- `rumahl-os/dev-local.ps1` / `.sh` — Local dev VM scripts
- Services use systemd in rumahl OS appliance mode

## Port Map
| Service | Dev | Prod |
|---|---|---|
| rumahl-home | 3001 | 8126 |
| rumahl-core | 8090 | 8090 |
| rumahl-assist | 8092 | 8092 |
| rumahl-supervisor | 8097 | 8097 |
| rumahl-appstore | 8098 | 8098 |

## Dependency Management
- NEVER add new crates to Cargo.toml without asking
- Pin `libsqlite3-sys` in workspace Cargo.toml
- Check for version conflicts with `cargo tree -d`

## Cross-Platform
- Paths: use `std::path::PathBuf`, not hardcoded `/` or `\`
- macOS: `/var` canonicalizes to `/private/var` — always canonicalize both sides
- Windows: raw terminal mode fixes in `rumahl-dev-watch`
