# ORA Coding Agent runtime image.
#
# Contains git + the pi coding agent. The IORA app spawns one ephemeral
# container from this image per coding task. Build it once and reference it via
# the `agent_image` app setting (default: ora-coding-agent-runtime:latest).
#
#   docker build -t ora-coding-agent-runtime:latest ./agent
FROM node:20-bookworm-slim

# git for cloning/pushing, ca-certificates for HTTPS, bash for the entrypoint.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

# Install the pi coding agent globally. --ignore-scripts per pi's guidance.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# pi config dir inside the container.
ENV PI_CODING_AGENT_DIR=/opt/pi \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1

RUN mkdir -p /opt/ora /workspace
COPY ora-provider.ts /opt/ora/ora-provider.ts
COPY entrypoint.sh /opt/ora/entrypoint.sh
COPY commit-watcher.js /opt/ora/commit-watcher.js
RUN chmod +x /opt/ora/entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/opt/ora/entrypoint.sh"]
