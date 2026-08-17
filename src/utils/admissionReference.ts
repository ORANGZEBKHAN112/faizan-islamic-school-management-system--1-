export const ADMISSION_REFERENCE_OPTIONS = [
  'Admin',
  'Principal',
  'Teacher',
  'Relative',
  'Sibling',
  'Head Office',
  'Social Media',
] as const;

export type AdmissionReference = (typeof ADMISSION_REFERENCE_OPTIONS)[number];
