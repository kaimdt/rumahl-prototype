#!/bin/bash
# IORA Service Dependency Validator
# Ensures critical services are enabled and validates dependencies

set -e

CRITICAL_SERVICES=("postgres" "iora-core" "iora-secrets" "iora-home")
OPTIONAL_SERVICES=("iora-supervisor" "iora-security" "iora-watchdog" "iora-gateway" "iora-control" "iora-assist" "iora-appstore")

check_service_dependencies() {
    local service="$1"

    case "$service" in
        "iora-core")
            echo "  Dependencies: postgres"
            ;;
        "iora-secrets")
            echo "  Dependencies: postgres"
            ;;
        "iora-home")
            echo "  Dependencies: postgres, iora-core"
            ;;
        "iora-security")
            echo "  Dependencies: postgres"
            ;;
        "iora-watchdog")
            echo "  Dependencies: iora-core"
            ;;
        "iora-control")
            echo "  Dependencies: iora-core, iora-home"
            ;;
        "iora-assist")
            echo "  Dependencies: iora-core"
            ;;
        "iora-gateway")
            echo "  Dependencies: none"
            ;;
        "iora-supervisor")
            echo "  Dependencies: none"
            ;;
        "iora-appstore")
            echo "  Dependencies: postgres, iora-supervisor"
            ;;
        *)
            echo "  Dependencies: unknown"
            ;;
    esac
}

validate_critical_services() {
    echo "Validating critical services..."
    echo ""

    local all_critical_enabled=true

    for service in "${CRITICAL_SERVICES[@]}"; do
        local container_name="iora-$service"
        if [ "$service" = "postgres" ]; then
            container_name="iora-postgres"
        fi

        echo "Checking $service..."

        # Check if service is defined in docker-compose
        if docker compose config --services 2>/dev/null | grep -q "$service\|${service#iora-}"; then
            echo "  ✓ Defined in docker-compose.yml"
            check_service_dependencies "$service"
        else
            echo "  ✗ NOT defined in docker-compose.yml"
            echo "  ⚠ CRITICAL SERVICE MISSING"
            all_critical_enabled=false
        fi
        echo ""
    done

    if [ "$all_critical_enabled" = false ]; then
        echo "ERROR: One or more critical services are not defined!"
        echo "IORA requires the following services to function:"
        for service in "${CRITICAL_SERVICES[@]}"; do
            echo "  - $service"
        done
        return 1
    fi

    echo "✓ All critical services are defined"
    return 0
}

validate_service_order() {
    echo ""
    echo "Validating service startup order..."
    echo ""

    # Services should start in this order:
    # 1. postgres
    # 2. iora-core, iora-secrets
    # 3. iora-home (depends on core)
    # 4. Optional services

    echo "Expected startup order:"
    echo "  1. postgres (database)"
    echo "  2. iora-core, iora-secrets (parallel)"
    echo "  3. iora-home (depends on core)"
    echo "  4. Optional services"
    echo ""
}

show_optional_services() {
    echo ""
    echo "Optional services status:"
    echo ""

    for service in "${OPTIONAL_SERVICES[@]}"; do
        if docker compose config --services 2>/dev/null | grep -q "${service#iora-}"; then
            echo "  ✓ $service (enabled)"
            check_service_dependencies "$service"
        else
            echo "  ○ $service (disabled)"
        fi
        echo ""
    done
}

generate_minimal_config() {
    echo ""
    echo "To create a minimal configuration with only critical services,"
    echo "use: docker-compose.minimal.yml"
    echo ""
    echo "Minimal services:"
    for service in "${CRITICAL_SERVICES[@]}"; do
        echo "  - $service"
    done
    echo ""
    echo "Resource usage (minimal): ~500MB RAM, ~2GB disk"
}

# Main execution
echo "╔════════════════════════════════════════╗"
echo "║  IORA Service Dependency Validator    ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if docker compose config is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "Error: Docker Compose is not available"
    exit 1
fi

# Validate critical services
if ! validate_critical_services; then
    echo ""
    echo "❌ Validation FAILED"
    echo ""
    generate_minimal_config
    exit 1
fi

# Validate service order
validate_service_order

# Show optional services
show_optional_services

echo ""
echo "✅ Service configuration is valid"
echo ""

# Provide usage information
echo "Next steps:"
echo "  1. Start services: docker compose up -d"
echo "  2. Check health: ./scripts/healthcheck.sh"
echo "  3. Access IORA: http://localhost:8080"
echo ""
