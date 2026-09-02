# MediHelp screen content and placement

Companion to `medihelp-design-system.md`. That file says how things look. This one says what is on each screen, in what order, and why. It follows the same tokens and components, so "PageHeader", "Card", "Chip" and so on mean the components defined there.

Ordering rule used throughout: **the thing the person came for is at the top, the thing they might need next is below it, and account or settings chores are last.** A worried patient should never scroll past marketing to find a doctor. A doctor should never scroll past stats to see who is waiting.

---

## 1. Navigation map

```
/                      Front page (doctors + triage entry)     public, patient
/triage                Symptom triage                          public, patient
/doctors/:id           Doctor detail + booking                 public, patient (booking needs login)
/login  /signup        Auth                                    public
/my/appointments       Patient appointments + queue card       patient
/my/waitlist           Waitlist offers                         patient (phase 10)
/account               Patient profile                        patient
/board                 Live queue board                        public, no shell (phase 9)

/doctor                Today (dashboard)                       doctor
/doctor/appointments   All appointments                        doctor
/doctor/queue          Queue controls                          doctor (phase 9)
/doctor/profile        Profile, clinic hours, earnings         doctor

/admin                 Overview                                admin
/admin/appointments    All appointments                        admin
/admin/doctors         Doctors                                 admin
/admin/doctors/new     Add doctor                              admin
```

Signed-out visitors see: Find a doctor, Check symptoms, Sign in. Signed-in patients see: Find a doctor, Check symptoms, My appointments, and an avatar menu with Account and Sign out. Doctors and admins never see the patient nav; their shells route them straight to their own home after login.

---

## 2. Public and patient

### 2.1 Front page `/`

There is no separate marketing landing page. The front page is the doctor finder, because that is what almost everyone arrives to do. A short welcome strip sits above it and is dismissed by scrolling, not by a close button.

```
┌────────────────────────────────────────────────────────────────┐
│ MediHelp                     Find a doctor  Check symptoms  Sign in │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Book a doctor at [Clinic name]                                │  h1
│  See who is available today, or describe your symptoms and     │  one sentence, ink-muted
│  we will suggest who to see.                                   │
│                                                                │
│  [ Search by name or speciality        ]  [ Speciality ▾ ]     │  filters, sticky on scroll
│                                                                │
│  ┌─ Not sure who to see? ───────────────────────────────────┐  │  Card tone=info, padding=sm
│  │ Describe your symptoms and get a suggested speciality.    │  │
│  │                                        [ Check symptoms ] │  │  secondary md
│  └───────────────────────────────────────────────────────────┘  │
│                                                                │
│  Available today (6)            All doctors (14)               │  Tabs
│                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │  3-col grid, 1 on mobile
│  │ (avatar) │ │          │ │          │                        │
│  │ Dr Name  │ │          │ │          │                        │  text-body 500
│  │ Cardio.  │ │          │ │          │                        │  text-sm ink-muted
│  │ MD, DM   │ │          │ │          │                        │  text-xs ink-faint
│  │ Next 2:30│ │          │ │          │                        │  text-sm, info colour
│  │ ₹600     │ │          │ │          │                        │  tabular, right
│  └──────────┘ └──────────┘ └──────────┘                        │
└────────────────────────────────────────────────────────────────┘
```

Content rules:
- The welcome copy is two lines, never a hero. No illustration, no stat strip, no testimonials.
- The triage banner has two states. Default is the "Not sure who to see?" prompt. After a triage, it becomes "Suggested from your symptoms: Cardiology" with the urgency chip, the doctor grid pre-filtered to that speciality, and a quiet "Show all doctors" link. It never shows both.
- Each doctor card carries exactly six facts: avatar, name, speciality, degree, next available slot, fee. Experience and bio belong on the detail page. The whole card is the link.
- "Next 2:30 today" is the most useful line on the card and the only coloured text. If nothing is available today it reads "Next Thu 4 Sep" in ink-muted.
- Empty state for a search with no matches: "No doctors match" with a "Clear filters" action.
- Doctor cards for inactive doctors do not appear at all.

### 2.2 Symptom triage `/triage`

Single centred column, `max-w-xl`. Two phases on one URL; the form collapses into a summary when the result arrives.

**Phase 1, the form**
```
Check your symptoms                                   h1
Describe what you are feeling in your own words.     ink-muted
Tell us how long it has been going on if you know.

[ Symptoms                                        ]   Textarea, 4 rows
[ How long has this been going on? (optional)     ]   Input
                                                       
TriageDisclaimer tone=full                             ink-muted, text-sm
                               [ Get a suggestion ]   primary md, right aligned
```

**Phase 2, routine or urgent result**
```
Your symptoms  "chest tightness for 2 days"  Edit    Card padding=sm, collapsed summary

┌────────────────────────────────────────────────┐
│ Cardiology                          (Urgent)   │   h2 + UrgencyChip
│ Your symptoms suggest seeing a heart           │   text-body, max-w-prose
│ specialist within the next day or two.         │
│                                                │
│ A doctor may ask you                           │   h3
│ - Does the tightness get worse with effort?    │   bulleted, text-body
│ - Any pain in your arm or jaw?                 │
│                                                │
│ [ See cardiologists ]   [ Book any doctor ]    │   primary md, secondary md
└────────────────────────────────────────────────┘
TriageDisclaimer tone=quiet
```

"See cardiologists" goes to `/` filtered with the triage attached. "Book any doctor" goes to `/` unfiltered but still attached. The attachment survives until the booking is made or the patient clears it from the front-page banner.

**Phase 2, emergency**: the whole result area is the emergency card from the design system, section 6.1. The collapsed symptom summary stays above it so the person can see what was matched. No tabs, no doctor links, no fee.

### 2.3 Doctor detail and booking `/doctors/:id`

Two-column on `lg`, single column below. Left is who the doctor is, right is when to see them. Booking sits in the right column so it stays visible while reading.

```
← Doctors                                                   breadcrumb

┌ Left (2/5) ─────────────────┐  ┌ Right (3/5) ──────────────────────────┐
│ (avatar xl)                 │  │ Choose a time                     h2  │
│ Dr Asha Menon           h1  │  │                                       │
│ Cardiology · MD, DM         │  │ [Wed 2] [Thu 3] [Fri 4] [Sat 5] ...   │  day strip, 7 days, Tabs style
│ 12 years experience         │  │                                       │
│ ₹600 consultation           │  │ Morning                           h3  │
│                             │  │ [09:00] [09:20] [09:40] [10:00]       │  slot grid, radiogroup
│ About                   h3  │  │ Afternoon                             │
│ Short paragraph, max-w-prose│  │ [14:00] [14:20] [14:40]               │
│                             │  │                                       │
│ Clinic hours            h3  │  │ ┌ From your symptom check ──────────┐ │  Card tone=info, only if attached
│ Mon–Fri 9:00–13:00,         │  │ │ Cardiology, urgent. This will be   │ │
│ 14:00–17:00                 │  │ │ shared with the doctor.  [Remove]  │ │
└─────────────────────────────┘  │ └───────────────────────────────────┘ │
                                 │                                       │
                                 │ How would you like to pay?        h3  │
                                 │ (•) Pay at the clinic  ( ) Pay online │
                                 │                                       │
                                 │ Thu 3 Sep, 09:20 with Dr Menon  ₹600  │  summary line, tabular
                                 │ [ Book this slot                    ] │  primary lg, full width
                                 └───────────────────────────────────────┘
```

Rules:
- The book button is disabled until a slot is chosen, and its label changes to "Sign in to book" when signed out. Clicking it sends the person to login and returns them here with the slot still selected.
- The summary line above the button repeats the exact slot so nobody books the wrong time.
- Taken slots render as disabled with a strikethrough time, not hidden, so the day still reads as a full schedule.
- On mobile the right column comes first and the "About" section moves below the booking panel. People on phones are booking, not reading.
- On success: toast "Booked for Thu 3 Sep, 09:20" and redirect to `/my/appointments` with the new card scrolled into view.

### 2.4 My appointments `/my/appointments`

```
My appointments                                        h1
Upcoming visits first. Past visits are below.          ink-muted

┌ Live queue (only when checked in today) ────────────┐   Card padding=lg, first
│ Your token is T-14                               h1 │
│ 3 people ahead · about 25 min                       │
│ Dr Menon, room 4                                    │
└─────────────────────────────────────────────────────┘

Upcoming                                               h3
┌─────────────────────────────────────────────────────┐   one Card per appointment
│ (avatar) Dr Asha Menon, Cardiology                  │
│ Thu 3 Sep, 09:20  ·  T-14        (Booked) (Unpaid)  │   Chips
│                          [ Pay now ]  [ Cancel ]    │   primary sm, quiet sm
└─────────────────────────────────────────────────────┘

Past                                                   h3, collapsed after 3
│ Tue 12 Aug, 10:00  Dr Rao, Dermatology  (Completed) │   compact rows, no actions
```

- The queue card is the phase 9 patient queue card and only exists on the day of a checked-in appointment. It is always first.
- Cancel opens a Dialog: "Cancel this appointment? Your slot will be offered to someone on the waitlist." Confirm is the red button.
- Empty state: "You have no appointments" with "Find a doctor".
- The waitlist offer (phase 10) appears as a Card tone=info between the queue card and Upcoming, with the countdown and claim button from design system 6.4.

### 2.5 Account `/account`

Single column, `max-w-xl`. One form, one save button at the bottom.

Order: avatar (upload with preview, 96px, "Change photo" quiet button), full name, phone, date of birth, gender, then email as read-only with the hint "Email is used to sign in and cannot be changed here." Save button is `primary md`, right aligned, `loading` while saving, toast "Profile saved".

Below the form, separated by 48px: a "Sign out" quiet button. Nothing else. No danger zone, no delete account in this phase.

### 2.6 Login and signup

Centred Card `max-w-sm`, 32px padding. Wordmark above the card. Title "Sign in" or "Create an account" in h2. Fields, then a full-width primary button, then one line of text with the link to the other page. Signup adds full name above email. Server errors go in a Card tone=danger at the top of the form. After login, redirect to the page the person came from, otherwise to the role home.

---

## 3. Doctor

The doctor shell has four sidebar items: Today, Appointments, Queue, Profile. The doctor's name and speciality sit at the bottom of the sidebar with a sign-out link.

### 3.1 Today `/doctor`

This is the dashboard, renamed to what it is. The doctor opens it between patients, so the queue comes before the numbers.

```
Wednesday 2 September                                  h1
You have 9 appointments today, 3 done.                 ink-muted, computed

┌ Now ──────────────────────────────────────────────────┐   Card tone=info, padding=lg
│ Priya Sharma, 34 y                     T-14  10:30   │   h2 + tabular
│ Triage note: chest tightness, 2 days   (Urgent)      │
│                                        [ Complete ]  │   primary md
└──────────────────────────────────────────────────────┘
       or, when nobody is in progress:
┌ Next up ─────────────────────────────────────────────┐
│ Rahul Verma, 52 y                      T-15  10:50   │
│ Waiting since 10:41                                  │
│                          [ Start consult ]           │
└──────────────────────────────────────────────────────┘

[ Waiting 4 ] [ Done 3 ] [ Cancelled 1 ] [ Earned today ₹1,800 ]     StatTiles, 4 cols

Rest of today                                           h3
AppointmentTable, today only, sorted by time
```

- The "Now" card is the single most important thing on the screen. It mirrors the top row of the queue and carries the one action that matters.
- Stat tiles are small and sit below it. Revenue is the last tile, not the first.
- The table below excludes the appointment already shown in the Now card.

### 3.2 Appointments `/doctor/appointments`

```
Appointments                                            h1
Every visit, past and upcoming.                         ink-muted

[ Today ] [ Upcoming ] [ Past ] [ All ]                 Tabs, default Today
[ Search patient                    ]                   Input, right aligned on md

AppointmentTable                                        design system 6.2
Pagination                                              only on Past and All
```

Row content and action rules are in the design system, section 6.2. The triage note popover shows speciality, urgency chip, the patient's own words in quotes, and the matched questions. It is read-only.

### 3.3 Queue `/doctor/queue` (phase 9)

Full-height two-panel layout. Left, the ordered list of today's checked-in patients as compact rows: token, name, waiting time. Right, a large "Now serving" panel repeating the Now card with three buttons in a fixed order: Call next (primary), Complete (secondary), No show (quiet, opens Dialog). Check-in is a button on each waiting row. The list updates over the socket; a new arrival slides in at the bottom, nothing else moves.

### 3.4 Profile `/doctor/profile`

Three sections, each a Card with its own save button, so saving clinic hours does not resubmit the bio.

1. **About you**: avatar, name, speciality (read-only, set by admin), degree, experience, bio textarea, fee.
2. **Clinic hours**: the AvailabilityGrid. One row per day with start, end, and a remove icon button; an "Add hours" quiet button below; per-row errors under the row. Days with no rows show "Closed" in ink-faint.
3. **Earnings**: three StatTiles (this month, last month, all time) and a short table of the last 10 paid appointments. No charts.

---

## 4. Admin

Sidebar items: Overview, Appointments, Doctors. Add doctor is reached from Doctors, not the sidebar.

### 4.1 Overview `/admin`

```
Overview                                                h1
Clinic activity across all doctors.                     ink-muted

[ Doctors 14 ] [ Patients 1,204 ] [ Appointments today 61 ] [ Revenue this month ₹2,41,000 ]

Latest bookings                                         h3
Compact table: time booked, patient, doctor, slot, status. 10 rows.
                                        See all appointments   link
```

Nothing else. The admin overview answers "is the clinic running normally", and four numbers plus the latest bookings do that.

### 4.2 Appointments `/admin/appointments`

PageHeader, then a filter row (status Select, doctor Select, date range as two inputs, "Clear" quiet button), then the table with columns patient, doctor, slot, fee and payment, status, and a single overflow action per row for cancel. Filters live in the URL so a filtered view can be shared. Pagination at the bottom.

### 4.3 Doctors `/admin/doctors`

PageHeader with the primary action "Add doctor" in the header slot. Table columns: doctor (avatar, name, speciality), fee, appointments this month, active as a Chip, and an action that reads "Deactivate" or "Activate" and opens a Dialog. Inactive doctors are listed last with a neutral chip, not hidden.

### 4.4 Add doctor `/admin/doctors/new`

Breadcrumb "Doctors / Add doctor". One long form split into the same three cards as the doctor's own profile (About, Clinic hours, and Sign-in details with email and a temporary password), with a single "Create doctor" primary button at the end and a "Cancel" quiet button beside it. On success, toast "Dr Menon added" and redirect to the doctors list.

---

## 5. Public queue board `/board` (phase 9)

No shell, no header. One column per doctor with room number, current token in display size, and the next three tokens. A single muted line at the bottom: "MediHelp · Updated 10:31". If a doctor has no one checked in, their column reads "No one waiting" in muted text. Nothing on this screen is clickable.

---

## 6. Shared rules of placement

- **Primary action position**: bottom right of a form, right of a page header, full width at the bottom of a card on mobile. Never floating, never in a sticky bar except the booking button on mobile, which is sticky at the bottom of the doctor detail page.
- **Destructive actions** are always the last item, always quiet or in an overflow, and always confirmed in a Dialog.
- **Status before action**: in any row or card, chips come before buttons, reading left to right or top to bottom.
- **Money is last**: fees and revenue are the final column or the final tile, and they are always tabular and right aligned.
- **One h1 per screen**, and it names what the screen is for in plain words: "Check your symptoms", "Today", "Doctors". No brand words in headings.
- **Help text is one sentence** under the h1. If it needs two, the screen is doing too much.
