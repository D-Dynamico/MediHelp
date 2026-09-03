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

---

## 9.2 — The queue session, and where tokens really come from

**What changed.** New `server/src/modules/queue/queue.snapshot.ts`: `sessionFor`
(lazy per doctor per day), `buildSnapshot`, `recordServed`, `broadcastQueue`.
`QueueSession` lost `lastIssuedToken` and `avgConsultMins`. `Appointment` gained
`checkedInAt`. The appointment service now broadcasts after cancel, start and
complete.

**Decisions.**

- *Token allocation was not moved into the session, and that is a deliberate
  departure from the substep as written in `docs/PHASES.md`.* 9.2 asked for the
  allocation to move into the booking transaction, which implies a counter on
  the session. The existing `tokenFor` derives a token from the slot's
  **position in the doctor's day**, and that is the better scheme on every axis
  that matters here: two concurrent bookings can never be handed the same
  number, so no lock and no transaction is needed; the board reads in time
  order; and token 7 means the seventh slot of the morning rather than the
  seventh person to click. A counter would have numbered patients by booking
  order, which is not the order anyone is seen in — it would have made the board
  wrong to fix a race that positions do not have. `lastIssuedToken` is therefore
  gone from the model, with a comment in its place saying why, rather than left
  as a field nothing writes.
- *The session is upserted, never found-then-created.* Two screens opening the
  same board at the same moment would both find nothing and both insert, and the
  unique index would answer one of them with a 500. `$setOnInsert` also means an
  upsert racing a real update cannot reset `currentToken` to zero mid-morning.
- *The snapshot's "now serving" comes from the appointment, not the session.*
  The `in_progress` appointment is the fact; `session.currentToken` is a cache of
  it. When they disagree — a consult completed from the appointments table — the
  fact wins. The session is the fallback, which is also what keeps "Now serving
  14" on the wall after 14 walks out and before 15 is called.
- *Broadcasting lives in its own module, not beside the queue's actions.* The
  appointment service has to broadcast too, and putting the broadcast next to
  the queue's own actions would have had the two services importing each other.
  `queue.snapshot.ts` reads models and emits; it calls no service.
- *A failed broadcast is swallowed.* The write already happened. Turning a
  completed consult into an error for the doctor who completed it, because a
  socket was unhappy, would be the wrong trade — the next event or page load
  repairs every screen anyway.
- *`servedCount` is bumped from `completeAppointment`, not from the queue
  screen.* A doctor finishes consults from the appointments table as often as
  from the queue, and a tally that counted only one route would be wrong by
  lunchtime.

**Files.** `server/src/modules/queue/queue.snapshot.ts` (new),
`server/src/models/QueueSession.ts`, `server/src/models/Appointment.ts`,
`server/src/modules/appointments/appointment.service.ts`.

**Verified.** `npm run typecheck` clean.

---

## 9.3 — The doctor's controls, and the board's way in

**What changed.** New `modules/queue/` — `queue.service.ts`, `queue.controller.ts`,
`queue.routes.ts`, `queue.schema.ts`. `markNoShow` added to the appointment
service. Two routers mounted in `app.ts`: `/api/doctor/queue` (guarded) and
`/api/board` (open, signed link only). New `scripts/check-queue.ts`, wired into
`npm run check`, and `socket.io-client` added as a server devDependency so the
check can open a real socket rather than assert about one.

**Decisions.**

- *Calling next refuses while somebody is in the room.* The alternative —
  quietly completing the current consult and calling the next — would record a
  consult length nobody measured and mark a patient seen on a mis-click. Two
  taps is the right price. The message says what to do: "Finish with the patient
  you are seeing first."
- *The next patient is the lowest waiting **token**, not the earliest arrival.*
  Someone who turns up at 09:00 for a 10:30 appointment has not moved ahead of
  the 09:20 one by being early.
- *Checking in twice is a 409, not a no-op.* The second call would move
  `checkedInAt` forward and reset the waiting time the doctor is reading to
  decide who has been kept longest — the opposite of harmless.
- *No-show is its own ending, not a flavour of cancelled.* The slot is released
  either way, but a no-show says the clinic held the time and nobody came. No
  refund is attempted: money taken for a slot that was kept open is a decision
  for a person.
- *An appointment belonging to another doctor answers 404, not 403.* Same reason
  `requireOwnership` does it — a 403 confirms the id exists.
- *`callNext` writes the session before it moves the appointment.* That is what
  leaves a token on the wall after the patient walks out and before the next one
  is called, which is what a waiting-room board is for.
- *The board's doctor id comes out of the token, and the one in the path is only
  compared with it.* Reading the path instead would turn one valid link into a
  key to every doctor's queue. The check asserts exactly that, and also that an
  access token is refused as a board link.
- *Board links are minted, never stored.* No list of live links to leak, no
  revocation story to get wrong; a link stops working after thirty days and the
  doctor asks for another.
- *`/api/doctor/queue` is mounted above `/api/doctor`.* It would have worked
  either way by falling through, but only by accident of the doctor router
  having no `/queue` route of its own.

**Files.** `server/src/modules/queue/{queue.service,queue.controller,queue.routes,queue.schema}.ts`
(new), `server/scripts/check-queue.ts` (new), `server/src/app.ts`,
`server/src/modules/appointments/appointment.service.ts`, `server/package.json`.

**Verified.** `npm run check:queue --workspace server` — **37 assertions, all
passing**, including the three the phase turns on: a listening patient socket is
told about "call next" without asking, the payload it receives contains no
patient name, and a board link for one doctor cannot read or listen to another's
queue. `npm run typecheck` and `npm run lint` clean.

---

## 9.4 — What the wait is actually built on

**What changed.** New `shared/queue.ts` — `etaMinutes`, `etaText`, `positionOf`,
`DEFAULT_CONSULT_MINS`. New `server/src/utils/eta.ts` — re-exports those and adds
`median` and `refreshMedianConsultMins`. `recordConsultLength` is gone from the
appointment service; completing a consult now recomputes the median instead.
Fourteen more assertions in `check-queue.ts`.

**Decisions.**

- *A true median over the last twenty consults, replacing the rolling average.*
  The average was the cheaper thing to keep and it is the wrong shape: one
  consult that genuinely ran ninety minutes because a patient needed ninety
  minutes would drag every estimate after it. A median steps past that. Twenty
  rows sorted on a stored field is a small query and it only runs when a consult
  ends — which is what the phase asked for, and it also makes the field's name
  true for the first time. The check writes lengths of 10, 10, 12, 10 and 120
  and asserts the answer is 10; through the old average it would have been
  around 30.
- *The formula lives in `shared/`, not on one side.* The server reasons about a
  doctor's day with it and the patient's card turns a snapshot into "about 25
  minutes" with it. Two copies would disagree the first time either was tuned,
  and the disagreement would surface as the app quoting one person two different
  waits on two screens. `server/src/utils/eta.ts` re-exports it so the filename
  `docs/PHASES.md` names still exists and still means something.
- *Estimates are rounded to five minutes and phrased with "about".* A queue
  forecast is built on a single number. "About 25 minutes" is honest in a way
  "23 minutes" is not — the false precision gets read as a promise and
  remembered as a lie when the consult before runs long.
- *Zero ahead is "You are next", not one consult's worth.* The person at the
  front is waiting for a door to open, not for another appointment to happen.
- *The sanity window stayed.* Under a minute is a double-tap; over four hours is
  a doctor who forgot to press complete before going home. Neither is a
  measurement, and either would move the estimate for everyone after them.

**Files.** `shared/queue.ts` (new), `server/src/utils/eta.ts` (new),
`server/src/modules/appointments/appointment.service.ts`,
`server/scripts/check-queue.ts`.

**Verified.** `npm run check:queue --workspace server` — **51 assertions, all
passing**. `npm run typecheck` and `npm run lint` clean.

---

## 9.5 and 9.6 — The three screens

**Committed together**, unlike every other substep this session. The patient's
card, the doctor's queue and the wall board share one hook and one route table;
splitting them would have meant a commit whose router imported a page that did
not exist yet, and a broken intermediate commit is worse than a wide one.

**What changed.** `socket.io-client` on the client. New `api/queue.ts`,
`hooks/useQueue.ts`, `components/QueueCard.tsx`, `pages/doctor/Queue.tsx`,
`pages/public/Board.tsx`. The patient's appointments screen shows the queue card;
the doctor's shell gained a Queue section; the router gained `/doctor/queue` and
`/board/:doctorId`. On the server, joining a queue room now hands that socket the
current snapshot (`snapshotProvider`, injected into `mountRealtime`).

**Decisions.**

- *Joining hands the screen the queue as it stands.* Without it a board switched
  on mid-morning shows nothing until the next thing happens, which in a quiet
  clinic is twenty minutes of a blank wall. The provider is **injected into**
  `mountRealtime` rather than imported by it, because the module that builds a
  snapshot is the one that calls `emitQueueUpdate` — importing it inside the
  socket file would have made the two require each other.
- *The socket's `auth` is a function, not an object.* The access token is
  refreshed in the background and rotates. Read once at connect, a reconnection
  an hour later would present a token that expired forty-five minutes earlier
  and the screen would silently stop updating.
- *The doctor's screen ignores the payload and re-reads over HTTP.* The
  broadcast carries no names by design, so for that screen it is a signal that
  something changed rather than a state to render. The doctor's own actions take
  the queue out of their own response and do not wait for the round trip.
- *A lost connection is shown, not hidden.* The patient's card swaps the wait
  time — the one number that can go stale — for an amber "Reconnecting" chip,
  keeping the token and the position, which are still true. The board dims to
  60% and puts a bar at the top. A queue screen that has quietly stopped
  updating is worse than one that admits it.
- *The board's first read is HTTP, everything after is the socket.* An expired
  link has to be able to say so in words; a failed handshake alone would leave
  the wall reading "Reconnecting" forever with no explanation.
- *The board is a `BoardColumn` component even though the route names one
  doctor.* `docs/PHASES.md` says `/board/:doctorId` and the screen content says
  one column per doctor; this satisfies the first and leaves the second a list
  rather than a rewrite.
- *Motion is spent only on the number changing.* A 200ms crossfade keyed on the
  token, and nothing else on the wall moves — movement in the corner of an eye
  reads as "something happened", and on a waiting-room screen that should only
  ever be true.
- *The queue card only exists on the day, and only once checked in.* A live card
  on Tuesday for a Thursday appointment is an invitation to arrive two days
  early. It is read off the list already on screen rather than fetched
  separately, because a checked-in appointment is by definition in "upcoming".
- *The doctor's nav is now at its ceiling of four.* The mobile tab bar splits the
  width equally; a fifth item leaves labels too narrow to read. Noted in
  `DoctorLayout` so the next section has to go somewhere other than the nav.
- *The board link is copied to the clipboard, and a refused clipboard says so.*
  An insecure origin or a browser setting blocks it often enough that failing
  silently would look like a broken button.

**Files.** `client/src/api/queue.ts`, `client/src/hooks/useQueue.ts`,
`client/src/components/QueueCard.tsx`, `client/src/pages/doctor/Queue.tsx`,
`client/src/pages/public/Board.tsx` (all new),
`client/src/pages/patient/Appointments.tsx`,
`client/src/pages/doctor/DoctorLayout.tsx`, `client/src/routes/router.tsx`,
`server/src/realtime/io.ts`, `server/src/modules/queue/queue.snapshot.ts`,
`server/src/index.ts`, `server/scripts/dev-sandbox.ts`,
`server/scripts/check-queue.ts`, `shared/queue.ts`, `server/src/utils/dates.ts`,
`client/package.json`.

**Verified.** `npm run typecheck`, `npm run lint` and `npm run build` all clean.
The whole check suite, run one script at a time: **620 assertions across 15
scripts, zero failures** — env 12, tokens 17, models 13, errors 6, auth 26,
auth:http 28, ratelimit 5, seed 28, upload 21, admin 87, doctor 94, booking 95,
payments 52, triage 83, **queue 53**.

**Not verified in a browser.** Nothing on these three screens has been clicked —
see the open items at the end of this note.

---

## Docs updated

- `docs/PHASES.md` — 9.1–9.6 ticked, with 9.2 rewritten to record that token
  allocation deliberately stayed where it was, and the exit criteria annotated
  with what the check covers and what still needs a human.
- `docs/SYSTEM_DESIGN.md` §6 — rewritten from a six-bullet sketch into the six
  subsections the feature actually has, including the snapshot's privacy rule
  and the board token's `typ` check.
- `docs/ARCHITECTURE.md` — the folder tree said `realtime/queue.gateway.ts`,
  `context/SocketContext` and `hooks/useSocket`, none of which were built. It
  now names what is there.
- `README.md` — the check line said "models, errors, auth, rate limiting, seed",
  which stopped being the whole list several phases ago.

## Open items

- **Nothing in phase 9 has been opened in a browser.** The exit criterion is
  explicitly a three-window walkthrough — doctor, patient, board — and that is a
  human check. The scripted check proves the wire; it does not prove the screens
  read well. Worth clicking: check a patient in and watch the board and the
  patient's card both move; pull the network out and confirm the board dims and
  says "Reconnecting" rather than freezing; open `/doctor/queue` under 768px and
  confirm the two panels stack and the four-item tab bar still reads.
- **The board has never been seen on a real television**, which is the only
  place the `lg:text-[6rem]` step matters.
- **Carried forward, unchanged from the last handoff:** 14 commits now unpushed
  and the branch has never been pushed; phase 8 and the design pass have not
  been reviewed or opened in a browser; the Claude triage path and the Razorpay
  provider have still never spoken to a real API, deliberately;
  `SEED_ADMIN_EMAIL` still defaults to `admin@medihelp.test`.
- **Phase 10 (auto-waitlist) plugs into what was built here.** `user:{userId}`
  rooms exist and are joined at connection but nothing emits to them yet — that
  is the channel a waitlist offer goes down. The `Waitlist` model is already in
  place and the offer card is specified in design system §6.4.
