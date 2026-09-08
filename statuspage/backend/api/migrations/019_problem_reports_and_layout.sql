CREATE TABLE IF NOT EXISTS status_page_problem_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status_page_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  region VARCHAR(80) NOT NULL DEFAULT 'unknown',
  visitor_hash CHAR(64) NOT NULL,
  message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  KEY idx_problem_reports_cluster (status_page_id,service_id,region,created_at),
  KEY idx_problem_reports_visitor (visitor_hash,created_at),
  CONSTRAINT fk_problem_reports_page FOREIGN KEY (status_page_id) REFERENCES status_pages(id) ON DELETE CASCADE,
  CONSTRAINT fk_problem_reports_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
