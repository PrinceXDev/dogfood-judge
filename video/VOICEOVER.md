# Dogfood Judge — voiceover script

Generated from `src/narration.json` (the single source of truth). Times are where each line starts in the final video.

## 0:00 · The hook

- `0:00` 41 projects.
- `0:02` 30 judges.
- `0:03` 126 reviews.
- `0:06` One winner.
- `0:07` But can you prove they deserved to win?
- `0:11` This is Dogfood Judge. Results you can defend.

## 0:15 · The problem

- `0:16` Judge A loves everything. Nines and tens.
- `0:19` Judge B is tough. Fives and sixes.
- `0:23` Judge C gives almost everyone a seven.
- `0:26` The usual approach: average the scores, sort, declare a winner.
- `0:30` But judges don't use the scale the same way. Draw the harsh judge, and you lose on luck.
- `0:36` What if one review changed the winner? What if removing one judge flips it?
- `0:42` I built Dogfood Judge to answer those questions.

## 0:45 · The platform

- `0:46` It's a complete, self-hosted hackathon platform: Go, SQLite, and Next.js.
- `0:52` Events, teams, submissions, assignments, scoring, analysis, publishing, and verification.
- `0:58` But the real work happens after scoring.

## 1:01 · Secure judging

- `1:01` Assignments respect tracks, conflicts of interest, and load balance.
- `1:06` Now, what if one judge asks for another judge's scores?
- `1:10` The backend refuses. 403.
- `1:13` Isolation is enforced by the server, not hidden by the UI. A 44-case authorization matrix proves it.

## 1:21 · Normalization

- `1:21` Now, the judging engine.
- `1:24` A raw score mixes two things: how good the project is, and how generous its judges were.
- `1:30` Dogfood models each judge's leniency and scale, using the overlap between judges.
- `1:35` Corrections are shrunk with empirical Bayes, so sparse judges aren't over-corrected.
- `1:40` And every rank comes with error bars: a rank interval, and the probability of a top three finish.

## 1:47 · Is the winner defensible?

- `1:48` Which brings us to the question every losing team asks.
- `1:51` Is the winner defensible?
- `1:53` Dogfood removes each judge in turn and refits the whole model. 30 refits.
- `1:59` On the sample event, first place survives 24 of 30. Six specific judges can change the winner.
- `2:06` The lead over second place? 0.05 standard errors.
- `2:11` Other platforms print first place and move on. Dogfood says it's a coin flip, and how to settle it.

## 2:19 · The review that changed everything

- `2:19` Next, reviews that disagree with everyone.
- `2:22` The model predicts every review. Reviews it can't explain get flagged.
- `2:27` In our test suite, one planted rogue review moved a project from #19 to #29.
- `2:32` It doesn't just flag a review. It measures what that review cost.

## 2:38 · Smart tie-breaking

- `2:38` When the podium is close, reviewing everything again is waste.
- `2:42` Most projects are already settled, near 0% or near 100%.
- `2:47` The tie-breaker round finds the coin flips at the prize line, and adds a judge to each.
- `2:52` Judge time goes where another review can actually change the outcome.

## 2:57 · Pairwise mode

- `2:58` Sometimes a score isn't enough. So there's a pairwise mode.
- `3:02` A judge sees two projects. A, B, or tie.
- `3:06` The server picks the pairs adaptively, so no judge can steer them.
- `3:10` Verdicts are fitted with Bradley–Terry, a regularizing prior, and real standard errors.

## 3:16 · Tamper-evident results

- `3:16` Fairness is half the story. The other half is trust.
- `3:21` Publishing produces a signed bundle: pseudonymized inputs, a fingerprint, an audit anchor, and the ranking.
- `3:28` Anyone can run dogfood verify-results. It re-runs the exact engine, offline.
- `3:33` Verified.
- `3:34` Now change a single score, and run it again.
- `3:38` Verification failed. The fingerprint no longer matches.
- `3:42` Judges can even verify their own reviews in the browser, with Merkle proofs.

## 3:47 · Built to be tested

- `3:48` And it's all tested end to end.
- `3:50` The Go suite boots the real portal. Real SQLite, real HTTP, not mocks.
- `3:56` The organizers' checker passes T1 and T2. Ours covers T3 and T4.
- `4:02` Authorization, deadlines, conflicts of interest, tamper detection, CSRF, CSV injection, rate limits, and signed webhooks.

## 4:11 · Offline and self-hosted

- `4:11` And it all runs on your own machine.
- `4:14` One command. docker compose up.
- `4:17` After the first build, pull the network. It keeps running, with zero outbound requests.

## 4:24 · The payoff

- `4:24` So let's go back to that leaderboard.
- `4:26` This time, the winner comes with evidence.
- `4:32` Picking a winner is easy.
- `4:34` Proving the result is fair is harder.
- `4:37` I'm Prince Panchani. This is Dogfood Judge. Results you can defend.

Total: 4:46
