#!/bin/bash
# IORA OS Startup Validator — informational only.
#
# Runs once at boot (multi-user.target) to take a quick snapshot of Docker
# + IORA containers + core health endpoints and write a status file.  It
# MUST complete quickly and MUST NEVER fail:
#   * 30 s hard deadline for the whole run (TimeoutStartSec=60 keeps
#     headroom for systemd itself).
#   * All waits are 1 s polling with tiny per-check budgets so we don't
#     hang the boot console for minutes.
#   * Always exits 0.  If we detect the stack isn't up yet (first boot /
#     .setup-complete missing / placeholder compose), we just log that
#     fact and return immediately instead of waiting in vain.
#
# If you want deep post-boot validation, run this out of a systemd timer
# AFTER multi-user.target, not during boot.

set +e

LOG_FILE="/var/log/iora-startup-validator.log"
STATUS_FILE="/run/iora-validated"
HARD_DEADLINE=$(( $(date +%s) + 30 ))   # never spend >30s total

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" \
        | tee -a "$LOG_FILE" >/dev/null 2>&1
    # Mirror to the boot console via /dev/kmsg so the user can see progress.
    printf '<6>iora-validator: %s\n' "$1" > /dev/kmsg 2>/dev/null || true
}

over_budget() {
    [ "$(date +%s)" -ge "$HARD_DEADLINE" ]
}

quick_wait_docker() {
    local waited=0
    while [ $waited -lt 10 ]; do
        over_budget && return 1
        if docker info >/dev/null 2>&1; then
            log "Docker daemon ready after ${waited}s"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log "Docker daemon not ready within 10s (may still come up; continuing)"
    return 1
}

has_container() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$1$"
}

peek_container() {
    local name="$1"
    if has_container "$name"; then
        log "container $name: running"
    else
        log "container $name: not running (yet)"
    fi
}

peek_health() {
    local name="$1" port="$2"
    if curl -sf --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
        log "health $name:${port}: ok"
    else
        log "health $name:${port}: not responding"
    fi
}

validate() {
    log "=== IORA OS Startup Validation ==="

    # First-boot / fresh install: nothing to validate yet.
    # Use dual-flag check: setup is complete if EITHER flag exists.
    if [ ! -e /mnt/data/iora/.setup-complete ] && [ ! -e /etc/iora/.setup-complete ]; then
        log "setup not complete yet (missing .setup-complete) — skipping stack checks"
        return 0
    fi

    # Placeholder compose (hello-world only) — user hasn't dropped their
    # real docker-compose.yml yet. No point timing out on iora-* containers.
    if [ -f /mnt/data/iora/docker-compose.yml ] && \
       grep -q '^\s*image:\s*hello-world\s*$' /mnt/data/iora/docker-compose.yml 2>/dev/null && \
       ! grep -q '^\s*image:\s*ghcr.io/.*iora' /mnt/data/iora/docker-compose.yml 2>/dev/null; then
        log "placeholder docker-compose.yml detected — skipping stack checks"
        return 0
    fi

    quick_wait_docker || return 0

    # Snapshot critical containers (no long waits).
    for c in iora-postgres iora-core iora-secrets iora-home; do
        over_budget && { log "deadline reached; abort snapshot"; return 0; }
        peek_container "$c"
    done

    # Light health probes with 2 s timeout each.
    for entry in "iora-core:8090" "iora-secrets:8093" "iora-home:8080"; do
        over_budget && { log "deadline reached; abort health probes"; return 0; }
        name="${entry%:*}"; port="${entry##*:}"
        has_container "$name" && peek_health "$name" "$port"
    done

    log "validation snapshot complete"
    return 0
}

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
validate || true

{
    echo "VALIDATED"
    date +%s
} > "$STATUS_FILE" 2>/dev/null || true

log "iora-startup-validator finished"
# ALWAYS exit 0 — validator is informational.
exit 0
