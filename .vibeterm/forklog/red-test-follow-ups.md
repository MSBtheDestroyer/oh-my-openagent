# Red-test follow-ups

Load-sensitive or flaky tests found during fork validation. Each entry names the evidence and the next step; fix on its own branch off the integration branch, never inside an unrelated feature branch.

## Git fixture setup timeouts under host load (open)

- Found: 2026-11-17, W14 ([`ses_e295e6a5bffe26sVuR2I7T5GhC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e295e6a5bffe26sVuR2I7T5GhC)), m4max full suite at `fe9029d9cc` (branch `fix/v2-session-location-cwd-v5175`, fast-forwarded onto `origin/v2` the same day). Coordinator classified the rows as environmental, not caused by the candidate.
- Tests (12 rows):
  - `packages/omo-opencode/src/cli/worktree-sweep/worktree-sweep.test.ts`: 11 rows (classification x3, `--older-than` x2, `--apply` x5, output x1). Its `git()` fixture helper runs `spawnSync("git", ...)` with `timeout: GIT_COMMAND_TIMEOUT_MS` (`10_000`, line 17). Every failure is that helper's `git worktree add` dying with `spawnSync git ETIMEDOUT` after ~10s; on an unloaded host the same tests take 0.1-2.1s.
  - `packages/omo-senpi/src/components/thread/worktree/worktree-cleanup.test.ts`: "L1: a worktree create that fails part way leaves nothing behind", hit bun's 20s test timeout while its real `git worktree add` ran.
- Conditions: another session's full `bun test` ran on m4max at the same time (06:55-07:00 CST); 1-min load 11-25. Both files pass 39/0 alone at `fe9029d9cc` and at `99d3756e98`.
- Evidence (m4max): `~/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/w14-triage-v5175-cand-fe902.log` and `.fails.txt`; `w14-diag-{fe9,base}-worktree-files.log`.
- Next step: make the fixture budget not depend on host load: one bound for the whole fixture setup rather than 10s per git call, or a per-call limit sized for a loaded CI host, keeping the setup-phase error message. Verify by running both files under a parallel CPU/IO load and once alone.
