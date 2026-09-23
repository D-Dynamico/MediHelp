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

---

## 10.1–10.5 — The waitlist, on the server

**Committed together.** Joining, offering, notifying, claiming and sweeping
are one mechanism. Each substep calls the others, and none of them can be checked
on its own — an offer is only meaningful if it can be claimed, a claim only if
it was offered. They ship as one commit with one check script. The UI (10.6)
follows separately.

**What changed.** `node-cron` added to the server. New `modules/waitlist/`:
`waitlist.offers.ts` (`offerNext`, `sweepWaitlist`, `heldSlots`, `isHeld`,
`toWaitlistDto`, `notify`), `waitlist.service.ts` (`joinWaitlist`, `listMine`,
`withdraw`, `claim`), and the schema, controller and routes, mounted at
`/api/waitlist`. New `jobs/waitlistSweeper.ts`, started from `index.ts` and the
sandbox. `emitToUser` in `realtime/io.ts`. `WaitlistEntryDto` and
`WAITLIST_UPDATE_EVENT` in `shared/types.ts`. The appointment service now offers
every cancelled slot, refuses to book a held one, and retires a patient's
waiting entry once they book that day directly. `slotsOn` treats held slots as
taken. New `scripts/check-waitlist.ts`, in `npm run check`.

**Decisions.**

- *An offered slot is held.* `SYSTEM_DESIGN.md` §7 says the slot "returns to open
  inventory" only when the list runs out, which means it is not open while
  someone is being offered it. Without a hold, "you have ten minutes to claim
  this" is a race the person offered it cannot see, against anybody who happens
  to refresh the doctor's page. The catalogue shows a held slot as taken, and a
  booking for it is refused with the same words as a taken slot. The hold is
  worked out from open, unexpired offers — there is no separate lock to release,
  so an offer that lapses holds nothing, whether or not the sweeper has run.
- *Only for a genuinely full day.* Joining is refused while any slot is free.
  Nothing gets cancelled into a day that still has room, so an entry there would
  never be offered anything. It is also refused for a patient who already has an
  appointment with that doctor that day.
- *Offering is one sorted `findOneAndUpdate`.* Picking the first waiting entry
  and marking it offered happen in one atomic step, so two cancellations landing
  together cannot offer both slots to one person or one slot to two people.
  Positions can collide when two people join in the same instant; the sort
  breaks ties by `_id`, so the order stays total and nobody is skipped.
- *No offer for a slot that has begun, and no window past the slot's start.* The
  window is `min(now + 10 min, slotStart)`. A ten-minute claim on a slot starting
  in six would let someone claim a consult already under way.
- *A claim is marked before it is booked, conditionally on the clock.* The
  entry flips `offered → claimed` only if the offer is still open *and*
  `offerExpiresAt` is still ahead. Whichever of claim and sweeper changes the
  state first wins; the other finds nothing to change. Because the clock is in
  the condition, a lapsed offer is refused even on a host that slept through the
  sweeper — which Render's free tier does. A lapsed claim also runs the sweep on
  the spot, so the next person hears straight away.
- *A failed booking after a claim puts the patient back where they were.* The
  booking still goes through the ordinary path — fee from the doctor record,
  token from the slot's position, the unique index. If it fails anyway, the
  patient did nothing wrong, so the entry returns to `waiting` at its original
  position instead of being lost.
- *Letting an offer go passes it on at once.* Withdrawing an offered entry
  cascades immediately rather than holding the slot until the window would have
  closed. Declining and leaving the list are one action, because they are one
  decision: "I no longer want a place that day".
- *Booking directly retires the same patient's waiting entry for that day.*
  Otherwise it would be offered the next cancellation, and hold a slot they have
  no use for until it timed out.
- *The offer is logged.* There is no SMS or email provider, so
  `logger.info('Waitlist offer sent', …)` is the record that an offer went out,
  and the only way to see one in the sandbox without a browser open as that
  patient. That is 10.3's "logged in mock mode".
- *The sweep is a plain function, and the cron job only calls it.*
  `sweepWaitlist(now)` takes the clock as an argument, so the check lapses an
  offer by passing a time eleven minutes ahead instead of waiting eleven
  minutes. The job skips a run while the previous one is still going. Every step
  is a conditional update, so overlap would be safe, but it would be wasted
  work.
- *Offers are pushed to `user:{patientId}`* — the room phase 9 set up and nothing
  used until now. The server joins it for the user from the verified token, so a
  push reaches exactly that account.

**Verified.** `npm run check:waitlist --workspace server`: **41 assertions, all
passing**, covering the phase's three exit sentences with a real socket: the
first person waiting is told live about exactly the freed slot, with about ten
minutes to decide; a lapsed window passes it on live and tells the person whose
window closed; a claim creates an appointment for that slot, with its original
token, at the doctor-record fee. Also covered: the held slot reads as taken and
refuses a walk-in; one patient cannot claim another's offer; an offer claimed
after its window closes is refused before the sweeper runs, and no appointment
is made; with nobody left waiting, a cancelled slot reopens.

Full suite: **671 assertions across 16 scripts, zero failures**. `typecheck` and
`lint` clean.

---

## 10.6 — The waitlist screens

**What changed.** New `client/src/api/socket.ts` (`openSocket`), `api/waitlist.ts`,
`hooks/useWaitlist.ts` and `components/WaitlistPanel.tsx`. `useQueue` now opens
its connection through `openSocket`. `dateOf()` added to `format.ts`. The
booking page offers "Join the waitlist" on a full day. The patient's
appointments page shows offers, lapsed offers and places in line, between the
queue card and the list.

**Decisions.**

- *One helper opens every live connection.* The waitlist needed a socket of its
  own, and the two behaviours the review had just fixed in `useQueue` — reading
  the token at every handshake, and renewing the session after a refused one —
  would otherwise have been copied. They live in `openSocket` once.
- *The waitlist re-reads on every connect, the first included.* A push that
  arrives while the connection is down is lost, so every reconnect is a
  catch-up read. That also makes it the initial load, so there is one code
  path instead of two.
- *Claims are pay-at-the-clinic.* Online payment in this app is chosen at
  booking time and the appointments page only offers it for bookings made that
  way. Ten minutes is no time to put someone through a gateway that might
  stall. The card says "You will pay at the clinic" before they press anything.
- *The countdown is calm.* It follows design system §6.4 to the letter: tabular
  `text-h2`, never red, never flashing. A clock that turns red at thirty
  seconds is built to hurry people, and someone deciding whether they can get
  to a clinic should not be hurried into a yes. Its accessible label gives
  whole minutes, so a screen reader is not announcing every second for ten
  minutes.
- *"Let it go" goes through a `Dialog`.* The design system lists it as one of
  the destructive decisions. It cannot be undone, and the slot goes to someone
  else immediately.
- *An expired offer is neutral, and "Stay on the waitlist" rejoins at the
  back.* Nothing went wrong, so it is not styled as a warning. The copy says
  "at the end of the line" because the people behind have moved up — promising
  the old place would be untrue.
- *The join offer only appears for a patient, or for someone signed out.* A
  doctor or an admin would be refused by the server, and a button that can only
  fail is worse than none. Signed out, it goes to login and back here, the same
  detour as booking.

**Verified.** `npm run typecheck`, `npm run lint` and `npm run build` clean;
`npm run check --workspace client` 14/14. None of it has been opened in a
browser.

---

## Docs updated

- `docs/PHASES.md` — phase 10 ticked, with a note on the hold, pay-at-clinic
  claims, and what the check covers.
- `docs/SYSTEM_DESIGN.md` §7 — rewritten from five bullets into four subsections
  covering joining, offering and the hold, claiming, and the sweeper. §8's API
  surface listed `/api/queue/:doctorId` and `/next`, routes that were never
  built; it now lists the queue and waitlist routes that exist.
- `docs/ARCHITECTURE.md` — `api/socket.ts`, `useWaitlist` and `WaitlistPanel`.
- `README.md` — sixteen check scripts.

## Open items

- **Nothing from phase 9, phase 10 or the design pass has been opened in a
  browser.** Worth clicking for phase 10: fill a day as one patient, join its
  waitlist as a second in another browser, cancel as the first, and watch the
  offer arrive with its countdown; let it lapse (or run the sandbox and wait a
  minute past the window) and watch it move. The sandbox logs "Waitlist offer
  sent" when an offer goes out.
- **Review findings 4 and 8–10 are fixed but unscripted.** A failing database
  mid-request and browser reconnect behaviour are not something the check
  scripts can reproduce.
- **Phase 12 (hardening) and phase 13 (deploy) are what remain.** 13.1 (root
  `start` script) and 13.2 (serving the built client) are the next deploy work.
- **Carried forward:** the branch is not merged to `main`; Claude triage and
  Razorpay have never spoken to the real services; `SEED_ADMIN_EMAIL` still
  defaults to `admin@medihelp.test`.

---

## The UI revision: calm teal, warm neutrals

**Asked for.** The user said the interface "feels a bit sloppy" and asked for a
look at how modern medtech sites handle style and navigation, then an
improvement. Two decisions were theirs and were asked: the direction (**calm
teal on warm neutrals** was chosen over a refined blue or a dark navy), and
whether headless screenshots were acceptable given the standing "don't drive
Chrome" preference (**yes** — recorded in memory as an exception that covers
headless scratchpad browsers, not their own Chrome window).

**How it was judged.** Research first (2026 healthcare UX write-ups: calm teals
and warm neutrals over clinical blue, search-first booking, generous whitespace,
real trust signals over stock photos, soft error states). Then Playwright in the
scratchpad screenshotted all 17 screens at desktop and phone width against the
sandbox, before and after. The sandbox ran with `NODE_ENV=test` for the shoot,
because the login rate limiter counts every page load's session refresh as a
sign-in and tripped after nine pages.

**What the "before" screens showed.** A front page that opened on three stacked
grey boxes with no welcome; dashboards with a table in a card in a card, so
every section had a double border; the work-area sidebar and header centred in a
container and floating mid-screen on a wide monitor; a red Cancel/Remove on
every table row; a sign-in page that was a lone box on grey; a booking page with
half the screen empty; a disabled primary button that looked like a rendering
glitch.

**What changed.**

- *Tokens.* Teal brand (`brand-50/100/500/600/700/800`), warm neutrals, a quiet
  blue for `info` now that the brand is not blue, Plus Jakarta Sans instead of
  IBM Plex, radii 8/14/20px, a `shadow-card` whisper on every card, and a `hero`
  type step. Every text colour was contrast-checked before choosing it; all
  pass AA on both surfaces, and the ratios are in the design doc.
- *Primitives.* Pill buttons with a real disabled state; 44px controls with a
  focus halo; `Card padding="none"`; a new `Section` for titled content; an
  edge-to-edge `TableFrame` that is its own card and must not be put in another;
  stat tiles with small icon badges; a pill `Tabs`; a blurred dialog backdrop.
- *The mark.* A teal rounded square with a cross and a "live" dot, inline SVG
  (`Logo`, `LogoMark`, with an inverted form) and the same as `favicon.svg`.
- *Shells.* The public header is sticky and translucent with pill nav and a
  "Create account" call to action, and every public page gets a footer with the
  emergency line. The work shell is a full-height sidebar pinned left with the
  signed-in person at its foot, and a slim top bar plus pill tab bar on mobile.
- *Screens.* The front page opens with a hero — search first, a link to the
  symptom check, a drawn preview of the live queue card and a waitlist offer,
  and three promises that are each true of this product — then speciality pills
  with icons and doctor cards that lift on hover. The doctor page is two
  columns with a sticky booking panel, times grouped by part of day, and a
  summary line above a full-width book button. Sign in and sign up are split
  screen with a teal brand panel. Appointments are cards with a calendar-leaf
  date. Destructive row actions (admin Cancel, admin Remove, patient Cancel)
  are quiet until hovered; the dialog behind each one is where the red lives.

**Decisions worth knowing.**

- *The first design doc said "cards get no shadow" and "no all-caps anywhere".*
  Both were relaxed deliberately and the doc says so: a hairline alone made
  pages a grid of outlines, and small tracked uppercase is now allowed for table
  headers and slot-group labels only.
- *No stock photography, anywhere.* The auth panel uses soft shapes; the hero
  uses a picture of the product itself. A stock clinician is the least trusted
  image a health site can show.
- *Tailwind config changes need the dev server restarted.* The first "after"
  pass showed the old disabled button because the running Vite still had the
  old config; a restart fixed it. Worth knowing when touching
  `tailwind.config.js`.
- *`npx prettier` is a trap here.* The repo has no Prettier, so `npx` fetched
  one and reformatted a file into double quotes. The file was restored from git
  and the edits reapplied by hand.

**Files.** `client/index.html`, `client/public/favicon.svg` (new),
`client/tailwind.config.js`, `client/src/index.css`,
`client/src/components/ui/{Button,Card,Dialog,Field,PageHeader,StatTile,TableFrame,Tabs,index}.tsx`,
`client/src/components/ui/{Logo,Section}.tsx` (new),
`client/src/components/specialityIcons.ts` (new),
`client/src/components/WorkShell.tsx`, `client/src/pages/public/{SiteLayout,Doctors,DoctorDetail}.tsx`,
`client/src/pages/auth/AuthShell.tsx`, `client/src/pages/patient/Appointments.tsx`,
`client/src/pages/admin/{Dashboard,Doctors,AdminAppointmentTable}.tsx`,
`client/src/pages/doctor/Dashboard.tsx`, `docs/medihelp-design-system.md`.

**Verified.** `typecheck`, `lint` and `build` clean; client check 14/14; the
raw-colour grep over `client/src` returns nothing. Every screen was
re-screenshotted at desktop and phone width and looked at.

**Not verified.** Nothing interactive was clicked through — hover states, the
sticky booking panel while scrolling, and the mobile menu sheet were seen only
as still frames. The phase 9 and 10 screens (queue card, board, waitlist offer)
inherited the new tokens but were not individually re-screenshotted with live
data in them.

---

## Real photographs for the demo doctors

**Asked for.** The user liked the revision but not the cartoon (DiceBear)
avatars on the doctors, and asked for stock images.

**Finding them.** Unsplash's search needs an API key, and its pages sit behind a
proof-of-work bot wall that even the headless browser could not pass, so that
route was dropped. Openverse's CC0 catalogue was reachable, but its 222 stock
results were almost all older Western clinicians, engravings and cartoons.
Portraits like those, put on doctors named Anita Rao or Imran Sheikh, would have
looked as wrong as the cartoons. Pexels' search pages loaded in the headless
browser, and its image server is open. Seventy-six candidates were laid out as a
numbered contact sheet, a shortlist of sixteen was viewed large, and eight were
cast against the profiles: age against years of experience, and gender. Several
candidates turned out to be the same person in different shots, so none was
used twice. Each photographer's name and the licence ("Free", Pexels License)
were read from the photo page.

**What changed.**

- `client/public/doctors/{surname}.jpg` — the eight portraits, cropped square to
  the face and resized to 400×400 (14–27 KB each). With no face detector
  available, and no wish to install one into the user's Python for eight images,
  the crops were set by eye against a 10% grid laid over each photo. Checked on a
  contact sheet.
- `client/public/doctors/CREDITS.md` — photographer and source for each.
- `seed.ts` — doctors are seeded with `/doctors/{surname}.jpg`, served from our
  own origin: no third-party image host to go down, and no request to anyone
  else on each page view.
- `scripts/refresh-demo-photos.ts` (`npm run refresh:photos --workspace
  server`) — updates a database seeded before the photos existed, without a
  wipe. It changes only `@medihelp.test` doctors whose image is still the
  DiceBear cartoon, and only when a photo ships for that surname. It also fixes
  the frozen copy of the image in those doctors' appointments (`docSnapshot`).
  It is idempotent.
- **Run against Atlas**, at the user's request to see the change in the running
  app: 8 doctor photos replaced, 14 appointment snapshots updated.
- The design doc gains a "Photographs" section (2.9). The earlier "no stock
  photography, anywhere" line in this note is superseded: photographs are for
  people, where the person is the subject.

**Verified.** `typecheck` and `lint` clean; `check:seed` 28/28. The live front
page was screenshotted against Atlas after the refresh: every doctor card shows
their photograph.
