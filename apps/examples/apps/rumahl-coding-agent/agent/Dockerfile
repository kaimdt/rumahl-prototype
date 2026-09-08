# rumahl Coding Agent runtime image.
#
# Contains git + the pi coding agent + productivity extensions. The rumahl app
# spawns one ephemeral container from this image per coding task. Build once
# and reference via the `agent_image` app setting.
#
#   docker build -t rumahl-coding-agent-runtime:latest ./agent
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

RUN mkdir -p /opt/rumahl /workspace

# Agent scripts + project instructions
COPY rumahl-provider.ts /opt/rumahl/rumahl-provider.ts
COPY entrypoint.sh /opt/rumahl/entrypoint.sh
COPY commit-watcher.js /opt/rumahl/commit-watcher.js
COPY AGENTS.md /opt/rumahl/AGENTS.md
RUN chmod +x /opt/rumahl/entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/opt/rumahl/entrypoint.sh"]
