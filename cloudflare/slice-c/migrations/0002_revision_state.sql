PRAGMA foreign_keys = ON;

CREATE TABLE household_revisions (
  household_id TEXT PRIMARY KEY,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  last_write_token TEXT,
  updated_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(household_id)
);

INSERT INTO household_revisions(household_id,current_revision,last_write_token,updated_at)
SELECT household_id,0,NULL,NULL FROM households;

CREATE TRIGGER household_revision_increment_only
BEFORE UPDATE OF current_revision ON household_revisions
FOR EACH ROW
WHEN NEW.current_revision <> OLD.current_revision + 1
BEGIN
  SELECT RAISE(ABORT, 'revision must increment by exactly one');
END;
