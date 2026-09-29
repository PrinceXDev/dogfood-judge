-- Sign-in through an external identity provider (GitHub, Google, LinkedIn,
-- X). One row links a provider's stable user id to a local account. An
-- account may have a password, identities, or both; it can sign in if it has
-- either. Providers are configured by the operator and off by default, so a
-- fresh instance still runs fully offline.
CREATE TABLE user_identities (
    provider   TEXT NOT NULL,                  -- github | google | linkedin | x
    subject    TEXT NOT NULL,                  -- the provider's user id, never reused
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,                  -- verified address the provider reported at link time
    created_at TEXT NOT NULL,
    last_used  TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_user ON user_identities(user_id);
