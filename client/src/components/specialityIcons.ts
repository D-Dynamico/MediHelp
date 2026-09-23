import type { LucideIcon } from 'lucide-react';
import { Baby, Bone, Brain, HeartPulse, Pill, ScanFace, Stethoscope, Venus } from 'lucide-react';
import type { Speciality } from '@shared/types';

/**
 * One icon per speciality, so a person can find "the heart one" without reading
 * eight labels. Keyed on the shared list, so adding a speciality there is a type
 * error here until it has an icon.
 */
export const SPECIALITY_ICONS: Record<Speciality, LucideIcon> = {
  'General physician': Stethoscope,
  Gynecologist: Venus,
  Dermatologist: ScanFace,
  Pediatrician: Baby,
  Neurologist: Brain,
  Gastroenterologist: Pill,
  Cardiologist: HeartPulse,
  Orthopedist: Bone,
};
