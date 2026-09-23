# 2026-09-23 — Review, plan reconciliation, and phase 10: the auto-waitlist

Scope, in the order agreed: push the branch, run a `/code-review high` over the
design pass and phase 9 (`519e181..HEAD`), reconcile `docs/PHASES.md` with the
code, then build phase 10. Branch `phase-8-ai-triage`, pushed to origin for the
first time at `a35b74b`.

---

## The plan, reconciled with the code

**What changed.** `docs/PHASES.md` only.

- *Phase 11 ticked.* It was done as the design pass on 2026-09-02 and never
  marked. Two items were met differently from their wording and the note under
  the phase says so: a wrong-role visit redirects to the person's own home rather
  than showing a 403 page — the guards exist to keep people off screens that
  would only show them errors — and the offline state is the queue's own
  reconnecting treatment from phase 9.
- *13.3, 13.4 and 13.5 ticked.* Proxy trust and production-only `secure`
  cookies, the Cloudinary provider and the seed's `--force` refusal were all
  built during earlier phases. 13.1 stays open — the root package has no `start`
  script — and 13.2 is untouched.

**Verified.** Each tick checked against the file that implements it.

---

## The code review of the design pass and phase 9, and its fixes

`/code-review high` over `519e181..HEAD` returned ten findings, eight of them
correctness. All ten were fixed before phase 10 was allowed to build on this
code. Two commits: server, then client.

**Server.**

1. *Reading a queue created one.* `buildSnapshot` upserted a `QueueSession`, and
   `queue:join` accepted any date from any signed-in user with no rate limit, so
   one account could walk every date from year 1 to 9999 and write a session for
   each. Reads are now plain `findOne`s; only writes (`recordCalled`,
   `recordServed`) upsert, through one `writeSession` helper. Socket joins are
   also bounded to yesterday through the booking horizon.
2. *The board fell back to an older token.* Only "call next" recorded the called
   token, so a consult started and finished from the appointments table let the
   board drop from T-8 back to whatever "call next" had last seen. `recordCalled`
   now runs inside the shared `startConsult`, so every route that starts a
   consult moves the board.
3. *Two consults could be in progress at once.* `startConsult` now refuses while
   the doctor has anyone else in the room that day. Every queue screen assumed
   one; the second was hidden, and "call next" refused until someone found it.
   `callNext`'s own copy of that check was removed — the shared rule covers it.
4. *A completed consult could come back as a 500.* The median refresh and the
   served count ran after the save with nothing catching them; a blip in either
   told the doctor the action failed, and a retry then failed for real with
   "already marked complete". They now run through `afterward()`, which logs at
   error level and lets the action succeed.
5. *Impossible dates were accepted.* `dayFromKey('2026-02-31')` rolled into
   March, so a socket joined a February room and was sent March's snapshot.
   There is now one `isDayKey` in `utils/dates.ts`, which round-trips the key;
   `doctor.schema.ts` had its own private copy (`isRealCalendarDay`), which is
   gone in favour of it.
6. *The socket validated by hand.* `io.ts` now parses `queue:join` with
   `queueJoinSchema`, and `queue.schema.ts` takes its id rule from
   `objectIdParamSchema` instead of re-declaring it. CLAUDE.md's "validate with
   zod at the boundary" now holds for the socket too.
7. *Every action built the snapshot twice.* `checkIn` hands the snapshot it just
   broadcast to `doctorQueue`, and the separate find-then-update on the session
   became one upsert.

**Client.**

8. *A refused handshake was permanent.* Socket.IO never retries after the server
   rejects the handshake, so a screen whose access token expired during a wifi
   drop said "Reconnecting" until reloaded. `useQueue` now renews the session
   (`refreshSession()`, newly exported from `api/client.ts` and sharing the
   one-at-a-time refresh) and reconnects. A board — whose credential cannot be
   renewed — gets a new `refused` state and says its link has expired.
9. *The patient card trusted stale data.* It read "being seen" from the
   appointment loaded when the page opened, so a finished patient kept being told
   the doctor was ready for them; and a missing snapshot read as "You are next".
   The snapshot now carries `inRoom`, every line of the card is read from the
   snapshot alone, nothing is claimed before one arrives, and when the token is
   neither waiting nor in the room the card asks the page to re-read its list.
10. *A board left on overnight stayed in yesterday's room.* The day key was worked
    out once. It is now worked out at every join, a timer rejoins at UTC
    midnight, and updates for any other day are ignored. The patient card is
    pinned to its appointment's own day instead.

Also from finding 7, client half: the doctor's queue screen no longer re-reads
the list when a broadcast only echoes what its own action already returned.

**Verified.** Ten new assertions in `check-queue.ts` cover findings 1, 2, 3, 5
and 6: a table-started consult moves the board and stays on it after it
finishes, a second start is refused, 31 February is a 422, and three socket
reads — a day long gone, today, and a malformed id — write no session. Findings
4 and 8–10 are not scripted: 4 needs a failing database mid-request, and 8–10
are browser behaviour. Full suite **630 assertions across 15 scripts, zero
failures**; `typecheck`, `lint` and `build` clean.
