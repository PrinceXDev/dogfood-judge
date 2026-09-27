-- DOGFOOD schema v1.
-- Conventions: ids are prefixed strings (usr_, evt_, prj_ ...); timestamps are
-- TEXT in 'YYYY-MM-DDTHH:MM:SSZ' (UTC, second precision) so that string
-- comparison equals time comparison, including inside triggers.

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT,                       -- NULL: imported account, cannot log in until a password is set
    is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    created_at    TEXT NOT NULL
);

-- Sessions, API tokens and one-time account activation links. Only the
-- SHA-256 of a token is stored.
CREATE TABLE credentials (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('session', 'api', 'activation')),
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT
);
CREATE INDEX credentials_user ON credentials(user_id);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE events (
    id                   TEXT PRIMARY KEY,
    slug                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    submissions_open_at  TEXT NOT NULL,
    submissions_close_at TEXT NOT NULL,
    judging_close_at     TEXT,
    voting_open_at       TEXT,
    voting_close_at      TEXT,
    results_published_at TEXT,
    reviews_per_project  INTEGER NOT NULL DEFAULT 3 CHECK (reviews_per_project BETWEEN 1 AND 20),
    max_team_size        INTEGER NOT NULL DEFAULT 4 CHECK (max_team_size BETWEEN 1 AND 50),
    votes_per_voter      INTEGER NOT NULL DEFAULT 3 CHECK (votes_per_voter BETWEEN 1 AND 50),
    is_public            INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
    created_by           TEXT REFERENCES users(id),
    created_at           TEXT NOT NULL,
    CHECK (submissions_open_at < submissions_close_at),
    CHECK (voting_open_at IS NULL OR voting_close_at IS NULL OR voting_open_at < voting_close_at)
);

-- Roles are per event: the same person can judge one event and compete in another.
-- 'admin' is global (users.is_admin); 'visitor' is the absence of a session.
CREATE TABLE event_roles (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT NOT NULL CHECK (role IN ('organizer', 'judge', 'participant')),
    PRIMARY KEY (event_id, user_id, role)
);
CREATE INDEX event_roles_user ON event_roles(user_id);

-- Conflict of interest, enforced by the database: nobody judges an event they compete in.
CREATE TRIGGER event_roles_no_judge_participant
BEFORE INSERT ON event_roles
WHEN (NEW.role = 'judge' AND EXISTS (SELECT 1 FROM event_roles
        WHERE event_id = NEW.event_id AND user_id = NEW.user_id AND role = 'participant'))
  OR (NEW.role = 'participant' AND EXISTS (SELECT 1 FROM event_roles
        WHERE event_id = NEW.event_id AND user_id = NEW.user_id AND role = 'judge'))
BEGIN
    SELECT RAISE(ABORT, 'conflict_of_interest: a judge cannot participate in the same event');
END;

CREATE TABLE invitations (
    token_hash  TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    email       TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL CHECK (role IN ('organizer', 'judge')),
    created_by  TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    accepted_by TEXT REFERENCES users(id),
    accepted_at TEXT
);

CREATE TABLE tracks (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (event_id, name),
    UNIQUE (id, event_id)
);

CREATE TABLE prizes (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    track_id    TEXT REFERENCES tracks(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    value       TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

-- Judge expertise, used by the assignment engine.
CREATE TABLE judge_tracks (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id, track_id)
);

CREATE TABLE teams (
    id           TEXT PRIMARY KEY,
    event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,                -- deliberately not unique: fixtures contain repeated team names
    invite_token TEXT NOT NULL UNIQUE,         -- capability link; rotated by the team
    created_by   TEXT REFERENCES users(id),
    created_at   TEXT NOT NULL,
    UNIQUE (id, event_id)
);

CREATE TABLE team_members (
    team_id   TEXT NOT NULL,
    event_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    UNIQUE (event_id, user_id),                -- one team per person per event
    FOREIGN KEY (team_id, event_id) REFERENCES teams(id, event_id) ON DELETE CASCADE
);

CREATE TABLE deadline_extensions (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    until      TEXT NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    granted_by TEXT NOT NULL REFERENCES users(id),
    granted_at TEXT NOT NULL,
    PRIMARY KEY (event_id, team_id)
);

CREATE TABLE projects (
    id                  TEXT PRIMARY KEY,
    event_id            TEXT NOT NULL,
    team_id             TEXT NOT NULL,
    track_id            TEXT,
    title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    summary             TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 280),
    description         TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
    repo_url            TEXT NOT NULL DEFAULT '',
    demo_url            TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL CHECK (status IN ('draft', 'submitted')),
    origin              TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'import')),
    submitted_at        TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    duplicate_of        TEXT REFERENCES projects(id),
    disqualified_reason TEXT,
    FOREIGN KEY (team_id, event_id)  REFERENCES teams(id, event_id) ON DELETE CASCADE,
    FOREIGN KEY (track_id, event_id) REFERENCES tracks(id, event_id),
    CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);
CREATE INDEX projects_event ON projects(event_id, status);
-- One live project per team; a flagged duplicate does not count.
CREATE UNIQUE INDEX projects_one_per_team ON projects(team_id) WHERE duplicate_of IS NULL;

-- The deadline, enforced by the database as well as the service layer, so a
-- future handler that forgets the check still cannot write after close.
-- Imported rows (origin = 'import') carry their original timestamps and are audited.
CREATE TRIGGER projects_deadline_insert
BEFORE INSERT ON projects
WHEN NEW.origin = 'portal'
 AND strftime('%Y-%m-%dT%H:%M:%SZ', 'now') >= max(
        (SELECT submissions_close_at FROM events WHERE id = NEW.event_id),
        coalesce((SELECT until FROM deadline_extensions
                  WHERE event_id = NEW.event_id AND team_id = NEW.team_id), ''))
BEGIN
    SELECT RAISE(ABORT, 'submissions_closed');
END;

CREATE TRIGGER projects_deadline_update
BEFORE UPDATE OF title, summary, description, repo_url, demo_url, track_id, status, team_id, submitted_at ON projects
WHEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') >= max(
        (SELECT submissions_close_at FROM events WHERE id = OLD.event_id),
        coalesce((SELECT until FROM deadline_extensions
                  WHERE event_id = OLD.event_id AND team_id = OLD.team_id), ''))
BEGIN
    SELECT RAISE(ABORT, 'submissions_closed');
END;

CREATE TABLE criteria (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    weight      REAL NOT NULL CHECK (weight > 0),
    scale_min   INTEGER NOT NULL DEFAULT 1,
    scale_max   INTEGER NOT NULL DEFAULT 5,
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (event_id, key),
    CHECK (scale_min < scale_max)
);

CREATE TABLE assignments (
    event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    judge_id     TEXT NOT NULL REFERENCES users(id),
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'recused')),
    reason       TEXT NOT NULL DEFAULT '',     -- why the engine chose this judge
    assigned_at  TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY (judge_id, project_id)
);
CREATE INDEX assignments_event ON assignments(event_id, status);

-- A review can only exist for an assignment: judges cannot score projects they were not given.
CREATE TABLE reviews (
    event_id   TEXT NOT NULL,
    judge_id   TEXT NOT NULL,
    project_id TEXT NOT NULL,
    comment    TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 5000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (judge_id, project_id),
    FOREIGN KEY (judge_id, project_id) REFERENCES assignments(judge_id, project_id) ON DELETE CASCADE
);
CREATE INDEX reviews_event ON reviews(event_id);

CREATE TABLE review_scores (
    judge_id     TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    criterion_id TEXT NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    value        INTEGER NOT NULL,
    PRIMARY KEY (judge_id, project_id, criterion_id),
    FOREIGN KEY (judge_id, project_id) REFERENCES reviews(judge_id, project_id) ON DELETE CASCADE
);

CREATE TRIGGER review_scores_in_range_insert
BEFORE INSERT ON review_scores
WHEN NEW.value < (SELECT scale_min FROM criteria WHERE id = NEW.criterion_id)
  OR NEW.value > (SELECT scale_max FROM criteria WHERE id = NEW.criterion_id)
BEGIN
    SELECT RAISE(ABORT, 'score_out_of_range');
END;

CREATE TRIGGER review_scores_in_range_update
BEFORE UPDATE OF value ON review_scores
WHEN NEW.value < (SELECT scale_min FROM criteria WHERE id = NEW.criterion_id)
  OR NEW.value > (SELECT scale_max FROM criteria WHERE id = NEW.criterion_id)
BEGIN
    SELECT RAISE(ABORT, 'score_out_of_range');
END;

-- Pairwise mode. The server offers exactly one pair per judge at a time and
-- only accepts a verdict on that pair, so judges cannot steer which projects meet.
CREATE TABLE pairwise_offers (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    judge_id   TEXT NOT NULL REFERENCES users(id),
    project_a  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_b  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    offered_at TEXT NOT NULL,
    PRIMARY KEY (event_id, judge_id)
);

CREATE TABLE comparisons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    judge_id   TEXT NOT NULL REFERENCES users(id),
    project_a  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_b  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    outcome    TEXT NOT NULL CHECK (outcome IN ('a', 'b', 'tie')),
    created_at TEXT NOT NULL,
    CHECK (project_a <> project_b)
);
CREATE INDEX comparisons_event ON comparisons(event_id);

-- Community voting. ip_hash/ua_hash are salted hashes, never raw addresses.
CREATE TABLE votes (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_hash    TEXT NOT NULL DEFAULT '',
    ua_hash    TEXT NOT NULL DEFAULT '',
    flagged    TEXT,                           -- NULL = counted; otherwise the reason it is held back
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id, project_id)
);
CREATE INDEX votes_ip ON votes(event_id, ip_hash);

CREATE TRIGGER votes_budget
BEFORE INSERT ON votes
WHEN (SELECT count(*) FROM votes WHERE event_id = NEW.event_id AND user_id = NEW.user_id)
     >= (SELECT votes_per_voter FROM events WHERE id = NEW.event_id)
BEGIN
    SELECT RAISE(ABORT, 'vote_budget_exhausted');
END;

CREATE TABLE comments (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL,
    hidden_at  TEXT,
    hidden_by  TEXT REFERENCES users(id)
);
CREATE INDEX comments_project ON comments(project_id, created_at);

CREATE TABLE webhooks (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    secret     TEXT NOT NULL,
    topics     TEXT NOT NULL,                  -- comma separated, '*' for all
    active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE webhook_deliveries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id      TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error      TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);

-- Tamper-evident audit trail: each row hashes the previous row's hash.
CREATE TABLE audit_log (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    actor_id  TEXT NOT NULL DEFAULT '',
    event_id  TEXT NOT NULL DEFAULT '',
    action    TEXT NOT NULL,
    target    TEXT NOT NULL DEFAULT '',
    detail    TEXT NOT NULL DEFAULT '{}',
    ip_hash   TEXT NOT NULL DEFAULT '',
    prev_hash TEXT NOT NULL,
    hash      TEXT NOT NULL
);
CREATE INDEX audit_event ON audit_log(event_id, seq);

CREATE TRIGGER audit_log_append_only_update BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_append_only_delete BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;
