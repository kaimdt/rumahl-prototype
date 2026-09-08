CREATE TABLE IF NOT EXISTS incident_services (
  id CHAR(36) NOT NULL PRIMARY KEY,
  incident_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  display_status ENUM('operational','degraded','partial_outage','major_outage','maintenance') NOT NULL DEFAULT 'degraded',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_incident_service (incident_id, service_id),
  KEY idx_incident_services_service (service_id),
  CONSTRAINT fk_incident_services_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_services_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_update_services (
  update_id BIGINT UNSIGNED NOT NULL,
  service_id CHAR(36) NOT NULL,
  display_status ENUM('operational','degraded','partial_outage','major_outage','maintenance') NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (update_id, service_id),
  CONSTRAINT fk_incident_update_services_update FOREIGN KEY (update_id) REFERENCES incident_updates(id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_update_services_service FOREIGN KEY (service_id) REFERENCES monitoring_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO incident_services (id,incident_id,service_id,display_status,created_at,updated_at)
SELECT UUID(),ic.incident_id,s.id,
       CASE i.impact WHEN 'critical' THEN 'major_outage' WHEN 'major' THEN 'partial_outage' ELSE 'degraded' END,
       i.created_at,i.updated_at
  FROM incident_components ic
  JOIN monitoring_services s ON s.legacy_component_id=ic.component_id
  JOIN incidents i ON i.id=ic.incident_id;
