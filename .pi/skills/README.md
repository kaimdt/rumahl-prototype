# rumahl Skills Directory

Domain-specific instructions for the pi coding agent. Each skill is loaded on-demand
when working in a specific area of the monorepo.

## Available Skills

| Skill | File | When to use |
|---|---|---|
| **rumahl-frontend** | `rumahl-frontend.md` | React/Vite/Tailwind changes, i18n, widget development |
| **rumahl-backend** | `rumahl-backend.md` | Rust/Axum/SQLx changes, API handlers, migrations, permissions |
| **rumahl-security** | `rumahl-security.md` | Security hardening, deployment, Docker, cross-platform fixes |

## Usage
```
/load-skill rumahl-backend    # Load backend rules when working on Rust code
/load-skill rumahl-frontend   # Load frontend rules when working on React code
```

## Design
- Skills are kept OUTSIDE the main AGENTS.md to save tokens
- Each skill is ~1-2KB — loaded only when relevant
- The main AGENTS.md contains only universal critical rules
