# Multi-stage Dockerfile for all IORA backend services
# Builds all services in one image, then creates individual service images
# Now using Alpine Linux for minimal footprint (~7MB base vs ~120MB Debian)

FROM rust:1.77-alpine AS builder

WORKDIR /app/backend

# Install build dependencies for Alpine.
# - musl-dev / gcc / g++ / make: C/C++ toolchain (some crates ship cc/cmake build scripts)
# - openssl-dev / openssl-libs-static / pkgconfig: openssl-sys / native-tls
# - postgresql-dev: sqlx-postgres native build
# - perl: required by openssl-sys to (re)build openssl from source if needed
# - cmake: a few crates use it transitively
# - git: some build.rs scripts shell out to git for version info
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
    git

# Build arguments for security tokens
ARG IORA_DEVELOPER_APP_TOKEN=dev-token-placeholder
ARG IORA_DEVELOPER_APP_OFFICIAL=false

# Copy the entire backend workspace.
# Listing crates one by one had to be kept in sync with backend/Cargo.toml
# `[workspace] members = [...]` and silently broke the build whenever a new
# crate (e.g. iora-cli, iora-appstore, iora-nginx, iora-network-monitor,
# iora-domain-validator, iora-resource-manager, iora-verify, iora-updater,
# iora-sign, iora-dev-bridge, iora-backup) was added: cargo failed with
# `failed to load manifest for workspace member /app/backend/iora-cli`.
# A blanket COPY is correct (the workspace is self-contained) and resilient.
COPY . .

# Build all release binaries with Developer App token injected at compile time.
# Each package is built individually so a single broken crate doesn't stop
# the rest from being produced — `build-all-images.sh` then extracts only the
# binaries that actually exist and the systemd units use ConditionPathExists
# to skip missing services on first boot. Per-crate stderr is captured to
# /tmp/cargo-build-<svc>.log AND echoed at the end so failures aren't silent.
ENV IORA_DEVELOPER_APP_TOKEN=${IORA_DEVELOPER_APP_TOKEN}
ENV IORA_DEVELOPER_APP_OFFICIAL=${IORA_DEVELOPER_APP_OFFICIAL}
RUN set -eu; \
    failures=""; \
    for svc in iora-core iora-home iora-control iora-assist iora-secrets \
               iora-watchdog iora-security iora-gateway iora-supervisor \
               iora-api iora-appstore iora-backup iora-connector \
               iora-dev-bridge iora-domain-validator iora-files \
               iora-network-monitor iora-nginx iora-resource-manager \
               iora-updater iora-cli iora-sign iora-verify; do \
        echo "==> cargo build -p ${svc}"; \
        if ! cargo build --release -p "${svc}" 2>&1 | tee "/tmp/cargo-build-${svc}.log"; then \
            failures="${failures} ${svc}"; \
            echo "WARNING: ${svc} did not compile — image will still build."; \
        fi; \
    done; \
    if [ -n "${failures}" ]; then \
        echo "================================================================"; \
        echo "BUILD FAILURES:${failures}"; \
        echo "Last 30 lines of each failure log:"; \
        for f in ${failures}; do \
            echo "----- ${f} -----"; \
            tail -n 30 "/tmp/cargo-build-${f}.log" 2>/dev/null || true; \
        done; \
        echo "================================================================"; \
    fi; \
    echo "Built binaries:"; \
    find /app/backend/target -maxdepth 4 -type f -executable \
         \( -path '*/release/iora-*' -o -path '*/release/ora' \) \
         -printf '  %p (%s bytes)\n' 2>/dev/null | sort -u || true

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

# Create iora user
RUN adduser -D -s /sbin/nologin iora

# iora-home service
FROM runtime-base AS iora-home
COPY --from=builder /app/backend/target/release/iora-home /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["/app/iora-home"]

# iora-core service
FROM runtime-base AS iora-core
COPY --from=builder /app/backend/target/release/iora-core /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8090/health || exit 1
CMD ["/app/iora-core"]

# iora-control service
FROM runtime-base AS iora-control
COPY --from=builder /app/backend/target/release/iora-control /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8091/health || exit 1
CMD ["/app/iora-control"]

# iora-assist service
FROM runtime-base AS iora-assist
COPY --from=builder /app/backend/target/release/iora-assist /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8092/health || exit 1
CMD ["/app/iora-assist"]

# iora-secrets service
FROM runtime-base AS iora-secrets
COPY --from=builder /app/backend/target/release/iora-secrets /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8093/health || exit 1
CMD ["/app/iora-secrets"]

# iora-watchdog service
FROM runtime-base AS iora-watchdog
COPY --from=builder /app/backend/target/release/iora-watchdog /app/
RUN chown -R iora:iora /app
USER iora
EXPOSE 8094
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8094/health || exit 1
CMD ["/app/iora-watchdog"]

# iora-security service
FROM runtime-base AS iora-security
COPY --from=builder /app/backend/target/release/iora-security /app/
RUN mkdir -p /var/lib/iora && chown -R iora:iora /var/lib/iora /app
USER iora
EXPOSE 8095
VOLUME ["/var/lib/iora"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8095/health || exit 1
CMD ["/app/iora-security"]

# iora-gateway service
FROM runtime-base AS iora-gateway
COPY --from=builder /app/backend/target/release/iora-gateway /app/
RUN mkdir -p /var/lib/iora && chown -R iora:iora /var/lib/iora /app
USER iora
EXPOSE 8096
VOLUME ["/var/lib/iora"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8096/health || exit 1
CMD ["/app/iora-gateway"]

# iora-supervisor service (requires Docker socket access)
FROM runtime-base AS iora-supervisor
COPY --from=builder /app/backend/target/release/iora-supervisor /app/
# Supervisor runs as root to access Docker socket
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8097/health || exit 1
CMD ["/app/iora-supervisor"]

# iora-developer-app service (Developer Mode tool with exclusive HotReload permission)
FROM runtime-base AS iora-developer-app
COPY --from=builder /app/backend/target/release/iora-developer-app /app/
COPY iora-developer-app/manifest.json /app/manifest.json
RUN mkdir -p /app/data && chown -R iora:iora /app
USER iora
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1
CMD ["/app/iora-developer-app"]
