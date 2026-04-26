# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json tailwind.config.js components.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Build backend
FROM rust:1.77-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock* ./
COPY backend/src/ src/
COPY backend/migrations/ migrations/
RUN cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy backend binary
COPY --from=backend-build /app/backend/target/release/ha-dashboard-backend .

# Copy frontend dist
COPY --from=frontend-build /app/dist ../dist

# Create data directory for SQLite
RUN mkdir -p data

# Environment variables (override at runtime)
ENV DATABASE_URL=sqlite:./data/ha-dashboard.db
ENV RUST_LOG=info

EXPOSE 3001

VOLUME ["/app/backend/data"]

CMD ["./ha-dashboard-backend"]
