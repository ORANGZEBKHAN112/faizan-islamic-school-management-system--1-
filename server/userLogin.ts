import type sql from "mssql";

export function isStudentRollUsername(username: string): boolean {
  return /^STU-\d{4}-\d+$/i.test(String(username || "").trim());
}

export function suggestLoginUsername(fullName: string, fallback = "user"): string {
  const slug = String(fullName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return slug || fallback;
}

export async function pickUniqueLoginUsername(
  pool: sql.ConnectionPool,
  base: string,
  excludeUserId?: string
): Promise<string> {
  let candidate = base.slice(0, 24);
  let n = 0;
  while (n < 100) {
    const check = await pool.request()
      .input("username", candidate)
      .input("excludeId", excludeUserId || null)
      .query(`
        SELECT id FROM Users
        WHERE username = @username
        ${excludeUserId ? "AND id <> @excludeId" : ""}
      `);
    if (!check.recordset[0]) return candidate;
    n += 1;
    candidate = `${base.slice(0, 20)}${n}`;
  }
  return `${base.slice(0, 12)}${Date.now().toString().slice(-6)}`;
}

/** Staff accounts should not keep student roll numbers as login username. */
export async function normalizeStaffUsernames(pool: sql.ConnectionPool): Promise<number> {
  const rows = await pool.request().query(`
    SELECT id, fullName, username, role FROM Users
    WHERE role <> 'Student' AND username LIKE 'STU-%'
  `);
  let updated = 0;
  for (const row of rows.recordset) {
    const base = suggestLoginUsername(String(row.fullName || ""), "staff");
    const newUsername = await pickUniqueLoginUsername(pool, base, String(row.id));
    if (newUsername === row.username) continue;
    await pool.request()
      .input("id", row.id)
      .input("username", newUsername)
      .query("UPDATE Users SET username = @username WHERE id = @id");
    updated += 1;
    console.log(`[Users] Renamed staff login ${row.username} -> ${newUsername} (${row.fullName})`);
  }
  return updated;
}
