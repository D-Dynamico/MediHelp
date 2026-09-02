import { CalendarDays, LayoutDashboard, UserCog } from 'lucide-react';
import { WorkShell, type Section } from '../../components/WorkShell';

/**
 * The doctor's shell. Three sections, because a doctor manages their own day
 * rather than the clinic.
 */
const SECTIONS: Section[] = [
  { to: '/doctor', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/doctor/profile', label: 'Profile', icon: UserCog },
];

export function DoctorLayout() {
  return <WorkShell role="Doctor" sections={SECTIONS} home="/doctor" />;
}
