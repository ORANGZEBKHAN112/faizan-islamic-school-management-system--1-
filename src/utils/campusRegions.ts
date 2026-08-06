/** Campus State → Region cascade for Campus Management (#30). */

export const CAMPUS_STATES = [
  'Sindh',
  'Punjab',
  'KPK',
  'Balochistan',
  'Kashmir',
  'Islamabad',
  'Gilgit-Baltistan',
] as const;

export type CampusState = (typeof CAMPUS_STATES)[number];

/** Stored region values (Campuses.region) with UI labels under each state. */
export const REGIONS_BY_STATE: Record<CampusState, Array<{ value: string; label: string }>> = {
  Sindh: [
    { value: 'Karachi', label: 'Karachi' },
    { value: 'Interior Sindh', label: 'Interior Sindh' },
  ],
  Punjab: [{ value: 'Punjab', label: 'Punjab' }],
  KPK: [{ value: 'KPK', label: 'KPK' }],
  Balochistan: [
    { value: 'Balochistan – Summer Zone', label: 'Summer Zone' },
    { value: 'Balochistan – Winter Zone', label: 'Winter Zone' },
  ],
  Kashmir: [{ value: 'Kashmir', label: 'Kashmir' }],
  Islamabad: [{ value: 'Islamabad', label: 'Islamabad' }],
  'Gilgit-Baltistan': [{ value: 'Gilgit-Baltistan', label: 'Gilgit-Baltistan' }],
};

/** Flat list of stored region values (Books, Exams filters). */
export const CAMPUS_REGIONS = CAMPUS_STATES.flatMap((state) =>
  REGIONS_BY_STATE[state].map((r) => r.value),
) as readonly string[];

export type CampusRegion = (typeof CAMPUS_REGIONS)[number];

/** Optional city options under a stored region (kept for address detail). */
export const CITIES_BY_CAMPUS_REGION: Record<string, string[]> = {
  Karachi: ['Karachi'],
  'Interior Sindh': ['Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah', 'Mirpur Khas', 'Jacobabad', 'Shikarpur'],
  Punjab: ['Lahore', 'Multan', 'Faisalabad', 'Rawalpindi', 'Gujranwala', 'Sialkot', 'Bahawalpur', 'Sargodha'],
  KPK: ['Peshawar', 'Mardan', 'Abbottabad', 'Swat', 'Kohat', 'Bannu', 'Dera Ismail Khan'],
  'Balochistan – Summer Zone': ['Turbat', 'Gwadar', 'Sibi', 'Zhob', 'Loralai', 'Chaman', 'Hub'],
  'Balochistan – Winter Zone': ['Quetta', 'Khuzdar'],
  Kashmir: ['Muzaffarabad', 'Mirpur', 'Kotli', 'Rawalakot', 'Bagh'],
  Islamabad: ['Islamabad'],
  'Gilgit-Baltistan': ['Gilgit', 'Skardu', 'Hunza', 'Ghizer', 'Diamer'],
};

/** @deprecated Use CITIES_BY_CAMPUS_REGION — kept for older imports. */
export const STATES_BY_CAMPUS_REGION = CITIES_BY_CAMPUS_REGION;

export function regionsForCampusState(state: string): Array<{ value: string; label: string }> {
  return REGIONS_BY_STATE[state as CampusState] ?? [];
}

export function stateForCampusRegion(region: string): string {
  const trimmed = (region || '').trim();
  if (!trimmed) return '';
  for (const state of CAMPUS_STATES) {
    if (REGIONS_BY_STATE[state].some((r) => r.value === trimmed)) return state;
  }
  if (trimmed.includes('Balochistan')) return 'Balochistan';
  if (trimmed === 'Karachi' || trimmed === 'Interior Sindh') return 'Sindh';
  return '';
}

export function citiesForCampusRegion(region: string): string[] {
  return CITIES_BY_CAMPUS_REGION[region] ?? [];
}

/** @deprecated Use citiesForCampusRegion */
export function statesForCampusRegion(region: string): string[] {
  return citiesForCampusRegion(region);
}
