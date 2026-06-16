/** Student portal logins use roll numbers like STU-2026-0001 */
export function isStudentRollUsername(username: string): boolean {
  return /^STU-\d{4}-\d+$/i.test(String(username || "").trim());
}

/** Suggest a staff login username from full name (not roll-number style). */
export function suggestLoginUsername(fullName: string, fallback = "user"): string {
  const slug = String(fullName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return slug || fallback;
}

export function staffUsernameFromRoll(role: string, username: string): boolean {
  return role !== "Student" && isStudentRollUsername(username);
}
