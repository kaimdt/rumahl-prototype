CREATE TABLE IF NOT EXISTS monitoring_check_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  check_id CHAR(36) NOT NULL,
  ok TINYINT(1) NOT NULL,
  softfail TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  latency_ms INT NULL,
  dns_ms INT NULL,
  connect_ms INT NULL,
  tls_ms INT NULL,
  server_ms INT NULL,
  status_code INT NULL,
  error_text TEXT NULL,
  diagnostic_json LONGTEXT NULL,
  checked_at DATETIME NOT NULL,
  KEY idx_monitoring_check_results_check_time (check_id, checked_at),
  KEY idx_monitoring_check_results_check_ok_time (check_id, ok, checked_at),
  CONSTRAINT fk_monitoring_check_results_check FOREIGN KEY (check_id) REFERENCES monitor_checks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
