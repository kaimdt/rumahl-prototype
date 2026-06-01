#!/usr/bin/env bash
# ORA Coding Agent — container entrypoint.
#
# Clones the target repository, creates a work branch, runs the `pi` coding
# agent in JSON event mode, and commits changes incrementally: after each
# logical step where the agent writes code and explains what it did, an
# individual Git commit is created with a descriptive message extracted from
# the assistant's response. The final set of commits is pushed to the remote.
#
# Structured `ora` events (JSON lines) are printed on stdout; diagnostics and
# git/push logs go to stderr / workspace files.
#
# Required env: TASK_ID, TASK_PROMPT, REPO_URL, BASE_BRANCH, WORK_BRANCH,
#               PI_PROVIDER, PI_MODEL
# Optional env: ORA_BASE_URL, ORA_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
#               GEMINI_API_KEY, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL,
#               WORKSPACE, ORA_EXTENSION_PATH,
#               INCREMENTAL_COMMITS (true/false, default: true),
#               INCREMENTAL_COMMIT_INTERVAL (seconds, default: 30)

set -uo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO_DIR="${WORKSPACE}/repo"
EVENTS_FILE="${WORKSPACE}/pi-events.jsonl"
COMMIT_LOG="${WORKSPACE}/commits.jsonl"
EXTENSION_PATH="${ORA_EXTENSION_PATH:-/opt/ora/ora-provider.ts}"
COMMIT_WATCHER="${COMMIT_WATCHER:-/opt/ora/commit-watcher.js}"

emit() {
  node -e 'process.stdout.write(JSON.stringify({type:"ora",stage:process.argv[1],msg:process.argv[2]})+"\n")' "$1" "${2:-}"
}

fail() {
  emit "error" "$1"
  node -e 'process.stdout.write(JSON.stringify({type:"ora_result",changed:false,summary:process.argv[1]})+"\n")' "$1"
  exit 1
}

mkdir -p "$WORKSPACE"

# --- Clone -----------------------------------------------------------------
emit "clone" "Cloning repository into ${REPO_DIR}"
if ! git clone --quiet "$REPO_URL" "$REPO_DIR" 2>>"${WORKSPACE}/git.log"; then
  fail "git clone failed"
fi
cd "$REPO_DIR" || fail "cannot enter repo directory"

git config user.name "${GIT_AUTHOR_NAME:-ora-bot}" >/dev/null 2>&1
git config user.email "${GIT_AUTHOR_EMAIL:-ora-bot@iora.local}" >/dev/null 2>&1

# --- Branch ----------------------------------------------------------------
emit "branch" "Checking out base '${BASE_BRANCH}' and creating '${WORK_BRANCH}'"
git fetch --quiet origin "$BASE_BRANCH" >/dev/null 2>&1 || true
git checkout --quiet "$BASE_BRANCH" >/dev/null 2>&1 || true
git checkout -B "$WORK_BRANCH" >/dev/null 2>&1 || fail "could not create work branch"

# --- Provider flags --------------------------------------------------------
PI_ARGS=(--mode json --no-session --name "$TASK_ID" --provider "$PI_PROVIDER" --model "$PI_MODEL")
if [ "$PI_PROVIDER" = "ora" ] && [ -f "$EXTENSION_PATH" ]; then
  PI_ARGS+=(-e "$EXTENSION_PATH")
fi

# --- Run pi with incremental commit watcher --------------------------------
emit "agent" "Running pi (${PI_PROVIDER}/${PI_MODEL})"

set +e
if [ "${INCREMENTAL_COMMITS:-true}" = "true" ] && [ -f "$COMMIT_WATCHER" ]; then
  # Incremental mode: pi → commit-watcher (commits per feature-step) → tee → EVENTS_FILE
  emit "agent" "Incremental commit mode active — committing after each feature step"
  pi "${PI_ARGS[@]}" "$TASK_PROMPT" 2>>"${WORKSPACE}/pi.log" \
    | node "$COMMIT_WATCHER" "$REPO_DIR" "$COMMIT_LOG" \
    | tee "$EVENTS_FILE"
  PI_EXIT=${PIPESTATUS[0]}
else
  # Legacy mode: single commit at the end
  pi "${PI_ARGS[@]}" "$TASK_PROMPT" 2>>"${WORKSPACE}/pi.log" | tee "$EVENTS_FILE"
  PI_EXIT=${PIPESTATUS[0]}

  # Single commit of all changes
  git add -A >/dev/null 2>&1
  if git diff --cached --quiet; then
    emit "commit" "No changes produced by the agent"
    node -e 'process.stdout.write(JSON.stringify({type:"ora_result",changed:false,branch:process.argv[1],summary:"The agent finished without code changes."})+"\n")' "$WORK_BRANCH"
    exit "${PI_EXIT:-0}"
  fi
  FILES_CHANGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
  COMMIT_MSG="ora: ${TASK_PROMPT:0:72}"
  git commit --quiet -m "$COMMIT_MSG" >/dev/null 2>&1 || fail "git commit failed"
fi
set -e 2>/dev/null || true

if [ "${PI_EXIT:-1}" -ne 0 ]; then
  emit "agent" "pi exited with code ${PI_EXIT}"
fi

# --- Push ------------------------------------------------------------------
COMMIT_SHA=$(git rev-parse HEAD)
COMMIT_COUNT=$(wc -l < "$COMMIT_LOG" 2>/dev/null | tr -d ' ' || echo "0")
[ -z "$COMMIT_COUNT" ] && COMMIT_COUNT=0

emit "push" "Pushing branch ${WORK_BRANCH} (${COMMIT_COUNT} commits)"
if ! git push --quiet --set-upstream origin "$WORK_BRANCH" >>"${WORKSPACE}/git.log" 2>&1; then
  fail "git push failed (check installation token permissions)"
fi

# --- Summary ---------------------------------------------------------------
FILES_CHANGED=$(git diff --stat "${BASE_BRANCH}...${WORK_BRANCH}" 2>/dev/null | tail -1 | awk '{print $1}' || echo "?")
[ -z "$FILES_CHANGED" ] && FILES_CHANGED="?"

SUMMARY=$(node -e '
  const fs = require("fs");
  try {
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    let text = "";
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      const m = e.message;
      if ((e.type === "message_end" || e.type === "message_update") && m && m.role === "assistant" && Array.isArray(m.content)) {
        const t = m.content.filter(c => c.type === "text").map(c => c.text).join("");
        if (t.trim()) text = t.trim();
      }
    }
    process.stdout.write(text.slice(0, 1500));
  } catch { process.stdout.write(""); }
' "$EVENTS_FILE")
[ -z "$SUMMARY" ] && SUMMARY="The agent applied changes on branch ${WORK_BRANCH} (${COMMIT_COUNT} commits)."

COMMIT_LOG_DATA="[]"
if [ -f "$COMMIT_LOG" ] && [ -s "$COMMIT_LOG" ]; then
  COMMIT_LOG_DATA=$(node -e '
    const fs = require("fs");
    try {
      const lines = fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
      const commits = lines.map(l => JSON.parse(l));
      process.stdout.write(JSON.stringify(commits));
    } catch { process.stdout.write("[]"); }
  ' "$COMMIT_LOG")
fi

node -e '
  const out = {
    type: "ora_result",
    changed: true,
    branch: process.argv[1],
    commitSha: process.argv[2],
    filesChanged: Number(process.argv[3]) || 0,
    summary: process.argv[4],
    commitCount: Number(process.argv[5]) || 0,
    commits: JSON.parse(process.argv[6] || "[]"),
  };
  process.stdout.write(JSON.stringify(out) + "\n");
' "$WORK_BRANCH" "$COMMIT_SHA" "$FILES_CHANGED" "$SUMMARY" "$COMMIT_COUNT" "$COMMIT_LOG_DATA"

exit 0
