# rumahl Account

Central identity service for `account.rumahl.com`, rumahl Appstore, rumahl Developers, and private package registries.

## Initial API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health |
| `POST` | `/v1/auth/register` | Register and establish a browser session |
| `POST` | `/v1/auth/login` | Authenticate and establish a browser session |
| `POST` | `/v1/auth/logout` | Revoke the current session |
| `GET` | `/v1/account` | Read the authenticated account |

Passwords are hashed with bcrypt. Browser sessions use random opaque credentials; only SHA-256 digests are stored. The shared cookie domain is `.rumahl.com`, allowing the future Appstore and Developer frontends to use the central session through their backends.

## Configuration

- `ACCOUNT_DATABASE_URL` (required): PostgreSQL connection URL.
- `ACCOUNT_BIND`: bind address, default `0.0.0.0:8110`.
- `ACCOUNT_COOKIE_DOMAIN`: cookie domain, default `.rumahl.com`.
- `ACCOUNT_SECURE_COOKIES`: set to `false` only for local HTTP development.
- `ACCOUNT_SESSION_DAYS`: session lifetime, default `30`.

The first migration also reserves normalized organization membership, scoped registry credentials, and immutable audit events for subsequent phases. Registry credentials must never reuse browser session tokens.
