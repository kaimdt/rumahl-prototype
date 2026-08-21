# Multi-stage Dockerfile for all rumahl backend services
# Builds all services in one image, then creates individual service images
# Now using Alpine Linux for minimal footprint (~7MB base vs ~120MB Debian)

# Several workspace deps require recent rustc:
#   - edition2024 (stabilized in Rust 1.85): home, time-core, clap_lex, base64ct, …
#   - rustc 1.89: async-graphql 7.2.1, asynk-strim 0.1.5 (pulled by rumahl-api)
# The host VM ships rustc 1.95 (Apr 2026); pick a base that comfortably covers
# all current MSRVs. Bump if a future dep raises the floor further.
FROM rust:1.90-alpine AS builder

WORKDIR /app/backend

# Install build dependencies for Alpine.
# - musl-dev / gcc / g++ / make: C/C++ toolchain (some crates ship cc/cmake build scripts)
# - openssl-dev / openssl-libs-static / pkgconfig: openssl-sys / native-tls
# - postgresql-dev: sqlx-postgres native build
# - perl: required by openssl-sys to (re)build openssl from source if needed
# - cmake: a few crates use it transitively
# - git: some build.rs scripts shell out to git for version info
# - curl: utoipa-swagger-ui build.rs downloads swagger-ui zip via system curl
#         when the optional `reqwest` cargo feature isn't enabled
RUN apk add --no-cache \
    musl-dev \
    gcc \
    g++ \
    make \
    openssl-dev \
    openssl-libs-static \
    pkgconfig \
    postgresql-dev \
    perl \
    cmake \
    git \
    curl \
    sccache

# Build arguments for security tokens
ARG rumahl_DEVELOPER_APP_TOKEN=dev-token-placeholder
ARG rumahl_DEVELOPER_APP_OFFICIAL=false

# sccache – Rust compiler cache, persisted across Docker builds via BuildKit
# mount.  Falls back to no-op if sccache is not installed (Apk below may lag).
ARG SCCACHE_DIR=/sccache

# Copy the entire backend workspace.
# Listing crates one by one had to be kept in sync with backend/Cargo.toml
# `[workspace] members = [...]` and silently broke the build whenever a new
# crate (e.g. rumahl-cli, rumahl-appstore, rumahl-nginx, rumahl-network-monitor,
# rumahl-domain-validator, rumahl-resource-manager, rumahl-verify, rumahl-updater,
# rumahl-sign, rumahl-dev-bridge, rumahl-backup) was added: cargo failed with
# `failed to load manifest for workspace member /app/backend/rumahl-cli`.
# A blanket COPY is correct (the workspace is self-contained) and resilient.
COPY . .

# Build all release binaries with Developer App token injected at compile time.
# Each package is built individually so a single broken crate doesn't stop
# the rest from being produced — `build-all-images.sh` then extracts only the
# binaries that actually exist and the systemd units use ConditionPathExists
# to skip missing services on first boot. Per-crate stderr is captured to
# /tmp/cargo-build-<svc>.log AND echoed at the end so failures aren't silent.
ENV rumahl_DEVELOPER_APP_TOKEN=${rumahl_DEVELOPER_APP_TOKEN}
ENV rumahl_DEVELOPER_APP_OFFICIAL=${rumahl_DEVELOPER_APP_OFFICIAL}
# BuildKit cache mounts: persist cargo's registry/git index AND target/
# between docker builds. On a no-source-change rebuild every cargo invocation
# becomes a near-no-op (~seconds instead of minutes per crate). The mounts
# require BuildKit (DOCKER_BUILDKIT=1) which is the default on modern Docker
# and is what build-all-images.sh already uses via --progress=plain.
# Cache id is shared across all 23 crates so they reuse one another's deps.
RUN --mount=type=cache,id=rumahl-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=rumahl-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=rumahl-cargo-target,target=/app/backend/target,sharing=locked \
    --mount=type=cache,id=rumahl-sccache,target=/sccache,sharing=locked \
    set -eu; \
    export RUSTC_WRAPPER="sccache"; \
    failures=""; \
    for svc in rumahl-core rumahl-home rumahl-control rumahl-assist rumahl-secrets \
               rumahl-watchdog rumahl-security rumahl-gateway rumahl-supervisor \
               rumahl-api rumahl-appstore rumahl-backup rumahl-connector \
               rumahl-dev-bridge rumahl-domain-validator rumahl-files \
               rumahl-network-monitor rumahl-nginx rumahl-resource-manager \
               rumahl-updater rumahl-developer-app rumahl-intelligence \
               rumahl-cli rumahl-sign rumahl-verify; do \
        echo "==> cargo build -p ${svc}"; \
        # Use plain redirection (not |tee) so the if-check sees cargo's
        # actual exit code, not tee's (which is always 0). Echo the log
        # tail on failure so the BuildKit log shows the error.
        if cargo build --release -p "${svc}" >"/tmp/cargo-build-${svc}.log" 2>&1; then \
            tail -n 2 "/tmp/cargo-build-${svc}.log" || true; \
        else \
            failures="${failures} ${svc}"; \
            echo "WARNING: ${svc} did not compile — last 30 lines:"; \
            tail -n 30 "/tmp/cargo-build-${svc}.log" 2>/dev/null || true; \
        fi; \
    done; \
    if [ -n "${failures}" ]; then \
        echo "================================================================"; \
        echo "BUILD FAILURES:${failures}"; \
        echo "================================================================"; \
    fi; \
    # Copy produced binaries OUT of the target/ cache mount into a persistent \
    # /out/ directory in the image layer. Cache mounts are scratch — without \
    # this step every binary would vanish the moment RUN exits and the \
    # extraction in build-all-images.sh would find nothing. \
    mkdir -p /out; \
    for svc in rumahl-core rumahl-home rumahl-control rumahl-assist rumahl-secrets \
               rumahl-watchdog rumahl-security rumahl-gateway rumahl-supervisor \
               rumahl-api rumahl-appstore rumahl-backup rumahl-connector \
               rumahl-dev-bridge rumahl-domain-validator rumahl-files \
               rumahl-network-monitor rumahl-nginx rumahl-resource-manager \
               rumahl-updater rumahl-developer-app rumahl-intelligence \
               rumahl-cli rumahl-sign rumahl-verify ora; do \
        for src in "/app/backend/target/release/${svc}" \
                   "/app/backend/target/x86_64-unknown-linux-musl/release/${svc}"; do \
            if [ -x "${src}" ]; then cp "${src}" "/out/${svc}"; break; fi; \
        done; \
    done; \
    echo "Built binaries (persisted to /out):"; \
    ls -la /out 2>/dev/null | sed 's/^/  /' || true

# Runtime base image - Alpine Linux for minimal footprint
FROM alpine:3.19 AS runtime-base

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    libgcc \
    libssl3 \
    libpq \
    curl

WORKDIR /app

# Create rumahl user
RUN adduser -D -s /sbin/nologin rumahl

# rumahl-home service
FROM runtime-base AS rumahl-home
COPY --from=builder /out/rumahl-home /app/rumahl-home
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["/app/rumahl-home"]

# rumahl-core service
FROM runtime-base AS rumahl-core
COPY --from=builder /out/rumahl-core /app/rumahl-core
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8090/health || exit 1
CMD ["/app/rumahl-core"]

# rumahl-control service
FROM runtime-base AS rumahl-control
COPY --from=builder /out/rumahl-control /app/rumahl-control
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8091/health || exit 1
CMD ["/app/rumahl-control"]

# rumahl-assist service
FROM runtime-base AS rumahl-assist
COPY --from=builder /out/rumahl-assist /app/rumahl-assist
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8092/health || exit 1
CMD ["/app/rumahl-assist"]

# rumahl-secrets service
FROM runtime-base AS rumahl-secrets
COPY --from=builder /out/rumahl-secrets /app/rumahl-secrets
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8093/health || exit 1
CMD ["/app/rumahl-secrets"]

# rumahl-watchdog service
FROM runtime-base AS rumahl-watchdog
COPY --from=builder /out/rumahl-watchdog /app/rumahl-watchdog
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8094
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8094/health || exit 1
CMD ["/app/rumahl-watchdog"]

# rumahl-security service
FROM runtime-base AS rumahl-security
COPY --from=builder /out/rumahl-security /app/rumahl-security
RUN mkdir -p /var/lib/rumahl && chown -R rumahl:rumahl /var/lib/rumahl /app
USER rumahl
EXPOSE 8095
VOLUME ["/var/lib/rumahl"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8095/health || exit 1
CMD ["/app/rumahl-security"]

# rumahl-gateway service
FROM runtime-base AS rumahl-gateway
COPY --from=builder /out/rumahl-gateway /app/rumahl-gateway
RUN mkdir -p /var/lib/rumahl && chown -R rumahl:rumahl /var/lib/rumahl /app
USER rumahl
EXPOSE 8096
VOLUME ["/var/lib/rumahl"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8096/health || exit 1
CMD ["/app/rumahl-gateway"]

# rumahl-supervisor service (requires Docker socket access)
FROM runtime-base AS rumahl-supervisor
COPY --from=builder /out/rumahl-supervisor /app/rumahl-supervisor
# Supervisor runs as root to access Docker socket
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8097/health || exit 1
CMD ["/app/rumahl-supervisor"]

# rumahl-developer-app service (Developer Mode tool with exclusive HotReload permission)
FROM runtime-base AS rumahl-developer-app
COPY --from=builder /out/rumahl-developer-app /app/rumahl-developer-app
COPY rumahl-developer-app/manifest.json /app/manifest.json
RUN mkdir -p /app/data && chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1
CMD ["/app/rumahl-developer-app"]

# ═══════════════════════════════════════════════════════════════════
# rumahl-dev-bridge — DEV IMAGES ONLY — ROOT — NO SECURITY
# ═══════════════════════════════════════════════════════════════════
# This container MUST run as root with:
#   - Docker socket mounted (/var/run/docker.sock)
#   - Host PID namespace (pid: host) for systemctl access
#   - Privileged mode or SYS_ADMIN, NET_ADMIN capabilities
#   - Host network or port 8101 exposed
FROM runtime-base AS rumahl-dev-bridge
COPY --from=builder /out/rumahl-dev-bridge /app/rumahl-dev-bridge
# Root required for: binary replacement, systemctl, docker compose
USER root
EXPOSE 8101
# No healthcheck — the bridge health endpoint is /dev/health (public)
HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
    CMD curl -f http://localhost:8101/dev/health || exit 1
CMD ["/app/rumahl-dev-bridge", "--listen", "0.0.0.0:8101"]

# ═══════════════════════════════════════════════════════════════════
# Additional rumahl services
# ═══════════════════════════════════════════════════════════════════

# rumahl-appstore – App marketplace and local store
FROM runtime-base AS rumahl-appstore
COPY --from=builder /out/rumahl-appstore /app/rumahl-appstore
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8098
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8098/health || exit 1
CMD ["/app/rumahl-appstore"]

# rumahl-backup – Backup & Restore
FROM runtime-base AS rumahl-backup
COPY --from=builder /out/rumahl-backup /app/rumahl-backup
RUN mkdir -p /var/lib/rumahl/backups && chown -R rumahl:rumahl /var/lib/rumahl /app
USER rumahl
EXPOSE 8100
VOLUME ["/var/lib/rumahl/backups"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1
CMD ["/app/rumahl-backup"]

# rumahl-api – REST + WebSocket API Gateway
FROM runtime-base AS rumahl-api
COPY --from=builder /out/rumahl-api /app/rumahl-api
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8101
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8101/health || exit 1
CMD ["/app/rumahl-api"]

# rumahl-files – File sharing service
FROM runtime-base AS rumahl-files
COPY --from=builder /out/rumahl-files /app/rumahl-files
RUN mkdir -p /var/lib/rumahl/files && chown -R rumahl:rumahl /var/lib/rumahl /app
USER rumahl
EXPOSE 8102
VOLUME ["/var/lib/rumahl/files"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8102/health || exit 1
CMD ["/app/rumahl-files"]

# rumahl-updater – Update manager (RAUC integration)
FROM runtime-base AS rumahl-updater
COPY --from=builder /out/rumahl-updater /app/rumahl-updater
RUN chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 8103
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8103/health || exit 1
CMD ["/app/rumahl-updater"]

# rumahl-connector – Remote connectivity (Tailscale/ZeroTier)
FROM runtime-base AS rumahl-connector
COPY --from=builder /out/rumahl-connector /app/rumahl-connector
# Needs network capabilities for VPN/tunnel setup
USER root
EXPOSE 8104
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8104/health || exit 1
CMD ["/app/rumahl-connector"]

# rumahl-nginx – Reverse proxy
FROM runtime-base AS rumahl-nginx
COPY --from=builder /out/rumahl-nginx /app/rumahl-nginx
RUN mkdir -p /etc/nginx/certs && chown -R rumahl:rumahl /app
USER rumahl
EXPOSE 80 443
VOLUME ["/etc/nginx/certs"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/health || exit 1
CMD ["/app/rumahl-nginx"]

# rumahl-network-monitor – Network scanner
FROM runtime-base AS rumahl-network-monitor
COPY --from=builder /out/rumahl-network-monitor /app/rumahl-network-monitor
# Network scanner needs raw socket access
USER root
EXPOSE 8105
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8105/health || exit 1
CMD ["/app/rumahl-network-monitor"]

# rumahl-intelligence – AI-powered system analysis
FROM runtime-base AS rumahl-intelligence
COPY --from=builder /out/rumahl-intelligence /app/rumahl-intelligence
RUN mkdir -p /var/lib/rumahl && chown -R rumahl:rumahl /var/lib/rumahl /app
USER rumahl
EXPOSE 8099
VOLUME ["/var/lib/rumahl"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1
CMD ["/app/rumahl-intelligence"]
