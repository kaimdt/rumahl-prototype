# deploy/

Docker Compose stacks and adjacent deployment helpers.

> **Status:** Legacy — these compose files predate the IORA OS migration and
> still reference the old top-level `backend/` layout. The canonical build is
> `iora-os/build-all-images.sh`, which produces the buildroot images directly
> and does not use docker-compose.
>
> Keep these files for ad-hoc local Postgres + service smoke-tests, but expect
> path adjustments before they run on the new layout
> (`backend/...` → `../iora-os/backend/services/...`).

## Files

- `docker-compose.yml` — full stack (Postgres + every iora-* service).
- `docker-compose.iora-os.yml` — minimal IORA OS subset.
- `docker-compose.minimal.yml` — Postgres + core services only.
- `init-postgres.sh` — Postgres entrypoint init (DB + user creation).
- `.dockerignore` — context exclusions for the (legacy) root build.

The frontend `Dockerfile` lives in [`../frontend/Dockerfile`](../frontend/Dockerfile)
because the React/Vite build context is `frontend/`.
