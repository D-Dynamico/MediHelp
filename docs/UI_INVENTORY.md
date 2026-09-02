# MediHelp — UI inventory (input for a design pass)

Context for whoever is writing the design system doc. This describes **what
exists today**, not what it should be. The app works; it has never had a design
pass.

**Snapshot taken 2026-09-02, at the end of phase 8 of 13.** Phase 11 is the
planned design pass; §7 lists the screens phases 9 and 10 will add, which is why
this is written before the polish rather than after. Re-check it against the code
before relying on it — it is a description, not a contract.

---

## 1. What the product is

A hospital management system. Three roles, three separate journeys, one React app:

- **Patient** — browses doctors, describes symptoms and gets routed, books and
  pays for a slot, manages their own account.
- **Doctor** — sees their day, starts/completes/cancels consults, sets clinic
  hours, reads earnings.
- **Admin** — clinic-wide dashboard, doctor management, all appointments.

The tone should be **calm and clinical, not playful**. People arrive worried.
Two screens carry real weight: the symptom triage result (which can tell someone
to call an ambulance) and the booking confirmation.

## 2. Technical constraints

- React 19 + TypeScript + Vite, React Router (`createBrowserRouter`).
- **Tailwind CSS only.** No component library, no CSS-in-JS, no UI kit. Adding
  one is possible but not currently planned.
- `darkMode: 'class'` **is configured in `tailwind.config.js` but completely
  unused — zero `dark:` classes in the codebase.** Dark mode is unbuilt, not
  broken. Say explicitly whether the system should include it.
- All shared pieces live in **one file**: `client/src/components/ui.tsx`
  (219 lines). Everything else is a page importing from it.
- No animation library, no icon set (currently zero icons anywhere).

## 3. Current design tokens

The whole palette, verbatim from `tailwind.config.js`:

```js
colors: {
  brand:   { 50: '#eef6ff', 100: '#d9ebff', 500: '#2f6fed', 600: '#1f57c9', 700: '#1a459d' },
  ink:     { DEFAULT: '#101827', muted: '#5b6472' },
  surface: { DEFAULT: '#ffffff', sunken: '#f6f8fb' },
}
fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'] }
```

Gaps worth naming in the design doc:

- **No semantic colours.** Success/warning/danger are ad-hoc raw Tailwind
  (`red-50/red-200/red-700/red-800/red-900`, `amber-50/100/800/900`,
  `green-50/800`, `slate-100/200/300/600`) scattered across files.
- **No spacing, radius, shadow or type scale.** Sizes are picked per component:
  radii range across `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full`;
  text is `text-xs`/`text-sm`/`text-lg`/`text-xl`/`text-2xl` chosen by feel.
- **No focus-ring convention.** One input defines a focus ring; nothing else does.

## 4. Existing shared components (`ui.tsx`)

| Component | Props / variants | Notes |
|---|---|---|
| `Card` | `children`, `className` | A white rounded panel. The only container primitive; callers override borders/background via `className` for coloured states. |
| `StatTile` | `label`, `value`, `hint` | Dashboard number tile. |
| `Button` | `variant: 'primary' \| 'quiet' \| 'danger'`, `type`, `disabled`, `onClick` | **No size prop, no loading state, no icon slot, no `as={Link}`.** Anything that needs to be a link is hand-rolled with Tailwind on an `<a>`/`<Link>` — see the triage result's two call-to-action links, which duplicate button styling by hand. |
| `TableFrame` | `head`, `children` | Table wrapper. Scrolls sideways below `min-w-[40rem]` — **tables do not collapse to cards on mobile.** |
| `StatusChip` | `status` (6 appointment statuses) | Pill. booked / checked in / in progress / completed / cancelled / no show. |
| `UrgencyChip` | `urgency` (routine / urgent / emergency) | Pill, colour climbs with severity. |
| `TriageDisclaimer` | `tone: 'full' \| 'quiet'` | Legal/safety text repeated on every triage surface. |
| `Loading` | `label` | A line of muted text. **No skeletons anywhere.** |
| `ErrorNote` | `message` | A line of red text. **No toasts anywhere.** |
| `Empty` | `children` | Empty-state text. Mostly no "next action" offered. |
| `money(rupees)`, `whenOf(iso)`, `paymentLabel(status)` | — | Formatting helpers, not components. |

**Not built, needed in several places already:** Modal/dialog, Toast, Input +
Label + field error (every form hand-rolls these), Select, Textarea, Badge
(generic), Tabs/segmented control, Skeleton, Avatar (hand-rolled in three
places — image or a letter in a circle), Pagination controls, Breadcrumb,
IconButton, Tooltip.

## 5. Screen inventory

### Shared shells
- **`SiteLayout`** — public/patient shell. Top header, brand wordmark left,
  horizontal nav right, sign-in / sign-out. Nav is role-aware.
- **`AdminLayout`**, **`DoctorLayout`** — sidebar shells. Sidebar is a
  `md:w-48` column that becomes a horizontal scrolling strip on mobile.
- **`Placeholder`** — the 404. Title only, no illustration, no way back.

### Public / patient
| Screen | What's on it |
|---|---|
| `public/Doctors` (`/`, the front page) | Search field, speciality filter, responsive grid of doctor cards (avatar, name, speciality, degree, fee). Plus a banner: either "not sure which doctor?" → triage, or "suggested from your symptoms" with an override. |
| `public/DoctorDetail` (`/doctors/:id`) | Doctor header (avatar, name, degree, experience, about, fee), a horizontal day strip, a grid of time-slot buttons, cash/online payment radio group, book button, and a note when a symptom assessment is attached. |
| `patient/Triage` (`/triage`) | Textarea + optional duration input + submit. Then a result card: speciality heading, urgency chip, plain-language advice, a bulleted list of questions, two call-to-action links. **Or**, for an emergency, a red card that replaces all of that — advice to call emergency services, matched indicators, and no booking affordance at all. |
| `patient/Appointments` (`/my/appointments`) | List of appointment cards, cancel and pay actions, a green confirmation banner after booking. |
| `patient/Account` (`/account`) | Profile form: avatar upload with preview, name/phone/DOB/gender, read-only email with an explanation. |

### Auth
| Screen | What's on it |
|---|---|
| `auth/Login`, `auth/Signup` | Centred card, email/password fields, field-level errors, link between the two. |

### Doctor
| Screen | What's on it |
|---|---|
| `doctor/Dashboard` | Stat tiles + today's appointments table. |
| `doctor/Appointments` | Scope tabs (today / upcoming / past / all) + the table. |
| `doctor/AppointmentTable` | Shared row: patient name + age, a collapsed `<details>` "Before the consult" triage note, time + token number, fee + payment label, status chip + urgency chip, and three action buttons (Start / Complete / Cancel). **This row is the densest thing in the app and the most in need of design help.** |
| `doctor/AvailabilityGrid` | Weekly clinic-hours editor — rows of day + start + end with per-row validation errors, add/remove. |
| `doctor/Profile` | Profile form + the availability grid + earnings. |

### Admin
| Screen | What's on it |
|---|---|
| `admin/Dashboard` | Stat tiles (doctors, patients, appointments, revenue) + latest bookings table. |
| `admin/Doctors` | Doctor table with activate/deactivate, link to add. |
| `admin/AddDoctor` | Long creation form incl. image upload and the availability grid. |
| `admin/Appointments` | Filterable, paginated appointment table (status, doctor, date range). |

## 6. Recurring patterns to systematise

1. **Page header** — `h1` + one muted sentence of explanation. Repeated on ~10 screens, hand-written each time.
2. **Form field** — label + input + optional error. Hand-rolled everywhere; no shared component.
3. **Async triad** — `Loading` → `ErrorNote` → `Empty` → content. Every data screen branches through this by hand.
4. **Table** — 4–6 columns, last column right-aligned actions. Four screens.
5. **Chip** — two chip components exist with the same shape and different colour maps; a third is likely.
6. **Card-as-panel** — `Card` plus `className` overrides is doing the work of a variant system (`Card className="border-red-200 bg-red-50"` etc.).
7. **Avatar** — image, or first letter on a tinted circle. Three copies.

## 7. Screens still to come (design for these too)

Phases 9 and 10 are next and add roughly five screens. The system should already
cover them:

- **Live queue board** — full-screen "now serving" display for a waiting room,
  readable across a room, no login, auto-updating over websockets.
- **Patient queue card** — live token number, people ahead, estimated wait, plus
  a reconnecting state.
- **Doctor queue controls** — check in / call next / complete.
- **Waitlist** — join, an offer with a claim window (a countdown), withdraw.

## 8. Known gaps the design doc should address

Taken from the project's own phase 11 plan, which has not been started:

- Consistent page container and layout shell across all three role areas.
- Theme-token-driven primitives, reused rather than re-styled per screen.
- Loading **skeletons**, empty states **with a next action**, **toasts** for
  success and failure, error boundaries per route group.
- **Responsive pass** — every screen at mobile width; tables should collapse to
  cards rather than scrolling sideways.
- **Accessibility** — labelled fields, visible focus rings, keyboard paths
  through booking and the doctor actions, contrast in both themes.
- Edge pages — 404, 403, and an offline/reconnecting state.

## 9. What would be most useful back

- A token set: colour (including semantic success/warning/danger and the three
  urgency levels), type scale, spacing, radius, shadow, and a decision on dark mode.
- A component spec for the primitives in §4 including the missing ones, with
  variants and states (default / hover / focus / disabled / loading / error).
- Layout rules: page container widths, header and sidebar behaviour, the
  breakpoint at which tables become cards.
- Specific direction for the two high-stakes surfaces: the **emergency triage
  card** and the **doctor's appointment row**.
