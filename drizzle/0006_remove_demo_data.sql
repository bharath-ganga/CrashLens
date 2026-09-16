DELETE FROM incident_logs
WHERE incident_id IN (
  SELECT incidents.id FROM incidents
  JOIN ingestions ON ingestions.id = incidents.ingestion_id
  WHERE ingestions.filename LIKE 'crashlens-sample.%'
);
DELETE FROM comments
WHERE incident_id IN (
  SELECT incidents.id FROM incidents
  JOIN ingestions ON ingestions.id = incidents.ingestion_id
  WHERE ingestions.filename LIKE 'crashlens-sample.%'
);
DELETE FROM incidents
WHERE ingestion_id IN (
  SELECT id FROM ingestions WHERE filename LIKE 'crashlens-sample.%'
);
DELETE FROM ingestions WHERE filename LIKE 'crashlens-sample.%';
DELETE FROM telemetry_spans WHERE source = 'demo';
DELETE FROM deployments WHERE source = 'demo';
DELETE FROM service_objectives
WHERE service = 'payment-service'
  AND team_id IN (
    SELECT team_id FROM audit_events
    WHERE action = 'intelligence.demo_loaded'
  );
DELETE FROM postmortems
WHERE incident_id IS NULL AND title = 'Production request failure';
DELETE FROM audit_events WHERE action = 'intelligence.demo_loaded';
