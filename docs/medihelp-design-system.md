# MediHelp design system

How the UI should look and behave. Written against the 2026-09-02 UI inventory (end of phase 8) and meant to be the spec for the phase 11 design pass, while already covering the phase 9 and 10 queue screens.

Direction in one line: **a quiet clinical surface where the only things that stand out are the things that matter to a worried person**, which are urgency, the next action, and their place in the queue.

---

## 1. Principles

1. **Whitespace is the styling.** Hierarchy comes from spacing, type size and one accent colour, not from borders, shadows, gradients or tinted panels. If a screen needs a box to feel organised, the spacing is wrong.
2. **One accent, used for actions only.** Brand blue appears on the primary button, links, focus rings and the active nav item. It is never used as decoration, never as a background wash, never on a heading.
3. **Colour means something.** Red means emergency or a destructive action. Amber means urgent or pending. Green means completed or paid. Grey means everything else. No colour is used for mood.
4. **Borders over shadows.** Panels sit on the page with a 1px hairline border. Shadows are reserved for things that float: modals, toasts, popovers, the mobile bottom bar.
5. **Numbers are data.** Token numbers, fees, wait times and times of day are set in tabular figures so columns line up and values do not jitter when they update.
6. **Every empty or failed state points somewhere.** No dead ends. An empty list offers the action that fills it; an error says what happened and how to retry.
7. **Motion only answers an action.** Toasts slide in, dialogs fade in, a queue number changes with a short crossfade. Nothing animates on page load. `prefers-reduced-motion` disables all of it.

---

## 2. Tokens

All tokens live in `tailwind.config.js` and, for colour, also as CSS variables on `:root` so a dark theme can be added later by swapping variables rather than touching components.

### 2.1 Colour

Neutrals are slightly cool (blue-leaning grey), never warm. The current `ink` and `surface` tokens are kept and extended into a scale.

| Token | Value | Use |
|---|---|---|
| `surface` | `#FFFFFF` | Page and card background |
| `surface-sunken` | `#F5F7FA` | App shell background behind cards, table header rows, inputs on hover |
| `surface-raised` | `#FFFFFF` | Modals, toasts, popovers (same white, differentiated by shadow) |
| `line` | `#E4E8EF` | Hairline borders, dividers, table rules |
| `line-strong` | `#C9D0DB` | Input borders, chip outlines |
| `ink` | `#111827` | Headings, primary text |
| `ink-muted` | `#5B6472` | Body secondary text, labels, hints |
| `ink-faint` | `#8A93A2` | Placeholders, disabled text, timestamps |
| `brand-50` | `#EEF4FF` | Selected slot background, active nav background |
| `brand-500` | `#2A63D9` | Links, focus ring, active indicators |
| `brand-600` | `#1F4FB8` | Primary button fill |
| `brand-700` | `#193F94` | Primary button hover and pressed |

The existing `#2F6FED` is slightly electric for a clinical product; `#2A63D9` is the same hue with a little less saturation. Keep `brand-100` if it is already referenced, otherwise drop it.

**Semantic colours.** Each has three stops: a `bg` for tinted surfaces, a `fg` for text on that tint, and a `solid` for fills and icons. Nothing else is needed.

| Role | bg | fg | solid |
|---|---|---|---|
| `success` | `#EAF7EE` | `#14532D` | `#1E8A4C` |
| `warning` | `#FFF6E5` | `#7A4A00` | `#D98A0B` |
| `danger` | `#FDECEC` | `#7F1D1D` | `#C93B3B` |
| `info` | `#EEF4FF` | `#193F94` | `#2A63D9` |

All `fg` on `bg` pairs pass WCAG AA at body size. `solid` on white passes AA at 14px semibold.

**Urgency is mapped, not invented.** `routine` uses `info`, `urgent` uses `warning`, `emergency` uses `danger`. **Appointment status** maps the same way: booked and checked in use neutral grey, in progress uses `info`, completed uses `success`, cancelled and no show use neutral grey with a strikethrough on the label, never red. Red is reserved so that when it appears it means something.

Replace every raw `red-*`, `amber-*`, `green-*` and `slate-*` class in the codebase with these tokens. There should be zero raw Tailwind colour classes in page files after phase 11.

### 2.2 Dark mode

**Decision: do not ship a dark theme in phase 11.** Remove `darkMode: 'class'` from the config so it stops implying a promise the app does not keep. Because colours are CSS variables, a dark theme is a future one-file change.

**Exception: the live queue board (phase 9) is dark by design.** It is a wall display in a waiting room, often on a bright TV, and dark backgrounds read better at distance and are easier on the room. It gets its own fixed palette (see section 6.3) and does not depend on a global theme toggle.

### 2.3 Typography

**Family: IBM Plex Sans**, weights 400, 500, 600. Fallback `Inter, system-ui, sans-serif`. Plex has a clinical, engineered character that suits a hospital tool, and its tabular figures are excellent. If loading a new webfont is not wanted, keep Inter and everything below still applies.

Enable `font-variant-numeric: tabular-nums` globally on `body`. Apply `lining-nums` too.

One scale, seven steps, defined as Tailwind `fontSize` entries with paired line height:

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-display` | 40 / 44 | 600 | Live queue board only |
| `text-h1` | 28 / 34 | 600 | Page title, one per screen |
| `text-h2` | 20 / 28 | 600 | Section title, card title, dialog title |
| `text-h3` | 16 / 24 | 600 | Sub-section, table group header |
| `text-body` | 15 / 24 | 400 | Default body text, form values |
| `text-sm` | 13 / 20 | 400 or 500 | Labels, table cells, chips, hints |
| `text-xs` | 12 / 16 | 500 | Timestamps, table headers, badges |

Rules:
- Headings are sentence case. No all-caps labels anywhere in the product, including table headers and eyebrow labels.
- Body line length is capped at `max-w-prose` (about 65ch). Triage advice and the account page explanation both need this.
- Letter-spacing is default everywhere except `text-display`, which gets `-0.01em`.
- No italics in the UI.

### 2.4 Spacing

4px base. Use only these steps: `1` (4), `2` (8), `3` (12), `4` (16), `6` (24), `8` (32), `12` (48), `16` (64). Component internals use 2 to 4, gaps between components use 4 to 6, gaps between sections use 8 to 12, and page padding uses 6 on mobile and 8 or above on desktop.

### 2.5 Radius

Three values only.

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 6px | Inputs, buttons, chips, table containers |
| `rounded-md` | 10px | Cards, dialogs, toasts |
| `rounded-full` | 9999px | Avatars, status dots, the pill on the queue board |

Delete every `rounded-lg` and `rounded-xl` usage. Small things get small radii; a card is the only thing that gets the larger one.

### 2.6 Shadow

Two shadows. Cards get none.

| Token | Value | Use |
|---|---|---|
| `shadow-float` | `0 4px 16px rgba(17, 24, 39, 0.08), 0 1px 2px rgba(17, 24, 39, 0.06)` | Popover, toast, mobile bottom bar |
| `shadow-modal` | `0 16px 48px rgba(17, 24, 39, 0.16)` | Dialog |

### 2.7 Focus

One convention, applied through a `focus-visible` utility on every interactive element:

```
outline: 2px solid var(--brand-500);
outline-offset: 2px;
border-radius: inherit;
```

Mouse clicks do not show it (`focus-visible` only). Danger buttons use the same blue ring, not red, so the ring never competes with the button's meaning.

### 2.8 Icons

Adopt **Lucide** at 16px inside text and 20px standalone, stroke width 1.75. Icons appear in exactly these places: navigation items, icon buttons, the status of a toast, the leading position of an empty state, and the emergency card. Buttons with text do not get decorative icons.

---

## 3. Layout

### 3.1 Page container

| Context | Max width | Padding |
|---|---|---|
| Patient and public pages | `max-w-6xl` (72rem) | `px-4 sm:px-6 lg:px-8` |
| Reading surfaces (triage, account, login) | `max-w-xl` (36rem), centred | same |
| Doctor and admin work areas | fluid, `max-w-7xl` | `px-4 sm:px-6` |
| Live queue board | full viewport, no container | `p-12` |

### 3.2 Shells

**SiteLayout (patient and public).** A 64px header on `surface` with a 1px `line` bottom border. Wordmark left, set in `text-h3` weight 600, no logo mark for now. Nav links right in `text-sm` weight 500, active link in `brand-500` with no underline. Sign in is a `quiet` button; sign out sits under the avatar in a small menu. On mobile the nav collapses into a sheet opened by an icon button; the sheet lists the same links at `text-body` with 48px tap targets.

**DoctorLayout and AdminLayout.** Keep the sidebar but make it a real one: 240px fixed on `md` and up, `surface-sunken` background, 1px `line` right border, nav items as 40px rows with a 20px icon and label, active row gets `brand-50` background and `brand-500` text, no left bar. The role name sits at the top in `text-xs` `ink-faint`. On mobile the sidebar is replaced by a **bottom tab bar**, 56px, four items max, `shadow-float`, fixed. The horizontal scrolling strip is removed.

The content area of both shells has a `surface-sunken` background so white cards read as raised without needing shadows.

### 3.3 Page header

One shared component, used on every screen:

```
[h1 title]                                  [optional primary action]
[one sentence in ink-muted, max-w-prose]
```

Title in `text-h1`, description in `text-body` `ink-muted`, 16px between them, 32px below the header before content. The action slot holds at most one button. Breadcrumbs go above the title in `text-sm`, only on screens two levels deep (DoctorDetail, AddDoctor).

### 3.4 Responsive rules

Breakpoints are Tailwind defaults. The decisions that matter:

- **Tables become card lists below `md` (768px).** Above it they are tables. `TableFrame` owns this switch (see 4.4); pages never render two layouts by hand.
- The doctor card grid is 1 column below `sm`, 2 at `sm`, 3 at `lg`.
- Stat tiles are 2 columns on mobile, 4 at `md`.
- Forms are single column always. Two short fields (start and end time, first and last name) may share a row at `sm` and up.
- Minimum tap target is 44px on mobile for anything a patient touches during booking.

---

## 4. Components

Split `ui.tsx` into `components/ui/` with one file per component and a barrel export. The list below is the full set. States are listed once here and apply wherever named: **default, hover, focus-visible, active, disabled, loading, error, selected**.

### 4.1 Button

| Prop | Values |
|---|---|
| `variant` | `primary`, `secondary`, `quiet`, `danger` |
| `size` | `sm` (32px), `md` (40px), `lg` (48px, booking and emergency only) |
| `loading` | boolean, swaps the label for a spinner, keeps width, sets `aria-busy` |
| `as` | `button` or `Link`, so the triage call-to-action links stop hand-rolling styles |
| `iconOnly` | boolean, square, requires `aria-label` |

Styles: `primary` is `brand-600` fill, white text, `brand-700` on hover. `secondary` is white with a `line-strong` border, `ink` text, `surface-sunken` on hover. `quiet` has no border, `ink-muted` text, `surface-sunken` on hover. `danger` is white with a `danger.solid` border and text, and fills red only on hover; a red filled button is reserved for the confirm step inside a destructive dialog. Disabled is 50% opacity with `cursor-not-allowed`. Text is `text-sm` weight 500 at `sm` and `md`, `text-body` at `lg`. Padding is `px-3` at `sm`, `px-4` otherwise.

### 4.2 Field, Input, Select, Textarea

`Field` wraps `Label`, the control, an optional `hint` and an optional `error`. The control is 40px tall, white, `line-strong` border, `rounded-sm`, `text-body`. On hover the border goes to `ink-faint`. On focus it gets the focus ring and the border goes to `brand-500`. On error the border goes to `danger.solid` and the error message renders in `text-sm` `danger.fg` with `aria-describedby` wired. Placeholders are `ink-faint`. Label is `text-sm` weight 500 `ink`, 6px above the control. Required fields do not get an asterisk; optional ones get "(optional)" after the label in `ink-muted`.

`Textarea` has a minimum of 4 rows and grows to 10. `Select` is a native select styled to match with a Lucide chevron.

### 4.3 Card

Props: `padding` (`sm` 16, `md` 24, `lg` 32) and `tone` (`default`, `info`, `success`, `warning`, `danger`). Default is white, `line` border, `rounded-md`, no shadow. Tones set background to the semantic `bg` and border to a 20% mix of `solid`. Remove `className` overrides for colour from every caller; `tone` replaces them.

### 4.4 TableFrame

Owns the responsive switch. Accepts `columns` (label, key, align, `hideOnCard`) and `rows`, plus a `renderCard(row)` for the mobile layout. Above `md`: header row on `surface-sunken`, `text-xs` weight 500 `ink-muted`, 12px vertical cell padding, hairline row dividers, last column right-aligned. Below `md`: a stack of `Card padding="sm"` with the primary field in `text-body` weight 500, secondary fields in `text-sm` `ink-muted`, and actions in a row at the bottom. Rows are never striped and never hover-highlighted unless they are clickable.

### 4.5 Chip

One component replaces `StatusChip` and `UrgencyChip`: `Chip` with `tone` (`neutral`, `info`, `success`, `warning`, `danger`) and an optional leading `dot`. 24px tall, `text-xs` weight 500, `rounded-full`, semantic `bg` and `fg`. Two thin wrappers, `StatusChip` and `UrgencyChip`, keep their current props and do the mapping in section 2.1.

### 4.6 Avatar

`size` (`sm` 32, `md` 40, `lg` 64, `xl` 96) and `src` or `name`. Fallback is the first letter on `brand-50` with `brand-700` text. Replaces the three hand-rolled copies.

### 4.7 StatTile

Keep, restyle: `Card padding="md"`, label in `text-sm` `ink-muted` above, value in `text-h1` tabular, hint in `text-xs` `ink-faint`. The value is the only large thing. No icons, no trend arrows.

### 4.8 Skeleton and Loading

`Skeleton` is a `surface-sunken` block with a slow shimmer, `rounded-sm`, sized by the caller. Provide `SkeletonText` (3 lines), `SkeletonCard` and `SkeletonTable` (5 rows). `Loading` remains for inline cases only (a button, a slot grid refetch). Every data screen uses a skeleton that matches the shape of the content it replaces.

### 4.9 Empty

Icon (20px Lucide, `ink-faint`), one sentence in `text-body` `ink-muted`, and a required `action` prop. "No appointments yet" is followed by "Find a doctor". "No doctors match" is followed by "Clear filters".

### 4.10 ErrorNote and ErrorBoundary

`ErrorNote` becomes `Card tone="danger" padding="sm"` with the message and an optional `onRetry`. `ErrorBoundary` wraps each route group and renders a full-page version with a "Reload" action and a link back to the role's home.

### 4.11 Toast

Bottom-centre on mobile, bottom-right on desktop. `surface-raised`, `shadow-float`, `rounded-md`, 16px padding, a leading 20px icon in the semantic `solid` colour, `text-sm` message, optional single action. Auto-dismisses after 5s, pauses on hover, `role="status"`. Errors do not auto-dismiss. Every mutation in the app (book, pay, cancel, start, complete, save profile, activate doctor) reports through a toast, not an inline banner. The green confirmation banner on Appointments becomes a success toast plus the appointment card scrolled into view.

### 4.12 Dialog

Centred, `max-w-md`, `shadow-modal`, `rounded-md`, 24px padding, title in `text-h2`, body in `text-body` `ink-muted`, actions right-aligned with the primary or danger action last. Backdrop is `ink` at 40%. Focus is trapped, Escape closes, the trigger regains focus on close. Used for cancel confirmations, doctor deactivation and the waitlist claim.

### 4.13 Tabs

Segmented control, 36px tall, `surface-sunken` track, `rounded-sm`, the active segment white with `line` border. Used for the doctor appointment scopes. Keyboard arrows move between tabs.

### 4.14 Pagination

Previous and next as `secondary sm` buttons with a "Page 3 of 12" label between in `text-sm` `ink-muted`. No numbered page buttons.

### 4.15 Tooltip and IconButton

`IconButton` is `Button iconOnly` with a required label. `Tooltip` shows that label on hover and focus after 300ms. Never put essential information in a tooltip.

### 4.16 Placeholder pages

404, 403 and offline share one layout: centred, `max-w-xl`, a 20px icon, `text-h1` title, one sentence, one `primary` button that goes to the role's home. Offline adds a live "Reconnecting" line that turns into a success toast when the socket returns.

---

## 5. Patterns

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

Dark, fixed palette: background `#0F172A`, primary text `#F8FAFC`, muted `#94A3B8`, accent `#60A5FA`. Layout is one column per doctor, each showing the doctor name in `text-h2`, the current token in `text-display` (scale it up to 96px on large screens), and the next three tokens in `text-h1` muted. A token change crossfades over 200ms. A small "Updated 10:31" line in muted text is the only chrome. No header, no nav, no login state. If the socket drops, a `warning.solid` bar appears at the top reading "Reconnecting" and the numbers dim to 60%.

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
7. Sweep: remove every raw colour class and every `rounded-lg`/`rounded-xl`.
