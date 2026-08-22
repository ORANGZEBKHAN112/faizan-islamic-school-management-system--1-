import type { Campus, User } from '../types';

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function getUserCampusIds(user: User): string[] {
  if (user.campusIds && user.campusIds.length > 0) return user.campusIds;
  if (user.campusId) return [user.campusId];
  return [];
}

/** Super Admin or campus-agnostic Admin — can view all campuses. */
export function isSchoolWideUser(user: User): boolean {
  const ids = getUserCampusIds(user);
  return user.role === 'Super Admin' || (user.role === 'Admin' && ids.length === 0 && !user.campusId);
}

/**
 * Fixed single campus for locked roles; null means not locked to one campus
 * (school-wide or multi-campus picker).
 */
export function getUserCampusScope(user: User): string | null {
  if (isSchoolWideUser(user)) return null;
  const ids = getUserCampusIds(user);
  if (ids.length === 1) return ids[0];
  return null;
}

/** null = all campuses (school-wide); string[] = allowed set. */
export function getAllowedCampusIds(user: User): string[] | null {
  if (isSchoolWideUser(user)) return null;
  return getUserCampusIds(user);
}

export function defaultCampusFilter(user: User): string {
  return getUserCampusScope(user) || 'all';
}

export function canPickCampus(user: User): boolean {
  if (isSchoolWideUser(user)) return true;
  return getUserCampusIds(user).length > 1;
}

/** Filter campus list for dropdowns based on user assignment. */
export function campusesForUser(user: User, campuses: Campus[]): Campus[] {
  const allowed = getAllowedCampusIds(user);
  if (!allowed) return campuses;
  const set = new Set(allowed);
  return campuses.filter((c) => set.has(c.id));
}

/** campusId query param for dataService (omit when school-wide and "all"). */
export function campusQueryParam(user: User, selected: string): Record<string, string> | undefined {
  const scope = getUserCampusScope(user);
  const campusId = scope || (selected !== 'all' ? selected : undefined);
  return campusId ? { campusId } : undefined;
}

/** Resolve campus filter from URL query, respecting locked campus scope. */
export function resolveCampusFilter(user: User, urlCampusId?: string | null): string {
  const scope = getUserCampusScope(user);
  if (scope) return scope;
  const allowed = getAllowedCampusIds(user);
  if (urlCampusId && urlCampusId !== 'all') {
    if (allowed && !allowed.includes(urlCampusId)) return allowed[0] || 'all';
    return urlCampusId;
  }
  return 'all';
}

/** Append campusId query when a picker user has a campus selected. */
export function pathWithCampus(path: string, user: User, selectedCampus: string): string {
  if (!canPickCampus(user) || selectedCampus === 'all') return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}campusId=${encodeURIComponent(selectedCampus)}`;
}
