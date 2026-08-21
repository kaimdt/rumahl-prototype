-- ============================================================================
-- rumahl Status Page — MySQL schema
-- Run automatically by install.php or manually:
--   mysql -u <user> -p <database> < schema.sql
-- All timestamps are stored in UTC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS component_groups (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  collapsed TINYINT(1) NOT NULL DEFAULT 0,
  auto_expand TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS components (
  id CHAR(36) NOT NULL PRIMARY KEY,
  group_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  kind ENUM('auto','manual') NOT NULL DEFAULT 'manual',
  check_type ENUM('http','tcp','ping') NOT NULL DEFAULT 'http',
  endpoint_url VARCHAR(500) NOT NULL DEFAULT '',
  method VARCHAR(10) NOT NULL DEFAULT 'GET',
  expected_status INT NOT NULL DEFAULT 200,
  timeout_ms INT NOT NULL DEFAULT 10000,
  headers TEXT NULL,
  view_mode VARCHAR(10) NOT NULL DEFAULT 'compact',
  history_days INT NOT NULL DEFAULT 90,
  position INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_components_group FOREIGN KEY (group_id)
    REFERENCES component_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS check_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  component_id CHAR(36) NOT NULL,
  ok TINYINT(1) NOT NULL,
  softfail TINYINT(1) NOT NULL DEFAULT 0,
  latency_ms INT NULL,
  status_code INT NULL,
  error VARCHAR(500) NULL,
  checked_at DATETIME NOT NULL,
  KEY idx_check_component_time (component_id, checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS component_status (
  component_id CHAR(36) NOT NULL PRIMARY KEY,
  status ENUM('operational','degraded','partial_outage','major_outage') NOT NULL DEFAULT 'operational',
  changed_at DATETIME NOT NULL,
  CONSTRAINT fk_component_status FOREIGN KEY (component_id)
    REFERENCES components(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS uptime_daily (
  component_id CHAR(36) NOT NULL,
  day DATE NOT NULL,
  ok_count INT NOT NULL DEFAULT 0,
  total_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (component_id, day),
  CONSTRAINT fk_uptime_component FOREIGN KEY (component_id)
    REFERENCES components(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incidents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  type ENUM('incident','maintenance') NOT NULL DEFAULT 'incident',
  source VARCHAR(10) NOT NULL DEFAULT 'manual',
  title VARCHAR(200) NOT NULL,
  status ENUM('investigating','identified','monitoring','resolved','scheduled','in_progress','completed') NOT NULL,
  impact ENUM('none','minor','major','critical') NOT NULL DEFAULT 'minor',
  starts_at DATETIME NOT NULL,
  resolves_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id CHAR(36) NOT NULL,
  status ENUM('investigating','identified','monitoring','resolved','scheduled','in_progress','completed') NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_incident_updates (incident_id),
  CONSTRAINT fk_incident_updates FOREIGN KEY (incident_id)
    REFERENCES incidents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_components (
  incident_id CHAR(36) NOT NULL,
  component_id CHAR(36) NOT NULL,
  PRIMARY KEY (incident_id, component_id),
  CONSTRAINT fk_ic_incident FOREIGN KEY (incident_id)
    REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_ic_component FOREIGN KEY (component_id)
    REFERENCES components(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS alert_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(30) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NULL,
  channel ENUM('email','webhook') NOT NULL DEFAULT 'email',
  recipient VARCHAR(200) NOT NULL DEFAULT '',
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  sent_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(64) NOT NULL PRIMARY KEY,
  svalue TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
