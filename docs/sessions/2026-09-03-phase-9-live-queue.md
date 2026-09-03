# 2026-09-03 — Phase 9: the live queue and token board

Scope: build phase 9 end to end, one commit per substep. Continuing on branch
`phase-8-ai-triage` at `6fe7d60` (phases 1–8 plus the design pass).

The design is `docs/SYSTEM_DESIGN.md` §6; the substeps and exit criteria are in
`docs/PHASES.md`. The screens are already specified — design system §6.3 (the
dark wall board) and §6.4 (the patient queue card), and screen content §3.3 and
§5 — so this builds against those rather than inventing a look.

Shape of the phase: sockets first, then the queue's state and the doctor's
controls over it, then the wait estimate, then the two screens that read it.

---

## 9.1 — The Socket.IO server

**What changed.** `socket.io` added to the server and `socket.io-client` to the
client. New `server/src/realtime/io.ts` mounts a Socket.IO server on the API's
own HTTP server, authenticates the handshake, and owns the two room names.
`index.ts` and `scripts/dev-sandbox.ts` call `mountRealtime(server)` after
`listen`. New board-token helpers in `utils/tokens.ts` and day-key helpers in
`utils/dates.ts`. The queue DTOs and the two event names are in `shared/types.ts`
so both sides agree on them.

**Decisions.**

- *The room payload carries numbers and no names.* `QueueSnapshotDto` is what
  `queue:update` broadcasts, and the room behind it is joined by every patient
  of that doctor and by an unauthenticated wall display. A payload with patient
  names in it would put the day's list on a wall and into the hands of anyone
  holding a board link. The doctor's screen needs names, so it reads them over
  its own authenticated endpoint and treats the socket event purely as the
  signal that something changed. This is the single most consequential decision
  in the phase and it shapes 9.3 and 9.5.
- *A third kind of token, checked by `typ`.* The board hangs on a wall with
  nobody signed in, so it cannot hold an access token — but the link must still
  prove it came from us. `signBoardToken` mints a JWT naming one doctor, with no
  user and no role, good for 30 days. `verifyBoardToken` insists on
  `typ: 'board'`; without that check the same secret and issuer would let a
  board token verify as a login and turn a wall link into a long-lived session.
- *Mounted from the bootstrap, not from `createApp`.* The check scripts and any
  test that wants the Express app get one with no socket server attached, and
  `emitQueueUpdate` is a no-op in that case rather than a crash. It is the same
  separation the app/bootstrap split was made for in phase 1.
- *The user's own room is joined for them, the queue room is asked for.*
  `user:{userId}` is joined at connection from the verified identity, so nothing
  a client sends can put it in somebody else's. `queue:join` is an event because
  the room depends on which doctor and day the screen is showing — and a board
  identity may only ask for the one doctor its token names.
- *One queue room per socket.* Joining leaves any queue room already held, so a
  client navigating between doctors does not quietly keep receiving the old
  one's updates.
- *Day keys are UTC, taken off the ISO string.* The room name contains
  `YYYY-MM-DD` and both sides derive it. A client in Kolkata building that from
  local getters would name a different room after 18:30 and hear nothing at all
  — the same class of bug as the `whenOf()` timezone trap.
- *A handshake with no credential is refused.* Nothing here is private, but an
  open socket server is a free amplifier.

**Files.** `server/src/realtime/io.ts` (new), `server/src/index.ts`,
`server/scripts/dev-sandbox.ts`, `server/src/utils/tokens.ts`,
`server/src/utils/dates.ts`, `shared/types.ts`, `server/package.json`,
`client/package.json`.

**Verified.** `npm run typecheck` and `npm run lint` clean. The Vite dev proxy
already forwarded `/socket.io` with `ws: true`, so nothing was needed there.
