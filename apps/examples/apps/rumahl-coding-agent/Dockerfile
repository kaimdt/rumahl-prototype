# rumahl Coding Agent — app container.
#
# Runs the Express server (GitHub webhook + REST API + UI) and orchestrates
# agent runs. In `docker` runner mode it talks to the host Docker socket to
# spawn ephemeral agent containers; in `local` mode it runs the agent inline
# (requires git + pi in this image, see the commented block below).
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# --- Optional: enable `local` runner mode -----------------------------------
# Uncomment to run the agent inside this container instead of spawning Docker
# containers (useful where no Docker socket is available):
# RUN apt-get update && apt-get install -y --no-install-recommends git bash ca-certificates \
#     && rm -rf /var/lib/apt/lists/* \
#     && npm install -g --ignore-scripts @earendil-works/pi-coding-agent

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

EXPOSE 3000
CMD ["node", "server.js"]
