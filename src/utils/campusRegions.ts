/** Campus region → state options for Campus Management (#23). */
export const CAMPUS_REGIONS = [
  'Karachi',
  'Interior Sindh',
  'Punjab',
  'KPK',
  'Balochistan – Summer Zone',
  'Balochistan – Winter Zone',
  'Kashmir',
  'Islamabad',
  'Gilgit-Baltistan',
] as const;

export type CampusRegion = (typeof CAMPUS_REGIONS)[number];

export const STATES_BY_CAMPUS_REGION: Record<CampusRegion, string[]> = {
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

export function statesForCampusRegion(region: string): string[] {
  return STATES_BY_CAMPUS_REGION[region as CampusRegion] ?? [];
}
