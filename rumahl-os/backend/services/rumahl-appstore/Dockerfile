# rumahl App Store - Alpine Linux
# Minimal footprint for Raspberry Pi compatibility

FROM rust:1.77-alpine as builder

WORKDIR /app

# Install build dependencies for Alpine
RUN apk add --no-cache \
    musl-dev \
    openssl-dev \
    openssl-libs-static \
    pkgconfig

# Copy workspace files
COPY backend/rumahl-shared backend/rumahl-shared
COPY backend/rumahl-appstore backend/rumahl-appstore

# Build the application
WORKDIR /app/backend/rumahl-appstore
RUN cargo build --release

# Runtime stage - Alpine Linux (~7MB base vs ~120MB Debian)
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    libgcc \
    libssl3

WORKDIR /app

COPY --from=builder /app/backend/rumahl-appstore/target/release/rumahl-appstore /app/rumahl-appstore

ENV PORT=8098
ENV RUST_LOG=info

EXPOSE 8098

CMD ["/app/rumahl-appstore"]
