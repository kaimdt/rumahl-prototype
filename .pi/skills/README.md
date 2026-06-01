# IORA Skills Directory

Domain-specific instructions for the pi coding agent. Each skill is loaded on-demand
when working in a specific area of the monorepo.

## Available Skills

| Skill | File | When to use |
|---|---|---|
| **iora-frontend** | `iora-frontend.md` | React/Vite/Tailwind changes, i18n, widget development |
| **iora-backend** | `iora-backend.md` | Rust/Axum/SQLx changes, API handlers, migrations, permissions |
| **iora-security** | `iora-security.md` | Security hardening, deployment, Docker, cross-platform fixes |

## Usage
```
/load-skill iora-backend    # Load backend rules when working on Rust code
/load-skill iora-frontend   # Load frontend rules when working on React code
```

## Design
- Skills are kept OUTSIDE the main AGENTS.md to save tokens
- Each skill is ~1-2KB — loaded only when relevant
- The main AGENTS.md contains only universal critical rules
