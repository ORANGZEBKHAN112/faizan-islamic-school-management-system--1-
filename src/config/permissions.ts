export type PermissionAction = 'view' | 'create' | 'update' | 'delete';

export interface ModulePermission {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export type PermissionMap = Record<string, ModulePermission>;

export const SUPER_ADMIN_ROLE = 'Super Admin';

export function isSuperAdminRole(roleName: string | null | undefined): boolean {
  return String(roleName || '').trim() === SUPER_ADMIN_ROLE;
}

export const PATH_TO_MODULE: Record<string, string> = {
  '/': 'dashboard',
  '/users': 'users',
  '/roles': 'roles',
  '/campuses': 'campuses',
  '/classes': 'classes',
  '/staff': 'staff',
  '/inventory': 'inventory',
  '/admissions': 'admissions',
  '/students': 'students',
  '/documents': 'documents',
  '/attendance': 'attendance',
  '/exams': 'exams',
  '/exam-attendance': 'exam-attendance',
  '/fee-settings': 'fee-settings',
  '/fees': 'fees',
  '/expenses': 'expenses',
  '/reports': 'reports',
  '/quickpay': 'quickpay',
};

export const ALL_MODULE_KEYS = [...new Set(Object.values(PATH_TO_MODULE))];

export function fullPermissionMap(): PermissionMap {
  const map: PermissionMap = {};
  for (const key of ALL_MODULE_KEYS) {
    map[key] = { view: true, create: true, update: true, delete: true };
  }
  return map;
}

export function moduleFromPath(pathname: string): string {
  if (PATH_TO_MODULE[pathname]) return PATH_TO_MODULE[pathname];
  const match = Object.entries(PATH_TO_MODULE)
    .filter(([path]) => path !== '/')
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return match?.[1] ?? 'dashboard';
}

export function emptyPermissionMap(moduleKeys: string[]): PermissionMap {
  const map: PermissionMap = {};
  for (const key of moduleKeys) {
    map[key] = { view: false, create: false, update: false, delete: false };
  }
  return map;
}

export function hasPermission(
  map: PermissionMap | undefined,
  moduleKey: string,
  action: PermissionAction,
  roleName?: string | null
): boolean {
  if (isSuperAdminRole(roleName)) return true;
  if (!map) return false;
  return Boolean(map[moduleKey]?.[action]);
}

/** First route the user can open after login (avoids bouncing back to login when dashboard is denied). */
export function firstAccessiblePath(
  map: PermissionMap | undefined,
  roleName?: string | null
): string | null {
  if (isSuperAdminRole(roleName)) return '/';
  const order = [
    '/',
    '/students',
    '/admissions',
    '/classes',
    '/campuses',
    '/fees',
    '/attendance',
    '/exams',
    '/exam-attendance',
    '/documents',
    '/expenses',
    '/reports',
    '/staff',
    '/users',
    '/roles',
    '/inventory',
    '/fee-settings',
    '/quickpay',
  ];
  for (const path of order) {
    const moduleKey = PATH_TO_MODULE[path];
    if (moduleKey && hasPermission(map, moduleKey, 'view', roleName)) return path;
  }
  return null;
}
