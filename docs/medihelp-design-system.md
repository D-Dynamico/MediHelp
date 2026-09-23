# MediHelp design system

How the UI should look and behave. First written against the 2026-09-02 UI inventory (end of phase 8) as the spec for the phase 11 design pass. **Revised on 2026-09-23** after the user asked for a warmer, sleeker, more modern-medtech look. The first pass was clean but read like hospital IT. This version keeps its rules about what colour means, and changes the surface: teal on warm neutrals, soft corners, a whisper of depth, and a real front page.

Direction in one line: **a calm, warm surface where the only things that stand out are the things that matter to a worried person**, which are urgency, the next action, and their place in the queue.

---

## 1. Principles

1. **Calm first.** Warm off-white pages, generous spacing, soft corners. A clinic's site is the first room a nervous patient walks into; it should feel like a place, not a system.
2. **One accent, spent on what to do next.** Brand teal is for primary buttons, links, focus, the active nav item and selected choices. It may also tint a small icon badge, and wash the front-page hero, the one place the product introduces itself. It is never the colour of a heading.
3. **Colour means something.** Red means emergency or a destructive action. Amber means urgent or pending. Green means completed or paid. Grey means everything else. No colour is used for mood.
4. **Borders, then a whisper of depth.** Cards have a hairline border and the faintest shadow (`shadow-card`). A border alone turned every page into a grid of outlines; a heavy shadow would make every panel look like it floats. Real floating things (dialogs, toasts, the bottom bar, a hovered doctor card) get `shadow-float` or `shadow-modal`. **No card inside a card**: a table is its own card, and a titled table sits in a `Section`.
5. **Numbers are data.** Token numbers, fees, wait times and times of day are set in tabular figures so columns line up and values do not jitter when they update.
6. **Every empty or failed state points somewhere.** No dead ends. An empty list offers the action that fills it; an error says what happened and how to retry.
7. **Motion only answers an action.** Toasts slide in, dialogs fade in, a queue number changes with a short crossfade, a doctor card lifts two pixels on hover. Nothing animates on page load. `prefers-reduced-motion` disables all of it.

---

## 2. Tokens

All tokens live in `tailwind.config.js` and, for colour, also as CSS variables on `:root` in `index.css`, so a dark theme can be added later by swapping variables rather than touching components.

### 2.1 Colour

Neutrals are warm (a hint of stone), not the cool blue-grey of the first pass. Blue-grey on white reads as the hospital's IT system.

| Token | Value | Use |
|---|---|---|
| `surface` | `#FFFFFF` | Cards, header, sidebar |
| `surface-sunken` | `#F7F5F2` | Page background, table header rows, inset panels |
| `surface-raised` | `#FFFFFF` | Modals, toasts, popovers (same white, differentiated by shadow) |
| `line` | `#EBE7E1` | Hairline borders, dividers, table rules |
| `line-strong` | `#D8D2C9` | Input borders, secondary button outline |
| `ink` | `#1C2321` | Headings, primary text (16.0:1 on white) |
| `ink-muted` | `#58625F` | Secondary text, labels, hints (6.3:1 on white, 5.8:1 on sunken) |
| `ink-faint` | `#858D89` | Placeholders and decoration only, never information |
| `brand-50` | `#E8F5F2` | Active nav, selected slot, icon badges, hero wash |
| `brand-100` | `#CFEAE5` | Hover borders, the disabled primary button |
| `brand-500` | `#0E7C71` | Links, focus ring (5.1:1 on white, 4.7:1 on sunken) |
| `brand-600` | `#0F766E` | Primary button fill (white on it is 5.5:1) |
| `brand-700` | `#115E59` | Primary hover, text on `brand-50` (6.8:1), the auth brand panel |
| `brand-800` | `#134E4A` | Depth on the auth brand panel |

Teal rather than blue, because health products have moved to softer teals and greens to lower anxiety, and because blue is what every hospital portal already is.

**Semantic colours.** Each has three stops: a `bg` for tinted surfaces, a `fg` for text on that tint, and a `solid` for fills and icons.

| Role | bg | fg | solid |
|---|---|---|---|
| `success` | `#EAF6EE` | `#1D5C3A` | `#2F855A` |
| `warning` | `#FFF5E3` | `#7A4A00` | `#D98A0B` |
| `danger` | `#FDECEB` | `#8A2323` | `#C93B3B` |
| `info` | `#EDF4FA` | `#1E4E79` | `#3B6FB6` |

`info` is its own quiet blue now that the brand is teal, so an informative panel (a waitlist offer, a triage suggestion) is never mistaken for a brand surface. All `fg` on `bg` pairs pass WCAG AA at body size.

**Urgency is mapped, not invented.** `routine` uses `info`, `urgent` uses `warning`, `emergency` uses `danger`. **Appointment status** maps the same way: booked and checked in use neutral grey, in progress uses `info`, completed uses `success`, cancelled and no-show use neutral grey with a strikethrough on the label, never red.

There are no raw Tailwind colour classes in `client/src`, and there should never be.

### 2.2 Dark mode

**Not shipped.** There is no `darkMode` key in the config, so nothing implies a promise the app does not keep. Because colours are CSS variables, a dark theme is a future one-file change.

**Exception: the live queue board (phase 9) is dark by design.** It is a wall display, often on a bright TV; dark reads better at distance. It has its own fixed palette (section 6.3), now with a teal accent (`#5EEAD4`, 12:1 on the board background) to match the app.

### 2.3 Typography

**Family: Plus Jakarta Sans**, weights 400, 500, 600, 700. Fallback `Inter, system-ui, sans-serif`. Humanist and round-shouldered, with true tabular figures. IBM Plex, the first choice, read engineered: right for a terminal, cold for a waiting room.

`font-variant-numeric: tabular-nums lining-nums` is set globally on `body`.

One scale, eight steps, each with its line height fixed:

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-hero` | 52 / 56, -0.025em | 700 | The front page's opening line, and nothing else |
| `text-display` | 40 / 44, -0.02em | 700 | Page titles on desktop, stat values, the board, the auth headline |
| `text-h1` | 28 / 34, -0.015em | 700 | Page titles on mobile, section titles on the front page |
| `text-h2` | 20 / 28, -0.01em | 600 to 700 | Section title, card title, dialog title |
| `text-h3` | 16 / 24 | 600 | Sub-section |
| `text-body` | 15 / 24 | 400 | Default body text, form values |
| `text-sm` | 13 / 20 | 400 to 600 | Labels, table cells, chips, hints |
| `text-xs` | 12 / 16 | 500 to 600 | Timestamps, table headers, badges |

Rules:
- Headings are sentence case. **One exception:** small tracked uppercase (`text-xs font-semibold uppercase tracking-wide`) for table header rows and slot-group labels ("Morning"), which are signposts rather than reading.
- Body line length is capped at `max-w-prose`.
- No italics in the UI.

### 2.4 Spacing

4px base. Component internals use 2 to 4, gaps between components 4 to 6, gaps between sections 8 to 12. Page padding is 4 on mobile and 8 to 10 on desktop.

### 2.5 Radius

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 8px | Inputs, small inset panels |
| `rounded-md` | 14px | Cards, day tiles, toasts, pay options |
| `rounded-lg` | 20px | Large panels: the front-page hero, dialogs, the live queue preview |
| `rounded-full` | 9999px | Buttons, chips, pills, tabs, nav items, avatars |

Buttons are pills. The first pass's 6px/10px corners read like a spreadsheet.

### 2.6 Shadow

| Token | Value | Use |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(28,35,33,.04), 0 2px 8px rgba(28,35,33,.04)` | Every default card; the search bar; the tab control |
| `shadow-float` | `0 8px 24px rgba(28,35,33,.10), 0 2px 4px rgba(28,35,33,.04)` | Toasts, the mobile bottom bar, a hovered doctor card |
| `shadow-modal` | `0 24px 64px rgba(28,35,33,.20)` | Dialogs |

Shadows are tinted with `ink`, not black, so they sit on the warm page instead of greying it. Tinted cards (`tone="info"` and the rest) carry no shadow: their colour already sets them apart.

### 2.7 Focus

`:focus-visible` draws `2px solid var(--brand-500)` at a 2px offset, on everything interactive. Text inputs also get a soft 4px `brand-50` halo on focus (`focus:ring-4 focus:ring-brand-50`), so where you are typing is unmistakable. Mouse clicks do not show the outline. Danger buttons use the same teal ring, never red.

### 2.8 Icons

**Lucide**, 16px inline and 18 to 20px standalone. Icons appear in navigation, icon buttons, toasts, empty states, the emergency card, and (added in the revision) as small tinted badges that help an eye find something in a group: stat tiles, the doctor's fact tiles, the front page's three promises, and one icon per speciality (`components/specialityIcons.ts`, keyed on the shared speciality list so a new speciality is a type error until it has one). Buttons with text still do not get decorative icons, with one exception: a trailing arrow on a link-like button ("Book →").

### 2.9 Photographs

**Doctors are shown with real photographs.** The first seed used generated cartoon avatars, which the user found childish on a clinic's site. The eight demo doctors now use licensed portraits (Pexels License) of South Asian clinicians, chosen to match each profile's age and gender. They are cropped square to the face at 400×400 and shipped in `client/public/doctors/`, with a `CREDITS.md` naming each photographer and source. They are served from our own origin, not hot-linked. `Avatar` renders them in a circle; a doctor's own upload replaces theirs. Photographs are for people, where the person is the subject. Illustration surfaces such as the auth panel and the hero use shapes and the product's own components.

### 2.10 The mark

A soft-cornered teal square with a white cross, and a bright teal dot in the corner: the cross says what the place is, and the dot is the "live" in the live queue. It is drawn inline (`components/ui/Logo.tsx`) rather than loaded, so it is sharp at any size, and it has an inverted form for the teal auth panel. The same mark is `public/favicon.svg`.

---

## 3. Layout

### 3.1 Page container

| Context | Max width | Padding |
|---|---|---|
| Patient and public pages | `max-w-6xl` (72rem) | `px-4 sm:px-6 lg:px-8` |
| Reading surfaces (triage, account) | `max-w-xl`, centred | same |
| Sign in and sign up | split screen at `lg`, form column `max-w-md` | `px-4 sm:px-10 lg:px-16` |
| Doctor and admin work areas | `max-w-6xl` beside a 256px sidebar | `px-4 sm:px-6 md:px-10` |
| Live queue board | full viewport, no container | `p-12` |

### 3.2 Shells

**SiteLayout (patient and public).** A 64px header, sticky, `surface` at 85% with a backdrop blur so a long doctor list scrolls under it without losing the way home. The mark and wordmark on the left. Nav links on the right as pills: `text-sm` weight 600, the active one on `brand-50` in `brand-700`. Signed out, "Sign in" is a `quiet` button and "Create account" is the `primary`. Signed in, a divider, then the avatar (to the account) and Sign out. On mobile the links move into a sheet with 48px pill rows. **A footer** closes every public page: the mark, one line about the product, and the emergency line on a `danger-bg` panel — "In an emergency, do not book. Call 112" — because the bottom of the page is where people look for "what if it is serious".

**WorkShell (doctor and admin).** A full-height 256px sidebar pinned to the left edge, `surface`, with a `line` right border: the mark and a role tag at the top, the sections as 44px pill rows (active on `brand-50` in `brand-700`), and the signed-in person — avatar, name, email and a sign-out icon button — at the foot. The page sits beside it in a `max-w-6xl` column. There is no separate top header on desktop; the first pass centred the sidebar and header inside one container, which left both floating mid-screen on a wide monitor, lined up with nothing. On mobile the sidebar becomes a 56px sticky top bar (mark, role, sign out) and a **bottom tab bar** of at most four items, each an icon in a pill that fills `brand-50` when active, with the label under it.

### 3.3 Page header

One shared component, used on every work screen:

```
[h1 title]                                  [optional primary action]
[one sentence in ink-muted, max-w-prose]
```

Title in `text-h1` bold, `text-display` from `lg`. Description in `text-body` `ink-muted`. At most one action. A back link ("← All doctors") goes above the title only on screens two levels deep.

The front page does not use it: it opens with the hero (section 5.1).

### 3.4 Responsive rules

- **Tables become card lists below `md` (768px).** `TableFrame` owns this switch; pages never render two layouts by hand.
- The doctor card grid is 1 column below `sm`, 2 at `sm`, 3 at `lg`.
- Speciality pills scroll sideways in one row on a phone and wrap from `sm`.
- On the doctor page, booking comes first on a phone and the profile second; side by side from `lg`, with the booking panel sticky.
- Forms are single column. Minimum tap target is 44px for anything a patient touches.

---

## 4. Components

`components/ui/`, one file per component, one barrel. States apply wherever named: **default, hover, focus-visible, active, disabled, loading, error, selected**.

### 4.1 Button

| Prop | Values |
|---|---|
| `variant` | `primary`, `secondary`, `quiet`, `danger` |
| `size` | `sm` (36px), `md` (44px), `lg` (48px) |
| `loading` | swaps the label for a spinner, keeps width, sets `aria-busy` |
| `as` | `button` or `link` |
| `iconOnly` | square, requires a label |
| `filled` | fills a `danger` button: the confirm step of a destructive dialog and the emergency call, nothing else |

All buttons are **pills**, weight 600, and press down one pixel. `primary` is `brand-600` with a small shadow, `brand-700` on hover; **disabled primary is `brand-100` with `brand-700` text at 80%**, which reads as "not yet" where half-opacity read as a rendering fault. `secondary` is white with a `line-strong` border. `quiet` has no border. `danger` is a red outline. **Destructive row actions are `quiet` and turn `danger-bg` only on hover** — a red outline on every row of a table turned the whole list into a warning; the dialog behind the button carries the seriousness.

### 4.2 Field, Input, Select, Textarea

`Field` wraps the label, the control, an optional hint and an optional error, and wires `aria-describedby`. The control is 44px, white, `line-strong` border, `rounded-sm`. On focus the border goes `brand-500` and a 4px `brand-50` halo appears. On error the border goes `danger-solid` and the message renders in `danger-fg`. Required fields carry no asterisk; optional ones say "(optional)".

### 4.3 Card and Section

`Card` props: `padding` (`none`, `sm` 16, `md` 24, `lg` 32) and `tone`. Default is white, `line` border, `rounded-md`, `shadow-card`. Tones use the semantic `bg` with a 20% `solid` border and no shadow.

`Section` is a titled part of a page: an `h2`, an optional line under it, an optional action on the right, and its children. **It is what a table or list with a heading sits in**, replacing the old pattern of a `Card` with an `h2` inside, which put a table's own card inside a second one.

### 4.4 TableFrame

Owns the responsive switch. Accepts `columns` (label, key, align, `hideOnCard`) and `rows`, plus a `renderCard(row)` for the mobile layout. Above `md`: **the table is its own card**, edge to edge (`Card padding="none"`), with a tinted header row in small tracked uppercase, 16px vertical cell padding, hairline row dividers. It is never placed inside another card; a titled table goes in a `Section`. Below `md`: a stack of `Card padding="sm"` with the primary field in `text-body` weight 500, secondary fields in `text-sm` `ink-muted`, and actions in a row at the bottom. Rows are never striped and never hover-highlighted unless they are clickable.

### 4.5 Chip

One component replaces `StatusChip` and `UrgencyChip`: `Chip` with `tone` (`neutral`, `info`, `success`, `warning`, `danger`) and an optional leading `dot`. 24px tall, `text-xs` weight 500, `rounded-full`, semantic `bg` and `fg`. Two thin wrappers, `StatusChip` and `UrgencyChip`, keep their current props and do the mapping in section 2.1.

### 4.6 Avatar

`size` (`sm` 32, `md` 40, `lg` 64, `xl` 96) and `src` or `name`. Fallback is the first letter on `brand-50` with `brand-700` text. Replaces the three hand-rolled copies.

### 4.7 StatTile

`Card`, label in `text-sm` `ink-muted`, an optional small icon in a `brand-50` badge on the right, the value in `text-display` bold, a hint in `text-xs`. The value is the largest thing; the icon only helps an eye find "revenue" among four. No trend arrows or sparklines.

### 4.8 Skeleton and Loading

`Skeleton` is a `surface-sunken` block with a slow shimmer, `rounded-sm`, sized by the caller. Provide `SkeletonText` (3 lines), `SkeletonCard` and `SkeletonTable` (5 rows). `Loading` remains for inline cases only (a button, a slot grid refetch). Every data screen uses a skeleton that matches the shape of the content it replaces.

### 4.9 Empty

Icon (20px Lucide, `ink-faint`), one sentence in `text-body` `ink-muted`, and a required `action` prop. "No appointments yet" is followed by "Find a doctor". "No doctors match" is followed by "Clear filters".

### 4.10 ErrorNote and ErrorBoundary

`ErrorNote` becomes `Card tone="danger" padding="sm"` with the message and an optional `onRetry`. `ErrorBoundary` wraps each route group and renders a full-page version with a "Reload" action and a link back to the role's home.

### 4.11 Toast

Bottom-centre on mobile, bottom-right on desktop. `surface-raised`, `shadow-float`, `rounded-md`, 16px padding, a leading 20px icon in the semantic `solid` colour, `text-sm` message, optional single action. Auto-dismisses after 5s, pauses on hover, `role="status"`. Errors do not auto-dismiss. Every mutation in the app (book, pay, cancel, start, complete, save profile, activate doctor) reports through a toast, not an inline banner. The green confirmation banner on Appointments becomes a success toast plus the appointment card scrolled into view.

### 4.12 Dialog

Centred, `max-w-md`, `shadow-modal`, `rounded-lg`, 24px padding, title in `text-h2`, body in `text-body` `ink-muted`, actions right-aligned with the primary or danger action last. Backdrop is `ink` at 40% with a slight blur. Focus is trapped, Escape closes, the trigger regains focus on close. Used for cancel confirmations, doctor deactivation and the waitlist claim.

### 4.13 Tabs

A pill segmented control, 44px tall, white with a `line` border and `shadow-card`; the active segment is a `brand-600` pill with white text. Used for the doctor appointment scopes. Keyboard arrows move between tabs.

### 4.14 Pagination

Previous and next as `secondary sm` buttons with a "Page 3 of 12" label between in `text-sm` `ink-muted`. No numbered page buttons.

### 4.15 Tooltip and IconButton

`IconButton` is `Button iconOnly` with a required label. `Tooltip` shows that label on hover and focus after 300ms. Never put essential information in a tooltip.

### 4.16 Placeholder pages

404, 403 and offline share one layout: centred, `max-w-xl`, a 20px icon, `text-h1` title, one sentence, one `primary` button that goes to the role's home. Offline adds a live "Reconnecting" line that turns into a success toast when the socket returns.

---

## 5. Patterns

**5.1 The front page.** It opens with a hero, not a filter form: someone arriving from a search engine has not decided to book yet. A `rounded-lg` panel with a soft `brand-50` wash holds an eyebrow pill naming the three features, the `text-hero` line, one sentence, a pill search bar with a leading icon that filters the list live, and a text link to the symptom check. On `lg` a tilted picture of the live queue card and a waitlist offer sits beside it, drawn in the app's own components and hidden from assistive technology: it shows the one thing no other booking page has, in the form the patient will meet it. Three promises close the hero, each true of this product. Below it, the doctors: a heading with the count, speciality pills with icons, and cards that lift on hover and end in a "Book →" pill.

**5.2 The booking panel.** Two columns from `lg`: who on the left (avatar, speciality pill, four fact tiles, about, address), when on the right, sticky. Days are 64px tiles; times are pills grouped under Morning, Afternoon and Evening; the selected time is a `brand-50` pill with a `brand-600` ring. The summary line above the full-width `lg` button repeats the exact slot and the fee.

**5.3 Sign in and sign up.** Split screen from `lg`: a `brand-700` panel with soft circles rather than a photograph, the inverted mark, one headline, three one-line reasons, and the emergency line; the form on the right. On a phone, the form alone.


**Async triad.** A `useAsync`-style hook returning `status` and a `<AsyncState>` component that takes `skeleton`, `error`, `empty` and `children` so pages stop branching by hand.

**Forms.** Every form uses `Field`. Submit buttons carry `loading`. Server errors land in a `Card tone="danger"` at the top of the form and the first invalid field receives focus.

**Destructive actions.** Cancel appointment, deactivate doctor and withdraw from waitlist go through a `Dialog` whose confirm button is the only red-filled button in the app.

**Money and time.** `money()` output is always tabular and right-aligned in tables. `whenOf()` renders "Wed 2 Sep, 10:30" and never a raw ISO string.

---

## 6. High-stakes surfaces

### 6.1 Emergency triage card

This is the one place the system spends its boldness. When the triage result is an emergency, the entire result area is replaced by a single `Card tone="danger" padding="lg"`:

```
[!]  Get emergency help now
     Your symptoms match signs that need urgent medical attention.

     Matched signs
     - chest pain spreading to the arm
     - shortness of breath

     [ Call 108 ]                    (primary, lg, danger fill, tel: link)

     If you are with someone, ask them to stay with you.
     [quiet] Back to symptoms
```

Rules: the heading is `text-h1` in `danger.fg`. The call button is full width on mobile, `lg`, red filled, and the only red filled button outside a dialog. There is no doctor list, no booking link, no fee, no urgency chip, and no `TriageDisclaimer` in its `full` form (the `quiet` form sits below the fold). The card has no border animation and no pulsing. Nothing else on the screen competes with it.

For routine and urgent results the card is `tone="default"`; the urgency chip and speciality heading carry the message, and the two call-to-action links become `Button as={Link}` in `primary` and `secondary`.

### 6.2 Doctor appointment row

Above `md`, redesign the row as five columns with a fixed rhythm:

| Patient | Time | Payment | Status | Actions |
|---|---|---|---|---|
| Name in `text-body` 500, "34 y" in `text-sm` `ink-muted` below, then a "Triage note" quiet button that opens a popover instead of an inline `<details>` | Time in tabular `text-body`, token "T-14" in `text-xs` `ink-faint` below | Fee tabular, payment label as a neutral `Chip` below | `StatusChip` and, only when urgent or emergency, `UrgencyChip` stacked | One visible action matching the state (Start, then Complete), plus an overflow `IconButton` holding Cancel |

Showing one action instead of three is the biggest density win: a booked row shows "Start", an in-progress row shows "Complete", and Cancel always lives in the overflow behind a dialog. Routine urgency shows no chip at all, so the column stays quiet until it matters.

Below `md` the same row becomes a card with the patient name as the title, time and token on one line, chips on the next, and the action button full width at the bottom.

### 6.3 Live queue board (phase 9)

Dark, fixed palette: background `#0F172A`, primary text `#F8FAFC`, muted `#94A3B8`, accent `#5EEAD4` (teal, to match the app; 12:1 on the background). Layout is one column per doctor, each showing the doctor name in `text-h2`, the current token in `text-display` (scale it up to 96px on large screens), and the next three tokens in `text-h1` muted. A token change crossfades over 200ms. A small "Updated 10:31" line in muted text is the only chrome. No header, no nav, no login state. If the socket drops, a `warning.solid` bar appears at the top reading "Reconnecting" and the numbers dim to 60%.

### 6.4 Patient queue card and waitlist (phases 9 and 10)

The patient queue card is a `Card padding="lg"` with the token number in `text-h1` tabular, "3 people ahead" in `text-body`, and "About 25 min" in `ink-muted`. A reconnecting state swaps the wait time for an amber `Chip` reading "Reconnecting". The waitlist offer is a `Card tone="info"` with a countdown in tabular `text-h2`, a `primary lg` "Claim this slot" button and a `quiet` "Let it go". The countdown never flashes or turns red; when it expires the card becomes a neutral "Offer expired" state with a "Stay on the waitlist" action.

---

## 7. Accessibility floor

- Every input has a visible label; placeholders are never the only label.
- Every icon button has `aria-label`.
- Focus order follows reading order on booking (day strip, slot grid, payment, book) and on doctor actions.
- The slot grid is a `radiogroup`; selected slot uses `brand-50` background, `brand-500` border and `aria-checked`.
- Colour is never the only signal: chips carry text, errors carry messages, the emergency card carries a heading.
- Contrast meets AA everywhere, including the dark queue board.
- All motion respects `prefers-reduced-motion`.

---

## 8. Migration order

1. Tokens: colours, type scale, radius, shadow, focus utility. Delete `darkMode`.
2. Split `ui.tsx` into `components/ui/`. Build `Button`, `Field`, `Card` with `tone`, `Chip`, `Avatar`, `Skeleton`, `Empty`, `Toast`, `Dialog`.
3. Shells: header, sidebar, bottom tab bar, `PageHeader`, `ErrorBoundary`, placeholder pages.
4. `TableFrame` with the card switch, then migrate the four table screens.
5. Forms: replace hand-rolled fields on Login, Signup, Account, Profile, AddDoctor, AvailabilityGrid.
6. Emergency card and the doctor appointment row.
7. Sweep: remove every raw colour class and every `rounded-xl`.

**Revision of 2026-09-23**, done in this order: the token swap (teal, warm neutrals, Plus Jakarta Sans, 8/14/20px radii, `shadow-card`, the `hero` type step); the primitives (pill buttons with a real disabled state, taller controls with a focus halo, `Section`, the edge-to-edge `TableFrame`, stat tiles with icons, the pill `Tabs`); the mark and favicon; both shells; then the four screens that carried the most weight — the front page, the doctor page, sign in and sign up, and the patient's appointments list.
