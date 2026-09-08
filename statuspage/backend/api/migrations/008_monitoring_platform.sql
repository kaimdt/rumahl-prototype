CREATE TABLE IF NOT EXISTS monitoring_hosts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  location VARCHAR(150) NULL,
  environment ENUM('production','staging','development') NOT NULL DEFAULT 'production',
  tags JSON NULL,
  operating_system VARCHAR(150) NULL,
  internal_address VARCHAR(255) NULL,
  status ENUM('operational','degraded','partial_outage','major_outage','maintenance','unknown') NOT NULL DEFAULT 'unknown',
  notes TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_monitoring_hosts_status (status),
  KEY idx_monitoring_hosts_environment (environment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_agents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  host_id CHAR(36) NULL,
  name VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  version VARCHAR(50) NULL,
  status ENUM('online','offline','revoked','unknown') NOT NULL DEFAULT 'unknown',
  last_seen_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_monitoring_agents_token_hash (token_hash),
  KEY idx_monitoring_agents_last_seen (last_seen_at),
  CONSTRAINT fk_monitoring_agents_host FOREIGN KEY (host_id) REFERENCES monitoring_hosts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_services (
  id CHAR(36) NOT NULL PRIMARY KEY,
  legacy_component_id CHAR(36) NULL,
  internal_name VARCHAR(150) NOT NULL,
  internal_description TEXT NULL,
  public_name VARCHAR(150) NOT NULL,
  public_description TEXT NULL,
  environment ENUM('production','staging','development') NOT NULL DEFAULT 'production',
  tags JSON NULL,
  status ENUM('operational','degraded','partial_outage','major_outage','maintenance','unknown') NOT NULL DEFAULT 'unknown',
  public_status_enabled TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_monitoring_services_legacy (legacy_component_id),
  KEY idx_monitoring_services_status (status),
  CONSTRAINT fk_monitoring_services_legacy FOREIGN KEY (legacy_component_id) REFERENCES components(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_service_hosts (
  service_id CHAR(36) NOT NULL,
  host_id CHAR(36) NOT NULL,
  PRIMARY KEY (service_id, host_id),
  CONSTRAINT fk_monitoring_service_hosts_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_service_hosts_host FOREIGN KEY (host_id) REFERENCES monitoring_hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_service_dependencies (
  service_id CHAR(36) NOT NULL,
  depends_on_service_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (service_id, depends_on_service_id),
  CONSTRAINT fk_service_dependencies_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_dependencies_dependency FOREIGN KEY (depends_on_service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitor_checks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  service_id CHAR(36) NULL,
  host_id CHAR(36) NULL,
  name VARCHAR(150) NOT NULL,
  check_type ENUM('http','tcp','icmp','dns','tls','custom') NOT NULL,
  target VARCHAR(500) NOT NULL,
  config JSON NULL,
  interval_seconds INT NOT NULL DEFAULT 60,
  timeout_ms INT NOT NULL DEFAULT 10000,
  retry_count INT NOT NULL DEFAULT 1,
  failure_threshold INT NOT NULL DEFAULT 3,
  recovery_threshold INT NOT NULL DEFAULT 2,
  consecutive_failures INT NOT NULL DEFAULT 0,
  consecutive_successes INT NOT NULL DEFAULT 0,
  status ENUM('operational','degraded','partial_outage','major_outage','maintenance','unknown') NOT NULL DEFAULT 'unknown',
  monitoring_location VARCHAR(100) NULL,
  auto_incident_enabled TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  last_checked_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_monitor_checks_service (service_id),
  KEY idx_monitor_checks_host (host_id),
  KEY idx_monitor_checks_status_enabled (status, enabled),
  CONSTRAINT fk_monitor_checks_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitor_checks_host FOREIGN KEY (host_id) REFERENCES monitoring_hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_metrics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id CHAR(36) NULL,
  service_id CHAR(36) NULL,
  check_id CHAR(36) NULL,
  metric_key VARCHAR(80) NOT NULL,
  value DOUBLE NOT NULL,
  unit VARCHAR(30) NULL,
  granularity ENUM('raw','hour','day') NOT NULL DEFAULT 'raw',
  recorded_at DATETIME NOT NULL,
  KEY idx_monitoring_metrics_host_key_time (host_id, metric_key, recorded_at),
  KEY idx_monitoring_metrics_service_key_time (service_id, metric_key, recorded_at),
  KEY idx_monitoring_metrics_check_time (check_id, recorded_at),
  CONSTRAINT fk_monitoring_metrics_host FOREIGN KEY (host_id) REFERENCES monitoring_hosts(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_metrics_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_metrics_check FOREIGN KEY (check_id) REFERENCES monitor_checks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  host_id CHAR(36) NULL,
  service_id CHAR(36) NULL,
  check_id CHAR(36) NULL,
  alert_type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  severity ENUM('info','minor','major','critical') NOT NULL DEFAULT 'minor',
  state ENUM('active','acknowledged','resolved') NOT NULL DEFAULT 'active',
  acknowledged_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_monitoring_alerts_state_severity (state, severity),
  CONSTRAINT fk_monitoring_alerts_host FOREIGN KEY (host_id) REFERENCES monitoring_hosts(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_alerts_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_alerts_check FOREIGN KEY (check_id) REFERENCES monitor_checks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS status_pages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(100) NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT NULL,
  logo_url VARCHAR(500) NULL,
  favicon_url VARCHAR(500) NULL,
  theme JSON NULL,
  contact_links JSON NULL,
  canonical_domain VARCHAR(255) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_status_pages_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS status_page_domains (
  id CHAR(36) NOT NULL PRIMARY KEY,
  status_page_id CHAR(36) NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  verification_token CHAR(64) NOT NULL,
  status ENUM('pending','verified','failed','disabled') NOT NULL DEFAULT 'pending',
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_status_page_domains_hostname (hostname),
  CONSTRAINT fk_status_page_domains_page FOREIGN KEY (status_page_id) REFERENCES status_pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS status_page_groups (
  id CHAR(36) NOT NULL PRIMARY KEY,
  status_page_id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY idx_status_page_groups_page_position (status_page_id, position),
  CONSTRAINT fk_status_page_groups_page FOREIGN KEY (status_page_id) REFERENCES status_pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS status_page_services (
  status_page_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  group_id CHAR(36) NULL,
  position INT NOT NULL DEFAULT 0,
  show_uptime TINYINT(1) NOT NULL DEFAULT 1,
  show_performance TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (status_page_id, service_id),
  KEY idx_status_page_services_group_position (group_id, position),
  CONSTRAINT fk_status_page_services_page FOREIGN KEY (status_page_id) REFERENCES status_pages(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_page_services_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_page_services_group FOREIGN KEY (group_id) REFERENCES status_page_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE IF NOT EXISTS status_page_incidents (
  status_page_id CHAR(36) NOT NULL,
  incident_id CHAR(36) NOT NULL,
  PRIMARY KEY (status_page_id, incident_id),
  CONSTRAINT fk_status_page_incidents_page FOREIGN KEY (status_page_id) REFERENCES status_pages(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_page_incidents_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

INSERT IGNORE INTO status_pages (id, slug, title, description, canonical_domain, enabled, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'rumahl Status', 'Service availability and incident information.', NULL, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())

INSERT IGNORE INTO monitoring_services (id, legacy_component_id, internal_name, internal_description, public_name, public_description, status, public_status_enabled, created_at, updated_at)
SELECT c.id, c.id, c.name, c.description, c.name, c.description, COALESCE(cs.status, 'unknown'), 1, c.created_at, c.updated_at
FROM components c LEFT JOIN component_status cs ON cs.component_id = c.id

INSERT IGNORE INTO status_page_services (status_page_id, service_id, position, show_uptime, show_performance)
SELECT '00000000-0000-4000-8000-000000000001', id, 0, 1, 0 FROM monitoring_services

INSERT IGNORE INTO status_page_incidents (status_page_id, incident_id)
SELECT '00000000-0000-4000-8000-000000000001', id FROM incidents
