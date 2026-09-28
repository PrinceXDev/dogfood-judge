# Threat model

Scope: abuse of **voting, submissions and judging** on a self-hosted
instance. The instance operator (whoever runs `docker compose up`) is trusted
with the database. Everyone else is not. Every defence below names the code
that implements it and the test that checks it. Attacks we do **not** stop
are listed at the end; that list matters as much as the first one.

## Assets

1. **The ranking.** Who wins, and whether that can be defended afterwards.
2. **Judge confidentiality.** A judge's scores are visible only to that judge
   and the organizers, so judges cannot anchor on or pressure each other.
3. **The deadline.** Everyone gets the same amount of time.
4. **The record.** What happened, and whether anyone rewrote it.

## Attacks we stop

### Judge reads or copies a peer's scores
- Every read goes through `core.JudgeScores` / `core.EventReviews`. Asking for
  another judge's reviews is refused (403), not filtered to an empty list,
  unless the caller organizes that event. There is no endpoint that returns
  another judge's scores to a judge.
- Results, rankings and judge diagnostics are organizer-only until
  publication; published results never include judge identities.
- *Tests:* `TestAuthorizationMatrix`, `TestJudgeScoresNeverLeakPeers`,
  run.py's "judge cannot see peer scores".

### Judge scores a project they were not given
- `reviews` has a foreign key to `assignments`, so the **database** refuses a
  review with no assignment. The service also returns 403 before revealing
  anything about the rubric.

### Judge steers pairwise comparisons
- The server chooses the pair and stores it as the judge's only open offer;
  a verdict on any other pair is `409 stale_pair` (`pairwise_offers`). A judge
  cannot make a friend meet only weak projects.

### Conflict of interest
- A database trigger makes `judge` and `participant` mutually exclusive in an
  event; the assignment engine also excludes team members; judges can recuse
  (audited). *Test:* `TestConflictOfInterestEnforcedByDatabase`.

### Deadline gaming (late submission, "just one more commit" edits)
- Checked in the service layer before anything else, **and** by SQLite
  triggers on `INSERT` and on every participant-editable column of `projects`.
  A future handler that forgets the check still cannot write after close.
- Extensions are per team, stored in `deadline_extensions`, honoured by the
  same triggers, and audited with the reason.
- Moving the event deadline is audited with old and new values.
- *Tests:* `TestDeadlineEnforcedByDatabase` (raw SQL bypassing the app), run.py.

### Sybil votes (many accounts, one person)
Voting is authenticated with a per-voter budget (default 3). That stops
ballot stuffing by one account; the rest is about many accounts:
- **Account age:** votes from accounts created after voting opened are
  *held* (counted separately, excluded from the tally) until an organizer
  counts or discards them. The cheap attack, signing up 50 accounts during
  voting, lands entirely in the review queue.
- **Network clustering:** once more than 5 distinct accounts have voted from
  one (hashed) IP in an event, further votes from that IP are held.
- **Sign-up rate limit:** 5 accounts per hour per IP.
- *Test:* `TestVotingRulesAndHiddenResults`.

### Ballot stuffing by one account
- `votes` primary key `(event, user, project)`: one vote per project.
- A trigger enforces the per-event budget in the database (`vote_budget_exhausted`).
- Team members cannot vote for their own project; duplicates and disqualified
  projects are not on the ballot.

### Bandwagon and position effects
- Tallies are hidden from everyone but organizers until publication, and
  publication is **refused while voting is open**.
- Each voter's ballot is shuffled with a per-voter seed (stable on reload,
  different between voters), so listing order cannot favour anyone.

### Submission scraping and duplicate submissions
- Drafts are visible only to the team and organizers; the gallery shows
  submitted projects only.
- Duplicate detection (normalised title or repository URL, earliest wins)
  runs on import and on demand; flagged projects leave the gallery and the
  model but keep their reviews. On the fixture it catches prj_41.

### Spoofed client addresses (dodging per-IP limits)
- The Go server is the network edge. It serves the API itself and
  reverse-proxies pages to Next.js, stripping any client-supplied
  `X-Forwarded-*` headers and setting its own.
- It trusts `X-Forwarded-For` only on requests coming from the frontend's own
  address (resolved from `DOGFOOD_FRONTEND_URL`), i.e. the server-side calls
  that forward the real client, as stamped by Go. Next.js alone would pass a
  client's forged header through (it sets the header only when absent), which
  is why Next is not the edge.

### Colluding judges and targeted favouritism (partly)
- A judge who inflates one friend does not look lenient overall, but that
  review is an **outlier** against the model's prediction (|z| ≥ 2.5). The
  results page lists it with its price in ranks ("worth 10 places").
- Each judge's **agreement** with the consensus computed without them is
  shown; negative agreement is flagged *contrarian*.
- **Leave-one-judge-out** shows whether any single judge decides first place.
- *Test:* `TestOutlierFindsPlantedRogueReview`.

### Results rewritten after publication
- Publication yields a signed manifest committing to the input fingerprint,
  the ranking and the audit hash of the publication. Anyone who saved the
  bundle can prove later that inputs or ranking changed.
  *Test:* `TestVerifiableResultsBundle`.

### Credential attacks
- Passwords: PBKDF2-SHA256, 600,000 iterations, per-user salt, constant-time
  compare; unknown emails take the same time as wrong passwords.
- Login rate limit: 10 per minute per IP (API and form). *Test:* `TestLoginRateLimited`.
- Tokens are 256-bit random; only SHA-256 hashes are stored. Sessions expire
  after 14 days.
- Sign-up cannot claim an imported judge's or participant's email (that
  would inherit their role); those people activate through a one-time link an
  organizer issues. *Test:* `TestSignupCannotClaimImportedAccount`.

### CSRF, XSS, clickjacking, CSV injection
- Cookie sessions are `HttpOnly`, `SameSite=Lax`; every form carries an HMAC
  token bound to the session; cookie-authenticated API writes need
  `X-CSRF-Token`. Bearer calls are CSRF-immune. *Test:* `TestCSRFRequiredForCookieForms`.
- All HTML goes through Go's contextual auto-escaping; CSP forbids inline and
  third-party scripts; pages cannot be framed except the embed widget.
- CSV cells starting with `= + - @` are prefixed with `'`. *Test:* `TestCSVIsInjectionSafe`.

### Rewriting history
- `audit_log` is append-only (triggers refuse `UPDATE`/`DELETE`), and every
  row carries `SHA-256(previous hash ‖ row)`. Reviews, score values,
  deadline moves, extensions, rubric weights, assignments, publication and
  vote moderation are all logged in the same transaction as the change.
- An operator who drops the triggers and edits a row breaks the chain from
  that row on, and the audit page says where. *Test:* `TestAuditChainDetectsTampering`.

### Forged certificates or judging records
- Records are Ed25519-signed over their exact bytes; the public key is at
  `/.well-known/dogfood-signing-key`; anyone can verify offline with
  `dogfood verify-record`. *Test:* `TestFullLifecycle` (a one-digit edit fails).

## Attacks we do not stop

Honest list. Each is a known gap, not an oversight.

| Attack | Why it still works | Mitigation available |
|---|---|---|
| **Sybil voting from many networks with aged accounts** | Without email or phone verification (no external services by design), a patient attacker who creates accounts days before voting, from different IPs, looks like real voters. | Set `votes_per_voter` low, weight community vote lightly, review held votes. Email-domain allowlists would be the next feature. |
| **Colluding judges who agree with each other** | If *every* reviewer of a project inflates it together, there is no honest review to disagree with, so no outlier appears. Outlier detection catches a lone favourite, not a unanimous conspiracy. | Assignment spreads co-reviews across many judge pairs, so a unanimous conspiracy needs every reviewer of that project. A tie-breaker round adds an independent reviewer where it matters. |
| **A malicious organizer** | Organizers can move deadlines, re-weight rubrics and disqualify. | Every such action is in the tamper-evident log with old and new values; publishing the audit export makes it visible. The platform does not pretend organizers are untrusted. |
| **Operator with database access** | Can rewrite rows and recompute the whole hash chain from scratch, before publication. | The signed results bundle anchors the published ranking to the audit hash at publication; anyone who saved it can detect a later rewrite. Before publication the operator is trusted. We do not anchor hashes externally, by design (offline). |
| **Shared-IP false positives** | A classroom behind one NAT trips the network rule. | Votes are held, never dropped; an organizer counts them in one click. |
| **Rate-limit state is in memory** | Restarting the process resets buckets. | Acceptable for one process; a multi-instance deployment would need a shared store. |
| **IP hashes are pseudonymous, not anonymous** | Keyed HMAC with a per-instance secret: not reversible without the database, but the operator could correlate. | Documented; no raw IPs are ever stored. |
| **Webhook URLs point at internal services (SSRF)** | Organizers choose webhook URLs and the server POSTs to them. On a single-tenant self-hosted instance organizers are trusted; local targets are a legitimate offline use. | Do not grant organizer to people you would not give network access. |
