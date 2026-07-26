export const PAKISTAN_PROVINCES = [
  'Punjab',
  'Sindh',
  'KPK',
  'Balochistan',
  'Islamabad',
  'Gilgit-Baltistan',
  'Azad Kashmir',
] as const;

export type PakistanProvince = (typeof PAKISTAN_PROVINCES)[number];

export const CITIES_BY_PROVINCE: Record<PakistanProvince, string[]> = {
  Punjab: [
    'Lahore', 'Multan', 'Faisalabad', 'Rawalpindi', 'Gujranwala', 'Sialkot',
    'Bahawalpur', 'Sargodha', 'Sahiwal', 'Jhang', 'Sheikhupura', 'Gujrat',
  ],
  Sindh: [
    'Karachi', 'Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah', 'Mirpur Khas',
    'Jacobabad', 'Shikarpur', 'Thatta', 'Badin',
  ],
  KPK: [
    'Peshawar', 'Mardan', 'Abbottabad', 'Swat', 'Kohat', 'Bannu', 'Dera Ismail Khan',
    'Mansehra', 'Charsadda', 'Haripur',
  ],
  Balochistan: [
    'Quetta', 'Khuzdar', 'Turbat', 'Gwadar', 'Sibi', 'Zhob', 'Loralai', 'Chaman',
  ],
  Islamabad: ['Islamabad'],
  'Gilgit-Baltistan': ['Gilgit', 'Skardu', 'Hunza', 'Ghizer', 'Diamer'],
  'Azad Kashmir': ['Muzaffarabad', 'Mirpur', 'Kotli', 'Rawalakot', 'Bagh'],
};

export function citiesForProvince(province: string): string[] {
  return CITIES_BY_PROVINCE[province as PakistanProvince] ?? [];
}
