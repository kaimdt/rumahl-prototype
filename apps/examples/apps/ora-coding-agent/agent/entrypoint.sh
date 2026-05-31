#!/usr/bin/env bash
# ORA Coding Agent — container entrypoint.
#
# Clones the target repository, creates a work branch, runs the `pi` coding
# agent in JSON event mode (powered by IORA Assist or an external provider),
# commits and pushes the result, and prints structured `ora` events on stdout
# that the IORA app parses. All log/diagnostic text goes to stderr.
#
# Required env: TASK_ID, TASK_PROMPT, REPO_URL, BASE_BRANCH, WORK_BRANCH,
#               PI_PROVIDER, PI_MODEL
# Optional env: ORA_BASE_URL, ORA_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
#               GEMINI_API_KEY, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL,
#               WORKSPACE, ORA_EXTENSION_PATH

set -uo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO_DIR="${WORKSPACE}/repo"
EVENTS_FILE="${WORKSPACE}/pi-events.jsonl"
EXTENSION_PATH="${ORA_EXTENSION_PATH:-/opt/ora/ora-provider.ts}"

# Emit a structured ORA event as a single JSON line on stdout.
emit() {
  # $1 = stage, $2 = message
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

# --- Run pi ----------------------------------------------------------------
emit "agent" "Running pi (${PI_PROVIDER}/${PI_MODEL})"
# Forward pi's JSON events to our stdout AND keep a copy for summary extraction.
# pi diagnostics go to stderr which the IORA app captures separately.
set +e
pi "${PI_ARGS[@]}" "$TASK_PROMPT" 2>>"${WORKSPACE}/pi.log" | tee "$EVENTS_FILE"
PI_EXIT=${PIPESTATUS[0]}
set -e 2>/dev/null || true

if [ "${PI_EXIT:-1}" -ne 0 ]; then
  emit "agent" "pi exited with code ${PI_EXIT}"
fi

# --- Commit & push ---------------------------------------------------------
git add -A >/dev/null 2>&1
if git diff --cached --quiet; then
  emit "commit" "No changes produced by the agent"
  node -e 'process.stdout.write(JSON.stringify({type:"ora_result",changed:false,branch:process.argv[1],summary:"The agent finished without code changes."})+"\n")' "$WORK_BRANCH"
  exit "${PI_EXIT:-0}"
fi

FILES_CHANGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
COMMIT_MSG="ora: ${TASK_PROMPT:0:72}"
git commit --quiet -m "$COMMIT_MSG" >/dev/null 2>&1 || fail "git commit failed"
COMMIT_SHA=$(git rev-parse HEAD)

emit "push" "Pushing branch ${WORK_BRANCH}"
if ! git push --quiet --set-upstream origin "$WORK_BRANCH" >>"${WORKSPACE}/git.log" 2>&1; then
  fail "git push failed (check installation token permissions)"
fi

# --- Summary ---------------------------------------------------------------
# Extract the last assistant text message from the pi event stream as a summary.
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
[ -z "$SUMMARY" ] && SUMMARY="The agent applied changes on branch ${WORK_BRANCH}."

node -e '
  const out = {
    type: "ora_result",
    changed: true,
    branch: process.argv[1],
    commitSha: process.argv[2],
    filesChanged: Number(process.argv[3]),
    summary: process.argv[4],
  };
  process.stdout.write(JSON.stringify(out) + "\n");
' "$WORK_BRANCH" "$COMMIT_SHA" "$FILES_CHANGED" "$SUMMARY"

exit 0
