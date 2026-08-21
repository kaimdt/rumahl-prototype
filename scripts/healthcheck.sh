#!/bin/bash
# rumahl Health Check Script
# Validates both Docker Compose and rumahl OS installations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

check_service() {
    local service_name="$1"
    local port="$2"
    local endpoint="${3:-/health}"
    local is_critical="${4:-true}"

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    echo -n "Checking $service_name (port $port)... "

    if curl -sf "http://localhost:$port$endpoint" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        return 0
    else
        if [ "$is_critical" = "true" ]; then
            echo -e "${RED}✗ FAILED (CRITICAL)${NC}"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        else
            echo -e "${YELLOW}⚠ WARNING (optional service)${NC}"
            return 0
        fi
    fi
}

check_container() {
    local container_name="$1"
    local is_critical="${2:-true}"

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    echo -n "Checking container $container_name... "

    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        local status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "unknown")

        if [ "$status" = "healthy" ] || [ "$status" = "unknown" ]; then
            echo -e "${GREEN}✓ Running${NC}"
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
            return 0
        else
            if [ "$is_critical" = "true" ]; then
                echo -e "${RED}✗ Unhealthy (CRITICAL)${NC}"
                FAILED_CHECKS=$((FAILED_CHECKS + 1))
                return 1
            else
                echo -e "${YELLOW}⚠ Unhealthy (optional)${NC}"
                return 0
            fi
        fi
    else
        if [ "$is_critical" = "true" ]; then
            echo -e "${RED}✗ Not running (CRITICAL)${NC}"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        else
            echo -e "${YELLOW}⚠ Not running (optional)${NC}"
            return 0
        fi
    fi
}

check_postgres() {
    echo -n "Checking PostgreSQL connection... "
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    if docker exec rumahl-postgres pg_isready -U ora > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Connected${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))

        # Check databases
        echo "  Databases:"
        for db in rumahl_core rumahl_home rumahl_secrets rumahl_security; do
            if docker exec rumahl-postgres psql -U ora -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$db"; then
                echo -e "    ${GREEN}✓${NC} $db"
            else
                echo -e "    ${YELLOW}⚠${NC} $db (not found)"
            fi
        done
        return 0
    else
        echo -e "${RED}✗ Failed${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     rumahl Health Check                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Detect installation type
if [ -f "/etc/rumahl-release" ] || [ -f "/etc/buildroot-release" ]; then
    INSTALLATION_TYPE="rumahl OS"
    echo -e "${BLUE}Installation Type: rumahl OS${NC}"
else
    INSTALLATION_TYPE="Docker Compose"
    echo -e "${BLUE}Installation Type: Docker Compose${NC}"
fi
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
    exit 1
fi

# Check Docker daemon
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    exit 1
fi

echo -e "${YELLOW}=== Critical Services ===${NC}"
echo ""

# Check critical containers
check_container "rumahl-postgres" true
check_postgres
check_container "rumahl-core" true
check_container "rumahl-secrets" true
check_container "rumahl-home" true

echo ""
echo -e "${YELLOW}=== Service Health Checks ===${NC}"
echo ""

# Check critical service health
check_service "rumahl-core" "8090" "/health" true
check_service "rumahl-secrets" "8093" "/health" true
check_service "rumahl-home" "8080" "/health" true

echo ""
echo -e "${YELLOW}=== Optional Services ===${NC}"
echo ""

# Check optional containers
check_container "rumahl-supervisor" false
check_container "rumahl-security" false
check_container "rumahl-watchdog" false
check_container "rumahl-gateway" false
check_container "rumahl-control" false
check_container "rumahl-assist" false
check_container "rumahl-appstore" false

# Check optional service health
if docker ps --format '{{.Names}}' | grep -q "^rumahl-supervisor$"; then
    check_service "rumahl-supervisor" "8097" "/api/supervisor/status" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-security$"; then
    check_service "rumahl-security" "8095" "/health" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-watchdog$"; then
    check_service "rumahl-watchdog" "8094" "/health" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-gateway$"; then
    check_service "rumahl-gateway" "8096" "/health" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-control$"; then
    check_service "rumahl-control" "8091" "/health" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-assist$"; then
    check_service "rumahl-assist" "8092" "/health" false
fi

if docker ps --format '{{.Names}}' | grep -q "^rumahl-appstore$"; then
    check_service "rumahl-appstore" "8098" "/health" false
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Results                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "Total Checks: ${TOTAL_CHECKS}"
echo -e "${GREEN}Passed: ${PASSED_CHECKS}${NC}"
echo -e "${RED}Failed: ${FAILED_CHECKS}${NC}"
echo ""

if [ "$FAILED_CHECKS" -eq 0 ]; then
    echo -e "${GREEN}✓ All critical services are healthy!${NC}"
    echo ""
    echo -e "${BLUE}Access rumahl:${NC}"
    echo -e "  rumahl Home:    http://localhost:8080"

    if docker ps --format '{{.Names}}' | grep -q "^rumahl-control$"; then
        echo -e "  rumahl Control: http://localhost:8091"
    fi

    if docker ps --format '{{.Names}}' | grep -q "^rumahl-supervisor$"; then
        echo -e "  Supervisor:   http://localhost:8097"
    fi

    exit 0
else
    echo -e "${RED}✗ Some critical services are not healthy!${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check logs: docker compose logs"
    echo "2. Check individual service: docker compose logs <service-name>"
    echo "3. Restart services: docker compose restart"
    echo "4. Check environment variables in .env file"
    echo ""
    exit 1
fi
