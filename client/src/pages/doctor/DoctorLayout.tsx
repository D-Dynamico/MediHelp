import { CalendarDays, LayoutDashboard, ListOrdered, UserCog } from 'lucide-react';
import { WorkShell, type Section } from '../../components/WorkShell';

/**
 * The doctor's shell. Four sections, because a doctor manages their own day
 * rather than the clinic — and four is the ceiling: the mobile bottom tab bar
 * gives each item an equal share of the width, and a fifth would leave labels
 * too narrow to read. Anything more has to go somewhere other than the nav.
 */
const SECTIONS: Section[] = [
  { to: '/doctor', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/doctor/queue', label: 'Queue', icon: ListOrdered },
  { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/doctor/profile', label: 'Profile', icon: UserCog },
];

export function DoctorLayout() {
  return <WorkShell role="Doctor" sections={SECTIONS} home="/doctor" />;
}
