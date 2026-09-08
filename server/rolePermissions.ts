import type { ConnectionPool } from "mssql";
import crypto from "crypto";

export type PermissionAction = "view" | "create" | "update" | "delete";

export interface ModulePermission {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export type PermissionMap = Record<string, ModulePermission>;

export interface AppModuleDef {
  key: string;
  label: string;
  group: string;
}

export const APP_MODULES: AppModuleDef[] = [
  { key: "dashboard", label: "Dashboard", group: "Overview" },
  { key: "users", label: "Users", group: "Administration" },
  { key: "roles", label: "Role Management", group: "Administration" },
  { key: "campuses", label: "Campuses", group: "Administration" },
  { key: "classes", label: "Classes", group: "Administration" },
  { key: "staff", label: "Staff", group: "Administration" },
  { key: "inventory", label: "Inventory", group: "Administration" },
  { key: "admissions", label: "Admissions", group: "Students & Admissions" },
  { key: "students", label: "Students", group: "Students & Admissions" },
  { key: "documents", label: "ID & Certificates", group: "Students & Admissions" },
  { key: "attendance", label: "Attendance", group: "Students & Admissions" },
  { key: "exams", label: "Exams", group: "Academics" },
  { key: "exam-attendance", label: "Exam Attendance", group: "Academics" },
  { key: "fee-settings", label: "Fee Settings", group: "Finance" },
  { key: "fees", label: "Fees", group: "Finance" },
  { key: "expenses", label: "Expenses", group: "Finance" },
  { key: "reports", label: "Reports", group: "Finance" },
  { key: "quickpay", label: "Quick Pay", group: "System" },
];

export const COLLECTION_TO_MODULE: Record<string, string> = {
  campuses: "campuses",
  classes: "classes",
  students: "students",
  staff: "staff",
  inventory: "inventory",
  attendance: "attendance",
  expenses: "expenses",
  fees: "fees",
  feevouchers: "fees",
  feestructures: "fee-settings",
  "fee-settings": "fee-settings",
  transactions: "fees",
  "quickpay-config": "quickpay",
  exams: "exams",
  examresults: "exams",
  examattendance: "exam-attendance",
  admissions: "admissions",
  admissionapplications: "admissions",
};

export const SUPER_ADMIN_ROLE = "Super Admin";

export function isSuperAdminRole(roleName: string | null | undefined): boolean {
  return String(roleName || "").trim() === SUPER_ADMIN_ROLE;
}

const full = (): ModulePermission => ({ view: true, create: true, update: true, delete: true });

export function fullPermissionMap(): PermissionMap {
  return buildMap(APP_MODULES.map((m) => [m.key, full()]));
}
const viewOnly = (): ModulePermission => ({ view: true, create: false, update: false, delete: false });
const none = (): ModulePermission => ({ view: false, create: false, update: false, delete: false });
const rw = (): ModulePermission => ({ view: true, create: true, update: true, delete: false });
const crudNoDelete = (): ModulePermission => ({ view: true, create: true, update: true, delete: false });

function buildMap(entries: Array<[string, ModulePermission]>): PermissionMap {
  const map: PermissionMap = {};
  for (const mod of APP_MODULES) map[mod.key] = none();
  for (const [key, perm] of entries) map[key] = perm;
  return map;
}

/** Default permissions mirroring legacy hard-coded role gates. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  "Super Admin": buildMap(APP_MODULES.map((m) => [m.key, full()])),
  Admin: buildMap([
    ["dashboard", viewOnly()],
    ["users", none()],
    ["roles", none()],
    ["campuses", full()],
    ["classes", full()],
    ["staff", full()],
    ["inventory", none()],
    ["admissions", full()],
    ["students", full()],
    ["documents", full()],
    ["attendance", full()],
    ["exams", full()],
    ["exam-attendance", full()],
    ["fee-settings", none()],
    ["fees", full()],
    ["expenses", full()],
    ["reports", full()],
    ["quickpay", full()],
  ]),
  Teacher: buildMap([
    ["dashboard", viewOnly()],
    ["students", viewOnly()],
    ["exams", crudNoDelete()],
    ["exam-attendance", crudNoDelete()],
  ]),
  Principal: buildMap([
    ["dashboard", viewOnly()],
    ["campuses", viewOnly()],
    ["classes", full()],
    ["staff", viewOnly()],
    ["admissions", full()],
    ["students", full()],
    ["documents", full()],
    ["attendance", full()],
    ["exams", full()],
    ["exam-attendance", full()],
    ["fees", viewOnly()],
    ["expenses", viewOnly()],
    ["reports", viewOnly()],
  ]),
  Accountant: buildMap([
    ["dashboard", viewOnly()],
    ["fees", full()],
    ["expenses", full()],
    ["reports", viewOnly()],
  ]),
  /** Fee desk: same fee generate/pay rights as Admin finance, plus Kuickpay setup. */
  "Kuickpay Admin": buildMap([
    ["dashboard", viewOnly()],
    ["students", viewOnly()],
    ["fees", full()],
    ["expenses", none()],
    ["reports", viewOnly()],
    ["quickpay", full()],
  ]),
  Student: buildMap([["dashboard", viewOnly()]]),
};

const permissionCache = new Map<string, { at: number; map: PermissionMap }>();
const CACHE_TTL_MS = 30_000;

export function emptyPermissionMap(): PermissionMap {
  return buildMap([]);
}

export function hasPermission(
  map: PermissionMap | null | undefined,
  moduleKey: string,
  action: PermissionAction,
  roleName?: string | null
): boolean {
  if (isSuperAdminRole(roleName)) return true;
  if (!map) return false;
  const mod = map[moduleKey];
  if (!mod) return false;
  return Boolean(mod[action]);
}

export function rowToPermissionMap(rows: Array<Record<string, unknown>>): PermissionMap {
  const map = emptyPermissionMap();
  for (const row of rows) {
    const key = String(row.moduleKey ?? row.module_key ?? "");
    if (!key) continue;
    map[key] = {
      view: Boolean(row.canView ?? row.can_view),
      create: Boolean(row.canCreate ?? row.can_create),
      update: Boolean(row.canUpdate ?? row.can_update),
      delete: Boolean(row.canDelete ?? row.can_delete),
    };
  }
  return map;
}

export async function ensureRoleSchema(pool: ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('AppRoles', 'U') IS NULL
    BEGIN
      CREATE TABLE AppRoles (
        id NVARCHAR(50) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(500) NULL,
        isSystem BIT NOT NULL DEFAULT 0,
        isActive BIT NOT NULL DEFAULT 1,
        createdOn DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE UNIQUE INDEX UX_AppRoles_name ON AppRoles(name);
    END

    IF OBJECT_ID('AppRolePermissions', 'U') IS NULL
    BEGIN
      CREATE TABLE AppRolePermissions (
        id NVARCHAR(50) PRIMARY KEY,
        roleId NVARCHAR(50) NOT NULL,
        moduleKey NVARCHAR(50) NOT NULL,
        canView BIT NOT NULL DEFAULT 0,
        canCreate BIT NOT NULL DEFAULT 0,
        canUpdate BIT NOT NULL DEFAULT 0,
        canDelete BIT NOT NULL DEFAULT 0,
        CONSTRAINT FK_AppRolePermissions_Role FOREIGN KEY (roleId) REFERENCES AppRoles(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX UX_AppRolePermissions_role_module ON AppRolePermissions(roleId, moduleKey);
    END
  `);
}

async function syncSuperAdminPermissions(pool: ConnectionPool, roleId: string): Promise<void> {
  for (const mod of APP_MODULES) {
    const existing = await pool.request()
      .input("roleId", roleId)
      .input("moduleKey", mod.key)
      .query("SELECT id FROM AppRolePermissions WHERE roleId = @roleId AND moduleKey = @moduleKey");

    if (existing.recordset.length === 0) {
      await pool.request()
        .input("id", crypto.randomUUID())
        .input("roleId", roleId)
        .input("moduleKey", mod.key)
        .query(`
          INSERT INTO AppRolePermissions (id, roleId, moduleKey, canView, canCreate, canUpdate, canDelete)
          VALUES (@id, @roleId, @moduleKey, 1, 1, 1, 1)
        `);
    } else {
      await pool.request()
        .input("roleId", roleId)
        .input("moduleKey", mod.key)
        .query(`
          UPDATE AppRolePermissions
          SET canView = 1, canCreate = 1, canUpdate = 1, canDelete = 1
          WHERE roleId = @roleId AND moduleKey = @moduleKey
        `);
    }
  }
  invalidatePermissionCache(SUPER_ADMIN_ROLE);
}

export async function seedAppRoles(pool: ConnectionPool): Promise<void> {
  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existing = await pool.request()
      .input("name", roleName)
      .query("SELECT id FROM AppRoles WHERE name = @name");
    let roleId = existing.recordset[0]?.id as string | undefined;
    if (!roleId) {
      roleId = crypto.randomUUID();
      await pool.request()
        .input("id", roleId)
        .input("name", roleName)
        .input("description", `System role: ${roleName}`)
        .input("isSystem", 1)
        .query(`
          INSERT INTO AppRoles (id, name, description, isSystem, isActive, createdOn)
          VALUES (@id, @name, @description, @isSystem, 1, GETDATE())
        `);
    }

    if (isSuperAdminRole(roleName)) {
      await syncSuperAdminPermissions(pool, roleId);
      continue;
    }

    const forceUpsert = roleName === "Kuickpay Admin";

    for (const mod of APP_MODULES) {
      const perm = permissions[mod.key] ?? none();
      const row = await pool.request()
        .input("roleId", roleId)
        .input("moduleKey", mod.key)
        .query("SELECT id FROM AppRolePermissions WHERE roleId = @roleId AND moduleKey = @moduleKey");

      if (row.recordset.length === 0) {
        await pool.request()
          .input("id", crypto.randomUUID())
          .input("roleId", roleId)
          .input("moduleKey", mod.key)
          .input("canView", perm.view ? 1 : 0)
          .input("canCreate", perm.create ? 1 : 0)
          .input("canUpdate", perm.update ? 1 : 0)
          .input("canDelete", perm.delete ? 1 : 0)
          .query(`
            INSERT INTO AppRolePermissions (id, roleId, moduleKey, canView, canCreate, canUpdate, canDelete)
            VALUES (@id, @roleId, @moduleKey, @canView, @canCreate, @canUpdate, @canDelete)
          `);
      } else if (forceUpsert) {
        await pool.request()
          .input("roleId", roleId)
          .input("moduleKey", mod.key)
          .input("canView", perm.view ? 1 : 0)
          .input("canCreate", perm.create ? 1 : 0)
          .input("canUpdate", perm.update ? 1 : 0)
          .input("canDelete", perm.delete ? 1 : 0)
          .query(`
            UPDATE AppRolePermissions
            SET canView = @canView, canCreate = @canCreate, canUpdate = @canUpdate, canDelete = @canDelete
            WHERE roleId = @roleId AND moduleKey = @moduleKey
          `);
      }
    }
    if (forceUpsert) invalidatePermissionCache(roleName);
  }

  // Existing custom "Kuickpay Access" (or similar) — give same fee desk rights as Kuickpay Admin
  // (skipped when resetKuickpayRoles already rebuilt a clean Kuickpay Admin)
}

/** Delete broken/custom Kuickpay|QuickPay roles (permissions + role rows). Recreate clean Kuickpay Admin. */
export async function resetKuickpayRoles(pool: ConnectionPool): Promise<{ deletedRoles: number }> {
  const roles = await pool.request().query(`
    SELECT id, name FROM AppRoles
    WHERE LOWER(LTRIM(RTRIM(name))) LIKE '%kuickpay%'
       OR LOWER(LTRIM(RTRIM(name))) LIKE '%quickpay%'
  `);

  let deletedRoles = 0;
  for (const role of roles.recordset) {
    await pool.request().input("roleId", role.id).query(`
      DELETE FROM AppRolePermissions WHERE roleId = @roleId;
      DELETE FROM AppRoles WHERE id = @roleId;
    `);
    invalidatePermissionCache(String(role.name));
    deletedRoles += 1;
  }

  // Fresh system role with fee desk defaults
  const desk = DEFAULT_ROLE_PERMISSIONS["Kuickpay Admin"];
  const roleId = crypto.randomUUID();
  await pool.request()
    .input("id", roleId)
    .input("name", "Kuickpay Admin")
    .input("description", "Fee desk: generate vouchers, record payments, Kuickpay setup")
    .input("isSystem", 1)
    .query(`
      INSERT INTO AppRoles (id, name, description, isSystem, isActive, createdOn)
      VALUES (@id, @name, @description, @isSystem, 1, GETDATE())
    `);

  if (desk) {
    for (const mod of APP_MODULES) {
      const perm = desk[mod.key] ?? none();
      await pool.request()
        .input("id", crypto.randomUUID())
        .input("roleId", roleId)
        .input("moduleKey", mod.key)
        .input("canView", perm.view ? 1 : 0)
        .input("canCreate", perm.create ? 1 : 0)
        .input("canUpdate", perm.update ? 1 : 0)
        .input("canDelete", perm.delete ? 1 : 0)
        .query(`
          INSERT INTO AppRolePermissions (id, roleId, moduleKey, canView, canCreate, canUpdate, canDelete)
          VALUES (@id, @roleId, @moduleKey, @canView, @canCreate, @canUpdate, @canDelete)
        `);
    }
  }
  invalidatePermissionCache("Kuickpay Admin");
  return { deletedRoles };
}

export function invalidatePermissionCache(roleName?: string) {
  if (roleName) permissionCache.delete(roleName);
  else permissionCache.clear();
}

/** Fix legacy typo: Principle → Principal (role name in AppRoles and Users). */
export async function migrateRoleNameTypo(pool: ConnectionPool): Promise<void> {
  const typo = await pool.request()
    .input("name", "Principle")
    .query("SELECT id FROM AppRoles WHERE name = @name");
  const typoId = typo.recordset[0]?.id as string | undefined;
  if (!typoId) return;

  const principal = await pool.request()
    .input("name", "Principal")
    .query("SELECT id FROM AppRoles WHERE name = @name");
  const principalId = principal.recordset[0]?.id as string | undefined;

  if (!principalId) {
    await pool.request()
      .input("id", typoId)
      .query("UPDATE AppRoles SET name = 'Principal', description = 'System role: Principal' WHERE id = @id");
  } else {
    await pool.request()
      .input("typoId", typoId)
      .query(`
        DELETE FROM AppRolePermissions WHERE roleId = @typoId;
        DELETE FROM AppRoles WHERE id = @typoId;
      `);
  }

  await pool.request().query("UPDATE Users SET role = 'Principal' WHERE role = 'Principle'");
  invalidatePermissionCache("Principle");
  invalidatePermissionCache("Principal");
}

function normalizeRoleName(roleName: string): string {
  return roleName === "Principle" ? "Principal" : roleName;
}

export async function fetchPermissionsForRole(
  pool: ConnectionPool,
  roleName: string
): Promise<PermissionMap> {
  const normalizedRole = normalizeRoleName(roleName);
  if (isSuperAdminRole(normalizedRole)) {
    const map = fullPermissionMap();
    permissionCache.set(roleName, { at: Date.now(), map });
    return map;
  }

  const cached = permissionCache.get(roleName);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.map;

  const roleResult = await pool.request()
    .input("name", normalizedRole)
    .query(`
      SELECT TOP 1 id FROM AppRoles
      WHERE isActive = 1 AND LOWER(LTRIM(RTRIM(name))) = LOWER(LTRIM(RTRIM(@name)))
    `);

  const roleId = roleResult.recordset[0]?.id as string | undefined;
  if (!roleId) {
    const fallback = DEFAULT_ROLE_PERMISSIONS[normalizedRole] ?? emptyPermissionMap();
    permissionCache.set(roleName, { at: Date.now(), map: fallback });
    return fallback;
  }

  const permResult = await pool.request()
    .input("roleId", roleId)
    .query(`
      SELECT moduleKey, canView, canCreate, canUpdate, canDelete
      FROM AppRolePermissions
      WHERE roleId = @roleId
    `);

  const map = rowToPermissionMap(permResult.recordset);
  permissionCache.set(roleName, { at: Date.now(), map });
  return map;
}

export function permissionsToRows(roleId: string, map: PermissionMap) {
  return APP_MODULES.map((mod) => {
    const p = map[mod.key] ?? none();
    return {
      id: crypto.randomUUID(),
      roleId,
      moduleKey: mod.key,
      canView: p.view,
      canCreate: p.create,
      canUpdate: p.update,
      canDelete: p.delete,
    };
  });
}
