-- The outing request itself now carries the place the student was standing when
-- they raised it, so the guardian's WhatsApp approval can show it on a map.
-- Live tracking during the outing stays in outing_tracking / outing_location_pings.
ALTER TABLE outing_requests ADD COLUMN start_latitude REAL;
ALTER TABLE outing_requests ADD COLUMN start_longitude REAL;
ALTER TABLE outing_requests ADD COLUMN start_accuracy_m REAL;
ALTER TABLE outing_requests ADD COLUMN start_location_at TEXT;
