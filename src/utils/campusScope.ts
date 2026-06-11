import type { User } from '../types';

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/** Super Admin or campus-agnostic Admin — can view all campuses. */
export function isSchoolWideUser(user: User): boolean {
  return user.role === 'Super Admin' || (user.role === 'Admin' && !user.campusId);
}

/** Fixed campus for scoped roles; null means no campus lock (school-wide). */
export function getUserCampusScope(user: User): string | null {
  if (isSchoolWideUser(user)) return null;
  return user.campusId || null;
}

export function defaultCampusFilter(user: User): string {
  return getUserCampusScope(user) || 'all';
}

export function canPickCampus(user: User): boolean {
  return isSchoolWideUser(user);
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
  if (urlCampusId && urlCampusId !== 'all') return urlCampusId;
  return 'all';
}

/** Append campusId query when a school-wide user has a campus selected. */
export function pathWithCampus(path: string, user: User, selectedCampus: string): string {
  if (!canPickCampus(user) || selectedCampus === 'all') return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}campusId=${encodeURIComponent(selectedCampus)}`;
}
