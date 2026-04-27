-- IORA Watchdog Schema
-- Health monitoring and metrics storage (optional)

CREATE TABLE IF NOT EXISTS service_health_history (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,  -- healthy, degraded, unhealthy, unreachable
    response_time_ms INTEGER,
    error_message TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_history_service ON service_health_history(service_name);
CREATE INDEX idx_health_history_timestamp ON service_health_history(timestamp DESC);
CREATE INDEX idx_health_history_status ON service_health_history(status);

-- System metrics history
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    cpu_usage_percent REAL,
    memory_used_mb BIGINT,
    memory_total_mb BIGINT,
    disk_used_mb BIGINT,
    disk_total_mb BIGINT,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_metrics_timestamp ON system_metrics(timestamp DESC);

-- Notification log
CREATE TABLE IF NOT EXISTS watchdog_notifications (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255),
    notification_type VARCHAR(50) NOT NULL,  -- service_down, service_recovered, core_down
    severity VARCHAR(20) NOT NULL,  -- info, warning, critical
    message TEXT NOT NULL,
    notified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_service ON watchdog_notifications(service_name);
CREATE INDEX idx_notifications_timestamp ON watchdog_notifications(notified_at DESC);
