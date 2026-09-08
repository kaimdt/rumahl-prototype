# rumahl Backup Service - Alpine Linux
# Minimal footprint for Raspberry Pi compatibility

FROM rust:1.77-alpine as builder

WORKDIR /app

# Install build dependencies for Alpine
RUN apk add --no-cache \
    musl-dev \
    openssl-dev \
    openssl-libs-static \
    pkgconfig \
    postgresql-dev

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY rumahl-shared ./rumahl-shared
COPY rumahl-backup ./rumahl-backup

# Build the application
RUN cargo build --release --package rumahl-backup

# Runtime stage - Alpine Linux (~7MB base vs ~120MB Debian)
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    libgcc \
    libssl3 \
    libpq \
    postgresql-client \
    curl \
    tar \
    gzip

# Copy the binary
COPY --from=builder /app/target/release/rumahl-backup /usr/local/bin/rumahl-backup

# Create backup directory
RUN mkdir -p /var/lib/rumahl/backups

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1

EXPOSE 8100

CMD ["rumahl-backup"]
