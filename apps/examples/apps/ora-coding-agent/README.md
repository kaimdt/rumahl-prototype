# ORA Coding Agent

An IORA app that closes the gap between **GitHub** and **IORA Assist** for
agentic coding. It has two elementary parts that work together:

1. **GitHub Bot** — a GitHub App webhook receiver. When you mention the bot
   (e.g. `@ora`) in a Pull Request comment, it spins up an isolated container,
   clones the repo, runs the [`pi`](https://pi.dev) coding agent (powered by
   IORA Assist / ORA AI or an external provider), commits the result, pushes a
   branch and reports back on the PR.
2. **The App UI** — a GitHub-Copilot-style interface where you start agentic
   coding tasks directly, watch live agent activity, and review the result.

```
GitHub PR comment "@ora ..."  ─┐
                               ├─►  ORA Coding Agent (this app)
App UI "New task" ─────────────┘          │
                                          ▼
                          spawn isolated container (pi + git)
                                          │
                       clone → branch → pi runs → commit → push
                                          │
                       comment back on PR / show result in UI
```

## Architecture

| File | Purpose |
|------|---------|
| `server.js` | Express server: GitHub webhook, REST API, SSE log stream, static UI |
| `src/config.js` | Settings loader (from env injected by IORA settings) |
| `src/github.js` | GitHub App auth (JWT → installation token), webhook signature check, PR comments |
| `src/store.js` | File-backed task store + live event emitter |
| `src/runner.js` | Concurrency-limited queue; runs the agent in Docker or locally |
| `agent/Dockerfile` | Runtime image for the agent (git + pi) |
| `agent/entrypoint.sh` | Clone → branch → run pi → commit → push → emit result |
| `agent/ora-provider.ts` | pi extension registering ORA AI as an OpenAI-compatible provider |
| `public/` | Copilot-like web UI (vanilla JS) |

The agent runtime is **pi** (`@earendil-works/pi-coding-agent`). It is run
headless with `pi --mode json` so every step (tool calls, messages) streams as
JSON and is shown live in the UI and the GitHub status.

## Providers

- **ORA AI** (default): pi loads `agent/ora-provider.ts` which registers an
  `ora` provider pointing at IORA Assist's OpenAI-compatible endpoint
  (`ORA_BASE_URL`, default `http://iora-assist:8092/v1`).
- **External**: `anthropic`, `openai`, `google` — handled natively by pi via the
  matching API-key settings (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_API_KEY`).

Choose the default in app settings, or per task in the UI.

## Setup

### 1. Create the GitHub App
Create a GitHub App (Settings → Developer settings → GitHub Apps) with:

- **Webhook URL**: a public URL that reaches this app's `/webhook/github`
  (see "Webhook reachability" below).
- **Webhook secret**: any strong secret — paste the same value into the app
  setting *GitHub Webhook Secret*.
- **Permissions**: Repository → *Contents: Read & write*, *Pull requests: Read &
  write*, *Issues: Read & write*, *Metadata: Read-only*.
- **Subscribe to events**: *Issue comment*, *Pull request*, *Pull request review
  comment*.
- Generate a **private key** (PEM) and copy the **App ID**.
- **Install** the App on the target repositories.

Fill the app settings: `GitHub App ID`, `GitHub App Private Key (PEM)`,
`GitHub Webhook Secret`, and (optionally) a default installation id.

### 2. Webhook reachability (you configure this)
GitHub must reach this app from the internet. Expose `/webhook/github`
through whatever you already use, e.g.:

- Tailscale Funnel / Cloudflare Tunnel to `ora-coding-agent:3000`
- A public reverse proxy / the IORA gateway with a public hostname

Point the GitHub App **Webhook URL** at `https://<your-host>/webhook/github`.

### 3. Build the agent runtime image
```bash
cd agent
docker build -t ora-coding-agent-runtime:latest .
```
Reference it via the `agent_image` setting (default
`ora-coding-agent-runtime:latest`).

### 4. Install the app in IORA
```bash
# Package
zip -r ora-coding-agent.zip manifest.json package.json server.js src public agent Dockerfile README.md

# Install via CLI
ora app install ora-coding-agent.zip
# or via API
curl -X POST http://localhost:8126/api/appstore/install \
  -H "Authorization: Bearer $API_KEY" -F "file=@ora-coding-agent.zip"
```

> The `AgentContainerSpawn` permission (declared in the manifest) grants the app
> the right to create ephemeral agent containers. In `docker` runner mode the
> app needs access to the Docker socket — the manifest mounts
> `/var/run/docker.sock`. Review this carefully before granting.

## Usage

### From GitHub
Comment on a pull request:
```
@ora add unit tests for the parser and fix the off-by-one in tokenize()
```
The bot reacts with 👀, runs the agent, pushes a branch, and replies with a
summary and the branch/PR link.

### From the app
Open **ORA Coding Agent** in the IORA navigation → **New task** → pick a repo,
base branch, provider/model, describe the task, and **Start agent**. Watch the
live activity stream and open the resulting branch.

## Runner modes
- `docker` (default): each task runs in a fresh, isolated container from
  `agent_image`. Recommended.
- `local`: the agent runs inside the app container (needs `git` + `pi` — see the
  commented block in the app `Dockerfile`). Intended for development/testing
  where no Docker socket is available.

## Security notes
- Webhook payloads are verified with HMAC-SHA256 against the webhook secret.
- Installation tokens are short-lived and scoped to the installation; they are
  embedded only in the agent container's clone URL for the duration of the run.
- The agent runs untrusted model output — keep it in `docker` mode so it is
  isolated from the rest of the IORA stack.
