# Builder stage
FROM rust:1.77-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache \
    musl-dev \
    openssl-dev \
    openssl-libs-static \
    pkgconfig

# Copy manifests
COPY Cargo.toml ./
COPY src ./src

# Build the application
RUN cargo build --release

# Runtime stage - Alpine Linux for Raspberry Pi compatibility
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    libgcc \
    libssl3 \
    ca-certificates \
    curl

# Copy binary from builder
COPY --from=builder /build/target/release/rumahl-developer-app /app/rumahl-developer-app

# Copy manifest
COPY manifest.json /app/manifest.json

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV RUST_LOG=info
ENV PORT=8099

EXPOSE 8099

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1

CMD ["/app/rumahl-developer-app"]
