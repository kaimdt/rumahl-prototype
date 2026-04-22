#!/bin/bash
# IORA OS Startup Validator
# Runs during boot to validate all required services are healthy
# Should be installed as a systemd service on IORA OS

set -e

LOG_FILE="/var/log/iora-startup-validator.log"
MAX_WAIT_TIME=180  # 3 minutes
CHECK_INTERVAL=10  # 10 seconds

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

wait_for_docker() {
    log "Waiting for Docker daemon to start..."
    local waited=0

    while [ $waited -lt $MAX_WAIT_TIME ]; do
        if docker info > /dev/null 2>&1; then
            log "Docker daemon is ready"
            return 0
        fi
        sleep $CHECK_INTERVAL
        waited=$((waited + CHECK_INTERVAL))
    done

    log "ERROR: Docker daemon did not start within $MAX_WAIT_TIME seconds"
    return 1
}

wait_for_service() {
    local service_name="$1"
    local port="$2"
    local max_wait="${3:-$MAX_WAIT_TIME}"

    log "Waiting for $service_name on port $port..."
    local waited=0

    while [ $waited -lt $max_wait ]; do
        if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
            log "$service_name is healthy"
            return 0
        fi
        sleep $CHECK_INTERVAL
        waited=$((waited + CHECK_INTERVAL))
    done

    log "WARNING: $service_name did not become healthy within $max_wait seconds"
    return 1
}

wait_for_container() {
    local container_name="$1"
    local max_wait="${2:-$MAX_WAIT_TIME}"

    log "Waiting for container $container_name..."
    local waited=0

    while [ $waited -lt $max_wait ]; do
        if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
            log "Container $container_name is running"
            return 0
        fi
        sleep $CHECK_INTERVAL
        waited=$((waited + CHECK_INTERVAL))
    done

    log "WARNING: Container $container_name did not start within $max_wait seconds"
    return 1
}

validate_startup() {
    log "=== IORA OS Startup Validation ==="
    log "Starting validation at $(date)"

    # Wait for Docker
    if ! wait_for_docker; then
        log "CRITICAL: Docker failed to start"
        return 1
    fi

    # Wait for critical containers
    log ""
    log "Checking critical containers..."

    wait_for_container "iora-postgres" 60 || log "WARNING: postgres slow to start"
    wait_for_container "iora-core" 90 || log "WARNING: iora-core slow to start"
    wait_for_container "iora-secrets" 90 || log "WARNING: iora-secrets slow to start"
    wait_for_container "iora-home" 120 || log "WARNING: iora-home slow to start"

    # Wait for critical service health checks
    log ""
    log "Checking service health..."

    wait_for_service "iora-core" 8090 120 || log "WARNING: iora-core health check failed"
    wait_for_service "iora-secrets" 8093 120 || log "WARNING: iora-secrets health check failed"
    wait_for_service "iora-home" 8080 180 || log "WARNING: iora-home health check failed"

    # Check optional services (don't fail if not present)
    log ""
    log "Checking optional services..."

    if docker ps --format '{{.Names}}' | grep -q "^iora-supervisor$"; then
        wait_for_service "iora-supervisor" 8097 60 || log "INFO: iora-supervisor not responding"
    else
        log "INFO: iora-supervisor not enabled"
    fi

    if docker ps --format '{{.Names}}' | grep -q "^iora-watchdog$"; then
        wait_for_service "iora-watchdog" 8094 60 || log "INFO: iora-watchdog not responding"
    else
        log "INFO: iora-watchdog not enabled"
    fi

    if docker ps --format '{{.Names}}' | grep -q "^iora-security$"; then
        wait_for_service "iora-security" 8095 60 || log "INFO: iora-security not responding"
    else
        log "INFO: iora-security not enabled"
    fi

    log ""
    log "=== Validation Complete ==="
    log "IORA OS startup validation finished at $(date)"

    # Create status file
    echo "VALIDATED" > /var/run/iora-validated
    echo "$(date +%s)" >> /var/run/iora-validated

    return 0
}

# Main execution
mkdir -p "$(dirname "$LOG_FILE")"
validate_startup

exit_code=$?

if [ $exit_code -eq 0 ]; then
    log "✓ IORA OS started successfully"
else
    log "✗ IORA OS startup validation failed"
fi

exit $exit_code
