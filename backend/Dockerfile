# Multi-stage Dockerfile for all IORA backend services
# Builds all services in one image, then creates individual service images

FROM rust:1.77-bookworm AS builder

WORKDIR /app/backend

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY iora-shared ./iora-shared
COPY iora-home ./iora-home
COPY iora-core ./iora-core
COPY iora-control ./iora-control
COPY iora-assist ./iora-assist
COPY iora-secrets ./iora-secrets
COPY iora-watchdog ./iora-watchdog
COPY iora-security ./iora-security
COPY iora-gateway ./iora-gateway
COPY iora-files ./iora-files
COPY iora-connector ./iora-connector
COPY iora-api ./iora-api
COPY iora-installer ./iora-installer
COPY iora-supervisor ./iora-supervisor
COPY iora-developer-app ./iora-developer-app

# Build all release binaries
RUN cargo build --release --workspace

# Runtime base image
FROM debian:bookworm-slim AS runtime-base

RUN apt-get update && \
    apt-get install -y \
        ca-certificates \
        libssl3 \
        libpq5 \
        && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create iora user
RUN useradd -r -s /bin/false iora

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
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/backend/target/release/iora-supervisor /app/
# Supervisor runs as root to access Docker socket
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8097/health || exit 1
CMD ["/app/iora-supervisor"]

# iora-developer-app service (Developer Mode tool with exclusive HotReload permission)
FROM runtime-base AS iora-developer-app
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/backend/target/release/iora-developer-app /app/
COPY iora-developer-app/manifest.json /app/manifest.json
RUN mkdir -p /app/data && chown -R iora:iora /app
USER iora
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1
CMD ["/app/iora-developer-app"]
