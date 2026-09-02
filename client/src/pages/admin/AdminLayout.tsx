import { CalendarDays, LayoutDashboard, Stethoscope } from 'lucide-react';
import { WorkShell, type Section } from '../../components/WorkShell';

/**
 * The admin's shell. Same shape as the doctor's on purpose — see `WorkShell`.
 */
const SECTIONS: Section[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/doctors', label: 'Doctors', icon: Stethoscope },
  { to: '/admin/appointments', label: 'Appointments', icon: CalendarDays },
];

export function AdminLayout() {
  return <WorkShell role="Admin" sections={SECTIONS} home="/admin" />;
}
