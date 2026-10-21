-- ---------------------------------------------------------------------------
-- Automatic worker routing.
--
-- The Warden's only decision is to accept a complaint. From there the system
-- works out the trade the issue belongs to, picks an active worker of that
-- trade and dispatches the job to them. One worker may hold any number of live
-- jobs, so nothing here reserves a worker exclusively.
--
-- Trade detection reads the category's configured `worker_category` first. When
-- the category carries none (an "Other Hostel Issue", say), the keywords below
-- are matched against the complaint title, description and location, so the
-- routing rules stay data, not code.
-- ---------------------------------------------------------------------------
CREATE TABLE complaint_worker_keywords (
  id              TEXT PRIMARY KEY,
  worker_category TEXT NOT NULL,                 -- matches technicians.category
  keyword         TEXT NOT NULL COLLATE NOCASE,
  weight          INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (worker_category, keyword)
);
CREATE INDEX ix_worker_keywords_trade ON complaint_worker_keywords(worker_category, is_active);

INSERT INTO complaint_worker_keywords (id, worker_category, keyword, weight) VALUES
  ('cwk_el_1','Electrical','power',2),
  ('cwk_el_2','Electrical','current',2),
  ('cwk_el_3','Electrical','light',1),
  ('cwk_el_4','Electrical','bulb',2),
  ('cwk_el_5','Electrical','tube light',2),
  ('cwk_el_6','Electrical','fan',2),
  ('cwk_el_7','Electrical','switch',2),
  ('cwk_el_8','Electrical','socket',2),
  ('cwk_el_9','Electrical','plug',1),
  ('cwk_el_10','Electrical','wiring',2),
  ('cwk_el_11','Electrical','short circuit',3),
  ('cwk_el_12','Electrical','shock',3),
  ('cwk_el_13','Electrical','mcb',2),
  ('cwk_el_14','Electrical','fuse',2),
  ('cwk_el_15','Electrical','geyser',1),
  ('cwk_el_16','Electrical','charging point',2),
  ('cwk_el_17','Electrical','electric',2),
  ('cwk_pl_1','Plumbing','water',2),
  ('cwk_pl_2','Plumbing','tap',2),
  ('cwk_pl_3','Plumbing','leak',2),
  ('cwk_pl_4','Plumbing','pipe',2),
  ('cwk_pl_5','Plumbing','drain',2),
  ('cwk_pl_6','Plumbing','blocked',1),
  ('cwk_pl_7','Plumbing','clogged',2),
  ('cwk_pl_8','Plumbing','toilet',2),
  ('cwk_pl_9','Plumbing','flush',2),
  ('cwk_pl_10','Plumbing','washroom',1),
  ('cwk_pl_11','Plumbing','bathroom',1),
  ('cwk_pl_12','Plumbing','basin',2),
  ('cwk_pl_13','Plumbing','shower',2),
  ('cwk_pl_14','Plumbing','overflow',2),
  ('cwk_pl_15','Plumbing','sewage',3),
  ('cwk_pl_16','Plumbing','motor',1),
  ('cwk_pl_17','Plumbing','sump',2),
  ('cwk_pl_18','Plumbing','tank',1),
  ('cwk_pl_19','Plumbing','seepage',2),
  ('cwk_cp_1','Carpentry','door',2),
  ('cwk_cp_2','Carpentry','window',2),
  ('cwk_cp_3','Carpentry','lock',2),
  ('cwk_cp_4','Carpentry','latch',2),
  ('cwk_cp_5','Carpentry','hinge',2),
  ('cwk_cp_6','Carpentry','cot',2),
  ('cwk_cp_7','Carpentry','bed',2),
  ('cwk_cp_8','Carpentry','cupboard',2),
  ('cwk_cp_9','Carpentry','almirah',2),
  ('cwk_cp_10','Carpentry','table',2),
  ('cwk_cp_11','Carpentry','chair',2),
  ('cwk_cp_12','Carpentry','shelf',2),
  ('cwk_cp_13','Carpentry','furniture',2),
  ('cwk_cp_14','Carpentry','wooden',1),
  ('cwk_cp_15','Carpentry','broken handle',2),
  ('cwk_wf_1','Wi-Fi / LAN','wifi',3),
  ('cwk_wf_2','Wi-Fi / LAN','wi-fi',3),
  ('cwk_wf_3','Wi-Fi / LAN','internet',3),
  ('cwk_wf_4','Wi-Fi / LAN','network',2),
  ('cwk_wf_5','Wi-Fi / LAN','lan port',2),
  ('cwk_wf_6','Wi-Fi / LAN','router',3),
  ('cwk_wf_7','Wi-Fi / LAN','broadband',3),
  ('cwk_wf_8','Wi-Fi / LAN','ethernet',3),
  ('cwk_hk_1','Housekeeping','cleaning',2),
  ('cwk_hk_2','Housekeeping','dirty',2),
  ('cwk_hk_3','Housekeeping','garbage',2),
  ('cwk_hk_4','Housekeeping','waste',2),
  ('cwk_hk_5','Housekeeping','dustbin',2),
  ('cwk_hk_6','Housekeeping','sweeping',2),
  ('cwk_hk_7','Housekeeping','mopping',2),
  ('cwk_hk_8','Housekeeping','smell',2),
  ('cwk_hk_9','Housekeeping','stink',2),
  ('cwk_hk_10','Housekeeping','mosquito',2),
  ('cwk_hk_11','Housekeeping','pest',2),
  ('cwk_hk_12','Housekeeping','cockroach',2),
  ('cwk_hk_13','Housekeeping','bedbug',2),
  ('cwk_hk_14','Housekeeping','hygiene',2),
  ('cwk_hk_15','Housekeeping','dust',1),
  ('cwk_cv_1','Civil / Masonry','wall',2),
  ('cwk_cv_2','Civil / Masonry','ceiling',2),
  ('cwk_cv_3','Civil / Masonry','floor',2),
  ('cwk_cv_4','Civil / Masonry','tile',2),
  ('cwk_cv_5','Civil / Masonry','crack',2),
  ('cwk_cv_6','Civil / Masonry','plaster',2),
  ('cwk_cv_7','Civil / Masonry','painting',1),
  ('cwk_cv_8','Civil / Masonry','concrete',2),
  ('cwk_cv_9','Civil / Masonry','roof',2),
  ('cwk_cv_10','Civil / Masonry','staircase',2),
  ('cwk_cv_11','Civil / Masonry','dampness',2),
  ('cwk_ms_1','Mess / Food','mess',2),
  ('cwk_ms_2','Mess / Food','food',2),
  ('cwk_ms_3','Mess / Food','canteen',2),
  ('cwk_ms_4','Mess / Food','breakfast',2),
  ('cwk_ms_5','Mess / Food','lunch',2),
  ('cwk_ms_6','Mess / Food','dinner',2),
  ('cwk_ms_7','Mess / Food','menu',2),
  ('cwk_ms_8','Mess / Food','stale',3),
  ('cwk_ms_9','Mess / Food','undercooked',3),
  ('cwk_ms_10','Mess / Food','drinking water',2);

-- What the automatic routing decided, and what happened when the job was sent.
ALTER TABLE complaint_assignments ADD COLUMN auto_assigned    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE complaint_assignments ADD COLUMN detected_trade   TEXT;
ALTER TABLE complaint_assignments ADD COLUMN detection_source TEXT;   -- 'category' | 'keywords' | 'fallback' | 'manual'
ALTER TABLE complaint_assignments ADD COLUMN dispatch_channel TEXT;   -- 'WhatsApp'
ALTER TABLE complaint_assignments ADD COLUMN dispatch_status  TEXT;   -- 'Sent' | 'Failed' | 'Not Configured'
ALTER TABLE complaint_assignments ADD COLUMN dispatch_error   TEXT;
ALTER TABLE complaint_assignments ADD COLUMN dispatched_at    TEXT;

-- The trade a complaint falls back to when its category carries none and the
-- keywords find nothing lives in SETTING_DEFAULTS as
-- `complaint.fallback_worker_category`; blank there disables the fallback and
-- the Warden is asked to pick a worker by hand.
