export const INVENTORY_CATEGORIES = [
  'Furniture',
  'IT Inventory',
  'Electrical Items',
  'Stationery',
  'Supplies',
  'Books',
  'Uniforms',
  'Other',
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  Furniture: ['Double Desk', 'Single Desk', 'Table', 'Chair', 'White Board', 'Soft Board', 'Cupboard', 'Shelf'],
  'IT Inventory': [
    'Desktop Computer',
    'Laptop',
    'Printer',
    'LED Monitor',
    'Keyboard',
    'Mouse',
    'UPS',
    'Scanner',
    'Projector',
  ],
  'Electrical Items': ['Fan', 'Tube Light', 'Bulb', 'Extension Board', 'Switch Board', 'Stabilizer'],
  Stationery: ['Notebook', 'Pen', 'Pencil', 'Marker', 'Register', 'Paper Ream', 'Stapler'],
  Supplies: ['Cleaning Supplies', 'First Aid Kit', 'Water Dispenser', 'Other Supply'],
  Books: ['Textbook', 'Workbook', 'Reference Book', 'Quran', 'Library Book'],
  Uniforms: ['Shirt', 'Trouser', 'Tie', 'Scarf', 'Sweater', 'Sports Kit'],
  Other: ['Miscellaneous'],
};

export const INVENTORY_UNITS = ['PCS', 'Box', 'Set', 'Pack', 'Kg', 'Litre'] as const;

export const LED_SIZES = ['17"', '20"', '22"', '24"', '27"', '32"'] as const;

export const ASSET_STATUSES = ['Own Asset', 'Donated'] as const;

export function isItInventoryCategory(category?: string): boolean {
  return category === 'IT Inventory' || category === 'Electronics';
}

export function itemsForCategory(category: string): string[] {
  return INVENTORY_ITEMS_BY_CATEGORY[category] || INVENTORY_ITEMS_BY_CATEGORY.Other;
}

export interface ItAssetSpecs {
  computerModel?: string;
  systemSerialNo?: string;
  processor?: string;
  ram?: string;
  hddCapacity?: string;
  ssdCapacity?: string;
  keyboard?: string;
  mouse?: string;
  ledModel?: string;
  ledSize?: string;
  ledSerialNumber?: string;
  printerModel?: string;
  printerSerialNumber?: string;
  assetStatus?: string;
}

export function emptyItSpecs(): ItAssetSpecs {
  return {
    computerModel: '',
    systemSerialNo: '',
    processor: '',
    ram: '',
    hddCapacity: '',
    ssdCapacity: '',
    keyboard: '',
    mouse: '',
    ledModel: '',
    ledSize: '',
    ledSerialNumber: '',
    printerModel: '',
    printerSerialNumber: '',
    assetStatus: 'Own Asset',
  };
}

export function parseItSpecs(raw?: string | ItAssetSpecs | null): ItAssetSpecs {
  if (!raw) return emptyItSpecs();
  if (typeof raw === 'object') return { ...emptyItSpecs(), ...raw };
  try {
    const parsed = JSON.parse(raw) as ItAssetSpecs;
    return { ...emptyItSpecs(), ...parsed };
  } catch {
    return emptyItSpecs();
  }
}
