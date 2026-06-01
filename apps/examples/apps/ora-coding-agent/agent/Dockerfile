# ORA Coding Agent runtime image.
#
# Contains git + the pi coding agent + productivity extensions. The IORA app
# spawns one ephemeral container from this image per coding task. Build once
# and reference via the `agent_image` app setting.
#
#   docker build -t ora-coding-agent-runtime:latest ./agent
FROM node:20-bookworm-slim

# git for cloning/pushing, ca-certificates for HTTPS, bash for the entrypoint.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates bash ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install the pi coding agent globally.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# ── pi Extensions (optional productivity tools) ──────────────────────────
# pi-context-tools: context_info + compact_context for token-aware operation
RUN npm install -g --ignore-scripts pi-context-tools 2>/dev/null || true

# pi-codex-goal: create_goal, update_goal, get_goal for multi-step workflows
RUN npm install -g --ignore-scripts pi-codex-goal 2>/dev/null || true

# ── Agent environment ─────────────────────────────────────────────────────
ENV PI_CODING_AGENT_DIR=/opt/pi \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1

RUN mkdir -p /opt/ora /workspace

# Agent scripts + project instructions
COPY ora-provider.ts /opt/ora/ora-provider.ts
COPY entrypoint.sh /opt/ora/entrypoint.sh
COPY commit-watcher.js /opt/ora/commit-watcher.js
COPY AGENTS.md /opt/ora/AGENTS.md
RUN chmod +x /opt/ora/entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/opt/ora/entrypoint.sh"]
