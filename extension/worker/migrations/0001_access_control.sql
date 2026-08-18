-- ABOUTME: Creates the WWO feature policy, cohort, and tester access tables.
-- ABOUTME: Seeds the deployed feature catalog and the internal and closed-beta cohorts.

PRAGMA foreign_keys = ON;

CREATE TABLE features (
  feature_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('internal', 'beta', 'lab', 'released')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cohorts (
  cohort_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grants_all_unreleased INTEGER NOT NULL DEFAULT 0 CHECK (grants_all_unreleased IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cohort_features (
  cohort_id TEXT NOT NULL REFERENCES cohorts(cohort_id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features(feature_id) ON DELETE CASCADE,
  PRIMARY KEY (cohort_id, feature_id)
);

CREATE TABLE people (
  public_id TEXT PRIMARY KEY,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cohort_memberships (
  public_id TEXT NOT NULL REFERENCES people(public_id) ON DELETE CASCADE,
  cohort_id TEXT NOT NULL REFERENCES cohorts(cohort_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (public_id, cohort_id)
);

CREATE TABLE access_requests (
  request_id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  email TEXT,
  requested_features TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX access_requests_status_created_at
  ON access_requests(status, created_at DESC);

INSERT INTO features (feature_id, name, description, stage) VALUES
  ('COPRESENCE', 'People here', 'Show shared cursors and the number of people on a page.', 'internal'),
  ('BOTTLES', 'Message bottles', 'Find and leave messages with other people across the web.', 'internal'),
  ('INVENTORY', 'Satchel', 'Collect and carry objects found on PlayHTML pages.', 'internal'),
  ('SCRAPS', 'Internet scraps', 'Collect a local collage of distinctive things you encounter.', 'beta'),
  ('BAG_SETTINGS', 'Bag settings', 'Show controls for unfinished PlayHTML Bag features.', 'internal'),
  ('COMMUTE', 'Internet Commute', 'Ride a slow train through pages people found recently.', 'beta'),
  ('PAGE_COLLECTION', 'Page collection', 'Discover sites and collect elements marked with can-collect.', 'internal'),
  ('EMOTES', 'Emotes', 'Use experimental on-page social reactions.', 'internal');

INSERT INTO cohorts (cohort_id, name, grants_all_unreleased) VALUES
  ('internal', 'Internal', 1),
  ('closed-beta', 'Closed beta', 0);

INSERT INTO cohort_features (cohort_id, feature_id) VALUES
  ('closed-beta', 'COMMUTE'),
  ('closed-beta', 'SCRAPS');
