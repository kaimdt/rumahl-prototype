FROM rust:1.75-slim as builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY backend/iora-shared backend/iora-shared
COPY backend/iora-appstore backend/iora-appstore

# Build the application
WORKDIR /app/backend/iora-appstore
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/backend/iora-appstore/target/release/iora-appstore /app/iora-appstore

ENV PORT=8098
ENV RUST_LOG=info

EXPOSE 8098

CMD ["/app/iora-appstore"]
