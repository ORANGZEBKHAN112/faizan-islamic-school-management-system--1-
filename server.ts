import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import sql from "mssql";
import multer from "multer";
import readXlsxFile from "read-excel-file/node";
import { parse, format, isValid } from "date-fns";
import crypto from "crypto";
import {
  ensureScalingSchema,
  startScalingWorkers,
  refreshDashboardCampusStats,
  archiveOldFees,
} from "./server/scalingJobs.js";
import {
  APP_MODULES,
  COLLECTION_TO_MODULE,
  ensureRoleSchema,
  seedAppRoles,
  fetchPermissionsForRole,
  hasPermission,
  invalidatePermissionCache,
  permissionsToRows,
  emptyPermissionMap,
  isSuperAdminRole,
  fullPermissionMap,
  migrateRoleNameTypo,
  type PermissionAction,
  type PermissionMap,
} from "./server/rolePermissions.js";
import {
  runAdmissionCnicReview,
  normalizeCnic,
  createEnrollmentFeeVoucher,
  type AdmissionReviewResult,
} from "./server/admissionReview.js";
import {
  ADMISSION_TEST_PASS_MARKS,
  ADMISSION_DOC_TYPES,
  generateAdmissionTrackingNo,
  sendAdmissionSms,
  contactMatchesApplication,
  type AdmissionDocType,
} from "./server/admissionHelpers.js";
import {
  isStudentRollUsername,
  suggestLoginUsername,
  pickUniqueLoginUsername,
  normalizeStaffUsernames,
} from "./server/userLogin.js";

interface JwtPayload {
  id: string;
  username: string;
  role: string;
  campusId?: string;
}

interface AuthUserRow {
  id: string;
  username: string;
  role: string;
  campusId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "faizan-school-secret-key-2026";

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getApiPath(req: Request): string {
  const url = req.originalUrl || req.url || "";
  return url.split("?")[0].toLowerCase();
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET) as JwtPayload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

const ADMIN_ROLES = new Set(["Super Admin", "Admin"]);
const FEE_ROLES = new Set(["Super Admin", "Admin", "Accountant"]);
const QUICKPAY_ROLES = new Set(["Super Admin", "Admin"]);
const SUPER_ADMIN_ROLES = new Set(["Super Admin"]);
const INACTIVE_CAMPUS_ACTION_MESSAGE =
  "This campus is inactive. You cannot perform this action. Please activate the campus first.";

function requireRoles(allowed: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !allowed.has(req.auth.role)) {
      return res.status(403).json({ message: "Forbidden — insufficient role" });
    }
    next();
  };
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  return requireRoles(ADMIN_ROLES)(req, res, next);
}

async function getRolePermissions(role: string): Promise<PermissionMap> {
  if (!pool || !pool.connected) await connectToDb();
  if (!pool) return emptyPermissionMap();
  return fetchPermissionsForRole(pool, role);
}

function requireModulePermission(moduleKey: string, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (isSuperAdminRole(req.auth.role)) {
      next();
      return;
    }
    getRolePermissions(req.auth.role)
      .then((perms) => {
        if (!hasPermission(perms, moduleKey, action, req.auth.role)) {
          res.status(403).json({ message: "Forbidden — insufficient permissions" });
          return;
        }
        next();
      })
      .catch((err) => next(err));
  };
}

async function assertCollectionPermission(
  req: Request,
  res: Response,
  collection: string,
  action: PermissionAction
): Promise<boolean> {
  const moduleKey = COLLECTION_TO_MODULE[collection];
  if (!moduleKey) return true;
  if (!req.auth) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  if (isSuperAdminRole(req.auth.role)) return true;
  const perms = await getRolePermissions(req.auth.role);
  if (!hasPermission(perms, moduleKey, action, req.auth.role)) {
    res.status(403).json({ message: "Forbidden — insufficient permissions" });
    return false;
  }
  return true;
}

function isPublicApiRoute(req: Request): boolean {
  const path = getApiPath(req);
  if (path === "/api/health") return true;
  if (path === "/api/auth/login" && req.method === "POST") return true;
  if (path === "/api/payments/quickpay-callback" && req.method === "POST") return true;
  if (path === "/api/public/campuses" && req.method === "GET") return true;
  if (path === "/api/public/classes" && req.method === "GET") return true;
  if (path === "/api/public/admissions" && req.method === "POST") return true;
  if (path === "/api/public/admissions/track" && req.method === "GET") return true;
  return false;
}

function gradeFromMarks(obtained: number, total: number): string {
  if (!total || total <= 0) return "";
  const pct = (obtained / total) * 100;
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  if (pct > 0) return "F";
  return "";
}

async function assertClassCapacity(
  classId: string,
  excludeStudentId?: string
): Promise<{ ok: boolean; message?: string; enrolled?: number; capacity?: number }> {
  if (!pool || !pool.connected) await connectToDb();
  if (!pool) return { ok: false, message: "Database unavailable" };
  const request = pool.request().input("classId", classId);
  if (excludeStudentId) request.input("excludeId", excludeStudentId);
  const excludeClause = excludeStudentId ? " AND s.id != @excludeId" : "";
  const result = await request.query(`
    SELECT cl.capacity,
      (SELECT COUNT(*) FROM Students s WHERE s.class_id = @classId AND s.status = 'Active'${excludeClause}) AS enrolled
    FROM Classes cl WHERE cl.id = @classId
  `);
  const row = result.recordset[0];
  if (!row) return { ok: false, message: "Class not found" };
  const capacity = Number(row.capacity) || 0;
  const enrolled = Number(row.enrolled) || 0;
  if (capacity > 0 && enrolled >= capacity) {
    return { ok: false, message: `Class is at capacity (${enrolled}/${capacity})`, enrolled, capacity };
  }
  return { ok: true, enrolled, capacity };
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

function parsePagination(req: Request, opts?: { defaultLimit?: number; maxLimit?: number }) {
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = opts?.maxLimit ?? MAX_PAGE_LIMIT;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limitRaw = parseInt(String(req.query.limit || String(defaultLimit)), 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, limitRaw));
  return { page, limit, enabled: true, offset: (page - 1) * limit };
}

function deriveAcademicSession(year: number, month = new Date().getMonth() + 1): string {
  if (month >= 4) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

function normalizeSessionLabel(raw: unknown, fallbackYear?: number, fallbackMonth?: number): string {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{4}$/.test(s)) return s;
  const y = fallbackYear ?? new Date().getFullYear();
  const m = fallbackMonth ?? new Date().getMonth() + 1;
  return deriveAcademicSession(y, m);
}

function buildFeeFilterClauses(req: Request, request: sql.Request, campusFilter: string | null) {
  const whereParts: string[] = [];
  if (campusFilter) {
    whereParts.push("s.campus_id = @campusId");
    request.input("campusId", campusFilter);
  }

  const studentId = String(req.query.studentId || "").trim();
  if (studentId) {
    whereParts.push("f.student_id = @studentId");
    request.input("studentId", studentId);
  }

  const classId = String(req.query.classId || "").trim();
  if (classId) {
    whereParts.push("s.class_id = @classId");
    request.input("classId", classId);
  }

  const status = String(req.query.status || "").trim();
  if (status && status !== "all") {
    whereParts.push("f.status = @status");
    request.input("status", status);
  }

  const month = parseInt(String(req.query.month || ""), 10);
  if (month >= 1 && month <= 12) {
    whereParts.push("f.month = @month");
    request.input("month", month);
  }

  const year = parseInt(String(req.query.year || ""), 10);
  if (year >= 2000 && year <= 2100) {
    whereParts.push("f.year = @year");
    request.input("year", year);
  }

  const search = String(req.query.search || "").trim();
  if (search) {
    whereParts.push("(s.student_name LIKE @search OR s.admission_no LIKE @search)");
    request.input("search", `%${search}%`);
  }

  return whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
}

/** All /api routes require JWT except health, login, and the QuickPay webhook. */
function requireAuthForProtectedApi(req: Request, res: Response, next: NextFunction) {
  const path = getApiPath(req);
  if (!path.startsWith("/api")) return next();
  if (isPublicApiRoute(req)) return next();
  return authenticate(req, res, next);
}

function sendServerError(res: Response, err: unknown, context: string) {
  console.error(context, err);
  res.status(500).json({
    message: "Internal server error",
    ...(process.env.NODE_ENV === "development" && {
      error: err instanceof Error ? err.message : String(err),
    }),
  });
}

async function sendInterviewScheduleSms(payload: {
  phoneNumber: string;
  applicantName: string;
  campusName: string;
  campusAddress?: string | null;
  campusPhone?: string | null;
  interviewAt: string;
  applicationId: string;
  trackingNo?: string;
}) {
  return sendAdmissionSms({
    phoneNumber: payload.phoneNumber,
    template: "admission_interview_schedule",
    applicationId: payload.applicationId,
    trackingNo: payload.trackingNo,
    applicantName: payload.applicantName,
    campusName: payload.campusName,
    campusAddress: payload.campusAddress,
    campusPhone: payload.campusPhone,
    interviewAt: payload.interviewAt,
  });
}

function redactQuickPayConfig(row: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  Object.keys(row).forEach((key) => {
    mapped[mapToResponseKey(key)] = row[key];
  });
  const hasKey = Boolean(mapped.apiKey);
  return { ...mapped, apiKey: "", apiKeySet: hasKey };
}

const GENERIC_WRITE_ROLES: Record<string, Set<string>> = {
  expenses: FEE_ROLES,
  attendance: ADMIN_ROLES,
  transactions: QUICKPAY_ROLES,
  "quickpay-config": QUICKPAY_ROLES,
  feestructures: ADMIN_ROLES,
  "fee-settings": SUPER_ADMIN_ROLES,
  fees: FEE_ROLES,
  feevouchers: FEE_ROLES,
  staff: ADMIN_ROLES,
  inventory: SUPER_ADMIN_ROLES,
};

function isSchoolWideRole(role: string, campusId: string | null | undefined): boolean {
  return role === "Super Admin" || (role === "Admin" && !campusId);
}

/** null = school-wide; string = one campus; undefined = user has no campus assignment. */
function resolveCampusScope(user: AuthUserRow): string | null | undefined {
  if (isSchoolWideRole(user.role, user.campusId)) return null;
  return user.campusId || undefined;
}

function resolveCampusFilter(
  user: AuthUserRow,
  queryCampusId?: unknown
): { filter: string | null; denied: boolean } {
  const scope = resolveCampusScope(user);
  if (scope === undefined) return { filter: null, denied: true };
  if (scope) return { filter: scope, denied: false };
  const q = queryCampusId && queryCampusId !== "all" ? String(queryCampusId) : null;
  return { filter: q, denied: false };
}

function mapUserFromRow(user: Record<string, unknown>) {
  const createdOnRaw = user.createdOn ?? user.created_on ?? user.CreatedOn;
  return {
    id: String(user.id ?? ""),
    fullName: String(user.fullName ?? user.full_name ?? user.FullName ?? ""),
    username: String(user.username ?? user.Username ?? ""),
    email: (user.email ?? user.Email ?? null) as string | null,
    role: String(user.role ?? user.Role ?? ""),
    campusId: (user.campusId ?? user.campus_id ?? null) as string | null,
    isActive: Boolean(user.isActive ?? user.is_active ?? user.IsActive ?? true),
    createdOn: createdOnRaw
      ? new Date(createdOnRaw as string | number | Date).toISOString().slice(0, 10)
      : null,
    uid: (user.uid ?? user.UID ?? null) as string | null,
  };
}

function isUserActive(user: Record<string, unknown>): boolean {
  const active = user.isActive ?? user.is_active ?? user.IsActive;
  if (active === false || active === 0 || active === "0") return false;
  return active === undefined ? true : Boolean(active);
}

async function assertCampusWrite(user: AuthUserRow, targetCampusId: string): Promise<string | null> {
  const scope = resolveCampusScope(user);
  if (scope === undefined) return "User is not assigned to a campus";
  if (!targetCampusId) return "Campus is required";
  if (scope && targetCampusId !== scope) return "Forbidden — cannot modify another campus";

  if (!pool || !pool.connected) await connectToDb();
  if (!pool) return "Database connection not available";
  const campus = await pool.request()
    .input("campusId", targetCampusId)
    .query("SELECT isActive FROM Campuses WHERE id = @campusId");
  const row = campus.recordset[0];
  if (!row) return "Campus not found";
  if (!row.isActive) return INACTIVE_CAMPUS_ACTION_MESSAGE;
  return null;
}

async function loadAuthUser(req: Request): Promise<AuthUserRow | null> {
  if (!req.auth) return null;
  if (!pool || !pool.connected) await connectToDb();
  if (!pool) return null;
  const result = await pool.request()
    .input("username", req.auth.username)
    .query("SELECT id, username, role, campusId FROM Users WHERE username = @username AND isActive = 1");
  return result.recordset[0] || null;
}

// Multer setup for Excel uploads (using memory storage for better compatibility)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Date parsing helper
const parseExcelDate = (dateVal: any): string | null => {
  if (!dateVal) return null;
  
  // Excel parsers may return date cells as Date objects.
  if (dateVal instanceof Date) {
    return format(dateVal, "yyyy-MM-dd");
  }

  const dateStr = String(dateVal).trim();
  const formats = [
    "dd-MM-yyyy", "MM-dd-yyyy", "yyyy-MM-dd",
    "MM-dd-yy", "dd-MM-yy",
    "dd MMM yyyy", "d MMM yyyy",
    "dd MMMM yyyy", "d MMMM yyyy",
    "MM/dd/yyyy", "dd/MM/yyyy", "M/d/yyyy",
  ];
  
  for (const f of formats) {
    const parsedDate = parse(dateStr, f, new Date());
    if (isValid(parsedDate)) {
      return format(parsedDate, "yyyy-MM-dd");
    }
  }
  
  return null;
};

function normalizeExcelCell(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  return String(value);
}

function excelRowsToJson(excelRows: unknown[][]): Record<string, unknown>[] {
  const [headerRow, ...dataRows] = excelRows;
  const headers = (headerRow || []).map((value) => String(normalizeExcelCell(value) || "").trim());
  const rows: Record<string, unknown>[] = [];
  dataRows.forEach((row) => {
    const item: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = normalizeExcelCell(row[index]);
      if (value !== "" && value !== null && value !== undefined) hasValue = true;
      item[header] = value;
    });
    if (hasValue) rows.push(item);
  });
  return rows;
}

// Robust value getter for Excel rows (handles spaces, casing, and multiple variations)
const getVal = (row: any, ...keys: string[]) => {
  if (!row) return "";
  const rowKeys = Object.keys(row);
  
  // Normalize a string for loose matching
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_]/g, "");
  
  for (const key of keys) {
    const target = normalize(key);
    
    // Try exact match first
    if (row[key] !== undefined) return row[key];
    
    // Try loose match
    const foundKey = rowKeys.find(rk => normalize(rk) === target);
    if (foundKey) return row[foundKey];
  }
  return "";
};

function normalizeImportStudentStatus(raw: unknown): string {
  const v = String(raw || "").trim().toLowerCase();
  if (!v || v === "physical campus" || v === "active") return "Active";
  if (v.includes("left") || v.includes("inactive")) return "Left";
  if (v.includes("graduat")) return "Graduated";
  return "Active";
}

function legacyCampusCode(raw: unknown): string {
  const id = String(raw ?? "").trim();
  return id ? `LEG-${id}` : "";
}

async function recomputeStudentOutstanding(studentId: string, tx?: sql.Transaction): Promise<void> {
  const req = tx ? new sql.Request(tx) : pool.request();
  await req
    .input("studentId", studentId)
    .query(`
      UPDATE Students
      SET outstanding_fees = ISNULL((
        SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END)
        FROM Fees f
        WHERE f.student_id = @studentId
          AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
      ), 0)
      WHERE id = @studentId
    `);
}

async function recomputeOutstandingForScope(campusId: string | null): Promise<void> {
  if (!pool || !pool.connected) return;
  const req = pool.request();
  const campusFilter = campusId ? "WHERE s.campus_id = @campusId" : "";
  if (campusId) req.input("campusId", campusId);
  await req.query(`
    UPDATE s
    SET outstanding_fees = ISNULL(agg.totalOutstanding, 0)
    FROM Students s
    OUTER APPLY (
      SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END) AS totalOutstanding
      FROM Fees f
      WHERE f.student_id = s.id
        AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
    ) agg
    ${campusFilter}
  `);
}

// SQL Server Configuration
let sqlConfig: sql.config = {
  user: process.env.SQL_USER || "", // Empty for Windows Auth/Integrated Security
  password: process.env.SQL_PASSWORD || "",
  database: process.env.SQL_DATABASE || (IS_PRODUCTION ? "" : "testdb12"),
  server: process.env.SQL_SERVER || (IS_PRODUCTION ? "" : "51.79.177.9"),
  port: parseInt(process.env.SQL_PORT || "1433"),
  pool: {
    max: 30,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: parseBooleanEnv("SQL_ENCRYPT", true),
    trustServerCertificate: parseBooleanEnv("SQL_TRUST_SERVER_CERTIFICATE", true),
    enableArithAbort: true
  }
};

// Check if we are on Windows for localdb support
const isWindows = process.platform === 'win32';
if (!isWindows && sqlConfig.server.toLowerCase().includes('localdb')) {
  console.warn("⚠️ WARNING: (localdb) detected on non-Windows platform. This will likely fail.");
  console.warn("Please provide a real SQL Server address in environment variables or appsettings.json.");
}

// Try to load from appsettings.json if it exists (common in .NET migrations)
const appSettingsPath = path.join(process.cwd(), 'Backend', 'FaizanIslamicSchool.WebApi', 'appsettings.json');
if (fs.existsSync(appSettingsPath)) {
  try {
    const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, 'utf8'));
    const connString = appSettings?.ConnectionStrings?.DefaultConnection;
    if (connString) {
      console.log("Found appsettings.json, parsing connection string...");
      // Simple parser for SQL connection string
      const parts = connString.split(';');
      parts.forEach((part: string) => {
        const [key, value] = part.split('=');
        if (!key || !value) return;
        const k = key.trim().toLowerCase();
        const v = value.trim();
        
        if (k === 'server' || k === 'data source' || k === 'datasource') {
          sqlConfig.server = v;
        }
        if (k === 'database' || k === 'initial catalog') sqlConfig.database = v;
        if (k === 'user id' || k === 'uid') sqlConfig.user = v;
        if (k === 'password' || k === 'pwd') sqlConfig.password = v;
        if (k === 'encrypt') sqlConfig.options.encrypt = v.toLowerCase() === 'true';
        if (k === 'trustservercertificate') sqlConfig.options.trustServerCertificate = v.toLowerCase() === 'true';
        if (k === 'trusted_connection' || k === 'integrated security') {
          if (v.toLowerCase() === 'true' || v.toLowerCase() === 'sspi') {
            // Integrated security usually means empty user/password for tedious
            sqlConfig.user = "";
            sqlConfig.password = "";
          }
        }
      });
    }
    
    // Environment variables take precedence over appsettings.json
    if (process.env.SQL_SERVER) sqlConfig.server = process.env.SQL_SERVER;
    if (process.env.SQL_USER) sqlConfig.user = process.env.SQL_USER;
    if (process.env.SQL_PASSWORD) sqlConfig.password = process.env.SQL_PASSWORD;
    if (process.env.SQL_DATABASE) sqlConfig.database = process.env.SQL_DATABASE;
    if (process.env.SQL_PORT) sqlConfig.port = parseInt(process.env.SQL_PORT);
  } catch (err) {
    console.error("Error parsing appsettings.json:", err);
  }
}

function getProductionStartupErrors(): string[] {
  if (!IS_PRODUCTION) return [];

  const errors: string[] = [];
  const sqlServer = String(sqlConfig.server || "").trim();
  const sqlDatabase = String(sqlConfig.database || "").trim();
  const distIndexPath = path.join(process.cwd(), "dist", "index.html");

  if (!process.env.JWT_SECRET?.trim()) {
    errors.push("Missing JWT_SECRET.");
  }
  if (!sqlServer) {
    errors.push("Missing SQL_SERVER or production connection string host.");
  } else if (sqlServer.toLowerCase().includes("localdb")) {
    errors.push(`SQL server "${sqlServer}" uses localdb, which is not valid for production hosting.`);
  }
  if (!sqlDatabase) {
    errors.push("Missing SQL_DATABASE or production connection string database name.");
  }
  if (!fs.existsSync(distIndexPath)) {
    errors.push("Missing dist/index.html. Build the frontend before starting production.");
  }

  return errors;
}

async function testConnection() {
  try {
    console.log(`Testing connection to ${sqlConfig.server} / ${sqlConfig.database}...`);
    if (!pool) await connectToDb();
    if (!pool) throw new Error("Pool not initialized");
    const result = await pool.request().query("SELECT 1 AS connected");
    if (result.recordset[0]?.connected === 1) {
      console.log("✅ Database connection test successful!");
    }
  } catch (err) {
    console.error("❌ Database connection test failed!");
    console.error("Error details:", err instanceof Error ? err.message : String(err));
    console.log("Note: (localdb) usually only works on Windows with SQL Server LocalDB installed.");
  }
}

/** Ensure pool is ready; reconnect if closed (e.g. after testConnection used to call .close()). */
async function ensurePool(): Promise<boolean> {
  try {
    if (!pool || !pool.connected) {
      await connectToDb();
    }
    if (!pool) return false;
    await pool.request().query("SELECT 1");
    return true;
  } catch (err) {
    console.error("Database unavailable:", err instanceof Error ? err.message : String(err));
    return false;
  }
}


// Mapping between API collection names and SQL Table names
const TABLE_MAP: Record<string, string> = {
  students: "Students",
  campuses: "Campuses",
  classes: "Classes",
  feevouchers: "Fees",
  fees: "Fees",
  transactions: "Transactions",
  feestructures: "FeeStructures",
  "fee-settings": "FeeSettings",
  "quickpay-config": "QuickPayConfig",
  "attendance": "Attendance",
  "expenses": "Expenses",
  staff: "Staff",
  inventory: "Inventory",
};

// Mapping between camelCase (JSON/Frontend) and snake_case (SQL DB)
const COLUMN_MAP: Record<string, string> = {
  // Students
  rollNumber: "admission_no",
  studentCode: "registration_no",
  serialNo: "gr_no",
  firstName: "student_name",
  fatherName: "father_name",
  cnicBForm: "father_cnic",
  contactNumber: "father_mobile",
  dateOfBirth: "dob",
  admissionDate: "admission_date",
  campusId: "campus_id",
  classId: "class_id",
  session: "batch_no",
  outstandingFees: "outstanding_fees",
  profileImage: "profile_image",
  applicantName: "applicant_name",
  previousSchool: "previous_school",
  appliedOn: "applied_on",
  testMarks: "test_marks",
  reviewedBy: "reviewed_by",
  reviewedOn: "reviewed_on",
  // Fees
  studentId: "student_id",
  transactionRef: "transaction_ref",
  paymentMethod: "payment_method",
  paymentDate: "payment_date",
  dueDate: "due_date",
  feeType: "fee_type",
  paidAmount: "paid_amount",
  discountAmount: "discount_amount",
  fineAmount: "fine_amount",
  balanceAmount: "balance_amount",
  paymentHistory: "payment_history",
  tuitionFee: "tuition_fee",
  admissionFee: "admission_fee",
  examFee: "exam_fee",
  transportFee: "transport_fee",
  miscFee: "misc_fee",
  arrears: "arrears",
  // Settings
  monthlyFee: "monthly_fee",
  securityFee: "security_fee",
  lastUpdated: "last_updated",
  // Campuses
  campusName: "campus_name",
  campusCode: "campus_code",
  // Classes
  className: "class_name",
  sectionName: "section_name",
  // QuickPay Config
  merchantId: "merchant_id",
  apiKey: "api_key",
  callbackUrl: "callback_url",
  isEnabled: "isEnabled",
  mode: "mode",
  // Attendance
  recordedBy: "recorded_by",
  // Expenses
  createdAt: "created_at",
  // Exams
  examType: "exam_type",
  examDate: "exam_date",
  totalMarks: "total_marks",
  obtainedMarks: "obtained_marks",
  recordedOn: "recorded_on",
  examId: "exam_id",
  // Inventory
  itemName: "item_name",
  minThreshold: "min_threshold",
  // Transactions
  transactionDate: "transaction_date",
  voucherId: "voucher_id",
  responseLog: "response_log"
};

const mapToDbColumn = (key: string) => COLUMN_MAP[key] || key;
const mapToResponseKey = (key: string) => {
  const entry = Object.entries(COLUMN_MAP).find(([_, val]) => val === key);
  return entry ? entry[0] : key;
};

/** Allowed JSON keys per table for generic POST (prevents arbitrary column writes). */
const TABLE_INSERT_WHITELIST: Record<string, Set<string>> = {
  Expenses: new Set(["id", "title", "amount", "category", "description", "date", "recordedBy", "campusId"]),
  Attendance: new Set(["id", "studentId", "date", "status", "recordedBy", "campusId", "classId"]),
  Transactions: new Set([
    "id", "studentId", "voucherId", "amount", "status", "transactionDate",
    "paymentMethod", "transactionRef", "responseLog",
  ]),
  QuickPayConfig: new Set([
    "id", "merchantId", "apiKey", "callbackUrl", "isEnabled", "mode",
  ]),
  FeeStructures: new Set([
    "id", "campusId", "classId", "tuitionFee", "admissionFee", "examFee", "transportFee", "miscFee",
  ]),
  Staff: new Set([
    "id", "fullName", "cnic", "qualification", "salary", "joiningDate", "campusId", "role", "email", "isActive", "profileImage",
  ]),
  Inventory: new Set([
    "id", "itemName", "category", "quantity", "unit", "minThreshold",
  ]),
};

let pool: sql.ConnectionPool;

async function ensureAdmissionExtendedSchema(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'tracking_no')
      ALTER TABLE AdmissionApplications ADD tracking_no NVARCHAR(30);
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'student_bform')
      ALTER TABLE AdmissionApplications ADD student_bform NVARCHAR(50);
  `);

  await pool.request().query(`
    IF OBJECT_ID('AdmissionDocuments', 'U') IS NULL
    BEGIN
      CREATE TABLE AdmissionDocuments (
        id NVARCHAR(50) PRIMARY KEY,
        application_id NVARCHAR(50) NOT NULL,
        doc_type NVARCHAR(50) NOT NULL,
        file_name NVARCHAR(255),
        file_url NVARCHAR(500) NOT NULL,
        uploaded_by NVARCHAR(255),
        uploaded_on DATETIME DEFAULT GETDATE()
      );
    END
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AdmissionDocuments_application' AND object_id = OBJECT_ID('AdmissionDocuments'))
      CREATE INDEX IX_AdmissionDocuments_application ON AdmissionDocuments(application_id);
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AdmissionApplications_tracking_no' AND object_id = OBJECT_ID('AdmissionApplications'))
      AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'tracking_no')
    BEGIN
      EXEC('CREATE UNIQUE INDEX UX_AdmissionApplications_tracking_no ON AdmissionApplications(tracking_no) WHERE tracking_no IS NOT NULL');
    END
  `);
}

async function connectToDb() {
  try {
    if (!sqlConfig.user || !sqlConfig.server || sqlConfig.server.includes('localdb')) {
      console.warn("⚠️ Database credentials missing or using (localdb) on cloud. Connection will likely fail.");
    }
    
    pool = await sql.connect(sqlConfig);
    console.log("✅ Connected to MSSQL successfully");

    try {
      await ensureAdmissionExtendedSchema(pool);
    } catch (admissionSchemaEarlyErr) {
      console.error("Error applying admission extended schema (early):", admissionSchemaEarlyErr);
    }

    // Ensure outstanding_fees column exists in Students table
    try {
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT * FROM sys.columns 
          WHERE object_id = OBJECT_ID('Students') AND name = 'outstanding_fees'
        )
        BEGIN
          IF EXISTS (
            SELECT * FROM sys.columns 
            WHERE object_id = OBJECT_ID('Students') AND name = 'outstandingFees'
          )
          BEGIN
            EXEC sp_rename 'Students.outstandingFees', 'outstanding_fees', 'COLUMN';
          END
          ELSE
          BEGIN
            ALTER TABLE Students ADD outstanding_fees DECIMAL(18, 2) DEFAULT 0;
          END
        END

        IF OBJECT_ID('Transactions', 'U') IS NOT NULL
        BEGIN
          PRINT 'Transactions table exists'
        END
        ELSE
        BEGIN
          CREATE TABLE Transactions (
            id NVARCHAR(50) PRIMARY KEY,
            student_id NVARCHAR(50) NOT NULL,
            voucher_id NVARCHAR(50),
            amount DECIMAL(18, 2) NOT NULL,
            status NVARCHAR(20) DEFAULT 'Pending',
            transaction_date DATETIME DEFAULT GETDATE(),
            response_log NVARCHAR(MAX)
          );
        END

        IF OBJECT_ID('FeeSettings', 'U') IS NOT NULL
        BEGIN
          PRINT 'FeeSettings table exists'
        END
        ELSE
        BEGIN
          CREATE TABLE FeeSettings (
            id NVARCHAR(50) PRIMARY KEY,
            class_id NVARCHAR(50) NOT NULL,
            monthly_fee DECIMAL(18, 2) DEFAULT 0,
            admission_fee DECIMAL(18, 2) DEFAULT 0,
            security_fee DECIMAL(18, 2) DEFAULT 0,
            exam_fee DECIMAL(18, 2) DEFAULT 0,
            transport_fee DECIMAL(18, 2) DEFAULT 0,
            misc_fee DECIMAL(18, 2) DEFAULT 0,
            last_updated DATETIME DEFAULT GETDATE()
          );
        END

        -- Ensure extra columns for FeeSettings if it exists
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'exam_fee')
          ALTER TABLE FeeSettings ADD exam_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'transport_fee')
          ALTER TABLE FeeSettings ADD transport_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'misc_fee')
          ALTER TABLE FeeSettings ADD misc_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'summer_camp_fee')
          ALTER TABLE FeeSettings ADD summer_camp_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'id_card_fee')
          ALTER TABLE FeeSettings ADD id_card_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeSettings') AND name = 'trip_fee')
          ALTER TABLE FeeSettings ADD trip_fee DECIMAL(18, 2) DEFAULT 0;

        IF OBJECT_ID('CampusNameHistory', 'U') IS NULL
        BEGIN
          CREATE TABLE CampusNameHistory (
            id NVARCHAR(50) PRIMARY KEY,
            campus_id NVARCHAR(50) NOT NULL,
            old_name NVARCHAR(200) NOT NULL,
            new_name NVARCHAR(200) NOT NULL,
            changed_on DATETIME DEFAULT GETDATE(),
            changed_by NVARCHAR(100)
          );
        END

        IF OBJECT_ID('ExamAttendance', 'U') IS NULL
        BEGIN
          CREATE TABLE ExamAttendance (
            id NVARCHAR(50) PRIMARY KEY,
            exam_id NVARCHAR(50) NOT NULL,
            person_type NVARCHAR(20) NOT NULL,
            person_id NVARCHAR(50) NOT NULL,
            status NVARCHAR(20) NOT NULL,
            recorded_by NVARCHAR(100),
            recorded_on DATETIME DEFAULT GETDATE()
          );
        END

        -- Ensure breakdown columns exist in Fees table
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'tuition_fee')
        ALTER TABLE Fees ADD tuition_fee DECIMAL(18, 2) DEFAULT 0;
        
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'admission_fee')
        ALTER TABLE Fees ADD admission_fee DECIMAL(18, 2) DEFAULT 0;
        
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'exam_fee')
        ALTER TABLE Fees ADD exam_fee DECIMAL(18, 2) DEFAULT 0;
        
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'transport_fee')
        ALTER TABLE Fees ADD transport_fee DECIMAL(18, 2) DEFAULT 0;
        
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'misc_fee')
        ALTER TABLE Fees ADD misc_fee DECIMAL(18, 2) DEFAULT 0;
        
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'arrears')
        ALTER TABLE Fees ADD arrears DECIMAL(18, 2) DEFAULT 0;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'paid_amount')
        ALTER TABLE Fees ADD paid_amount DECIMAL(18, 2) DEFAULT 0;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'discount_amount')
        ALTER TABLE Fees ADD discount_amount DECIMAL(18, 2) DEFAULT 0;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'fine_amount')
        ALTER TABLE Fees ADD fine_amount DECIMAL(18, 2) DEFAULT 0;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'balance_amount')
        ALTER TABLE Fees ADD balance_amount DECIMAL(18, 2) DEFAULT 0;

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'payment_history')
        ALTER TABLE Fees ADD payment_history NVARCHAR(MAX);

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'fee_type')
        BEGIN
          ALTER TABLE Fees ADD fee_type NVARCHAR(20) DEFAULT 'Monthly';
        END
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'campus_name_snapshot')
          ALTER TABLE Fees ADD campus_name_snapshot NVARCHAR(200);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'months_label')
          ALTER TABLE Fees ADD months_label NVARCHAR(100);
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'security_fee')
          ALTER TABLE Fees ADD security_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'summer_camp_fee')
          ALTER TABLE Fees ADD summer_camp_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'id_card_fee')
          ALTER TABLE Fees ADD id_card_fee DECIMAL(18, 2) DEFAULT 0;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Fees') AND name = 'trip_fee')
          ALTER TABLE Fees ADD trip_fee DECIMAL(18, 2) DEFAULT 0;

        -- Migration: Populate paid_amount for already paid vouchers to fix analytics
        UPDATE Fees SET paid_amount = amount + ISNULL(arrears, 0) 
        WHERE (paid_amount IS NULL OR paid_amount = 0)
          AND status = 'Paid'
          AND ISNULL(payment_method, '') NOT IN ('Carried Forward', 'System Adjustment');

        -- Migration: Populate balance_amount for unpaid vouchers
        UPDATE Fees SET balance_amount = amount + ISNULL(arrears, 0)
        WHERE (balance_amount IS NULL OR balance_amount = 0) AND status = 'Unpaid';

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Students_admission_no' AND object_id = OBJECT_ID('Students'))
          CREATE UNIQUE INDEX UX_Students_admission_no ON Students(admission_no);

        -- Stabilization indexes for fee workflows
        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'IX_Fees_student_year_month_status'
            AND object_id = OBJECT_ID('Fees')
        )
          CREATE INDEX IX_Fees_student_year_month_status ON Fees(student_id, year, month, status);

        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'IX_Students_campus_class_status'
            AND object_id = OBJECT_ID('Students')
        )
          CREATE INDEX IX_Students_campus_class_status ON Students(campus_id, class_id, status);

        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'UX_FeeStructures_class_id'
            AND object_id = OBJECT_ID('FeeStructures')
        )
          AND NOT EXISTS (
            SELECT class_id
            FROM FeeStructures
            WHERE class_id IS NOT NULL
            GROUP BY class_id
            HAVING COUNT(*) > 1
          )
          CREATE UNIQUE INDEX UX_FeeStructures_class_id ON FeeStructures(class_id)
            WHERE class_id IS NOT NULL;

        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'UX_Fees_monthly_admission_student_month_year'
            AND object_id = OBJECT_ID('Fees')
        )
          AND NOT EXISTS (
            SELECT student_id, month, year, fee_type
            FROM Fees
            WHERE fee_type IN ('Monthly', 'Admission')
            GROUP BY student_id, month, year, fee_type
            HAVING COUNT(*) > 1
          )
          CREATE UNIQUE INDEX UX_Fees_monthly_admission_student_month_year
            ON Fees(student_id, month, year, fee_type)
            WHERE fee_type IN ('Monthly', 'Admission');

        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'UX_Fees_transaction_ref'
            AND object_id = OBJECT_ID('Fees')
        )
          AND NOT EXISTS (
            SELECT transaction_ref
            FROM Fees
            WHERE transaction_ref IS NOT NULL AND transaction_ref <> ''
            GROUP BY transaction_ref
            HAVING COUNT(*) > 1
          )
          CREATE UNIQUE INDEX UX_Fees_transaction_ref
            ON Fees(transaction_ref)
            WHERE transaction_ref IS NOT NULL AND transaction_ref <> '';

        -- Campus code column (UI collects it; older schemas aliased campus_name as the code)
        IF OBJECT_ID('Campuses', 'U') IS NOT NULL AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Campuses') AND name = 'campus_code')
          ALTER TABLE Campuses ADD campus_code NVARCHAR(50);

        -- Users: legacy DBs used campus_id; app expects camelCase campusId
        IF OBJECT_ID('Users', 'U') IS NOT NULL
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'campusId')
             AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'campus_id')
            EXEC sp_rename 'Users.campus_id', 'campusId', 'COLUMN';
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'campusId')
            ALTER TABLE Users ADD campusId NVARCHAR(50);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'uid')
            ALTER TABLE Users ADD uid NVARCHAR(255);
        END

        -- Staff: same campus column naming
        IF OBJECT_ID('Staff', 'U') IS NOT NULL
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Staff') AND name = 'campusId')
             AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Staff') AND name = 'campus_id')
            EXEC sp_rename 'Staff.campus_id', 'campusId', 'COLUMN';
        END

        -- Transactions: columns the API/QuickPay callback insert
        IF OBJECT_ID('Transactions', 'U') IS NOT NULL
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Transactions') AND name = 'transaction_ref')
            ALTER TABLE Transactions ADD transaction_ref NVARCHAR(255);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Transactions') AND name = 'payment_method')
            ALTER TABLE Transactions ADD payment_method NVARCHAR(50);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Transactions') AND name = 'voucher_id')
            ALTER TABLE Transactions ADD voucher_id NVARCHAR(50);
        END

        -- Expenses (dashboard KPIs and Expenses page)
        IF OBJECT_ID('Expenses', 'U') IS NULL
        BEGIN
          CREATE TABLE Expenses (
            id NVARCHAR(50) PRIMARY KEY,
            title NVARCHAR(255) NOT NULL,
            category NVARCHAR(50) NOT NULL,
            amount DECIMAL(18, 2) NOT NULL,
            date DATE NOT NULL,
            recorded_by NVARCHAR(50),
            description NVARCHAR(MAX),
            campus_id NVARCHAR(50),
            created_at DATETIME DEFAULT GETDATE()
          );
        END
        ELSE
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Expenses') AND name = 'title')
            ALTER TABLE Expenses ADD title NVARCHAR(255) NULL;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Expenses') AND name = 'campus_id')
            ALTER TABLE Expenses ADD campus_id NVARCHAR(50);
        END

        -- Attendance (daily class attendance page and student portal summary)
        IF OBJECT_ID('Attendance', 'U') IS NULL
        BEGIN
          CREATE TABLE Attendance (
            id NVARCHAR(50) PRIMARY KEY,
            student_id NVARCHAR(50) NOT NULL,
            class_id NVARCHAR(50),
            date DATE NOT NULL,
            status NVARCHAR(20) NOT NULL,
            recorded_by NVARCHAR(50),
            created_at DATETIME DEFAULT GETDATE()
          );
        END
        ELSE
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Attendance') AND name = 'class_id')
            ALTER TABLE Attendance ADD class_id NVARCHAR(50);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Attendance') AND name = 'created_at')
            ALTER TABLE Attendance ADD created_at DATETIME DEFAULT GETDATE();
        END

        IF OBJECT_ID('Attendance', 'U') IS NOT NULL
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_Attendance_student_date'
              AND object_id = OBJECT_ID('Attendance')
          )
            CREATE INDEX IX_Attendance_student_date ON Attendance(student_id, date);

          IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_Attendance_class_date'
              AND object_id = OBJECT_ID('Attendance')
          )
            CREATE INDEX IX_Attendance_class_date ON Attendance(class_id, date);
        END

        -- FeeStructures: used by the Fee Structures tab and seed script
        IF OBJECT_ID('FeeStructures', 'U') IS NULL
        BEGIN
          CREATE TABLE FeeStructures (
            id NVARCHAR(50) PRIMARY KEY,
            campus_id NVARCHAR(50),
            class_id NVARCHAR(50),
            session NVARCHAR(20),
            tuition_fee DECIMAL(18, 2) DEFAULT 0,
            admission_fee DECIMAL(18, 2) DEFAULT 0,
            exam_fee DECIMAL(18, 2) DEFAULT 0,
            transport_fee DECIMAL(18, 2) DEFAULT 0,
            misc_fee DECIMAL(18, 2) DEFAULT 0,
            security_fee DECIMAL(18, 2) DEFAULT 0,
            summer_camp_fee DECIMAL(18, 2) DEFAULT 0,
            id_card_fee DECIMAL(18, 2) DEFAULT 0,
            trip_fee DECIMAL(18, 2) DEFAULT 0,
            last_updated DATETIME DEFAULT GETDATE()
          );
        END
        ELSE
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'session')
            ALTER TABLE FeeStructures ADD session NVARCHAR(20);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'security_fee')
            ALTER TABLE FeeStructures ADD security_fee DECIMAL(18, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'summer_camp_fee')
            ALTER TABLE FeeStructures ADD summer_camp_fee DECIMAL(18, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'id_card_fee')
            ALTER TABLE FeeStructures ADD id_card_fee DECIMAL(18, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'trip_fee')
            ALTER TABLE FeeStructures ADD trip_fee DECIMAL(18, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'last_updated')
            ALTER TABLE FeeStructures ADD last_updated DATETIME DEFAULT GETDATE();
        END

        IF OBJECT_ID('Staff', 'U') IS NULL
        BEGIN
          CREATE TABLE Staff (
            id NVARCHAR(50) PRIMARY KEY,
            fullName NVARCHAR(255) NOT NULL,
            cnic NVARCHAR(50) NOT NULL,
            qualification NVARCHAR(255),
            salary DECIMAL(18, 2),
            joiningDate DATE,
            campusId NVARCHAR(50) NOT NULL,
            role NVARCHAR(50) NOT NULL,
            email NVARCHAR(255),
            isActive BIT DEFAULT 1,
            profileImage NVARCHAR(MAX)
          );
        END

        IF OBJECT_ID('Inventory', 'U') IS NULL
        BEGIN
          CREATE TABLE Inventory (
            id NVARCHAR(50) PRIMARY KEY,
            itemName NVARCHAR(255) NOT NULL,
            category NVARCHAR(100),
            quantity INT DEFAULT 0,
            unit NVARCHAR(50),
            minThreshold INT DEFAULT 0,
            lastUpdated DATETIME DEFAULT GETDATE()
          );
        END

        IF OBJECT_ID('Exams', 'U') IS NULL
        BEGIN
          CREATE TABLE Exams (
            id NVARCHAR(50) PRIMARY KEY,
            title NVARCHAR(255) NOT NULL,
            exam_type NVARCHAR(50) DEFAULT 'Monthly',
            class_id NVARCHAR(50) NOT NULL,
            campus_id NVARCHAR(50) NOT NULL,
            exam_date DATE,
            total_marks DECIMAL(18, 2) DEFAULT 100,
            created_on DATETIME DEFAULT GETDATE()
          );
        END

        IF OBJECT_ID('ExamResults', 'U') IS NULL
        BEGIN
          CREATE TABLE ExamResults (
            id NVARCHAR(50) PRIMARY KEY,
            exam_id NVARCHAR(50) NOT NULL,
            student_id NVARCHAR(50) NOT NULL,
            obtained_marks DECIMAL(18, 2) DEFAULT 0,
            grade NVARCHAR(10),
            remarks NVARCHAR(255),
            recorded_on DATETIME DEFAULT GETDATE()
          );
        END

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Students') AND name = 'profile_image')
          ALTER TABLE Students ADD profile_image NVARCHAR(MAX);

        IF OBJECT_ID('AdmissionApplications', 'U') IS NULL
        BEGIN
          CREATE TABLE AdmissionApplications (
            id NVARCHAR(50) PRIMARY KEY,
            campus_id NVARCHAR(50) NOT NULL,
            class_id NVARCHAR(50),
            applicant_name NVARCHAR(255) NOT NULL,
            father_name NVARCHAR(255),
            father_cnic NVARCHAR(50),
            date_of_birth DATE,
            gender NVARCHAR(20),
            contact_number NVARCHAR(50),
            address NVARCHAR(MAX),
            previous_school NVARCHAR(255),
            applied_on DATETIME DEFAULT GETDATE(),
            status NVARCHAR(30) DEFAULT 'Pending',
            test_marks DECIMAL(18, 2),
            remarks NVARCHAR(MAX),
            reviewed_by NVARCHAR(255),
            reviewed_on DATETIME,
            student_id NVARCHAR(50),
            interview_at DATETIME,
            interview_sms_sent BIT DEFAULT 0,
            interview_sms_sent_on DATETIME,
            linked_student_id NVARCHAR(50),
            review_match_type NVARCHAR(30),
            review_snapshot NVARCHAR(MAX),
            waive_admission_fee BIT DEFAULT 0,
            fee_discount_amount DECIMAL(18, 2) DEFAULT 0,
            fee_discount_percent DECIMAL(5, 2) DEFAULT 0,
            sibling_discount_percent DECIMAL(5, 2) DEFAULT 0,
            rejection_reason NVARCHAR(100),
            tracking_no NVARCHAR(30),
            student_bform NVARCHAR(50)
          );
        END
        ELSE
        BEGIN
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'interview_at')
            ALTER TABLE AdmissionApplications ADD interview_at DATETIME;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'interview_sms_sent')
            ALTER TABLE AdmissionApplications ADD interview_sms_sent BIT DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'interview_sms_sent_on')
            ALTER TABLE AdmissionApplications ADD interview_sms_sent_on DATETIME;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'father_cnic')
            ALTER TABLE AdmissionApplications ADD father_cnic NVARCHAR(50);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'linked_student_id')
            ALTER TABLE AdmissionApplications ADD linked_student_id NVARCHAR(50);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'review_match_type')
            ALTER TABLE AdmissionApplications ADD review_match_type NVARCHAR(30);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'review_snapshot')
            ALTER TABLE AdmissionApplications ADD review_snapshot NVARCHAR(MAX);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'waive_admission_fee')
            ALTER TABLE AdmissionApplications ADD waive_admission_fee BIT DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'fee_discount_amount')
            ALTER TABLE AdmissionApplications ADD fee_discount_amount DECIMAL(18, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'fee_discount_percent')
            ALTER TABLE AdmissionApplications ADD fee_discount_percent DECIMAL(5, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'sibling_discount_percent')
            ALTER TABLE AdmissionApplications ADD sibling_discount_percent DECIMAL(5, 2) DEFAULT 0;
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'rejection_reason')
            ALTER TABLE AdmissionApplications ADD rejection_reason NVARCHAR(100);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'tracking_no')
            ALTER TABLE AdmissionApplications ADD tracking_no NVARCHAR(30);
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdmissionApplications') AND name = 'student_bform')
            ALTER TABLE AdmissionApplications ADD student_bform NVARCHAR(50);
        END

        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Campuses') AND name = 'sibling_discount_2nd')
          ALTER TABLE Campuses ADD sibling_discount_2nd DECIMAL(5, 2) DEFAULT 10;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Campuses') AND name = 'sibling_discount_3rd')
          ALTER TABLE Campuses ADD sibling_discount_3rd DECIMAL(5, 2) DEFAULT 15;

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Students_father_cnic' AND object_id = OBJECT_ID('Students'))
          CREATE INDEX IX_Students_father_cnic ON Students(father_cnic);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AdmissionApplications_father_cnic' AND object_id = OBJECT_ID('AdmissionApplications'))
          CREATE INDEX IX_AdmissionApplications_father_cnic ON AdmissionApplications(father_cnic);

        IF OBJECT_ID('FeeGenerationRuns', 'U') IS NULL
        BEGIN
          CREATE TABLE FeeGenerationRuns (
            id NVARCHAR(50) PRIMARY KEY,
            run_on DATETIME DEFAULT GETDATE(),
            run_by NVARCHAR(255),
            campus_id NVARCHAR(50),
            year INT,
            months_csv NVARCHAR(100),
            processed_count INT DEFAULT 0,
            skipped_missing_fee_settings INT DEFAULT 0,
            new_admissions_count INT DEFAULT 0,
            arrears_count INT DEFAULT 0,
            notes NVARCHAR(MAX)
          );
        END
      `);
      console.log("Verified database schema (Students and Transactions tables)");
    } catch (schemaErr) {
      console.error("Error verifying database schema:", schemaErr);
    }

    await seedAdmin();
    await seedDemoUsers();
    await migrateFeeStructuresSession(pool);
    await ensureScalingSchema(pool);
    await ensureRoleSchema(pool);
    try {
      await ensureAdmissionExtendedSchema(pool);
      console.log("Admission extended schema verified (tracking_no, student_bform, documents)");
    } catch (admissionSchemaErr) {
      console.error("Error applying admission extended schema:", admissionSchemaErr);
    }
    try {
      const renamed = await normalizeStaffUsernames(pool);
      if (renamed > 0) console.log(`Normalized ${renamed} staff login username(s) away from student roll numbers`);
    } catch (usernameErr) {
      console.error("Error normalizing staff usernames:", usernameErr);
    }
    await seedAppRoles(pool);
    try {
      await migrateRoleNameTypo(pool);
    } catch (roleTypoErr) {
      console.error("Error migrating Principle → Principal role name:", roleTypoErr);
    }
  } catch (err) {
    console.error("Database connection failed:", err);
  }
}

async function migrateFeeStructuresSession(pool: sql.ConnectionPool): Promise<void> {
  // Run in separate batches — SQL Server compiles the whole batch before execution,
  // so index DDL referencing `session` must not share a batch with ADD COLUMN session.
  await pool.request().query(`
    IF OBJECT_ID('FeeStructures', 'U') IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'session')
        ALTER TABLE FeeStructures ADD session NVARCHAR(20);
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'security_fee')
        ALTER TABLE FeeStructures ADD security_fee DECIMAL(18, 2) DEFAULT 0;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'summer_camp_fee')
        ALTER TABLE FeeStructures ADD summer_camp_fee DECIMAL(18, 2) DEFAULT 0;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'id_card_fee')
        ALTER TABLE FeeStructures ADD id_card_fee DECIMAL(18, 2) DEFAULT 0;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'trip_fee')
        ALTER TABLE FeeStructures ADD trip_fee DECIMAL(18, 2) DEFAULT 0;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'last_updated')
        ALTER TABLE FeeStructures ADD last_updated DATETIME DEFAULT GETDATE();
    END
  `);

  await pool.request().query(`
    IF OBJECT_ID('FeeStructures', 'U') IS NOT NULL
      AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FeeStructures') AND name = 'session')
    BEGIN
      IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UX_FeeStructures_class_id' AND object_id = OBJECT_ID('FeeStructures')
          AND has_filter = 0
      )
        DROP INDEX UX_FeeStructures_class_id ON FeeStructures;

      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UX_FeeStructures_campus_session' AND object_id = OBJECT_ID('FeeStructures')
      )
        AND NOT EXISTS (
          SELECT campus_id, session
          FROM FeeStructures
          WHERE class_id IS NULL AND session IS NOT NULL
          GROUP BY campus_id, session
          HAVING COUNT(*) > 1
        )
        CREATE UNIQUE INDEX UX_FeeStructures_campus_session
          ON FeeStructures(campus_id, session)
          WHERE class_id IS NULL AND session IS NOT NULL;

      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UX_FeeStructures_class_id' AND object_id = OBJECT_ID('FeeStructures')
      )
        AND NOT EXISTS (
          SELECT class_id FROM FeeStructures
          WHERE class_id IS NOT NULL
          GROUP BY class_id
          HAVING COUNT(*) > 1
        )
        CREATE UNIQUE INDEX UX_FeeStructures_class_id ON FeeStructures(class_id)
          WHERE class_id IS NOT NULL;
    END
  `);
}

async function seedAdmin() {
  try {
    const username = "admin";
    const password = "admin123";
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.request()
      .input("username", username)
      .query("SELECT id FROM Users WHERE username = @username");
      
    if (result.recordset.length === 0) {
      console.log("Seeding admin user...");
      await pool.request()
        .input("id", crypto.randomUUID())
        .input("fullName", "Super Admin")
        .input("username", username)
        .input("email", "admin@faizan.com")
        .input("passwordHash", hashedPassword)
        .input("role", "Super Admin")
        .query(`
          INSERT INTO Users (id, fullName, username, email, passwordHash, role, isActive, createdOn)
          VALUES (@id, @fullName, @username, @email, @passwordHash, @role, 1, GETDATE())
        `);
      console.log("Admin user seeded successfully.");
    }
  } catch (err) {
    console.error("Error seeding admin:", err);
  }
}

/** Demo staff accounts for QA (mirrors Database/02_seed_users_roles.sql). */
async function seedDemoUsers() {
  const demoUsers = [
    { id: "usr-super-2", fullName: "System Super Admin", username: "superadmin", email: "superadmin@faizan.com", password: "superadmin123", role: "Super Admin" },
    { id: "usr-accountant", fullName: "Head Accountant", username: "accountant", email: "accountant@faizan.com", password: "accountant123", role: "Accountant" },
    { id: "usr-teacher", fullName: "Demo Teacher", username: "teacher", email: "teacher@faizan.com", password: "teacher123", role: "Teacher" },
    { id: "usr-campus-admin", fullName: "Campus Administrator", username: "campusadmin", email: "campusadmin@faizan.com", password: "campusadmin123", role: "Admin" },
  ];

  try {
    for (const u of demoUsers) {
      const existing = await pool.request()
        .input("username", u.username)
        .query("SELECT id FROM Users WHERE username = @username");
      if (existing.recordset.length > 0) continue;

      const hashedPassword = await bcrypt.hash(u.password, 10);
      await pool.request()
        .input("id", u.id)
        .input("fullName", u.fullName)
        .input("username", u.username)
        .input("email", u.email)
        .input("passwordHash", hashedPassword)
        .input("role", u.role)
        .query(`
          INSERT INTO Users (id, fullName, username, email, passwordHash, role, isActive, createdOn)
          VALUES (@id, @fullName, @username, @email, @passwordHash, @role, 1, GETDATE())
        `);
      console.log(`Seeded demo user: ${u.username}`);
    }
  } catch (err) {
    console.error("Error seeding demo users:", err);
  }
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'wwwroot', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const studentPhotosDir = path.join(uploadsDir, "students");
if (!fs.existsSync(studentPhotosDir)) {
  fs.mkdirSync(studentPhotosDir, { recursive: true });
}

const admissionDocsDir = path.join(uploadsDir, "admissions");
if (!fs.existsSync(admissionDocsDir)) {
  fs.mkdirSync(admissionDocsDir, { recursive: true });
}

const uploadAdmissionDoc = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, admissionDocsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".pdf";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp|gif|bmp)|application\/pdf)$/.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("Only PDF or image files are allowed"));
  },
});

const uploadStudentPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, studentPhotosDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

async function startServer() {
  const startupErrors = getProductionStartupErrors();
  if (startupErrors.length > 0) {
    console.error("Production startup validation failed:");
    for (const error of startupErrors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  await connectToDb();
  await testConnection();
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const isAllowedOrigin = (origin?: string) => {
    if (!origin || corsOrigins.includes(origin)) return true;
    if (process.env.NODE_ENV === "production") return false;
    try {
      const hostname = new URL(origin).hostname;
      return hostname.endsWith(".loca.lt") || hostname.endsWith(".trycloudflare.com");
    } catch {
      return false;
    }
  };

  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(requireAuthForProtectedApi);
  app.use("/uploads", express.static(uploadsDir));

  // API Routes
  app.get("/api/health", async (_req, res) => {
    let db: "connected" | "disconnected" | "error" = "disconnected";
    try {
      if (await ensurePool()) {
        db = "connected";
      }
    } catch {
      db = "error";
    }
    res.json({
      status: db === "connected" ? "ok" : "degraded",
      db,
      message: "Faizan Islamic School API is running",
    });
  });

  app.get("/api/public/campuses", async (_req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const result = await pool.request().query(`
        SELECT id, campus_name AS campusName, campus_code AS campusCode, city, region
        FROM Campuses WHERE isActive = 1
        ORDER BY campus_name ASC
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching campuses");
    }
  });

  app.get("/api/public/classes", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const campusId = String(req.query.campusId || "").trim();
      if (!campusId) return res.status(400).json({ message: "campusId is required" });

      const result = await pool.request()
        .input("campusId", campusId)
        .query(`
          SELECT cl.id, cl.class_name AS className, cl.section_name AS sectionName, cl.capacity,
            (SELECT COUNT(*) FROM Students s WHERE s.class_id = cl.id AND s.status = 'Active') AS enrolledCount
          FROM Classes cl
          JOIN Campuses c ON c.id = cl.campus_id AND c.isActive = 1
          WHERE cl.campus_id = @campusId
          ORDER BY cl.class_name ASC
        `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching classes");
    }
  });

  app.post("/api/public/admissions", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const a = req.body;
      if (!a.campusId) return res.status(400).json({ message: "Campus is required" });
      if (!a.applicantName?.trim()) return res.status(400).json({ message: "Applicant name is required" });
      if (!a.contactNumber?.trim()) return res.status(400).json({ message: "Contact number is required" });
      const fatherCnic = normalizeCnic(a.fatherCnic);
      if (fatherCnic.length !== 13) return res.status(400).json({ message: "Father CNIC (13 digits) is required" });
      const studentBform = a.studentBform ? String(a.studentBform).trim() : null;

      const campusCheck = await pool.request()
        .input("campusId", a.campusId)
        .query("SELECT id, campus_name, phone FROM Campuses WHERE id = @campusId AND isActive = 1");
      const campusRow = campusCheck.recordset[0];
      if (!campusRow) return res.status(400).json({ message: INACTIVE_CAMPUS_ACTION_MESSAGE });

      const id = crypto.randomUUID();
      const trackingNo = await generateAdmissionTrackingNo(pool);
      await pool.request()
        .input("id", id)
        .input("tracking_no", trackingNo)
        .input("campus_id", a.campusId)
        .input("class_id", a.classId || null)
        .input("applicant_name", a.applicantName.trim())
        .input("father_name", a.fatherName || null)
        .input("father_cnic", fatherCnic)
        .input("student_bform", studentBform)
        .input("date_of_birth", a.dateOfBirth || null)
        .input("gender", a.gender || null)
        .input("contact_number", a.contactNumber || null)
        .input("address", a.address || null)
        .input("previous_school", a.previousSchool || null)
        .query(`
          INSERT INTO AdmissionApplications (
            id, tracking_no, campus_id, class_id, applicant_name, father_name, father_cnic, student_bform,
            date_of_birth, gender, contact_number, address, previous_school, status
          ) VALUES (
            @id, @tracking_no, @campus_id, @class_id, @applicant_name, @father_name, @father_cnic, @student_bform,
            @date_of_birth, @gender, @contact_number, @address, @previous_school, 'Pending'
          )
        `);

      let smsSent = false;
      let smsError: string | null = null;
      try {
        const smsResult = await sendAdmissionSms({
          phoneNumber: String(a.contactNumber),
          template: "admission_application_received",
          applicationId: id,
          trackingNo,
          applicantName: a.applicantName.trim(),
          campusName: String(campusRow.campus_name),
          campusPhone: campusRow.phone || null,
        });
        smsSent = smsResult.sent;
        if (!smsResult.sent) smsError = smsResult.reason || null;
      } catch (smsErr) {
        smsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
        console.warn("Application received SMS failed:", smsErr);
      }

      res.status(201).json({
        id,
        trackingNo,
        status: "Pending",
        message: "Application submitted successfully",
        smsSent,
        smsError,
      });
    } catch (err) {
      sendServerError(res, err, "Error submitting application");
    }
  });

  app.get("/api/public/admissions/track", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const trackingNo = String(req.query.trackingNo || "").trim().toUpperCase();
      const contact = String(req.query.contact || "").trim();
      if (!trackingNo) return res.status(400).json({ message: "Tracking number is required" });
      if (!contact) return res.status(400).json({ message: "Contact number is required for verification" });

      const result = await pool.request()
        .input("tracking_no", trackingNo)
        .query(`
          SELECT a.tracking_no AS trackingNo, a.applicant_name AS applicantName, a.status,
                 CONVERT(VARCHAR, a.applied_on, 120) AS appliedOn,
                 CONVERT(VARCHAR, a.interview_at, 120) AS interviewAt,
                 a.rejection_reason AS rejectionReason,
                 a.contact_number AS contactNumber,
                 c.campus_name AS campusName, cl.class_name AS className
          FROM AdmissionApplications a
          LEFT JOIN Campuses c ON c.id = a.campus_id
          LEFT JOIN Classes cl ON cl.id = a.class_id
          WHERE a.tracking_no = @tracking_no
        `);
      const row = result.recordset[0];
      if (!row) return res.status(404).json({ message: "Application not found" });
      if (!contactMatchesApplication(contact, String(row.contactNumber || ""))) {
        return res.status(403).json({ message: "Contact number does not match this application" });
      }

      res.json({
        trackingNo: row.trackingNo,
        applicantName: row.applicantName,
        status: row.status,
        appliedOn: row.appliedOn,
        interviewAt: row.interviewAt,
        rejectionReason: row.rejectionReason,
        campusName: row.campusName,
        className: row.className,
      });
    } catch (err) {
      sendServerError(res, err, "Error tracking application");
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const result = await pool.request()
        .input("username", req.auth.username)
        .query("SELECT * FROM Users WHERE username = @username");

      const user = result.recordset[0];
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!isUserActive(user)) {
        return res.status(403).json({ message: "Account is disabled" });
      }

      const permissions = await getRolePermissions(user.role);
      const mapped = mapUserFromRow(user);

      res.json({
        ...mapped,
        permissions,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/permission-modules", requireModulePermission("roles", "view"), (_req, res) => {
    res.json(APP_MODULES);
  });

  app.get("/api/app-roles", requireModulePermission("roles", "view"), async (_req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const result = await pool.request().query(`
        SELECT id, name, description, isSystem, isActive, createdOn
        FROM AppRoles
        ORDER BY isSystem DESC, name ASC
      `);
      res.json(result.recordset.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isSystem: Boolean(row.isSystem),
        isActive: Boolean(row.isActive),
        createdOn: row.createdOn,
      })));
    } catch (err) {
      sendServerError(res, err, "Error fetching roles");
    }
  });

  app.get("/api/app-roles/:id/permissions", requireModulePermission("roles", "view"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const roleRow = await pool.request()
        .input("roleId", req.params.id)
        .query("SELECT name FROM AppRoles WHERE id = @roleId");
      const roleName = roleRow.recordset[0]?.name as string | undefined;
      if (isSuperAdminRole(roleName)) {
        return res.json(fullPermissionMap());
      }
      const result = await pool.request()
        .input("roleId", req.params.id)
        .query(`
          SELECT moduleKey, canView, canCreate, canUpdate, canDelete
          FROM AppRolePermissions WHERE roleId = @roleId
        `);
      const map = emptyPermissionMap();
      for (const row of result.recordset) {
        map[String(row.moduleKey)] = {
          view: Boolean(row.canView),
          create: Boolean(row.canCreate),
          update: Boolean(row.canUpdate),
          delete: Boolean(row.canDelete),
        };
      }
      res.json(map);
    } catch (err) {
      sendServerError(res, err, "Error fetching role permissions");
    }
  });

  app.post("/api/app-roles", requireModulePermission("roles", "create"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ message: "Role name is required" });
      const dup = await pool.request().input("name", name).query("SELECT id FROM AppRoles WHERE name = @name");
      if (dup.recordset.length) return res.status(409).json({ message: "Role name already exists" });

      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("name", name)
        .input("description", String(req.body.description || "").trim() || null)
        .input("isSystem", 0)
        .query(`
          INSERT INTO AppRoles (id, name, description, isSystem, isActive, createdOn)
          VALUES (@id, @name, @description, @isSystem, 1, GETDATE())
        `);

      const permissions = (req.body.permissions || emptyPermissionMap()) as PermissionMap;
      for (const row of permissionsToRows(id, permissions)) {
        await pool.request()
          .input("id", row.id)
          .input("roleId", row.roleId)
          .input("moduleKey", row.moduleKey)
          .input("canView", row.canView ? 1 : 0)
          .input("canCreate", row.canCreate ? 1 : 0)
          .input("canUpdate", row.canUpdate ? 1 : 0)
          .input("canDelete", row.canDelete ? 1 : 0)
          .query(`
            INSERT INTO AppRolePermissions (id, roleId, moduleKey, canView, canCreate, canUpdate, canDelete)
            VALUES (@id, @roleId, @moduleKey, @canView, @canCreate, @canUpdate, @canDelete)
          `);
      }
      invalidatePermissionCache(name);
      res.status(201).json({ id, name, description: req.body.description || "", isSystem: false, isActive: true });
    } catch (err) {
      sendServerError(res, err, "Error creating role");
    }
  });

  app.put("/api/app-roles/:id", requireModulePermission("roles", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const existing = await pool.request()
        .input("id", req.params.id)
        .query("SELECT * FROM AppRoles WHERE id = @id");
      const role = existing.recordset[0];
      if (!role) return res.status(404).json({ message: "Role not found" });

      const name = String(req.body.name ?? role.name).trim();
      const description = req.body.description !== undefined ? String(req.body.description || "").trim() : role.description;
      const isActive = req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : role.isActive;

      if (Boolean(role.isSystem) && name !== role.name) {
        return res.status(400).json({ message: "System role name cannot be changed" });
      }

      await pool.request()
        .input("id", req.params.id)
        .input("name", name)
        .input("description", description || null)
        .input("isActive", isActive)
        .query(`
          UPDATE AppRoles SET name = @name, description = @description, isActive = @isActive
          WHERE id = @id
        `);

      invalidatePermissionCache(role.name);
      if (name !== role.name) invalidatePermissionCache(name);
      res.json({ id: req.params.id, name, description, isSystem: Boolean(role.isSystem), isActive: Boolean(isActive) });
    } catch (err) {
      sendServerError(res, err, "Error updating role");
    }
  });

  app.put("/api/app-roles/:id/permissions", requireModulePermission("roles", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const existing = await pool.request()
        .input("id", req.params.id)
        .query("SELECT name FROM AppRoles WHERE id = @id");
      const role = existing.recordset[0];
      if (!role) return res.status(404).json({ message: "Role not found" });
      if (isSuperAdminRole(role.name)) {
        return res.status(403).json({ message: "Super Admin permissions cannot be modified" });
      }

      const permissions = (req.body.permissions || req.body || emptyPermissionMap()) as PermissionMap;
      await pool.request().input("roleId", req.params.id).query("DELETE FROM AppRolePermissions WHERE roleId = @roleId");
      for (const row of permissionsToRows(req.params.id, permissions)) {
        await pool.request()
          .input("id", row.id)
          .input("roleId", row.roleId)
          .input("moduleKey", row.moduleKey)
          .input("canView", row.canView ? 1 : 0)
          .input("canCreate", row.canCreate ? 1 : 0)
          .input("canUpdate", row.canUpdate ? 1 : 0)
          .input("canDelete", row.canDelete ? 1 : 0)
          .query(`
            INSERT INTO AppRolePermissions (id, roleId, moduleKey, canView, canCreate, canUpdate, canDelete)
            VALUES (@id, @roleId, @moduleKey, @canView, @canCreate, @canUpdate, @canDelete)
          `);
      }
      invalidatePermissionCache(role.name);
      res.json({ ok: true });
    } catch (err) {
      sendServerError(res, err, "Error saving role permissions");
    }
  });

  app.delete("/api/app-roles/:id", requireModulePermission("roles", "delete"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const existing = await pool.request()
        .input("id", req.params.id)
        .query("SELECT name, isSystem FROM AppRoles WHERE id = @id");
      const role = existing.recordset[0];
      if (!role) return res.status(404).json({ message: "Role not found" });
      if (role.isSystem) return res.status(400).json({ message: "System roles cannot be deleted" });

      const users = await pool.request()
        .input("role", role.name)
        .query("SELECT COUNT(*) AS cnt FROM Users WHERE role = @role");
      if (Number(users.recordset[0]?.cnt || 0) > 0) {
        return res.status(400).json({ message: "Role is assigned to users and cannot be deleted" });
      }

      await pool.request().input("id", req.params.id).query("DELETE FROM AppRoles WHERE id = @id");
      invalidatePermissionCache(role.name);
      res.status(204).send();
    } catch (err) {
      sendServerError(res, err, "Error deleting role");
    }
  });

  // Specialized Students Route with Joins and Aliasing
  app.get("/api/students", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const studentPerms = await getRolePermissions(authUser.role);
      if (!hasPermission(studentPerms, "students", "view", authUser.role)) {
        return res.status(403).json({ message: "Forbidden — insufficient permissions" });
      }
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) {
        const { page, limit } = parsePagination(req);
        return res.json({ data: [], page, limit, total: 0 });
      }

      const { page, limit, offset } = parsePagination(req);
      const request = pool.request();
      const whereParts: string[] = [];

      if (campusFilter) {
        whereParts.push("s.campus_id = @campusId");
        request.input("campusId", campusFilter);
      }

      const classId = String(req.query.classId || "").trim();
      if (classId) {
        whereParts.push("s.class_id = @classId");
        request.input("classId", classId);
      }

      const status = String(req.query.status || "").trim();
      if (status) {
        whereParts.push("s.status = @status");
        request.input("status", status);
      }

      const search = String(req.query.search || "").trim();
      if (search) {
        whereParts.push("(s.student_name LIKE @search OR s.admission_no LIKE @search OR s.registration_no LIKE @search)");
        request.input("search", `%${search}%`);
      }

      const whereClause = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";

      const baseFrom = `
        FROM Students s
        LEFT JOIN Campuses c ON s.campus_id = c.id
        LEFT JOIN Classes cl ON s.class_id = cl.id
        ${whereClause}
      `;

      let total = 0;
      const countResult = await request.query(`SELECT COUNT(*) AS total ${baseFrom}`);
      total = countResult.recordset[0]?.total ?? 0;

      const query = `
        SELECT 
          s.id,
          s.campus_id AS campusId,
          s.class_id AS classId,
          s.admission_no AS rollNumber,
          s.registration_no AS studentCode,
          s.gr_no AS serialNo,
          s.student_name AS firstName,
          '' AS lastName,
          s.father_name AS fatherName,
          s.father_cnic AS cnicBForm,
          s.father_mobile AS contactNumber,
          CONVERT(VARCHAR, s.dob, 23) AS dateOfBirth,
          CONVERT(VARCHAR, s.admission_date, 23) AS admissionDate,
          s.gender,
          s.address,
          s.batch_no AS session,
          s.status,
          c.campus_name AS campusName,
          c.city AS city,
          cl.class_name AS className,
          cl.section_name AS sectionName,
          s.outstanding_fees AS outstandingFees,
          s.profile_image AS profileImage,
          'Physical Campus' AS campusType
        ${baseFrom}
        ORDER BY s.student_name ASC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `;

      const result = await request.query(query);
      return res.json({ data: result.recordset, page, limit, total });
    } catch (err) {
      sendServerError(res, err, "Error fetching students");
    }
  });

  app.get("/api/students/options", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "30"), 10) || 30));
      const search = String(req.query.search || "").trim();
      const request = pool.request().input("limit", limit);
      const whereParts: string[] = ["s.status = 'Active'"];
      if (campusFilter) {
        whereParts.push("s.campus_id = @campusId");
        request.input("campusId", campusFilter);
      }
      if (search) {
        whereParts.push("(s.student_name LIKE @search OR s.admission_no LIKE @search)");
        request.input("search", `%${search}%`);
      }

      const result = await request.query(`
        SELECT TOP (@limit)
          s.id,
          s.student_name AS firstName,
          '' AS lastName,
          s.admission_no AS rollNumber,
          s.class_id AS classId,
          s.campus_id AS campusId
        FROM Students s
        WHERE ${whereParts.join(" AND ")}
        ORDER BY s.student_name ASC
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching student options");
    }
  });

  // Specialized Campuses Route
  app.get("/api/campuses", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser);
      if (denied) return res.json([]);

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE id = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const query = `
        SELECT 
          id,
          campus_name AS campusName,
          ISNULL(campus_code, campus_name) AS campusCode,
          city,
          region,
          address,
          phone,
          email,
          isActive,
          ISNULL(sibling_discount_2nd, 10) AS siblingDiscount2nd,
          ISNULL(sibling_discount_3rd, 15) AS siblingDiscount3rd,
          CONVERT(VARCHAR, createdOn, 23) AS createdOn
        FROM Campuses
        ${campusWhere}
        ORDER BY campus_name ASC
      `;
      
      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching campuses:", err);
      res.status(500).json({ message: "Error fetching campuses", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/campuses", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const c = req.body;
      const id = crypto.randomUUID();
      
      await pool.request()
        .input("id", id)
        .input("campus_code", c.campusCode || null)
        .input("campus_name", c.campusName)
        .input("city", c.city || null)
        .input("region", c.region || null)
        .input("address", c.address || null)
        .input("phone", c.phone || null)
        .input("email", c.email || null)
        .input("isActive", c.isActive === false ? 0 : 1)
        .input("sibling_discount_2nd", c.siblingDiscount2nd ?? 10)
        .input("sibling_discount_3rd", c.siblingDiscount3rd ?? 15)
        .query(`
          INSERT INTO Campuses (id, campus_code, campus_name, city, region, address, phone, email, isActive, sibling_discount_2nd, sibling_discount_3rd)
          VALUES (@id, @campus_code, @campus_name, @city, @region, @address, @phone, @email, @isActive, @sibling_discount_2nd, @sibling_discount_3rd)
        `);
      
      res.status(201).json({ ...c, id });
    } catch (err) {
      console.error("Error adding campus:", err);
      res.status(500).json({ message: "Error adding campus", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/campuses/:id", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { id } = req.params;
      const c = req.body;

      const prevResult = await pool.request().input("id", id).query("SELECT campus_name, isActive FROM Campuses WHERE id = @id");
      const prevCampus = prevResult.recordset[0];
      if (!prevCampus) return res.status(404).json({ message: "Campus not found" });
      if (!prevCampus.isActive && c.isActive !== true) {
        return res.status(403).json({ message: INACTIVE_CAMPUS_ACTION_MESSAGE });
      }
      const prevName = prevCampus.campus_name;
      if (prevName && c.campusName && prevName !== c.campusName) {
        await pool.request()
          .input("id", crypto.randomUUID())
          .input("campus_id", id)
          .input("old_name", prevName)
          .input("new_name", c.campusName)
          .input("changed_by", req.auth?.username || null)
          .query(`
            INSERT INTO CampusNameHistory (id, campus_id, old_name, new_name, changed_by)
            VALUES (@id, @campus_id, @old_name, @new_name, @changed_by)
          `);
      }
      
      await pool.request()
        .input("id", id)
        .input("campus_code", c.campusCode || null)
        .input("campus_name", c.campusName)
        .input("city", c.city || null)
        .input("region", c.region || null)
        .input("address", c.address || null)
        .input("phone", c.phone || null)
        .input("email", c.email || null)
        .input("isActive", c.isActive === false ? 0 : 1)
        .input("sibling_discount_2nd", c.siblingDiscount2nd ?? 10)
        .input("sibling_discount_3rd", c.siblingDiscount3rd ?? 15)
        .query(`
          UPDATE Campuses 
          SET campus_code = @campus_code, campus_name = @campus_name, city = @city, region = @region, 
              address = @address, phone = @phone, email = @email, isActive = @isActive,
              sibling_discount_2nd = @sibling_discount_2nd, sibling_discount_3rd = @sibling_discount_3rd
          WHERE id = @id
        `);
      
      res.json({ ...c, id });
    } catch (err) {
      console.error("Error updating campus:", err);
      res.status(500).json({ message: "Error updating campus", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Specialized Classes Route
  app.get("/api/classes", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE cl.campus_id = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const query = `
        SELECT 
          cl.id,
          cl.class_name AS className,
          cl.section_name AS sectionName,
          cl.campus_id AS campusId,
          c.campus_name AS campusName,
          cl.capacity,
          cl.shift,
          (SELECT COUNT(*) FROM Students s WHERE s.class_id = cl.id AND s.status = 'Active') AS enrolledCount
        FROM Classes cl
        LEFT JOIN Campuses c ON cl.campus_id = c.id
        ${campusWhere}
        ORDER BY cl.class_name ASC
      `;
      
      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching classes:", err);
      res.status(500).json({ message: "Error fetching classes", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/classes", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const c = req.body;
      const campusErr = await assertCampusWrite(authUser, c.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      const id = crypto.randomUUID();
      
      await pool.request()
        .input("id", id)
        .input("campus_id", c.campusId)
        .input("class_name", c.className)
        .input("section_name", c.sectionName)
        .input("capacity", c.capacity || 40)
        .input("shift", c.shift || 'Morning')
        .query(`
          INSERT INTO Classes (id, campus_id, class_name, section_name, capacity, shift)
          VALUES (@id, @campus_id, @class_name, @section_name, @capacity, @shift)
        `);
      
      res.status(201).json({ ...c, id });
    } catch (err) {
      console.error("Error adding class:", err);
      res.status(500).json({ message: "Error adding class", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/classes/:id", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const c = req.body;
      const campusErr = await assertCampusWrite(authUser, c.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      
      await pool.request()
        .input("id", id)
        .input("campus_id", c.campusId)
        .input("class_name", c.className)
        .input("section_name", c.sectionName)
        .input("capacity", c.capacity)
        .input("shift", c.shift)
        .query(`
          UPDATE Classes SET 
            campus_id = @campus_id,
            class_name = @class_name,
            section_name = @section_name,
            capacity = @capacity,
            shift = @shift
          WHERE id = @id
        `);
      
      res.json({ ...c, id });
    } catch (err) {
      console.error("Error updating class:", err);
      res.status(500).json({ message: "Error updating class", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Campus session fee structures (one structure per campus per academic session)
  app.get("/api/fee-structures/campus", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);
      if (!campusFilter) {
        return res.status(400).json({ message: "campusId is required (cannot be 'all')" });
      }

      const session = String(req.query.session || "").trim();
      const request = pool.request().input("campusId", campusFilter);
      let query = `
        SELECT
          fs.id,
          fs.campus_id AS campusId,
          fs.session AS sessionLabel,
          ISNULL(fs.tuition_fee, 0) AS tuitionFee,
          ISNULL(fs.tuition_fee, 0) AS monthlyFee,
          ISNULL(fs.admission_fee, 0) AS admissionFee,
          ISNULL(fs.security_fee, 0) AS securityFee,
          ISNULL(fs.exam_fee, 0) AS examFee,
          ISNULL(fs.transport_fee, 0) AS transportFee,
          ISNULL(fs.misc_fee, 0) AS miscFee,
          ISNULL(fs.summer_camp_fee, 0) AS summerCampFee,
          ISNULL(fs.id_card_fee, 0) AS idCardFee,
          ISNULL(fs.trip_fee, 0) AS tripFee,
          fs.last_updated AS lastUpdated
        FROM FeeStructures fs
        WHERE fs.campus_id = @campusId AND fs.class_id IS NULL
      `;
      if (session) {
        query += " AND fs.session = @session";
        request.input("session", session);
      }
      query += " ORDER BY fs.session DESC";
      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching campus fee structures");
    }
  });

  app.get("/api/fee-structures/sessions", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);
      if (!campusFilter) {
        return res.status(400).json({ message: "campusId is required" });
      }

      const result = await pool.request()
        .input("campusId", campusFilter)
        .query(`
          SELECT DISTINCT session AS sessionLabel
          FROM FeeStructures
          WHERE campus_id = @campusId AND class_id IS NULL AND session IS NOT NULL
          ORDER BY session DESC
        `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching fee structure sessions");
    }
  });

  app.post("/api/fee-structures/campus", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusId = String(req.body.campusId || "").trim();
      if (!campusId) return res.status(400).json({ message: "campusId is required" });

      const campusErr = await assertCampusWrite(authUser, campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const sessionLabel = normalizeSessionLabel(
        req.body.sessionLabel || req.body.session,
        req.body.year ? Number(req.body.year) : undefined
      );
      const tuitionFee = Number(req.body.tuitionFee ?? req.body.monthlyFee ?? 0);
      const admissionFee = Number(req.body.admissionFee ?? 0);
      const securityFee = Number(req.body.securityFee ?? 0);
      const examFee = Number(req.body.examFee ?? 0);
      const transportFee = Number(req.body.transportFee ?? 0);
      const miscFee = Number(req.body.miscFee ?? 0);
      const summerCampFee = Number(req.body.summerCampFee ?? 0);
      const idCardFee = Number(req.body.idCardFee ?? 0);
      const tripFee = Number(req.body.tripFee ?? 0);

      const existing = await pool.request()
        .input("campusId", campusId)
        .input("session", sessionLabel)
        .query(`
          SELECT id FROM FeeStructures
          WHERE campus_id = @campusId AND session = @session AND class_id IS NULL
        `);

      if (existing.recordset[0]) {
        const id = existing.recordset[0].id;
        await pool.request()
          .input("id", id)
          .input("tuition_fee", tuitionFee)
          .input("admission_fee", admissionFee)
          .input("security_fee", securityFee)
          .input("exam_fee", examFee)
          .input("transport_fee", transportFee)
          .input("misc_fee", miscFee)
          .input("summer_camp_fee", summerCampFee)
          .input("id_card_fee", idCardFee)
          .input("trip_fee", tripFee)
          .query(`
            UPDATE FeeStructures SET
              tuition_fee = @tuition_fee, admission_fee = @admission_fee, security_fee = @security_fee,
              exam_fee = @exam_fee, transport_fee = @transport_fee, misc_fee = @misc_fee,
              summer_camp_fee = @summer_camp_fee, id_card_fee = @id_card_fee, trip_fee = @trip_fee,
              last_updated = GETDATE()
            WHERE id = @id
          `);
        return res.json({ id, campusId, sessionLabel, message: "Campus fee structure updated" });
      }

      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("campus_id", campusId)
        .input("session", sessionLabel)
        .input("tuition_fee", tuitionFee)
        .input("admission_fee", admissionFee)
        .input("security_fee", securityFee)
        .input("exam_fee", examFee)
        .input("transport_fee", transportFee)
        .input("misc_fee", miscFee)
        .input("summer_camp_fee", summerCampFee)
        .input("id_card_fee", idCardFee)
        .input("trip_fee", tripFee)
        .query(`
          INSERT INTO FeeStructures (
            id, campus_id, class_id, session, tuition_fee, admission_fee, security_fee,
            exam_fee, transport_fee, misc_fee, summer_camp_fee, id_card_fee, trip_fee, last_updated
          ) VALUES (
            @id, @campus_id, NULL, @session, @tuition_fee, @admission_fee, @security_fee,
            @exam_fee, @transport_fee, @misc_fee, @summer_camp_fee, @id_card_fee, @trip_fee, GETDATE()
          )
        `);
      res.status(201).json({ id, campusId, sessionLabel, message: "Campus fee structure created" });
    } catch (err) {
      sendServerError(res, err, "Error saving campus fee structure");
    }
  });

  app.post("/api/fee-structures/apply-to-classes", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusId = String(req.body.campusId || "").trim();
      const sessionLabel = normalizeSessionLabel(req.body.sessionLabel || req.body.session, req.body.year);
      if (!campusId) return res.status(400).json({ message: "campusId is required" });

      const campusErr = await assertCampusWrite(authUser, campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const structure = await pool.request()
        .input("campusId", campusId)
        .input("session", sessionLabel)
        .query(`
          SELECT TOP 1 * FROM FeeStructures
          WHERE campus_id = @campusId AND session = @session AND class_id IS NULL
        `);
      const fs = structure.recordset[0];
      if (!fs) return res.status(404).json({ message: "Campus session fee structure not found" });

      const classes = await pool.request()
        .input("campusId", campusId)
        .query("SELECT id FROM Classes WHERE campus_id = @campusId");

      let updatedCount = 0;
      for (const row of classes.recordset) {
        const existing = await pool.request()
          .input("class_id", row.id)
          .query("SELECT id FROM FeeSettings WHERE class_id = @class_id");
        if (existing.recordset[0]) {
          await pool.request()
            .input("id", existing.recordset[0].id)
            .input("monthly_fee", fs.tuition_fee ?? 0)
            .input("admission_fee", fs.admission_fee ?? 0)
            .input("security_fee", fs.security_fee ?? 0)
            .input("exam_fee", fs.exam_fee ?? 0)
            .input("transport_fee", fs.transport_fee ?? 0)
            .input("misc_fee", fs.misc_fee ?? 0)
            .input("summer_camp_fee", fs.summer_camp_fee ?? 0)
            .input("id_card_fee", fs.id_card_fee ?? 0)
            .input("trip_fee", fs.trip_fee ?? 0)
            .query(`
              UPDATE FeeSettings SET
                monthly_fee = @monthly_fee, admission_fee = @admission_fee, security_fee = @security_fee,
                exam_fee = @exam_fee, transport_fee = @transport_fee, misc_fee = @misc_fee,
                summer_camp_fee = @summer_camp_fee, id_card_fee = @id_card_fee, trip_fee = @trip_fee,
                last_updated = GETDATE()
              WHERE id = @id
            `);
        } else {
          await pool.request()
            .input("id", crypto.randomUUID())
            .input("class_id", row.id)
            .input("monthly_fee", fs.tuition_fee ?? 0)
            .input("admission_fee", fs.admission_fee ?? 0)
            .input("security_fee", fs.security_fee ?? 0)
            .input("exam_fee", fs.exam_fee ?? 0)
            .input("transport_fee", fs.transport_fee ?? 0)
            .input("misc_fee", fs.misc_fee ?? 0)
            .input("summer_camp_fee", fs.summer_camp_fee ?? 0)
            .input("id_card_fee", fs.id_card_fee ?? 0)
            .input("trip_fee", fs.trip_fee ?? 0)
            .query(`
              INSERT INTO FeeSettings (
                id, class_id, monthly_fee, admission_fee, security_fee, exam_fee,
                transport_fee, misc_fee, summer_camp_fee, id_card_fee, trip_fee, last_updated
              ) VALUES (
                @id, @class_id, @monthly_fee, @admission_fee, @security_fee, @exam_fee,
                @transport_fee, @misc_fee, @summer_camp_fee, @id_card_fee, @trip_fee, GETDATE()
              )
            `);
        }
        updatedCount++;
      }
      res.json({ message: "Campus fee structure applied to all classes", sessionLabel, updatedCount });
    } catch (err) {
      sendServerError(res, err, "Error applying campus fee structure to classes");
    }
  });

  // Specialized Fee Settings Routes
  app.get("/api/fee-settings", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      
      const campusId = req.query.campusId;
      if (!campusId || campusId === "all") {
        return res.status(400).json({ message: "campusId is required (cannot be 'all')" });
      }

      const query = `
        SELECT 
          cl.id AS classId,
          cl.class_name AS className,
          cl.section_name AS sectionName,
          fs.id,
          ISNULL(fs.monthly_fee, 0) AS monthlyFee,
          ISNULL(fs.admission_fee, 0) AS admissionFee,
          ISNULL(fs.security_fee, 0) AS securityFee,
          ISNULL(fs.exam_fee, 0) AS examFee,
          ISNULL(fs.transport_fee, 0) AS transportFee,
          ISNULL(fs.misc_fee, 0) AS miscFee,
          ISNULL(fs.summer_camp_fee, 0) AS summerCampFee,
          ISNULL(fs.id_card_fee, 0) AS idCardFee,
          ISNULL(fs.trip_fee, 0) AS tripFee,
          fs.last_updated AS lastUpdated
        FROM Classes cl
        LEFT JOIN FeeSettings fs ON cl.id = fs.class_id
        WHERE cl.campus_id = @campusId
      `;
      
      const result = await pool.request()
        .input("campusId", campusId)
        .query(query);
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching fee settings:", err);
      res.status(500).json({ message: "Error fetching fee settings", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/fee-settings", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const f = req.body;
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const classResult = await pool.request()
        .input("classId", f.classId)
        .query("SELECT campus_id FROM Classes WHERE id = @classId");
      const classRow = classResult.recordset[0];
      if (!classRow) return res.status(404).json({ message: "Class not found" });
      const campusErr = await assertCampusWrite(authUser, classRow.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });
      
      // Check if fee settings already exist for this class
      const checkQuery = `SELECT id FROM FeeSettings WHERE class_id = @class_id`;
      const checkResult = await pool.request()
        .input("class_id", f.classId)
        .query(checkQuery);
      
      if (checkResult.recordset.length > 0) {
        // Update
        const id = checkResult.recordset[0].id;
        await pool.request()
          .input("id", id)
          .input("monthly_fee", f.monthlyFee)
          .input("admission_fee", f.admissionFee)
          .input("security_fee", f.securityFee)
          .input("exam_fee", f.examFee ?? 0)
          .input("transport_fee", f.transportFee ?? 0)
          .input("misc_fee", f.miscFee ?? 0)
          .input("summer_camp_fee", f.summerCampFee ?? 0)
          .input("id_card_fee", f.idCardFee ?? 0)
          .input("trip_fee", f.tripFee ?? 0)
          .query(`
            UPDATE FeeSettings SET 
              monthly_fee = @monthly_fee,
              admission_fee = @admission_fee,
              security_fee = @security_fee,
              exam_fee = @exam_fee,
              transport_fee = @transport_fee,
              misc_fee = @misc_fee,
              summer_camp_fee = @summer_camp_fee,
              id_card_fee = @id_card_fee,
              trip_fee = @trip_fee,
              last_updated = GETDATE()
            WHERE id = @id
          `);
        res.json({ ...f, id });
      } else {
        // Insert
        const id = crypto.randomUUID();
        await pool.request()
          .input("id", id)
          .input("class_id", f.classId)
          .input("monthly_fee", f.monthlyFee)
          .input("admission_fee", f.admissionFee)
          .input("security_fee", f.securityFee)
          .input("exam_fee", f.examFee ?? 0)
          .input("transport_fee", f.transportFee ?? 0)
          .input("misc_fee", f.miscFee ?? 0)
          .input("summer_camp_fee", f.summerCampFee ?? 0)
          .input("id_card_fee", f.idCardFee ?? 0)
          .input("trip_fee", f.tripFee ?? 0)
          .query(`
            INSERT INTO FeeSettings (id, class_id, monthly_fee, admission_fee, security_fee, exam_fee, transport_fee, misc_fee, summer_camp_fee, id_card_fee, trip_fee, last_updated)
            VALUES (@id, @class_id, @monthly_fee, @admission_fee, @security_fee, @exam_fee, @transport_fee, @misc_fee, @summer_camp_fee, @id_card_fee, @trip_fee, GETDATE())
          `);
        res.status(201).json({ ...f, id });
      }
    } catch (err) {
      console.error("Error saving fee settings:", err);
      res.status(500).json({ message: "Error saving fee settings", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/fee-settings/apply-class-wide", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const classId = String(req.body.classId || "").trim();
      if (!classId) return res.status(400).json({ message: "classId is required" });

      const sourceClass = await pool.request()
        .input("classId", classId)
        .query("SELECT id, class_name, campus_id FROM Classes WHERE id = @classId");
      const src = sourceClass.recordset[0];
      if (!src) return res.status(404).json({ message: "Source class not found" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusErr = await assertCampusWrite(authUser, src.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const sourceSetting = await pool.request()
        .input("classId", classId)
        .query("SELECT * FROM FeeSettings WHERE class_id = @classId");
      const fs = sourceSetting.recordset[0];
      if (!fs) return res.status(400).json({ message: "Source class has no fee settings to apply" });

      const classesResult = await pool.request()
        .input("campusId", src.campus_id)
        .input("className", src.class_name)
        .query("SELECT id FROM Classes WHERE campus_id = @campusId AND class_name = @className");
      const classIds = classesResult.recordset.map((r: { id: string }) => r.id);

      let updatedCount = 0;
      for (const targetClassId of classIds) {
        const existing = await pool.request()
          .input("class_id", targetClassId)
          .query("SELECT id FROM FeeSettings WHERE class_id = @class_id");
        if (existing.recordset[0]) {
          await pool.request()
            .input("id", existing.recordset[0].id)
            .input("monthly_fee", fs.monthly_fee ?? 0)
            .input("admission_fee", fs.admission_fee ?? 0)
            .input("security_fee", fs.security_fee ?? 0)
            .input("exam_fee", fs.exam_fee ?? 0)
            .input("transport_fee", fs.transport_fee ?? 0)
            .input("misc_fee", fs.misc_fee ?? 0)
            .input("summer_camp_fee", fs.summer_camp_fee ?? 0)
            .input("id_card_fee", fs.id_card_fee ?? 0)
            .input("trip_fee", fs.trip_fee ?? 0)
            .query(`
              UPDATE FeeSettings SET
                monthly_fee = @monthly_fee, admission_fee = @admission_fee, security_fee = @security_fee,
                exam_fee = @exam_fee, transport_fee = @transport_fee, misc_fee = @misc_fee,
                summer_camp_fee = @summer_camp_fee, id_card_fee = @id_card_fee, trip_fee = @trip_fee,
                last_updated = GETDATE()
              WHERE id = @id
            `);
        } else {
          await pool.request()
            .input("id", crypto.randomUUID())
            .input("class_id", targetClassId)
            .input("monthly_fee", fs.monthly_fee ?? 0)
            .input("admission_fee", fs.admission_fee ?? 0)
            .input("security_fee", fs.security_fee ?? 0)
            .input("exam_fee", fs.exam_fee ?? 0)
            .input("transport_fee", fs.transport_fee ?? 0)
            .input("misc_fee", fs.misc_fee ?? 0)
            .input("summer_camp_fee", fs.summer_camp_fee ?? 0)
            .input("id_card_fee", fs.id_card_fee ?? 0)
            .input("trip_fee", fs.trip_fee ?? 0)
            .query(`
              INSERT INTO FeeSettings (
                id, class_id, monthly_fee, admission_fee, security_fee, exam_fee,
                transport_fee, misc_fee, summer_camp_fee, id_card_fee, trip_fee, last_updated
              ) VALUES (
                @id, @class_id, @monthly_fee, @admission_fee, @security_fee, @exam_fee,
                @transport_fee, @misc_fee, @summer_camp_fee, @id_card_fee, @trip_fee, GETDATE()
              )
            `);
        }
        updatedCount++;
      }

      res.json({
        message: "Fee settings applied to all sections of this class",
        className: src.class_name,
        updatedCount,
      });
    } catch (err) {
      sendServerError(res, err, "Error applying class-wide fee settings");
    }
  });

  app.post("/api/fee-settings/sync-from-structures", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.body?.campusId);
      if (denied) return res.status(403).json({ message: "User is not assigned to a campus" });
      if (campusFilter) {
        const campusErr = await assertCampusWrite(authUser, campusFilter);
        if (campusErr) return res.status(403).json({ message: campusErr });
      }
      const overwrite = Boolean(req.body?.overwrite);

      const updateResult = await pool.request()
        .input("campusId", campusFilter || null)
        .input("overwrite", overwrite ? 1 : 0)
        .query(`
          UPDATE fs
          SET
            monthly_fee = ISNULL(st.tuition_fee, 0),
            admission_fee = ISNULL(st.admission_fee, 0),
            exam_fee = ISNULL(st.exam_fee, 0),
            transport_fee = ISNULL(st.transport_fee, 0),
            misc_fee = ISNULL(st.misc_fee, 0),
            last_updated = GETDATE()
          FROM FeeSettings fs
          JOIN Classes c ON c.id = fs.class_id
          JOIN Campuses cp ON cp.id = c.campus_id AND cp.isActive = 1
          JOIN FeeStructures st ON st.class_id = c.id
          WHERE (@campusId IS NULL OR c.campus_id = @campusId)
            AND (
              @overwrite = 1
              OR ISNULL(fs.monthly_fee, 0) = 0
            )
        `);

      const insertResult = await pool.request()
        .input("campusId", campusFilter || null)
        .query(`
          INSERT INTO FeeSettings (
            id, class_id, monthly_fee, admission_fee, security_fee, exam_fee,
            transport_fee, misc_fee, summer_camp_fee, id_card_fee, trip_fee, last_updated
          )
          SELECT
            CONVERT(NVARCHAR(50), NEWID()),
            c.id,
            ISNULL(st.tuition_fee, 0),
            ISNULL(st.admission_fee, 0),
            0,
            ISNULL(st.exam_fee, 0),
            ISNULL(st.transport_fee, 0),
            ISNULL(st.misc_fee, 0),
            0,
            0,
            0,
            GETDATE()
          FROM Classes c
          JOIN Campuses cp ON cp.id = c.campus_id AND cp.isActive = 1
          JOIN FeeStructures st ON st.class_id = c.id
          LEFT JOIN FeeSettings fs ON fs.class_id = c.id
          WHERE fs.id IS NULL
            AND (@campusId IS NULL OR c.campus_id = @campusId)
        `);

      res.json({
        message: "Fee settings synced from fee structures",
        updatedCount: Number(updateResult.rowsAffected?.[0] || 0),
        insertedCount: Number(insertResult.rowsAffected?.[0] || 0),
        overwrite,
      });
    } catch (err) {
      sendServerError(res, err, "Error syncing fee settings from structures");
    }
  });

  const syncAllClassFeeStructures = async (req: Request, res: Response) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.body?.campusId);
      if (denied) return res.status(403).json({ message: "User is not assigned to a campus" });
      if (campusFilter) {
        const campusErr = await assertCampusWrite(authUser, campusFilter);
        if (campusErr) return res.status(403).json({ message: campusErr });
      }

      const request = pool.request().input("campusId", campusFilter || null);
      const summary = await request.query(`
        WITH MissingClasses AS (
          SELECT c.id AS class_id, c.campus_id, c.class_name
          FROM Classes c
          JOIN Campuses cp ON cp.id = c.campus_id AND cp.isActive = 1
          LEFT JOIN FeeStructures fs ON fs.class_id = c.id
          WHERE fs.id IS NULL
            AND (@campusId IS NULL OR c.campus_id = @campusId)
        )
        SELECT
          COUNT(1) AS missingCount,
          SUM(CASE WHEN tmpl.id IS NULL THEN 0 ELSE 1 END) AS templateCount
        FROM MissingClasses mc
        OUTER APPLY (
          SELECT TOP 1 fs.id
          FROM FeeStructures fs
          JOIN Classes c2 ON c2.id = fs.class_id
          WHERE c2.campus_id = mc.campus_id
            AND c2.class_name = mc.class_name
          ORDER BY fs.id
        ) tmpl
      `);

      const missingCount = Number(summary.recordset?.[0]?.missingCount || 0);
      const templateCount = Number(summary.recordset?.[0]?.templateCount || 0);
      if (missingCount === 0) {
        return res.json({
          message: "All classes already have fee structures",
          createdCount: 0,
          templateCopiedCount: 0,
          zeroDefaultCount: 0,
        });
      }

      const insertResult = await pool.request()
        .input("campusId", campusFilter || null)
        .query(`
          WITH MissingClasses AS (
            SELECT c.id AS class_id, c.campus_id, c.class_name
            FROM Classes c
            JOIN Campuses cp ON cp.id = c.campus_id AND cp.isActive = 1
            LEFT JOIN FeeStructures fs ON fs.class_id = c.id
            WHERE fs.id IS NULL
              AND (@campusId IS NULL OR c.campus_id = @campusId)
          )
          INSERT INTO FeeStructures (
            id, campus_id, class_id, tuition_fee, admission_fee, exam_fee, transport_fee, misc_fee
          )
          SELECT
            CONVERT(NVARCHAR(50), NEWID()) AS id,
            mc.campus_id,
            mc.class_id,
            ISNULL(tmpl.tuition_fee, 0),
            ISNULL(tmpl.admission_fee, 0),
            ISNULL(tmpl.exam_fee, 0),
            ISNULL(tmpl.transport_fee, 0),
            ISNULL(tmpl.misc_fee, 0)
          FROM MissingClasses mc
          OUTER APPLY (
            SELECT TOP 1
              fs.tuition_fee,
              fs.admission_fee,
              fs.exam_fee,
              fs.transport_fee,
              fs.misc_fee
            FROM FeeStructures fs
            JOIN Classes c2 ON c2.id = fs.class_id
            WHERE c2.campus_id = mc.campus_id
              AND c2.class_name = mc.class_name
            ORDER BY fs.id
          ) tmpl
        `);

      const createdCount = Number(insertResult.rowsAffected?.[0] || 0);
      res.json({
        message: "Fee structures initialized for missing classes",
        createdCount,
        templateCopiedCount: templateCount,
        zeroDefaultCount: Math.max(0, createdCount - templateCount),
      });
    } catch (err) {
      sendServerError(res, err, "Error syncing fee structures for classes");
    }
  };
  app.post("/api/fee-structures/sync-all-classes", requireRoles(ADMIN_ROLES), syncAllClassFeeStructures);
  app.post("/api/feestructures/sync-all-classes", requireRoles(ADMIN_ROLES), syncAllClassFeeStructures);
  app.post("/api/feeStructures/sync-all-classes", requireRoles(ADMIN_ROLES), syncAllClassFeeStructures);

  app.get("/api/fees/stats", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) {
        return res.json({
          totalCount: 0, totalPaid: 0, totalOutstanding: 0, defaulters: 0,
        });
      }

      const request = pool.request();
      const whereClause = buildFeeFilterClauses(req, request, campusFilter);
      const baseFrom = `
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        ${whereClause}
      `;

      const result = await request.query(`
        SELECT
          COUNT(*) AS totalCount,
          ISNULL(SUM(f.paid_amount), 0) AS totalPaid,
          ISNULL(SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END), 0) AS totalOutstanding,
          COUNT(DISTINCT CASE WHEN f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending') THEN f.student_id END) AS defaulters
        ${baseFrom}
      `);

      const row = result.recordset[0] || {};
      res.json({
        totalCount: row.totalCount ?? 0,
        totalPaid: row.totalPaid ?? 0,
        totalOutstanding: row.totalOutstanding ?? 0,
        defaulters: row.defaulters ?? 0,
      });
    } catch (err) {
      sendServerError(res, err, "Error fetching fee stats");
    }
  });

  // Specialized Fee Vouchers Route (Updated for QuickPay)
  app.get("/api/fees", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) {
        const { page, limit } = parsePagination(req);
        return res.json({ data: [], page, limit, total: 0 });
      }

      const { page, limit, offset } = parsePagination(req);
      const request = pool.request();
      const whereClause = buildFeeFilterClauses(req, request, campusFilter);

      const baseFrom = `
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        LEFT JOIN Classes cl ON s.class_id = cl.id
        LEFT JOIN Campuses cp ON s.campus_id = cp.id
        ${whereClause}
      `;

      const countResult = await request.query(`SELECT COUNT(*) AS total ${baseFrom}`);
      const total = countResult.recordset[0]?.total ?? 0;

      const query = `
        SELECT 
          f.id,
          f.student_id AS studentId,
          f.amount,
          f.month,
          f.year,
          f.status,
          f.fee_type AS feeType,
          f.paid_amount AS paidAmount,
          f.discount_amount AS discountAmount,
          f.fine_amount AS fineAmount,
          f.balance_amount AS balanceAmount,
          f.payment_history AS paymentHistory,
          f.tuition_fee AS tuitionFee,
          f.admission_fee AS admissionFee,
          f.exam_fee AS examFee,
          f.transport_fee AS transportFee,
          f.misc_fee AS miscFee,
          f.arrears AS arrears,
          f.security_fee AS securityFee,
          f.summer_camp_fee AS summerCampFee,
          f.id_card_fee AS idCardFee,
          f.trip_fee AS tripFee,
          f.months_label AS monthsLabel,
          COALESCE(f.campus_name_snapshot, cp.campus_name) AS campusName,
          f.transaction_ref AS transactionRef,
          f.payment_method AS paymentMethod,
          CONVERT(VARCHAR, f.payment_date, 23) AS paymentDate,
          CONVERT(VARCHAR, f.due_date, 23) AS dueDate,
          CONVERT(VARCHAR, f.created_at, 23) AS createdAt,
          s.student_name AS studentName,
          s.father_name AS fatherName,
          s.admission_no AS rollNumber,
          s.campus_id AS campusId,
          s.outstanding_fees AS outstandingFees,
          cl.class_name AS className
        ${baseFrom}
        ORDER BY f.created_at DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `;

      const result = await request.query(query);
      return res.json({ data: result.recordset, page, limit, total });
    } catch (err) {
      console.error("Error fetching fees:", err);
      res.status(500).json({ message: "Error fetching fees", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/feevouchers", async (req, res) => {
    // Alias for /api/fees
    res.redirect(307, "/api/fees");
  });

  const handleFeeUpdate = async (req: Request, res: Response) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { id } = req.params;
      const f = req.body;

      const currentResult = await pool.request()
        .input("id", id)
        .query("SELECT * FROM Fees WHERE id = @id");

      if (currentResult.recordset.length === 0) {
        return res.status(404).json({ message: "Fee record not found" });
      }

      const currentFee = currentResult.recordset[0];
      const studentId = currentFee.student_id;
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const studentCampusResult = await pool.request()
        .input("studentId", studentId)
        .query("SELECT campus_id FROM Students WHERE id = @studentId");
      const studentCampus = studentCampusResult.recordset[0];
      if (!studentCampus) return res.status(404).json({ message: "Student not found" });
      const campusErr = await assertCampusWrite(authUser, studentCampus.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const newPayment = parseFloat(f.receivedAmount || 0);
      const newDiscount = parseFloat(f.discountAmount || 0);
      const newFine = parseFloat(f.fineAmount || 0);

      const totalPaidSoFar = (currentFee.paid_amount || 0) + newPayment;
      const totalDiscount = (currentFee.discount_amount || 0) + newDiscount;
      const totalFine = (currentFee.fine_amount || 0) + newFine;

      const baseAmount = parseFloat(currentFee.amount || 0) + parseFloat(currentFee.arrears || 0);
      const netPayable = baseAmount + totalFine - totalDiscount;
      const balanceAmount = netPayable - totalPaidSoFar;

      let status = "Unpaid";
      if (balanceAmount <= 0) {
        status = "Paid";
      } else if (totalPaidSoFar > 0) {
        status = "Partially Paid";
      }

      let history: unknown[] = [];
      try {
        history = JSON.parse(currentFee.payment_history || "[]");
      } catch {
        history = [];
      }

      if (newPayment > 0 || newDiscount > 0 || newFine > 0) {
        history.push({
          date: new Date().toISOString(),
          amount: newPayment,
          discount: newDiscount,
          fine: newFine,
          method: f.paymentMethod || "Cash",
          ref: f.transactionRef || "Internal",
        });
      }

      await pool.request()
        .input("id", id)
        .input("status", status)
        .input("transaction_ref", f.transactionRef || currentFee.transaction_ref)
        .input("payment_method", f.paymentMethod || currentFee.payment_method)
        .input("payment_date", new Date())
        .input("paid_amount", totalPaidSoFar)
        .input("discount_amount", totalDiscount)
        .input("fine_amount", totalFine)
        .input("balance_amount", balanceAmount < 0 ? 0 : balanceAmount)
        .input("payment_history", JSON.stringify(history))
        .query(`
          UPDATE Fees SET 
            status = @status,
            transaction_ref = @transaction_ref,
            payment_method = @payment_method,
            payment_date = @payment_date,
            paid_amount = @paid_amount,
            discount_amount = @discount_amount,
            fine_amount = @fine_amount,
            balance_amount = @balance_amount,
            payment_history = @payment_history
          WHERE id = @id
        `);

      if (newPayment > 0) {
        await recomputeStudentOutstanding(studentId);
      }

      res.json({ ...f, id, status, balanceAmount: balanceAmount < 0 ? 0 : balanceAmount });
    } catch (err) {
      console.error("Error updating fee:", err);
      res.status(500).json({ message: "Error updating fee", error: err instanceof Error ? err.message : String(err) });
    }
  };

  app.put("/api/fees/:id", requireRoles(FEE_ROLES), handleFeeUpdate);
  app.put("/api/feevouchers/:id", requireRoles(FEE_ROLES), handleFeeUpdate);

  // QuickPay Callback Route (public webhook — signature + idempotency)
  app.post("/api/payments/quickpay-callback", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const { transaction_id, fee_id, amount, signature } = req.body;

      if (!fee_id || !transaction_id) {
        return res.status(400).json({ message: "Missing fee_id or transaction_id" });
      }

      const dupResult = await pool.request()
        .input("ref", String(transaction_id))
        .query("SELECT TOP 1 id FROM Fees WHERE transaction_ref = @ref");
      if (dupResult.recordset.length > 0) {
        return res.json({ message: "Already processed", duplicate: true });
      }

      const configResult = await pool.request().query(
        "SELECT TOP 1 api_key, isEnabled FROM QuickPayConfig WHERE isEnabled = 1"
      );
      const quickPayConfig = configResult.recordset[0] as { api_key?: string; isEnabled?: boolean } | undefined;
      const apiKey = quickPayConfig?.api_key;

      if (quickPayConfig?.isEnabled) {
        if (!apiKey || !signature) {
          return res.status(401).json({ message: "Signature required for QuickPay callback" });
        }
        const payload = `${transaction_id}:${fee_id}:${amount ?? ""}`;
        const expected = crypto.createHmac("sha256", apiKey).update(payload).digest("hex");
        if (signature !== expected) {
          return res.status(401).json({ message: "Invalid signature" });
        }
      } else if (apiKey && signature) {
        const payload = `${transaction_id}:${fee_id}:${amount ?? ""}`;
        const expected = crypto.createHmac("sha256", apiKey).update(payload).digest("hex");
        if (signature !== expected) {
          return res.status(401).json({ message: "Invalid signature" });
        }
      }

      const feeResult = await pool.request()
        .input("id", fee_id)
        .query("SELECT * FROM Fees WHERE id = @id");
      const fee = feeResult.recordset[0];
      if (!fee) {
        return res.status(404).json({ message: "Fee record not found" });
      }
      const campusCheck = await pool.request()
        .input("studentId", fee.student_id)
        .query(`
          SELECT c.isActive
          FROM Students s
          JOIN Campuses c ON c.id = s.campus_id
          WHERE s.id = @studentId
        `);
      if (!campusCheck.recordset[0]?.isActive) {
        return res.status(403).json({ message: INACTIVE_CAMPUS_ACTION_MESSAGE });
      }

      const paymentAmount =
        parseFloat(amount) ||
        parseFloat(fee.balance_amount) ||
        parseFloat(fee.amount) ||
        0;
      const baseAmount = parseFloat(fee.amount || 0) + parseFloat(fee.arrears || 0);
      const totalPaid = (parseFloat(fee.paid_amount) || 0) + paymentAmount;
      const balanceAmount = Math.max(0, baseAmount - totalPaid);
      const status =
        balanceAmount <= 0 ? "Paid" : totalPaid > 0 ? "Partially Paid" : fee.status;

      await pool.request()
        .input("id", fee_id)
        .input("status", status)
        .input("transaction_ref", transaction_id)
        .input("paid_amount", totalPaid)
        .input("balance_amount", balanceAmount)
        .query(`
          UPDATE Fees SET 
            status = @status,
            transaction_ref = @transaction_ref,
            payment_method = 'QuickPay',
            payment_date = GETDATE(),
            paid_amount = @paid_amount,
            balance_amount = @balance_amount
          WHERE id = @id
        `);

      if (paymentAmount > 0) {
        await recomputeStudentOutstanding(fee.student_id);
      }

      try {
        await pool.request()
          .input("id", crypto.randomUUID())
          .input("student_id", fee.student_id)
          .input("voucher_id", fee_id)
          .input("amount", paymentAmount)
          .input("status", "Success")
          .input("transaction_ref", transaction_id)
          .input("payment_method", "QuickPay")
          .query(`
            INSERT INTO Transactions (id, student_id, voucher_id, amount, status, transaction_ref, payment_method, transaction_date)
            VALUES (@id, @student_id, @voucher_id, @amount, @status, @transaction_ref, @payment_method, GETDATE())
          `);
      } catch (txErr) {
        console.warn("QuickPay transaction log skipped:", txErr);
      }

      res.json({ message: "Payment status updated successfully", status, balanceAmount });
    } catch (err) {
      console.error("QuickPay callback error:", err);
      res.status(500).json({ message: "Error processing callback", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Generate Monthly Fees Route — enqueues async background job
  app.post("/api/generate-monthly-fees", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const scope = resolveCampusScope(authUser);
      if (scope === undefined) {
        return res.status(403).json({ message: "User is not assigned to a campus" });
      }

      const { campusId, month: reqMonth, months: reqMonths, year: reqYear, session: reqSession, includeAdmissions, includeArrears } = req.body;
      const effectiveCampusId = scope || (campusId && campusId !== "all" ? campusId : null);
      if (effectiveCampusId) {
        const campusErr = await assertCampusWrite(authUser, String(effectiveCampusId));
        if (campusErr) return res.status(403).json({ message: campusErr });
      }

      const year = reqYear || new Date().getFullYear();
      const monthsToGenerate: number[] = Array.isArray(reqMonths) && reqMonths.length > 0
        ? reqMonths.map((m: unknown) => Number(m)).filter((m) => m >= 1 && m <= 12)
        : [reqMonth || (new Date().getMonth() + 1)];
      const firstMonth = [...monthsToGenerate].sort((a, b) => a - b)[0];
      const sessionLabel = normalizeSessionLabel(reqSession, year, firstMonth);

      const jobId = crypto.randomUUID();
      await pool.request()
        .input("id", jobId)
        .input("campus_id", effectiveCampusId || null)
        .input("session", sessionLabel)
        .input("year", year)
        .input("months_csv", monthsToGenerate.join(","))
        .input("include_admissions", includeAdmissions !== false ? 1 : 0)
        .input("include_arrears", includeArrears !== false ? 1 : 0)
        .input("run_by", authUser.username)
        .query(`
          INSERT INTO FeeGenerationJobs (
            id, campus_id, session, year, months_csv, include_admissions, include_arrears, status, run_by
          ) VALUES (
            @id, @campus_id, @session, @year, @months_csv, @include_admissions, @include_arrears, 'pending', @run_by
          )
        `);

      res.status(202).json({
        message: `Fee generation queued for session ${sessionLabel}, ${monthsToGenerate.length} month(s). Poll job status for progress.`,
        jobId,
        session: sessionLabel,
        months: monthsToGenerate,
        async: true,
      });
    } catch (err) {
      console.error("Error queuing fee generation:", err);
      res.status(500).json({ message: "Error queuing fee generation", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/fee-generation-jobs/:id", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const result = await pool.request()
        .input("id", req.params.id)
        .query(`
          SELECT
            id, campus_id AS campusId, session AS sessionLabel, year, months_csv AS monthsCsv,
            include_admissions AS includeAdmissions, include_arrears AS includeArrears,
            status, processed_count AS processedCount, total_count AS totalCount,
            skipped_missing_fee_settings AS skippedMissingFeeSettings,
            new_admissions_count AS newAdmissionsCount,
            arrears_count AS arrearsCount,
            error_message AS errorMessage, run_by AS runBy,
            CONVERT(VARCHAR, started_at, 120) AS startedAt,
            CONVERT(VARCHAR, finished_at, 120) AS finishedAt,
            CONVERT(VARCHAR, created_at, 120) AS createdAt
          FROM FeeGenerationJobs WHERE id = @id
        `);
      const job = result.recordset[0];
      if (!job) return res.status(404).json({ message: "Job not found" });

      const scope = resolveCampusScope(authUser);
      if (scope && job.campusId && job.campusId !== scope) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(job);
    } catch (err) {
      sendServerError(res, err, "Error fetching fee generation job");
    }
  });

  app.post("/api/fees/export", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.body?.campusId);
      if (denied) return res.status(403).json({ message: "User is not assigned to a campus" });
      if (campusFilter) {
        const campusErr = await assertCampusWrite(authUser, campusFilter);
        if (campusErr) return res.status(403).json({ message: campusErr });
      }

      const jobId = crypto.randomUUID();
      await pool.request()
        .input("id", jobId)
        .input("campus_id", campusFilter || null)
        .input("year", req.body?.year || null)
        .input("month", req.body?.month || null)
        .input("status_filter", req.body?.status || "all")
        .input("search", req.body?.search || null)
        .input("requested_by", authUser.username)
        .query(`
          INSERT INTO FeeExportJobs (id, campus_id, year, month, status_filter, search, requested_by, status)
          VALUES (@id, @campus_id, @year, @month, @status_filter, @search, @requested_by, 'pending')
        `);

      res.status(202).json({ message: "Export queued", jobId, async: true });
    } catch (err) {
      sendServerError(res, err, "Error queuing fee export");
    }
  });

  app.get("/api/fees/export/:id", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const result = await pool.request()
        .input("id", req.params.id)
        .query(`
          SELECT
            id, campus_id AS campusId, year, month, status_filter AS statusFilter,
            status, processed_count AS processedCount, total_count AS totalCount,
            file_path AS filePath, error_message AS errorMessage,
            CONVERT(VARCHAR, started_at, 120) AS startedAt,
            CONVERT(VARCHAR, finished_at, 120) AS finishedAt
          FROM FeeExportJobs WHERE id = @id
        `);
      const job = result.recordset[0];
      if (!job) return res.status(404).json({ message: "Export job not found" });
      res.json(job);
    } catch (err) {
      sendServerError(res, err, "Error fetching export job");
    }
  });

  app.get("/api/fees/export/:id/download", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const result = await pool.request()
        .input("id", req.params.id)
        .query(`SELECT status, file_path FROM FeeExportJobs WHERE id = @id`);
      const job = result.recordset[0];
      if (!job || job.status !== "completed" || !job.file_path) {
        return res.status(404).json({ message: "Export file not ready" });
      }
      const filePath = path.join(process.cwd(), "wwwroot", job.file_path.replace(/^\//, ""));
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Export file missing" });
      res.download(filePath);
    } catch (err) {
      sendServerError(res, err, "Error downloading export");
    }
  });

  app.post("/api/dashboard-stats/refresh", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const campusId = req.body?.campusId && req.body.campusId !== "all" ? String(req.body.campusId) : null;
      const count = await refreshDashboardCampusStats(pool, campusId);
      res.json({ message: "Dashboard stats refreshed", campusCount: count });
    } catch (err) {
      sendServerError(res, err, "Error refreshing dashboard stats");
    }
  });

  app.post("/api/fees/archive", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const beforeYear = parseInt(String(req.body?.beforeYear || new Date().getFullYear() - 3), 10);
      const archived = await archiveOldFees(pool, beforeYear);
      res.json({ message: `Archived paid fees before ${beforeYear}`, archivedCount: archived });
    } catch (err) {
      sendServerError(res, err, "Error archiving fees");
    }
  });

  app.get("/api/fee-generation-runs", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const request = pool.request().input("limit", limit);
      const whereParts: string[] = [];
      if (campusFilter) {
        whereParts.push("r.campus_id = @campusId");
        request.input("campusId", campusFilter);
      }

      const query = `
        SELECT TOP (@limit)
          r.id,
          CONVERT(VARCHAR, r.run_on, 120) AS runOn,
          r.run_by AS runBy,
          r.campus_id AS campusId,
          cp.campus_name AS campusName,
          r.year,
          r.months_csv AS monthsCsv,
          r.processed_count AS processedCount,
          r.skipped_missing_fee_settings AS skippedMissingFeeSettings,
          r.new_admissions_count AS newAdmissionsCount,
          r.arrears_count AS arrearsCount,
          r.notes
        FROM FeeGenerationRuns r
        LEFT JOIN Campuses cp ON cp.id = r.campus_id
        ${whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""}
        ORDER BY r.run_on DESC
      `;
      const result = await request.query(query);
      const rows = result.recordset.map((row: Record<string, unknown>) => {
        let notes = null;
        if (typeof row.notes === "string" && row.notes.trim()) {
          try {
            notes = JSON.parse(row.notes);
          } catch {
            notes = null;
          }
        }
        return { ...row, notes };
      });
      res.json(rows);
    } catch (err) {
      sendServerError(res, err, "Error fetching fee generation runs");
    }
  });

  app.post("/api/fees/extra-charge", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { studentId, feeType, amount, month, year, description } = req.body;
      const allowed = ["Security Deposit", "Summer Camp", "ID Card", "Educational Trip"];
      if (!studentId || !feeType || !allowed.includes(feeType)) {
        return res.status(400).json({ message: "studentId and valid feeType are required" });
      }
      const chargeAmount = Number(amount);
      if (!chargeAmount || chargeAmount <= 0) {
        return res.status(400).json({ message: "amount must be greater than zero" });
      }

      const studentResult = await pool.request().input("id", studentId).query(`
        SELECT s.id, s.campus_id, cp.campus_name FROM Students s
        LEFT JOIN Campuses cp ON s.campus_id = cp.id WHERE s.id = @id
      `);
      const student = studentResult.recordset[0];
      if (!student) return res.status(404).json({ message: "Student not found" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusErr = await assertCampusWrite(authUser, student.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const m = month || new Date().getMonth() + 1;
      const y = year || new Date().getFullYear();
      const dueDate = new Date(y, m - 1, 10).toISOString().split("T")[0];
      const id = crypto.randomUUID();
      const securityFee = feeType === "Security Deposit" ? chargeAmount : 0;
      const summerCampFee = feeType === "Summer Camp" ? chargeAmount : 0;
      const idCardFee = feeType === "ID Card" ? chargeAmount : 0;
      const tripFee = feeType === "Educational Trip" ? chargeAmount : 0;

      await pool.request()
        .input("id", id)
        .input("student_id", studentId)
        .input("amount", chargeAmount)
        .input("month", m)
        .input("year", y)
        .input("due_date", dueDate)
        .input("fee_type", feeType)
        .input("security_fee", securityFee)
        .input("summer_camp_fee", summerCampFee)
        .input("id_card_fee", idCardFee)
        .input("trip_fee", tripFee)
        .input("balance_amount", chargeAmount)
        .input("campus_name_snapshot", student.campus_name || null)
        .input("months_label", description || `${feeType} — ${m}/${y}`)
        .query(`
          INSERT INTO Fees (
            id, student_id, amount, month, year, status, due_date, fee_type,
            security_fee, summer_camp_fee, id_card_fee, trip_fee,
            balance_amount, paid_amount, campus_name_snapshot, months_label
          ) VALUES (
            @id, @student_id, @amount, @month, @year, 'Unpaid', @due_date, @fee_type,
            @security_fee, @summer_camp_fee, @id_card_fee, @trip_fee,
            @balance_amount, 0, @campus_name_snapshot, @months_label
          )
        `);

      await recomputeStudentOutstanding(studentId);

      res.status(201).json({ id, feeType, amount: chargeAmount, message: `${feeType} charge created` });
    } catch (err) {
      sendServerError(res, err, "Error creating extra charge");
    }
  });

  app.post("/api/fees/advance-year-payment", requireRoles(FEE_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { studentId, year: reqYear, paymentMethod, transactionRef, receivedAmount } = req.body;
      if (!studentId) return res.status(400).json({ message: "studentId is required" });
      const year = reqYear || new Date().getFullYear();
      const payAmount = Number(receivedAmount) || 0;
      if (payAmount <= 0) return res.status(400).json({ message: "receivedAmount must be greater than zero" });

      const studentCampusResult = await pool.request()
        .input("studentId", studentId)
        .query("SELECT campus_id FROM Students WHERE id = @studentId");
      const studentCampus = studentCampusResult.recordset[0];
      if (!studentCampus) return res.status(404).json({ message: "Student not found" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusErr = await assertCampusWrite(authUser, studentCampus.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const vouchersResult = await pool.request()
        .input("studentId", studentId)
        .input("year", year)
        .query(`
          SELECT * FROM Fees
          WHERE student_id = @studentId AND year = @year
            AND status IN ('Unpaid', 'Partially Paid')
            AND fee_type IN ('Monthly', 'Admission')
          ORDER BY month ASC
        `);
      const vouchers = vouchersResult.recordset;
      if (vouchers.length === 0) {
        return res.status(400).json({ message: "No unpaid monthly vouchers found for this year" });
      }

      let remaining = payAmount;
      let paidCount = 0;
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const v of vouchers) {
          if (remaining <= 0) break;
          const balance = Number(v.balance_amount) || (Number(v.amount) + Number(v.arrears || 0) - Number(v.paid_amount || 0));
          if (balance <= 0) continue;
          const payThis = Math.min(remaining, balance);
          const newPaid = Number(v.paid_amount || 0) + payThis;
          const newBalance = balance - payThis;
          const status = newBalance <= 0 ? "Paid" : "Partially Paid";
          let history: unknown[] = [];
          try { history = JSON.parse(v.payment_history || "[]"); } catch { history = []; }
          history.push({
            date: new Date().toISOString(),
            amount: payThis,
            method: paymentMethod || "Cash",
            ref: transactionRef || "Advance-Year",
            note: "Full-year advance payment",
          });
          await new sql.Request(transaction)
            .input("id", v.id)
            .input("paid_amount", newPaid)
            .input("balance_amount", Math.max(0, newBalance))
            .input("status", status)
            .input("payment_method", paymentMethod || "Cash")
            .input("transaction_ref", transactionRef || null)
            .input("payment_date", new Date())
            .input("payment_history", JSON.stringify(history))
            .query(`
              UPDATE Fees SET paid_amount = @paid_amount, balance_amount = @balance_amount, status = @status,
                payment_method = @payment_method, transaction_ref = @transaction_ref,
                payment_date = @payment_date, payment_history = @payment_history
              WHERE id = @id
            `);
          remaining -= payThis;
          paidCount++;
        }
        await transaction.commit();
      } catch (txErr) {
        await transaction.rollback();
        throw txErr;
      }

      await recomputeStudentOutstanding(studentId);

      res.json({
        message: "Advance payment applied",
        vouchersUpdated: paidCount,
        amountApplied: payAmount - remaining,
        remainingUnallocated: remaining,
      });
    } catch (err) {
      sendServerError(res, err, "Error processing advance payment");
    }
  });

  app.get("/api/exam-attendance", requireRoles(new Set(["Super Admin", "Admin", "Teacher"])), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const examId = String(req.query.examId || "").trim();
      if (!examId) return res.status(400).json({ message: "examId is required" });
      const result = await pool.request().input("examId", examId).query(`
        SELECT id, exam_id AS examId, person_type AS personType, person_id AS personId,
               status, recorded_by AS recordedBy, CONVERT(VARCHAR, recorded_on, 120) AS recordedOn
        FROM ExamAttendance WHERE exam_id = @examId
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching exam attendance");
    }
  });

  app.post("/api/exam-attendance", requireRoles(new Set(["Super Admin", "Admin", "Teacher"])), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { examId, records } = req.body as {
        examId: string;
        records: Array<{ personType: string; personId: string; status: string }>;
      };
      if (!examId || !Array.isArray(records)) {
        return res.status(400).json({ message: "examId and records array are required" });
      }

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const examCheck = await pool.request()
        .input("examId", examId)
        .query("SELECT campus_id FROM Exams WHERE id = @examId");
      const examRow = examCheck.recordset[0];
      if (!examRow) return res.status(404).json({ message: "Exam not found" });
      const campusErr = await assertCampusWrite(authUser, examRow.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await new sql.Request(transaction).input("examId", examId).query("DELETE FROM ExamAttendance WHERE exam_id = @examId");
        for (const row of records) {
          await new sql.Request(transaction)
            .input("id", crypto.randomUUID())
            .input("examId", examId)
            .input("personType", row.personType)
            .input("personId", row.personId)
            .input("status", row.status)
            .input("recordedBy", req.auth?.username || null)
            .query(`
              INSERT INTO ExamAttendance (id, exam_id, person_type, person_id, status, recorded_by)
              VALUES (@id, @examId, @personType, @personId, @status, @recordedBy)
            `);
        }
        await transaction.commit();
      } catch (txErr) {
        await transaction.rollback();
        throw txErr;
      }
      res.json({ message: "Exam attendance saved", count: records.length });
    } catch (err) {
      sendServerError(res, err, "Error saving exam attendance");
    }
  });

  app.post("/api/students", requireModulePermission("students", "create"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const s = req.body;
      const campusErr = await assertCampusWrite(authUser, s.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const dupCheck = await pool.request()
        .input("admission_no", s.rollNumber)
        .query("SELECT id FROM Students WHERE admission_no = @admission_no");
      if (dupCheck.recordset.length > 0) {
        return res.status(409).json({ message: "Roll number / admission number already exists" });
      }

      if ((s.status || "Active") === "Active" && s.classId) {
        const cap = await assertClassCapacity(s.classId);
        if (!cap.ok) return res.status(400).json({ message: cap.message });
      }

      const id = crypto.randomUUID();
      
      await pool.request()
        .input("id", id)
        .input("campus_id", s.campusId)
        .input("class_id", s.classId)
        .input("admission_no", s.rollNumber)
        .input("registration_no", s.studentCode)
        .input("gr_no", s.serialNo)
        .input("student_name", s.firstName)
        .input("father_name", s.fatherName)
        .input("father_cnic", s.cnicBForm)
        .input("father_mobile", s.contactNumber)
        .input("dob", s.dateOfBirth)
        .input("admission_date", s.admissionDate)
        .input("gender", s.gender)
        .input("address", s.address)
        .input("city", s.city)
        .input("batch_no", s.session)
        .input("status", s.status || 'Active')
        .input("outstanding_fees", s.outstandingFees || 0)
        .input("profile_image", s.profileImage || null)
        .query(`
          INSERT INTO Students (
            id, campus_id, class_id, admission_no, registration_no, gr_no, 
            student_name, father_name, father_cnic, father_mobile, dob, 
            admission_date, gender, address, city, batch_no, status, outstanding_fees, profile_image
          ) VALUES (
            @id, @campus_id, @class_id, @admission_no, @registration_no, @gr_no, 
            @student_name, @father_name, @father_cnic, @father_mobile, @dob, 
            @admission_date, @gender, @address, @city, @batch_no, @status, @outstanding_fees, @profile_image
          )
        `);
      
      res.status(201).json({ ...s, id });
    } catch (err) {
      sendServerError(res, err, "Error adding student");
    }
  });

  app.put("/api/students/:id", requireModulePermission("students", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const s = req.body;
      const campusErr = await assertCampusWrite(authUser, s.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });

      if (s.status === "Active" && s.classId) {
        const cap = await assertClassCapacity(s.classId, id);
        if (!cap.ok) return res.status(400).json({ message: cap.message });
      }
      
      await pool.request()
        .input("id", id)
        .input("campus_id", s.campusId)
        .input("class_id", s.classId)
        .input("admission_no", s.rollNumber)
        .input("registration_no", s.studentCode)
        .input("gr_no", s.serialNo)
        .input("student_name", s.firstName)
        .input("father_name", s.fatherName)
        .input("father_cnic", s.cnicBForm)
        .input("father_mobile", s.contactNumber)
        .input("dob", s.dateOfBirth)
        .input("admission_date", s.admissionDate)
        .input("gender", s.gender)
        .input("address", s.address)
        .input("city", s.city)
        .input("batch_no", s.session)
        .input("status", s.status)
        .input("outstanding_fees", s.outstandingFees)
        .input("profile_image", s.profileImage || null)
        .query(`
          UPDATE Students SET 
            campus_id = @campus_id,
            class_id = @class_id,
            admission_no = @admission_no,
            registration_no = @registration_no,
            gr_no = @gr_no,
            student_name = @student_name,
            father_name = @father_name,
            father_cnic = @father_cnic,
            father_mobile = @father_mobile,
            dob = @dob,
            admission_date = @admission_date,
            gender = @gender,
            address = @address,
            city = @city,
            batch_no = @batch_no,
            status = @status,
            outstanding_fees = @outstanding_fees,
            profile_image = @profile_image
          WHERE id = @id
        `);
      
      res.json({ ...s, id });
    } catch (err) {
      console.error("Error updating student:", err);
      res.status(500).json({ message: "Error updating student", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    "/api/students/:id/photo",
    requireRoles(ADMIN_ROLES),
    (req, res, next) => {
      uploadStudentPhoto.single("photo")(req, res, (err) => {
        if (err) return res.status(400).json({ message: err instanceof Error ? err.message : "Upload failed" });
        next();
      });
    },
    async (req, res) => {
      try {
        if (!pool || !pool.connected) await connectToDb();
        if (!pool) return res.status(503).json({ message: "Database connection not available" });
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ message: "No photo file uploaded" });

        const existing = await pool.request().input("id", id).query("SELECT campus_id FROM Students WHERE id = @id");
        const student = existing.recordset[0];
        if (!student) return res.status(404).json({ message: "Student not found" });
        const campusErr = await assertCampusWrite(authUser, student.campus_id);
        if (campusErr) return res.status(403).json({ message: campusErr });

        const photoUrl = `/uploads/students/${req.file.filename}`;
        await pool.request()
          .input("id", id)
          .input("profile_image", photoUrl)
          .query("UPDATE Students SET profile_image = @profile_image WHERE id = @id");

        res.json({ profileImage: photoUrl });
      } catch (err) {
        sendServerError(res, err, "Error uploading student photo");
      }
    }
  );

  // Legacy ERP student import (Enrolled Report Excel — campuses, classes, sections, arrears)
  app.post("/api/import-students", requireRoles(ADMIN_ROLES), upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded. Please select a valid .xlsx file." });
    }
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      return res.status(400).json({ message: "Only .xlsx Excel workbooks are supported." });
    }

    if (!pool || !pool.connected) {
      try {
        await connectToDb();
        if (!pool || !pool.connected) throw new Error("Database connection not available");
      } catch (dbErr) {
        return res.status(500).json({ message: dbErr instanceof Error ? dbErr.message : "Database connection failed" });
      }
    }

    try {
      const sheets = await readXlsxFile(req.file.buffer);
      const sheet = sheets.find((item) => /enrolled/i.test(item.sheet)) || sheets[0];
      if (!sheet) {
        return res.status(400).json({ message: "The Excel file has no worksheets." });
      }
      const rows = excelRowsToJson(sheet.data);

      if (rows.length === 0) {
        return res.status(400).json({ message: "The Excel file has no data rows." });
      }

      const campusCache = new Map<string, string>();
      const classCache = new Map<string, string>();
      const admissionCache = new Map<string, string>();

      const existingCampuses = await pool.request().query(
        "SELECT id, campus_name, city, campus_code FROM Campuses"
      );
      for (const c of existingCampuses.recordset) {
        const codeKey = c.campus_code ? `code:${c.campus_code}` : "";
        const nameKey = `name:${c.campus_name}|${c.city || ""}`;
        if (codeKey) campusCache.set(codeKey, c.id);
        campusCache.set(nameKey, c.id);
      }

      const existingClasses = await pool.request().query(
        "SELECT id, campus_id, class_name, section_name FROM Classes"
      );
      for (const cl of existingClasses.recordset) {
        classCache.set(
          `${cl.campus_id}|${cl.class_name}|${cl.section_name || ""}`,
          cl.id
        );
      }

      const existingStudents = await pool.request().query(
        "SELECT id, admission_no FROM Students"
      );
      for (const s of existingStudents.recordset) {
        admissionCache.set(String(s.admission_no), s.id);
      }

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let newCampusesCount = 0;
      let newClassesCount = 0;
      let arrearsVouchersCount = 0;
      const errorDetails: string[] = [];
      const BATCH_SIZE = 250;
      const arrearsCache = new Set<string>();
      const existingArrears = await pool.request().query(
        "SELECT student_id FROM Fees WHERE fee_type = 'Arrears' AND month = 0 AND year = 0"
      );
      for (const r of existingArrears.recordset) {
        arrearsCache.add(String(r.student_id));
      }

      const resolveCampusId = async (tx: sql.Transaction, row: Record<string, unknown>): Promise<string> => {
        const campusName = String(getVal(row, "Campus Name", "campus_name", "CampusName") || "Unknown").trim();
        const region = String(getVal(row, "Campus Region", "region", "CampusRegion") || "").trim();
        const cityName = String(getVal(row, "Campus City", "city", "CampusCity", "Campus_City") || "").trim();
        const address = String(getVal(row, "Campus Address", "address", "Campus Address") || "").trim();
        const legacyCode = legacyCampusCode(getVal(row, "campus_id", "Campus Id", "CampusId"));
        const cacheKey = legacyCode ? `code:${legacyCode}` : `name:${campusName}|${cityName}`;

        if (campusCache.has(cacheKey)) return campusCache.get(cacheKey)!;

        let found: { id: string } | undefined;
        if (legacyCode) {
          const byCode = await new sql.Request(tx)
            .input("code", legacyCode)
            .query("SELECT id FROM Campuses WHERE campus_code = @code");
          found = byCode.recordset[0];
        }
        if (!found) {
          const byName = await new sql.Request(tx)
            .input("name", campusName)
            .input("city", cityName || null)
            .query("SELECT id FROM Campuses WHERE campus_name = @name AND (city = @city OR @city IS NULL OR city IS NULL)");
          found = byName.recordset[0];
        }

        if (found) {
          campusCache.set(cacheKey, found.id);
          return found.id;
        }

        const campusId = crypto.randomUUID();
        await new sql.Request(tx)
          .input("id", campusId)
          .input("campus_code", legacyCode || campusName.slice(0, 20).replace(/\s+/g, "-").toUpperCase())
          .input("campus_name", campusName)
          .input("city", cityName || null)
          .input("region", region || null)
          .input("address", address || null)
          .query(`
            INSERT INTO Campuses (id, campus_code, campus_name, city, region, address, isActive)
            VALUES (@id, @campus_code, @campus_name, @city, @region, @address, 1)
          `);
        campusCache.set(cacheKey, campusId);
        if (legacyCode) campusCache.set(`code:${legacyCode}`, campusId);
        campusCache.set(`name:${campusName}|${cityName}`, campusId);
        newCampusesCount++;
        return campusId;
      };

      const resolveClassId = async (
        tx: sql.Transaction,
        campusId: string,
        className: string,
        sectionName: string
      ): Promise<string> => {
        const cacheKey = `${campusId}|${className}|${sectionName}`;
        if (classCache.has(cacheKey)) return classCache.get(cacheKey)!;

        const existing = await new sql.Request(tx)
          .input("campusId", campusId)
          .input("className", className)
          .input("sectionName", sectionName)
          .query(`
            SELECT id FROM Classes
            WHERE campus_id = @campusId AND class_name = @className
              AND ISNULL(section_name, '') = @sectionName
          `);
        if (existing.recordset[0]) {
          classCache.set(cacheKey, existing.recordset[0].id);
          return existing.recordset[0].id;
        }

        const classId = crypto.randomUUID();
        await new sql.Request(tx)
          .input("id", classId)
          .input("campus_id", campusId)
          .input("class_name", className)
          .input("section_name", sectionName)
          .input("capacity", 60)
          .query(`
            INSERT INTO Classes (id, campus_id, class_name, section_name, capacity, shift)
            VALUES (@id, @campus_id, @class_name, @section_name, @capacity, 'Morning')
          `);
        classCache.set(cacheKey, classId);
        newClassesCount++;
        return classId;
      };

      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          for (const row of batch) {
            try {
              const studentName = String(getVal(row, "Student Name", "student_name", "StudentName")).trim();
              if (!studentName) {
                skippedCount++;
                continue;
              }

              const campusName = String(getVal(row, "Campus Name", "campus_name", "CampusName") || "Unknown").trim();
              const className = String(getVal(row, "Class", "class_name", "ClassName") || "Unknown").trim();
              const sectionName = String(getVal(row, "Section", "section_name", "SectionName") || "").trim();
              const cityName = String(getVal(row, "Campus City", "city", "CampusCity") || "").trim();

              const campusId = await resolveCampusId(transaction, row);
              const classId = await resolveClassId(transaction, campusId, className, sectionName);

              const admissionNo = String(
                getVal(row, "Admission_No", "admission_no", "Admission No", "AdmissionNo") || ""
              ).trim();
              if (!admissionNo) {
                skippedCount++;
                continue;
              }

              const dob = parseExcelDate(getVal(row, "Date_of_Birth", "dob", "DOB", "Date of Birth"));
              const admissionDate = parseExcelDate(
                getVal(row, "Date_of_Admission", "admission_date", "AdmissionDate", "Date of Admission", "Joining_date", "Joining Date")
              );
              const outstandingFees = parseFloat(
                String(
                  getVal(row, "Outstanding Fees", "outstanding_fees", "OutstandingFees", "Arrears", "arrears", "Balance") || "0"
                )
              ) || 0;
              const status = normalizeImportStudentStatus(getVal(row, "Campus_status", "status", "Campus Status"));

              const studentFields = {
                registration_no: String(getVal(row, "Registration No", "registration_no", "RegistrationNo") || ""),
                gr_no: String(getVal(row, "GR No", "gr_no", "GRNo") || ""),
                father_name: String(getVal(row, "Father_Name", "father_name", "FatherName", "Father Name") || ""),
                father_cnic: String(getVal(row, "Father_CNIC", "father_cnic", "FatherCNIC", "Father CNIC") || ""),
                father_mobile: String(getVal(row, "Father Mobile No", "father_mobile", "Father Mobile") || ""),
                gender: String(getVal(row, "Gender", "gender") || "Male"),
                address: String(getVal(row, "Home Address", "address", "HomeAddress") || ""),
                batch_no: String(getVal(row, "Batch_No", "batch_no", "Batch No", "BatchNo") || new Date().getFullYear()),
              };

              let studentId = admissionCache.get(admissionNo);
              if (studentId) {
                await new sql.Request(transaction)
                  .input("id", studentId)
                  .input("campus_id", campusId)
                  .input("class_id", classId)
                  .input("student_name", studentName)
                  .input("father_name", studentFields.father_name)
                  .input("father_cnic", studentFields.father_cnic)
                  .input("father_mobile", studentFields.father_mobile)
                  .input("dob", dob)
                  .input("admission_date", admissionDate)
                  .input("gender", studentFields.gender)
                  .input("address", studentFields.address)
                  .input("city", cityName)
                  .input("batch_no", studentFields.batch_no)
                  .input("status", status)
                  .input("outstanding_fees", outstandingFees)
                  .input("registration_no", studentFields.registration_no)
                  .input("gr_no", studentFields.gr_no)
                  .query(`
                    UPDATE Students SET campus_id=@campus_id, class_id=@class_id, student_name=@student_name,
                      father_name=@father_name, father_cnic=@father_cnic, father_mobile=@father_mobile,
                      dob=@dob, admission_date=@admission_date, gender=@gender, address=@address, city=@city,
                      batch_no=@batch_no, status=@status, outstanding_fees=@outstanding_fees,
                      registration_no=@registration_no, gr_no=@gr_no
                    WHERE id=@id
                  `);
                updatedCount++;
              } else {
                studentId = crypto.randomUUID();
                await new sql.Request(transaction)
                  .input("id", studentId)
                  .input("admission_no", admissionNo)
                  .input("registration_no", studentFields.registration_no)
                  .input("gr_no", studentFields.gr_no)
                  .input("student_name", studentName)
                  .input("father_name", studentFields.father_name)
                  .input("father_cnic", studentFields.father_cnic)
                  .input("father_mobile", studentFields.father_mobile)
                  .input("dob", dob)
                  .input("admission_date", admissionDate)
                  .input("gender", studentFields.gender)
                  .input("address", studentFields.address)
                  .input("city", cityName)
                  .input("campus_id", campusId)
                  .input("class_id", classId)
                  .input("batch_no", studentFields.batch_no)
                  .input("status", status)
                  .input("outstanding_fees", outstandingFees)
                  .query(`
                    INSERT INTO Students (
                      id, admission_no, registration_no, gr_no, student_name, father_name,
                      father_cnic, father_mobile, dob, admission_date, gender, address, city,
                      campus_id, class_id, batch_no, status, outstanding_fees
                    ) VALUES (
                      @id, @admission_no, @registration_no, @gr_no, @student_name, @father_name,
                      @father_cnic, @father_mobile, @dob, @admission_date, @gender, @address, @city,
                      @campus_id, @class_id, @batch_no, @status, @outstanding_fees
                    )
                  `);
                admissionCache.set(admissionNo, studentId);
                importedCount++;
              }

              if (outstandingFees > 0 && !arrearsCache.has(studentId)) {
                  await new sql.Request(transaction)
                    .input("id", crypto.randomUUID())
                    .input("student_id", studentId)
                    .input("amount", outstandingFees)
                    .input("arrears", outstandingFees)
                    .input("balance_amount", outstandingFees)
                    .input("campus_name_snapshot", campusName)
                    .input("months_label", "Legacy arrears import")
                    .query(`
                      INSERT INTO Fees (
                        id, student_id, amount, month, year, status, fee_type, arrears,
                        balance_amount, paid_amount, due_date, campus_name_snapshot, months_label
                      ) VALUES (
                        @id, @student_id, @amount, 0, 0, 'Unpaid', 'Arrears', @arrears,
                        @balance_amount, 0, GETDATE(), @campus_name_snapshot, @months_label
                      )
                    `);
                  arrearsCache.add(studentId);
                  arrearsVouchersCount++;
              }
            } catch (rowErr) {
              errorCount++;
              const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
              if (errorDetails.length < 8) errorDetails.push(msg);
            }
          }
          await transaction.commit();
          console.log(`Import batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} committed`);
        } catch (batchErr) {
          await transaction.rollback();
          errorCount += batch.length;
          const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
          if (errorDetails.length < 8) errorDetails.push(`Batch failed: ${msg}`);
        }
      }

      console.log(`Import finished: ${importedCount} new, ${updatedCount} updated, ${errorCount} failed`);

      res.json({
        message: "Import finished",
        totalRows: rows.length,
        imported: importedCount,
        updated: updatedCount,
        skipped: skippedCount,
        failed: errorCount,
        newCampuses: newCampusesCount,
        newClasses: newClassesCount,
        arrearsVouchers: arrearsVouchersCount,
        errorDetails,
      });
    } catch (err) {
      console.error("Excel import failed:", err);
      sendServerError(res, err, "Excel import failed");
    }
  });

  // User management (permission-gated; never expose password hashes)
  app.get("/api/users", requireModulePermission("users", "view"), async (_req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const result = await pool.request().query(`
        SELECT u.*,
          CASE WHEN s.id IS NOT NULL THEN s.admission_no ELSE NULL END AS linkedStudentRoll
        FROM Users u
        LEFT JOIN Students s ON s.admission_no = u.username AND s.status = 'Active'
      `);
      const users = result.recordset
        .map((row) => {
          const mapped = mapUserFromRow(row as Record<string, unknown>);
          const linkedStudentRoll = row.linkedStudentRoll as string | null;
          return linkedStudentRoll ? { ...mapped, linkedStudentRoll } : mapped;
        })
        .sort((a, b) => String(b.createdOn || "").localeCompare(String(a.createdOn || "")));
      res.json(users);
    } catch (err) {
      sendServerError(res, err, "Error fetching users");
    }
  });

  app.put("/api/users/:id", requireModulePermission("users", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { id } = req.params;
      const { fullName, email, role, campusId, isActive, password, username } = req.body;

      if (req.auth?.id === id && isActive === false) {
        return res.status(400).json({ message: "Cannot deactivate your own account" });
      }

      const existingUser = await pool.request()
        .input("id", id)
        .query("SELECT fullName, username, role FROM Users WHERE id = @id");
      const existing = existingUser.recordset[0];
      if (!existing) return res.status(404).json({ message: "User not found" });

      const request = pool.request().input("id", id);
      const updates: string[] = [];
      if (fullName !== undefined) {
        request.input("fullName", fullName);
        updates.push("fullName = @fullName");
      }
      if (email !== undefined) {
        request.input("email", email || null);
        updates.push("email = @email");
      }
      if (role !== undefined) {
        if (role === "Super Admin" && req.auth?.role !== "Super Admin") {
          return res.status(403).json({ message: "Forbidden" });
        }
        request.input("role", role);
        updates.push("role = @role");
        if (role !== "Student" && username === undefined && isStudentRollUsername(String(existing.username))) {
          const newUsername = await pickUniqueLoginUsername(
            pool,
            suggestLoginUsername(fullName ?? existing.fullName),
            id,
          );
          request.input("username", newUsername);
          updates.push("username = @username");
        }
      }
      if (username !== undefined) {
        const nextUsername = String(username).trim();
        if (!nextUsername) return res.status(400).json({ message: "Username cannot be empty" });
        const targetRole = role ?? (await pool.request().input("id", id).query("SELECT role FROM Users WHERE id = @id")).recordset[0]?.role;
        if (targetRole && targetRole !== "Student" && isStudentRollUsername(nextUsername)) {
          return res.status(400).json({
            message: "Staff login username cannot use student roll format (STU-YYYY-####). Use a name-based username.",
          });
        }
        const dup = await pool.request()
          .input("username", nextUsername)
          .input("id", id)
          .query("SELECT id FROM Users WHERE username = @username AND id <> @id");
        if (dup.recordset[0]) return res.status(409).json({ message: "Username already in use" });
        request.input("username", nextUsername);
        updates.push("username = @username");
      }
      if (campusId !== undefined) {
        request.input("campusId", campusId || null);
        updates.push("campusId = @campusId");
      }
      if (isActive !== undefined) {
        request.input("isActive", isActive ? 1 : 0);
        updates.push("isActive = @isActive");
      }
      if (password) {
        const hashed = await bcrypt.hash(String(password), 10);
        request.input("passwordHash", hashed);
        updates.push("passwordHash = @passwordHash");
      }
      if (updates.length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      await request.query(`UPDATE Users SET ${updates.join(", ")} WHERE id = @id`);
      const updated = await pool.request()
        .input("id", id)
        .query(`SELECT * FROM Users WHERE id = @id`);
      res.json(mapUserFromRow(updated.recordset[0] as Record<string, unknown>));
    } catch (err) {
      sendServerError(res, err, "Error updating user");
    }
  });

  // Staff (campus-scoped reads; admin writes)
  app.get("/api/staff", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE st.campusId = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const result = await request.query(`
        SELECT st.id, st.fullName, st.cnic, st.qualification, st.salary,
               CONVERT(VARCHAR, st.joiningDate, 23) AS joiningDate,
               st.campusId, c.campus_name AS campusName, st.role, st.email,
               st.isActive, st.profileImage
        FROM Staff st
        LEFT JOIN Campuses c ON st.campusId = c.id
        ${campusWhere}
        ORDER BY st.fullName ASC
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching staff");
    }
  });

  app.post("/api/staff", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const s = req.body;
      const campusErr = await assertCampusWrite(authUser, s.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("fullName", s.fullName)
        .input("cnic", s.cnic)
        .input("qualification", s.qualification || null)
        .input("salary", s.salary || 0)
        .input("joiningDate", s.joiningDate || null)
        .input("campusId", s.campusId)
        .input("role", s.role)
        .input("email", s.email || null)
        .input("isActive", s.isActive === false ? 0 : 1)
        .input("profileImage", s.profileImage || null)
        .query(`
          INSERT INTO Staff (id, fullName, cnic, qualification, salary, joiningDate, campusId, role, email, isActive, profileImage)
          VALUES (@id, @fullName, @cnic, @qualification, @salary, @joiningDate, @campusId, @role, @email, @isActive, @profileImage)
        `);
      res.status(201).json({ ...s, id, isActive: s.isActive !== false });
    } catch (err) {
      sendServerError(res, err, "Error adding staff member");
    }
  });

  app.put("/api/staff/:id", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const s = req.body;
      const campusErr = await assertCampusWrite(authUser, s.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      await pool.request()
        .input("id", id)
        .input("fullName", s.fullName)
        .input("cnic", s.cnic)
        .input("qualification", s.qualification || null)
        .input("salary", s.salary || 0)
        .input("joiningDate", s.joiningDate || null)
        .input("campusId", s.campusId)
        .input("role", s.role)
        .input("email", s.email || null)
        .input("isActive", s.isActive === false ? 0 : 1)
        .input("profileImage", s.profileImage || null)
        .query(`
          UPDATE Staff SET
            fullName = @fullName, cnic = @cnic, qualification = @qualification,
            salary = @salary, joiningDate = @joiningDate, campusId = @campusId,
            role = @role, email = @email, isActive = @isActive, profileImage = @profileImage
          WHERE id = @id
        `);
      res.json({ ...s, id });
    } catch (err) {
      sendServerError(res, err, "Error updating staff member");
    }
  });

  // Exams & results
  app.get("/api/exams", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE e.campus_id = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const result = await request.query(`
        SELECT e.id, e.title, e.exam_type AS examType, e.class_id AS classId,
               cl.class_name AS className, e.campus_id AS campusId,
               c.campus_name AS campusName, CONVERT(VARCHAR, e.exam_date, 23) AS examDate,
               e.total_marks AS totalMarks, CONVERT(VARCHAR, e.created_on, 23) AS createdOn
        FROM Exams e
        LEFT JOIN Classes cl ON e.class_id = cl.id
        LEFT JOIN Campuses c ON e.campus_id = c.id
        ${campusWhere}
        ORDER BY e.exam_date DESC, e.created_on DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching exams");
    }
  });

  app.post("/api/exams", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const e = req.body;
      const campusErr = await assertCampusWrite(authUser, e.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("title", e.title)
        .input("exam_type", e.examType || "Monthly")
        .input("class_id", e.classId)
        .input("campus_id", e.campusId)
        .input("exam_date", e.examDate || null)
        .input("total_marks", e.totalMarks || 100)
        .query(`
          INSERT INTO Exams (id, title, exam_type, class_id, campus_id, exam_date, total_marks)
          VALUES (@id, @title, @exam_type, @class_id, @campus_id, @exam_date, @total_marks)
        `);
      res.status(201).json({ ...e, id });
    } catch (err) {
      sendServerError(res, err, "Error creating exam");
    }
  });

  app.put("/api/exams/:id", requireRoles(ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const e = req.body;
      const campusErr = await assertCampusWrite(authUser, e.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      await pool.request()
        .input("id", id)
        .input("title", e.title)
        .input("exam_type", e.examType || "Monthly")
        .input("class_id", e.classId)
        .input("campus_id", e.campusId)
        .input("exam_date", e.examDate || null)
        .input("total_marks", e.totalMarks || 100)
        .query(`
          UPDATE Exams SET title = @title, exam_type = @exam_type, class_id = @class_id,
            campus_id = @campus_id, exam_date = @exam_date, total_marks = @total_marks
          WHERE id = @id
        `);
      res.json({ ...e, id });
    } catch (err) {
      sendServerError(res, err, "Error updating exam");
    }
  });

  app.delete("/api/exams/:id", requireRoles(SUPER_ADMIN_ROLES), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const { id } = req.params;
      await pool.request().input("id", id).query("DELETE FROM ExamResults WHERE exam_id = @id");
      await pool.request().input("id", id).query("DELETE FROM Exams WHERE id = @id");
      res.status(204).send();
    } catch (err) {
      sendServerError(res, err, "Error deleting exam");
    }
  });

  app.get("/api/exam-results", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const examId = req.query.examId;
      if (!examId) return res.status(400).json({ message: "examId is required" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });

      const examCheck = await pool.request()
        .input("examId", examId)
        .query("SELECT campus_id FROM Exams WHERE id = @examId");
      const examRow = examCheck.recordset[0];
      if (!examRow) return res.status(404).json({ message: "Exam not found" });
      const campusErr = await assertCampusWrite(authUser, examRow.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const result = await pool.request()
        .input("examId", examId)
        .query(`
          SELECT r.id, r.exam_id AS examId, r.student_id AS studentId,
                 s.student_name AS studentName, s.admission_no AS rollNumber,
                 r.obtained_marks AS obtainedMarks, r.grade, r.remarks,
                 CONVERT(VARCHAR, r.recorded_on, 23) AS recordedOn
          FROM ExamResults r
          JOIN Students s ON r.student_id = s.id
          WHERE r.exam_id = @examId
          ORDER BY s.student_name ASC
        `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching exam results");
    }
  });

  app.post("/api/exam-results", requireRoles(new Set(["Super Admin", "Admin", "Teacher"])), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { examId, results } = req.body as { examId: string; results: Array<{ studentId: string; obtainedMarks: number; grade?: string; remarks?: string }> };
      if (!examId || !Array.isArray(results)) {
        return res.status(400).json({ message: "examId and results array are required" });
      }

      const examCheck = await pool.request()
        .input("examId", examId)
        .query("SELECT campus_id, total_marks FROM Exams WHERE id = @examId");
      const examRow = examCheck.recordset[0];
      if (!examRow) return res.status(404).json({ message: "Exam not found" });
      const campusErr = await assertCampusWrite(authUser, examRow.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const totalMarks = Number(examRow.total_marks) || 0;
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const row of results) {
          const grade =
            (row.grade && String(row.grade).trim()) ||
            gradeFromMarks(Number(row.obtainedMarks), totalMarks) ||
            null;
          const existing = await new sql.Request(transaction)
            .input("examId", examId)
            .input("studentId", row.studentId)
            .query("SELECT id FROM ExamResults WHERE exam_id = @examId AND student_id = @studentId");
          if (existing.recordset.length > 0) {
            await new sql.Request(transaction)
              .input("id", existing.recordset[0].id)
              .input("obtainedMarks", row.obtainedMarks)
              .input("grade", grade)
              .input("remarks", row.remarks || null)
              .query(`
                UPDATE ExamResults SET obtained_marks = @obtainedMarks, grade = @grade, remarks = @remarks, recorded_on = GETDATE()
                WHERE id = @id
              `);
          } else {
            await new sql.Request(transaction)
              .input("id", crypto.randomUUID())
              .input("examId", examId)
              .input("studentId", row.studentId)
              .input("obtainedMarks", row.obtainedMarks)
              .input("grade", grade)
              .input("remarks", row.remarks || null)
              .query(`
                INSERT INTO ExamResults (id, exam_id, student_id, obtained_marks, grade, remarks)
                VALUES (@id, @examId, @studentId, @obtainedMarks, @grade, @remarks)
              `);
          }
        }
        await transaction.commit();
      } catch (txErr) {
        await transaction.rollback();
        throw txErr;
      }
      res.json({ message: "Results saved", count: results.length });
    } catch (err) {
      sendServerError(res, err, "Error saving exam results");
    }
  });

  // Student portal — linked by username = admission_no
  app.get("/api/student-portal/me", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      if (!req.auth) return res.status(401).json({ message: "Unauthorized" });
      if (req.auth.role !== "Student") {
        return res.status(403).json({ message: "Student portal is for Student accounts only" });
      }

      const studentResult = await pool.request()
        .input("username", req.auth.username)
        .query(`
          SELECT s.id, s.campus_id AS campusId, s.class_id AS classId,
                 s.admission_no AS rollNumber, s.registration_no AS studentCode,
                 s.gr_no AS serialNo, s.student_name AS firstName,
                 s.father_name AS fatherName, s.father_mobile AS contactNumber,
                 s.dob AS dateOfBirth, s.admission_date AS admissionDate,
                 s.gender, s.address, s.city, s.batch_no AS session, s.status,
                 s.outstanding_fees AS outstandingFees,
                 c.campus_name AS campusName, cl.class_name AS className
          FROM Students s
          LEFT JOIN Campuses c ON s.campus_id = c.id
          LEFT JOIN Classes cl ON s.class_id = cl.id
          WHERE s.admission_no = @username AND s.status = 'Active'
        `);
      const student = studentResult.recordset[0];
      if (!student) return res.status(404).json({ message: "No student record linked to this account" });

      const feesResult = await pool.request()
        .input("studentId", student.id)
        .query(`
          SELECT f.id, f.student_id AS studentId, f.amount, f.month, f.year, f.status,
                 f.paid_amount AS paidAmount, f.balance_amount AS balanceAmount,
                 f.arrears, f.due_date AS dueDate
          FROM Fees f WHERE f.student_id = @studentId ORDER BY f.year DESC, f.month DESC
        `);

      const attendanceResult = await pool.request()
        .input("studentId", student.id)
        .query(`
          SELECT status, COUNT(*) AS cnt FROM Attendance
          WHERE student_id = @studentId GROUP BY status
        `);
      const summary = { present: 0, absent: 0, late: 0, total: 0 };
      attendanceResult.recordset.forEach((r: { status: string; cnt: number }) => {
        const key = r.status?.toLowerCase();
        if (key === "present") summary.present = r.cnt;
        else if (key === "absent") summary.absent = r.cnt;
        else if (key === "late") summary.late = r.cnt;
        summary.total += r.cnt;
      });

      res.json({
        student,
        fees: feesResult.recordset,
        attendanceSummary: summary,
      });
    } catch (err) {
      sendServerError(res, err, "Error loading student portal");
    }
  });

  // Admissions workflow
  app.get("/api/admissions", requireModulePermission("admissions", "view"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json([]);

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE a.campus_id = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const result = await request.query(`
        SELECT a.id, a.campus_id AS campusId, c.campus_name AS campusName,
               a.class_id AS classId, cl.class_name AS className,
               a.tracking_no AS trackingNo,
               a.applicant_name AS applicantName, a.father_name AS fatherName,
               a.father_cnic AS fatherCnic, a.student_bform AS studentBform,
               CONVERT(VARCHAR, a.date_of_birth, 23) AS dateOfBirth,
               a.gender, a.contact_number AS contactNumber, a.address,
               a.previous_school AS previousSchool,
               CONVERT(VARCHAR, a.applied_on, 120) AS appliedOn,
               a.status, a.test_marks AS testMarks, a.remarks,
               a.reviewed_by AS reviewedBy, CONVERT(VARCHAR, a.reviewed_on, 120) AS reviewedOn,
               a.student_id AS studentId,
               a.linked_student_id AS linkedStudentId,
               a.review_match_type AS reviewMatchType,
               a.review_snapshot AS reviewSnapshot,
               ISNULL(a.waive_admission_fee, 0) AS waiveAdmissionFee,
               ISNULL(a.fee_discount_amount, 0) AS feeDiscountAmount,
               ISNULL(a.fee_discount_percent, 0) AS feeDiscountPercent,
               ISNULL(a.sibling_discount_percent, 0) AS siblingDiscountPercent,
               a.rejection_reason AS rejectionReason,
               CONVERT(VARCHAR, a.interview_at, 120) AS interviewAt,
               ISNULL(a.interview_sms_sent, 0) AS interviewSmsSent,
               CONVERT(VARCHAR, a.interview_sms_sent_on, 120) AS interviewSmsSentOn,
               c.address AS campusAddress,
               c.phone AS campusPhone
        FROM AdmissionApplications a
        LEFT JOIN Campuses c ON a.campus_id = c.id
        LEFT JOIN Classes cl ON a.class_id = cl.id
        ${campusWhere}
        ORDER BY a.applied_on DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching admissions");
    }
  });

  app.post("/api/admissions", requireModulePermission("admissions", "create"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const a = req.body;
      const campusErr = await assertCampusWrite(authUser, a.campusId);
      if (campusErr) return res.status(403).json({ message: campusErr });
      const fatherCnic = normalizeCnic(a.fatherCnic);
      if (fatherCnic.length !== 13) return res.status(400).json({ message: "Father CNIC (13 digits) is required" });
      const id = crypto.randomUUID();
      const trackingNo = await generateAdmissionTrackingNo(pool);
      await pool.request()
        .input("id", id)
        .input("tracking_no", trackingNo)
        .input("campus_id", a.campusId)
        .input("class_id", a.classId || null)
        .input("applicant_name", a.applicantName)
        .input("father_name", a.fatherName || null)
        .input("father_cnic", fatherCnic)
        .input("student_bform", a.studentBform || null)
        .input("date_of_birth", a.dateOfBirth || null)
        .input("gender", a.gender || null)
        .input("contact_number", a.contactNumber || null)
        .input("address", a.address || null)
        .input("previous_school", a.previousSchool || null)
        .input("test_marks", a.testMarks ?? null)
        .input("remarks", a.remarks || null)
        .query(`
          INSERT INTO AdmissionApplications (
            id, tracking_no, campus_id, class_id, applicant_name, father_name, father_cnic, student_bform,
            date_of_birth, gender, contact_number, address, previous_school, test_marks, remarks, status
          ) VALUES (
            @id, @tracking_no, @campus_id, @class_id, @applicant_name, @father_name, @father_cnic, @student_bform,
            @date_of_birth, @gender, @contact_number, @address, @previous_school, @test_marks, @remarks, 'Pending'
          )
        `);
      res.status(201).json({ ...a, id, trackingNo, status: "Pending" });
    } catch (err) {
      sendServerError(res, err, "Error creating admission application");
    }
  });

  app.put("/api/admissions/:id", requireModulePermission("admissions", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const a = req.body;

      const existing = await pool.request().input("id", id).query(`
        SELECT a.campus_id, a.status, a.interview_at, a.contact_number, a.applicant_name,
               a.test_marks, a.tracking_no, a.rejection_reason,
               c.campus_name, c.address AS campus_address, c.phone AS campus_phone
        FROM AdmissionApplications a
        LEFT JOIN Campuses c ON c.id = a.campus_id
        WHERE a.id = @id
      `);
      const row = existing.recordset[0];
      if (!row) return res.status(404).json({ message: "Application not found" });
      const campusErr = await assertCampusWrite(authUser, row.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const nextStatus = a.status || row.status;
      const interviewAt = a.interviewAt || null;
      const testMarks = a.testMarks != null ? Number(a.testMarks) : (row.test_marks != null ? Number(row.test_marks) : null);

      if (nextStatus === "Approved" && !interviewAt) {
        return res.status(400).json({ message: "Interview date/time is required when approving an application" });
      }
      if (nextStatus === "Approved" && (testMarks == null || Number.isNaN(testMarks) || testMarks < ADMISSION_TEST_PASS_MARKS)) {
        return res.status(400).json({
          message: `Test marks must be at least ${ADMISSION_TEST_PASS_MARKS} to approve (current: ${testMarks ?? "not set"})`,
        });
      }

      const shouldSendInterviewSms = Boolean(
        nextStatus === "Approved" &&
        interviewAt &&
        row.contact_number &&
        (row.status !== "Approved" || String(row.interview_at || "") !== String(interviewAt))
      );
      const shouldSendRejectSms = Boolean(
        nextStatus === "Rejected" &&
        row.status !== "Rejected" &&
        row.contact_number
      );

      await pool.request()
        .input("id", id)
        .input("class_id", a.classId || null)
        .input("father_cnic", a.fatherCnic != null ? normalizeCnic(String(a.fatherCnic)) || null : null)
        .input("student_bform", a.studentBform != null ? String(a.studentBform).trim() || null : null)
        .input("status", nextStatus)
        .input("test_marks", a.testMarks ?? null)
        .input("remarks", a.remarks || null)
        .input("rejection_reason", a.rejectionReason || a.rejection_reason || null)
        .input("interview_at", interviewAt)
        .input("reviewed_by", req.auth?.username || null)
        .query(`
          UPDATE AdmissionApplications SET
            class_id = COALESCE(@class_id, class_id),
            father_cnic = COALESCE(@father_cnic, father_cnic),
            student_bform = COALESCE(@student_bform, student_bform),
            status = @status,
            test_marks = COALESCE(@test_marks, test_marks),
            remarks = @remarks,
            rejection_reason = COALESCE(@rejection_reason, rejection_reason),
            interview_at = COALESCE(@interview_at, interview_at),
            reviewed_by = @reviewed_by,
            reviewed_on = GETDATE()
          WHERE id = @id
        `);

      let smsSent = false;
      let smsError: string | null = null;
      if (shouldSendInterviewSms) {
        try {
          const smsResult = await sendInterviewScheduleSms({
            phoneNumber: String(row.contact_number),
            applicantName: String(row.applicant_name || a.applicantName || "Applicant"),
            campusName: String(row.campus_name || "Campus"),
            campusAddress: row.campus_address || null,
            campusPhone: row.campus_phone || null,
            interviewAt: String(interviewAt),
            applicationId: id,
            trackingNo: row.tracking_no || undefined,
          });
          smsSent = smsResult.sent;
          if (smsResult.sent) {
            await pool.request().input("id", id).query(`
              UPDATE AdmissionApplications
              SET interview_sms_sent = 1, interview_sms_sent_on = GETDATE()
              WHERE id = @id
            `);
          } else {
            smsError = smsResult.reason || "SMS was not sent";
          }
        } catch (smsErr) {
          smsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
          console.warn("Interview SMS failed:", smsErr);
        }
      } else if (shouldSendRejectSms) {
        try {
          const smsResult = await sendAdmissionSms({
            phoneNumber: String(row.contact_number),
            template: "admission_rejected",
            applicationId: id,
            trackingNo: row.tracking_no || undefined,
            applicantName: String(row.applicant_name || "Applicant"),
            campusName: String(row.campus_name || "Campus"),
            campusPhone: row.campus_phone || null,
            rejectionReason: String(a.rejectionReason || a.rejection_reason || row.rejection_reason || ""),
          });
          smsSent = smsResult.sent;
          if (!smsResult.sent) smsError = smsResult.reason || "SMS was not sent";
        } catch (smsErr) {
          smsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
          console.warn("Rejection SMS failed:", smsErr);
        }
      }

      res.json({ ...a, id, interviewAt, testMarks, interviewSmsSent: smsSent, interviewSmsError: smsError });
    } catch (err) {
      sendServerError(res, err, "Error updating admission");
    }
  });

  app.get("/api/admissions/policy", async (_req, res) => {
    res.json({
      rejectionReasons: ["Incomplete documents", "Eligibility not met", "Failed entrance test", "Capacity full", "Duplicate application", "Already enrolled", "Other"],
      siblingDiscountDefaults: { secondChildPercent: 10, thirdChildPercent: 15 },
      testPassMarks: ADMISSION_TEST_PASS_MARKS,
      documentTypes: ADMISSION_DOC_TYPES,
    });
  });

  app.get("/api/admissions/report", requireModulePermission("admissions", "view"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) return res.json({ summary: {}, rows: [] });

      const request = pool.request();
      const campusWhere = campusFilter ? " WHERE a.campus_id = @campusId" : "";
      if (campusFilter) request.input("campusId", campusFilter);

      const summaryResult = await request.query(`
        SELECT
          COUNT(*) AS totalApplications,
          SUM(CASE WHEN a.status = 'Enrolled' THEN 1 ELSE 0 END) AS enrolled,
          SUM(CASE WHEN a.review_match_type = 'new' THEN 1 ELSE 0 END) AS matchNew,
          SUM(CASE WHEN a.review_match_type = 'sibling' THEN 1 ELSE 0 END) AS matchSibling,
          SUM(CASE WHEN a.review_match_type = 're_enrollment' THEN 1 ELSE 0 END) AS matchReEnrollment,
          SUM(CASE WHEN ISNULL(a.waive_admission_fee, 0) = 1 THEN 1 ELSE 0 END) AS waivedAdmissionFee,
          SUM(ISNULL(a.fee_discount_amount, 0)) AS totalDiscountAmount,
          SUM(ISNULL(a.sibling_discount_percent, 0)) AS totalSiblingDiscountPercent
        FROM AdmissionApplications a
        ${campusWhere}
      `);

      const rowsRequest = pool.request();
      if (campusFilter) rowsRequest.input("campusId", campusFilter);
      const rowsResult = await rowsRequest.query(`
          SELECT a.tracking_no AS trackingNo, a.applicant_name AS applicantName,
                 c.campus_name AS campusName, cl.class_name AS className,
                 a.status, a.review_match_type AS reviewMatchType,
                 a.test_marks AS testMarks,
                 ISNULL(a.waive_admission_fee, 0) AS waiveAdmissionFee,
                 ISNULL(a.fee_discount_amount, 0) AS feeDiscountAmount,
                 ISNULL(a.fee_discount_percent, 0) AS feeDiscountPercent,
                 ISNULL(a.sibling_discount_percent, 0) AS siblingDiscountPercent,
                 a.rejection_reason AS rejectionReason,
                 CONVERT(VARCHAR, a.applied_on, 120) AS appliedOn,
                 CONVERT(VARCHAR, a.reviewed_on, 120) AS reviewedOn
          FROM AdmissionApplications a
          LEFT JOIN Campuses c ON c.id = a.campus_id
          LEFT JOIN Classes cl ON cl.id = a.class_id
          ${campusWhere}
          ORDER BY a.applied_on DESC
        `);

      res.json({
        summary: summaryResult.recordset[0] || {},
        rows: rowsResult.recordset,
        testPassMarks: ADMISSION_TEST_PASS_MARKS,
      });
    } catch (err) {
      sendServerError(res, err, "Error generating admission report");
    }
  });

  app.post("/api/admissions/:id/review-check", requireModulePermission("admissions", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;

      const appResult = await pool.request().input("id", id).query(`
        SELECT id, campus_id, class_id, applicant_name, father_cnic, date_of_birth, status
        FROM AdmissionApplications WHERE id = @id
      `);
      const app = appResult.recordset[0];
      if (!app) return res.status(404).json({ message: "Application not found" });
      const campusErr = await assertCampusWrite(authUser, app.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const bodyCnic = req.body?.fatherCnic != null ? normalizeCnic(String(req.body.fatherCnic)) : "";
      const storedCnic = normalizeCnic(app.father_cnic);
      const fatherCnic = bodyCnic.length === 13 ? bodyCnic : storedCnic;

      if (fatherCnic.length !== 13) {
        return res.status(400).json({
          message: storedCnic
            ? "Father CNIC on record is invalid — please enter a valid 13-digit CNIC"
            : "Father CNIC is missing on this application — please enter a valid 13-digit CNIC",
        });
      }

      if (fatherCnic !== storedCnic) {
        await pool.request()
          .input("id", id)
          .input("father_cnic", fatherCnic)
          .query("UPDATE AdmissionApplications SET father_cnic = @father_cnic WHERE id = @id");
      }

      const result = await runAdmissionCnicReview(pool, {
        fatherCnic,
        applicantName: String(app.applicant_name),
        dateOfBirth: app.date_of_birth ? String(app.date_of_birth).slice(0, 10) : null,
        excludeApplicationId: id,
        classId: req.body?.classId || app.class_id || null,
        campusId: app.campus_id,
        waiveAdmissionFee: Boolean(req.body?.waiveAdmissionFee),
        discountAmount: Number(req.body?.feeDiscountAmount) || 0,
        discountPercent: Number(req.body?.feeDiscountPercent) || 0,
        siblingDiscountPercent: req.body?.siblingDiscountPercent != null
          ? Number(req.body.siblingDiscountPercent)
          : undefined,
      });
      res.json({ ...result, fatherCnic });
    } catch (err) {
      console.error("Error checking admission CNIC:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("CNIC")) return res.status(400).json({ message: msg });
      res.status(500).json({ message: `CNIC check failed: ${msg}` });
    }
  });

  app.post("/api/admissions/:id/review", requireModulePermission("admissions", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const body = req.body || {};

      const appResult = await pool.request().input("id", id).query(`
        SELECT id, campus_id, class_id, applicant_name, father_cnic, date_of_birth, status,
               contact_number, tracking_no
        FROM AdmissionApplications WHERE id = @id
      `);
      const app = appResult.recordset[0];
      if (!app) return res.status(404).json({ message: "Application not found" });
      if (app.status !== "Pending") {
        return res.status(400).json({ message: "Only pending applications can be moved to review" });
      }
      const campusErr = await assertCampusWrite(authUser, app.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const bodyCnic = body.fatherCnic != null ? normalizeCnic(String(body.fatherCnic)) : "";
      const storedCnic = normalizeCnic(app.father_cnic);
      const fatherCnic = bodyCnic.length === 13 ? bodyCnic : storedCnic;
      if (fatherCnic.length !== 13) {
        return res.status(400).json({ message: "Father CNIC (13 digits) is required" });
      }

      const reviewResult: AdmissionReviewResult = body.reviewResult || await runAdmissionCnicReview(pool, {
        fatherCnic,
        applicantName: String(app.applicant_name),
        dateOfBirth: app.date_of_birth ? String(app.date_of_birth).slice(0, 10) : null,
        excludeApplicationId: id,
      });

      if (reviewResult.matchType === "duplicate_active") {
        return res.status(409).json({
          message: reviewResult.message,
          reviewResult,
        });
      }

      const linkedStudentId = body.linkedStudentId ?? reviewResult.suggestedLinkedStudentId ?? null;
      const waiveAdmissionFee = Boolean(body.waiveAdmissionFee);
      const feeDiscountAmount = Number(body.feeDiscountAmount) || 0;
      const feeDiscountPercent = Number(body.feeDiscountPercent) || 0;
      const siblingDiscountPercent = Number(
        body.siblingDiscountPercent ?? reviewResult.suggestedSiblingDiscountPercent ?? 0,
      );
      const reviewSnapshot = JSON.stringify({
        reviewedAt: new Date().toISOString(),
        reviewedBy: authUser.username,
        ...reviewResult,
      });

      await pool.request()
        .input("id", id)
        .input("father_cnic", fatherCnic)
        .input("status", "Under Review")
        .input("linked_student_id", linkedStudentId)
        .input("review_match_type", reviewResult.matchType)
        .input("review_snapshot", reviewSnapshot)
        .input("waive_admission_fee", waiveAdmissionFee ? 1 : 0)
        .input("fee_discount_amount", feeDiscountAmount)
        .input("fee_discount_percent", feeDiscountPercent)
        .input("sibling_discount_percent", siblingDiscountPercent)
        .input("reviewed_by", authUser.username)
        .query(`
          UPDATE AdmissionApplications SET
            father_cnic = @father_cnic,
            status = @status,
            linked_student_id = @linked_student_id,
            review_match_type = @review_match_type,
            review_snapshot = @review_snapshot,
            waive_admission_fee = @waive_admission_fee,
            fee_discount_amount = @fee_discount_amount,
            fee_discount_percent = @fee_discount_percent,
            sibling_discount_percent = @sibling_discount_percent,
            reviewed_by = @reviewed_by,
            reviewed_on = GETDATE()
          WHERE id = @id
        `);

      let reviewSmsSent = false;
      let reviewSmsError: string | null = null;
      if (app.contact_number) {
        try {
          const campusRow = await pool.request()
            .input("campus_id", app.campus_id)
            .query("SELECT campus_name, phone FROM Campuses WHERE id = @campus_id");
          const campus = campusRow.recordset[0];
          const smsResult = await sendAdmissionSms({
            phoneNumber: String(app.contact_number),
            template: "admission_under_review",
            applicationId: id,
            trackingNo: app.tracking_no || undefined,
            applicantName: String(app.applicant_name),
            campusName: campus?.campus_name || "Campus",
            campusPhone: campus?.phone || null,
          });
          reviewSmsSent = smsResult.sent;
          if (!smsResult.sent) reviewSmsError = smsResult.reason || null;
        } catch (smsErr) {
          reviewSmsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
          console.warn("Under review SMS failed:", smsErr);
        }
      }

      res.json({
        id,
        status: "Under Review",
        reviewMatchType: reviewResult.matchType,
        linkedStudentId,
        waiveAdmissionFee,
        feeDiscountAmount,
        feeDiscountPercent,
        siblingDiscountPercent,
        message: reviewResult.message,
        reviewSmsSent,
        reviewSmsError,
      });
    } catch (err) {
      sendServerError(res, err, "Error completing admission review");
    }
  });

  app.get("/api/admissions/:id/documents", requireModulePermission("admissions", "view"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const appRow = await pool.request().input("id", id).query("SELECT campus_id FROM AdmissionApplications WHERE id = @id");
      const app = appRow.recordset[0];
      if (!app) return res.status(404).json({ message: "Application not found" });
      const campusErr = await assertCampusWrite(authUser, app.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const docs = await pool.request().input("application_id", id).query(`
        SELECT id, application_id AS applicationId, doc_type AS docType, file_name AS fileName,
               file_url AS fileUrl, uploaded_by AS uploadedBy,
               CONVERT(VARCHAR, uploaded_on, 120) AS uploadedOn
        FROM AdmissionDocuments WHERE application_id = @application_id
        ORDER BY uploaded_on DESC
      `);
      res.json(docs.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching admission documents");
    }
  });

  app.post("/api/admissions/:id/documents", requireModulePermission("admissions", "update"), (req, res) => {
    uploadAdmissionDoc.single("file")(req, res, async (err) => {
      try {
        if (err) return res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
        if (!pool || !pool.connected) await connectToDb();
        if (!pool) return res.status(503).json({ message: "Database connection not available" });
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const appRow = await pool.request().input("id", id).query("SELECT campus_id FROM AdmissionApplications WHERE id = @id");
        const app = appRow.recordset[0];
        if (!app) return res.status(404).json({ message: "Application not found" });
        const campusErr = await assertCampusWrite(authUser, app.campus_id);
        if (campusErr) return res.status(403).json({ message: campusErr });

        const docTypeRaw = String(req.body?.docType || "other").toLowerCase();
        const docType: AdmissionDocType = ADMISSION_DOC_TYPES.includes(docTypeRaw as AdmissionDocType)
          ? (docTypeRaw as AdmissionDocType)
          : "other";
        const docId = crypto.randomUUID();
        const fileUrl = `/uploads/admissions/${req.file.filename}`;

        await pool.request()
          .input("id", docId)
          .input("application_id", id)
          .input("doc_type", docType)
          .input("file_name", req.file.originalname)
          .input("file_url", fileUrl)
          .input("uploaded_by", req.auth?.username || null)
          .query(`
            INSERT INTO AdmissionDocuments (id, application_id, doc_type, file_name, file_url, uploaded_by)
            VALUES (@id, @application_id, @doc_type, @file_name, @file_url, @uploaded_by)
          `);

        res.status(201).json({
          id: docId,
          applicationId: id,
          docType,
          fileName: req.file.originalname,
          fileUrl,
          uploadedBy: req.auth?.username || null,
        });
      } catch (uploadErr) {
        sendServerError(res, uploadErr, "Error uploading admission document");
      }
    });
  });

  app.delete("/api/admissions/:id/documents/:docId", requireModulePermission("admissions", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id, docId } = req.params;

      const docRow = await pool.request()
        .input("docId", docId)
        .input("application_id", id)
        .query(`
          SELECT d.file_url, a.campus_id
          FROM AdmissionDocuments d
          JOIN AdmissionApplications a ON a.id = d.application_id
          WHERE d.id = @docId AND d.application_id = @application_id
        `);
      const doc = docRow.recordset[0];
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const campusErr = await assertCampusWrite(authUser, doc.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      await pool.request().input("docId", docId).query("DELETE FROM AdmissionDocuments WHERE id = @docId");
      if (doc.file_url) {
        const diskPath = path.join(process.cwd(), "wwwroot", String(doc.file_url).replace(/^\//, ""));
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      }
      res.json({ message: "Document deleted" });
    } catch (err) {
      sendServerError(res, err, "Error deleting admission document");
    }
  });

  app.post("/api/admissions/:id/enroll", requireModulePermission("admissions", "update"), async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;

      const appResult = await pool.request().input("id", id).query(`
        SELECT a.*, cl.class_name FROM AdmissionApplications a
        LEFT JOIN Classes cl ON a.class_id = cl.id WHERE a.id = @id
      `);
      const app = appResult.recordset[0];
      if (!app) return res.status(404).json({ message: "Application not found" });
      if (app.status === "Enrolled") return res.status(400).json({ message: "Already enrolled" });
      if (app.status !== "Approved") {
        return res.status(400).json({ message: "Application must be approved before enrollment" });
      }
      if (!app.class_id) return res.status(400).json({ message: "Assign a class before enrolling" });
      if (!app.review_match_type) {
        return res.status(400).json({ message: "Complete CNIC review before enrolling" });
      }
      if (app.review_match_type === "duplicate_active") {
        return res.status(409).json({ message: "Cannot enroll — an active student with matching details already exists" });
      }

      const campusErr = await assertCampusWrite(authUser, app.campus_id);
      if (campusErr) return res.status(403).json({ message: campusErr });

      const cap = await assertClassCapacity(app.class_id);
      if (!cap.ok) return res.status(400).json({ message: cap.message });

      const fatherCnic = normalizeCnic(app.father_cnic);
      const admissionDate = new Date().toISOString().split("T")[0];
      let studentId: string;
      let rollNumber: string;
      let reactivated = false;
      let carryArrears = 0;

      if (app.review_match_type === "re_enrollment" && app.linked_student_id) {
        const linkedResult = await pool.request()
          .input("id", app.linked_student_id)
          .query(`
            SELECT id, admission_no, status, outstanding_fees FROM Students WHERE id = @id
          `);
        const linked = linkedResult.recordset[0];
        if (!linked) return res.status(400).json({ message: "Linked student record not found" });
        if (linked.status === "Active") {
          return res.status(409).json({ message: "Linked student is already active" });
        }

        studentId = String(linked.id);
        rollNumber = String(linked.admission_no);
        carryArrears = Number(linked.outstanding_fees) || 0;
        reactivated = true;

        await pool.request()
          .input("id", studentId)
          .input("campus_id", app.campus_id)
          .input("class_id", app.class_id)
          .input("student_name", app.applicant_name)
          .input("father_name", app.father_name)
          .input("father_cnic", fatherCnic || null)
          .input("father_mobile", app.contact_number)
          .input("registration_no", app.student_bform || null)
          .input("dob", app.date_of_birth)
          .input("admission_date", admissionDate)
          .input("gender", app.gender)
          .input("address", app.address)
          .query(`
            UPDATE Students SET
              campus_id = @campus_id,
              class_id = @class_id,
              student_name = @student_name,
              father_name = @father_name,
              father_cnic = @father_cnic,
              father_mobile = @father_mobile,
              registration_no = COALESCE(@registration_no, registration_no),
              dob = @dob,
              admission_date = @admission_date,
              gender = @gender,
              address = @address,
              status = 'Active'
            WHERE id = @id
          `);
      } else {
        const year = new Date().getFullYear();
        const countResult = await pool.request()
          .input("pattern", `STU-${year}-%`)
          .query("SELECT COUNT(*) AS cnt FROM Students WHERE admission_no LIKE @pattern");
        const seq = (countResult.recordset[0]?.cnt ?? 0) + 1;
        rollNumber = `STU-${year}-${String(seq).padStart(4, "0")}`;
        studentId = crypto.randomUUID();

        await pool.request()
          .input("id", studentId)
          .input("campus_id", app.campus_id)
          .input("class_id", app.class_id)
          .input("admission_no", rollNumber)
          .input("student_name", app.applicant_name)
          .input("father_name", app.father_name)
          .input("father_cnic", fatherCnic || null)
          .input("father_mobile", app.contact_number)
          .input("registration_no", app.student_bform || null)
          .input("dob", app.date_of_birth)
          .input("admission_date", admissionDate)
          .input("gender", app.gender)
          .input("address", app.address)
          .input("status", "Active")
          .query(`
            INSERT INTO Students (id, campus_id, class_id, admission_no, registration_no, student_name, father_name,
              father_cnic, father_mobile, dob, admission_date, gender, address, status, outstanding_fees)
            VALUES (@id, @campus_id, @class_id, @admission_no, @registration_no, @student_name, @father_name,
              @father_cnic, @father_mobile, @dob, @admission_date, @gender, @address, @status, 0)
          `);

        if (!reactivated) {
          try {
            const hashed = await bcrypt.hash(rollNumber, 10);
            await pool.request()
              .input("id", crypto.randomUUID())
              .input("fullName", app.applicant_name)
              .input("username", rollNumber)
              .input("passwordHash", hashed)
              .input("role", "Student")
              .input("campusId", app.campus_id)
              .query(`
                INSERT INTO Users (id, fullName, username, email, passwordHash, role, campusId, isActive, createdOn)
                VALUES (@id, @fullName, @username, NULL, @passwordHash, @role, @campusId, 1, GETDATE())
              `);
          } catch {
            // Student record created; login account is optional
          }
        }
      }

      const feeVoucher = await createEnrollmentFeeVoucher(pool, studentId, app.class_id, {
        waiveAdmissionFee: Boolean(app.waive_admission_fee),
        discountAmount: Number(app.fee_discount_amount) || 0,
        discountPercent: Number(app.fee_discount_percent) || 0,
        siblingDiscountPercent: Number(app.sibling_discount_percent) || 0,
        carryArrears: app.review_match_type === "re_enrollment" ? carryArrears : 0,
      });
      await recomputeStudentOutstanding(studentId);

      await pool.request()
        .input("id", id)
        .input("student_id", studentId)
        .input("reviewed_by", req.auth?.username || null)
        .query(`
          UPDATE AdmissionApplications SET status = 'Enrolled', student_id = @student_id,
            reviewed_by = @reviewed_by, reviewed_on = GETDATE() WHERE id = @id
        `);

      res.json({
        message: reactivated ? "Student reactivated and enrolled" : "Student enrolled successfully",
        studentId,
        rollNumber,
        reactivated,
        feeVoucherId: feeVoucher.feeId,
        totalDue: feeVoucher.totalDue,
        carryArrears: app.review_match_type === "re_enrollment" ? carryArrears : 0,
      });
    } catch (err) {
      sendServerError(res, err, "Error enrolling student");
    }
  });

  // Network / campus report summary (uses materialized stats + bounded fee aggregates)
  app.get("/api/reports/summary", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) {
        return res.json({
          totalExpected: 0, totalCollected: 0, totalPending: 0, totalExpenses: 0,
          defaulters: 0, netProfit: 0, monthlyData: [], campusBreakdown: [],
        });
      }

      const year = parseInt(String(req.query.year || new Date().getFullYear()), 10);
      const request = pool.request().input("year", year).input("campusId", campusFilter || null);

      const feeAgg = await request.query(`
        SELECT
          ISNULL(SUM(f.amount + ISNULL(f.arrears, 0)), 0) AS totalExpected,
          ISNULL(SUM(f.paid_amount), 0) AS totalCollected,
          ISNULL(SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END), 0) AS totalPending,
          COUNT(DISTINCT CASE WHEN f.status IN ('Unpaid','Partially Paid') THEN f.student_id END) AS defaulters
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        WHERE f.year = @year AND (@campusId IS NULL OR s.campus_id = @campusId)
      `);

      const expenseAgg = await request.query(`
        SELECT ISNULL(SUM(e.amount), 0) AS totalExpenses
        FROM Expenses e
        WHERE YEAR(e.date) = @year AND (@campusId IS NULL OR e.campus_id = @campusId)
      `);

      const monthly = await request.query(`
        SELECT f.month,
          ISNULL(SUM(f.paid_amount), 0) AS collected,
          ISNULL(SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END), 0) AS pending
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        WHERE f.year = @year AND f.month > 0
          AND (@campusId IS NULL OR s.campus_id = @campusId)
        GROUP BY f.month
        ORDER BY f.month
      `);

      let campusBreakdown: unknown[] = [];
      if (!campusFilter) {
        const campusRows = await pool.request().query(`
          SELECT d.campus_id AS campusId, c.campus_name AS campusName,
            d.total_collected AS collected, d.total_outstanding AS pending, d.defaulters
          FROM DashboardCampusStats d
          JOIN Campuses c ON c.id = d.campus_id
          ORDER BY d.total_collected DESC
        `);
        campusBreakdown = campusRows.recordset;
      }

      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fees = feeAgg.recordset[0] || {};
      const expenses = Number(expenseAgg.recordset[0]?.totalExpenses || 0);
      const collected = Number(fees.totalCollected || 0);

      res.json({
        totalExpected: Number(fees.totalExpected || 0),
        totalCollected: collected,
        totalPending: Number(fees.totalPending || 0),
        totalExpenses: expenses,
        defaulters: Number(fees.defaulters || 0),
        netProfit: collected - expenses,
        monthlyData: monthly.recordset.map((r: { month: number; collected: number; pending: number }) => ({
          month: monthNames[r.month] || `M${r.month}`,
          Collected: r.collected,
          Pending: r.pending,
        })),
        campusBreakdown,
      });
    } catch (err) {
      sendServerError(res, err, "Error fetching report summary");
    }
  });

  // Dashboard Stats Route (single source of truth for KPIs)
  app.get("/api/dashboard-stats", async (req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
      if (denied) {
        return res.json({
          activeStudents: 0, totalCollected: 0, totalOutstanding: 0, campusCount: 0,
          classCount: 0, defaulters: 0, pendingAdmissions: 0, examsScheduled: 0,
          onlineCollections: 0, totalExpenses: 0, monthlyFees: [], recentPayments: [],
        });
      }

      const request = pool.request().input("campusId", campusFilter || null);

      let statsData: Record<string, unknown>;
      if (!campusFilter) {
        const matResult = await pool.request().query(`
          SELECT
            ISNULL(SUM(active_students), 0) AS activeStudents,
            ISNULL(SUM(total_collected), 0) AS totalCollected,
            ISNULL(SUM(total_outstanding), 0) AS totalOutstanding,
            (SELECT COUNT(*) FROM Campuses WHERE isActive = 1) AS campusCount,
            (SELECT COUNT(*) FROM Classes) AS classCount,
            ISNULL(SUM(defaulters), 0) AS defaulters,
            ISNULL(SUM(pending_admissions), 0) AS pendingAdmissions,
            ISNULL(SUM(exams_scheduled), 0) AS examsScheduled,
            ISNULL(SUM(online_collections), 0) AS onlineCollections,
            ISNULL(SUM(total_expenses), 0) AS totalExpenses
          FROM DashboardCampusStats
        `);
        statsData = matResult.recordset[0] || {};
        const matCount = await pool.request().query(`SELECT COUNT(*) AS n FROM DashboardCampusStats`);
        if ((matCount.recordset[0]?.n ?? 0) === 0) {
          await refreshDashboardCampusStats(pool);
          const retry = await pool.request().query(`
            SELECT
              ISNULL(SUM(active_students), 0) AS activeStudents,
              ISNULL(SUM(total_collected), 0) AS totalCollected,
              ISNULL(SUM(total_outstanding), 0) AS totalOutstanding,
              (SELECT COUNT(*) FROM Campuses WHERE isActive = 1) AS campusCount,
              (SELECT COUNT(*) FROM Classes) AS classCount,
              ISNULL(SUM(defaulters), 0) AS defaulters,
              ISNULL(SUM(pending_admissions), 0) AS pendingAdmissions,
              ISNULL(SUM(exams_scheduled), 0) AS examsScheduled,
              ISNULL(SUM(online_collections), 0) AS onlineCollections,
              ISNULL(SUM(total_expenses), 0) AS totalExpenses
            FROM DashboardCampusStats
          `);
          statsData = retry.recordset[0] || statsData;
        }
      } else {
        const matCampus = await pool.request()
          .input("campusId", campusFilter)
          .query(`
            SELECT TOP 1
              active_students AS activeStudents,
              total_collected AS totalCollected,
              total_outstanding AS totalOutstanding,
              1 AS campusCount,
              (SELECT COUNT(*) FROM Classes WHERE campus_id = @campusId) AS classCount,
              defaulters,
              pending_admissions AS pendingAdmissions,
              exams_scheduled AS examsScheduled,
              online_collections AS onlineCollections,
              total_expenses AS totalExpenses
            FROM DashboardCampusStats WHERE campus_id = @campusId
          `);
        if (matCampus.recordset[0]) {
          statsData = matCampus.recordset[0];
        } else {
          const stats = await request.query(`
            SELECT 
              (SELECT COUNT(*) FROM Students WHERE status = 'Active' AND campus_id = @campusId) as activeStudents,
              (SELECT ISNULL(SUM(f.paid_amount), 0) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE s.campus_id = @campusId) as totalCollected,
              (SELECT ISNULL(SUM(f.balance_amount), 0) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE s.campus_id = @campusId) as totalOutstanding,
              1 as campusCount,
              (SELECT COUNT(*) FROM Classes WHERE campus_id = @campusId) as classCount,
              (SELECT COUNT(DISTINCT f.student_id) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE f.status IN ('Unpaid','Partially Paid') AND s.campus_id = @campusId) as defaulters,
              (SELECT COUNT(*) FROM AdmissionApplications WHERE status IN ('Pending','Under Review','Approved') AND campus_id = @campusId) as pendingAdmissions,
              (SELECT COUNT(*) FROM Exams e WHERE MONTH(e.exam_date) = MONTH(GETDATE()) AND YEAR(e.exam_date) = YEAR(GETDATE()) AND e.campus_id = @campusId) as examsScheduled,
              (SELECT ISNULL(SUM(t.amount), 0) FROM Transactions t JOIN Students s ON t.student_id = s.id WHERE t.status = 'Success' AND s.campus_id = @campusId) as onlineCollections,
              (SELECT ISNULL(SUM(e.amount), 0) FROM Expenses e WHERE e.campus_id = @campusId) as totalExpenses
          `);
          statsData = stats.recordset[0] || {};
        }
      }

      const monthly = await request.query(`
        SELECT f.month, f.year,
          ISNULL(SUM(f.paid_amount), 0) AS collected,
          ISNULL(SUM(CASE WHEN f.balance_amount > 0 THEN f.balance_amount ELSE 0 END), 0) AS pending
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        WHERE f.month > 0 AND f.year = YEAR(GETDATE())
          AND (@campusId IS NULL OR s.campus_id = @campusId)
        GROUP BY f.month, f.year
        ORDER BY f.month
      `);

      const recent = await request.query(`
        SELECT TOP 5 t.id, t.amount, s.student_name AS studentName,
               CONVERT(VARCHAR, t.transaction_date, 120) AS transactionDate
        FROM Transactions t
        JOIN Students s ON t.student_id = s.id
        WHERE t.status = 'Success' AND (@campusId IS NULL OR s.campus_id = @campusId)
        ORDER BY t.transaction_date DESC
      `);

      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      res.json({
        ...statsData,
        monthlyFees: monthly.recordset.map((r: { month: number; collected: number; pending: number }) => ({
          month: r.month,
          monthName: monthNames[r.month] || `M${r.month}`,
          collected: r.collected,
          pending: r.pending,
        })),
        recentPayments: recent.recordset,
      });
    } catch (err) {
      sendServerError(res, err, "Error fetching dashboard stats");
    }
  });

  // QuickPay config — never expose api_key in responses
  app.get("/api/quickpay-config", requireRoles(QUICKPAY_ROLES), async (_req, res) => {
    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      const result = await pool.request().query("SELECT * FROM QuickPayConfig");
      res.json(result.recordset.map((row) => redactQuickPayConfig(row)));
    } catch (err) {
      sendServerError(res, err, "Error fetching QuickPay config");
    }
  });

  // Generic Data Routes (Mapped to SQL Tables)
  app.get("/api/:collection", async (req, res) => {
    const collection = req.params.collection.toLowerCase();
    const tableName = TABLE_MAP[collection];
    if (!tableName) return res.status(404).json({ message: "Collection not supported in SQL yet" });

    if (COLLECTION_TO_MODULE[collection]) {
      if (!(await assertCollectionPermission(req, res, collection, "view"))) return;
    } else {
      const readRoles = collection === "quickpay-config" ? QUICKPAY_ROLES : null;
      if (readRoles && (!req.auth || !readRoles.has(req.auth.role))) {
        return res.status(403).json({ message: "Forbidden — insufficient role" });
      }
    }

    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });

      const campusScopedCollections = new Set(["expenses", "attendance"]);
      let result: sql.IResult<Record<string, unknown>>;
      if (campusScopedCollections.has(collection)) {
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const { filter: campusFilter, denied } = resolveCampusFilter(authUser, req.query.campusId);
        if (denied) return res.json([]);

        const request = pool.request();
        if (collection === "expenses") {
          if (campusFilter) {
            request.input("campusId", campusFilter);
            result = await request.query(`SELECT * FROM Expenses WHERE campus_id = @campusId`);
          } else {
            result = await request.query(`SELECT * FROM Expenses`);
          }
        } else if (campusFilter) {
          request.input("campusId", campusFilter);
          result = await request.query(`
            SELECT a.* FROM Attendance a
            INNER JOIN Students s ON a.student_id = s.id
            WHERE s.campus_id = @campusId
          `);
        } else {
          result = await request.query(`SELECT * FROM Attendance`);
        }
      } else {
        result = await pool.request().query(`SELECT * FROM ${tableName}`);
      }
      
      const mappedData = result.recordset.map((row) => {
        if (collection === "quickpay-config") {
          return redactQuickPayConfig(row);
        }
        const newRow: Record<string, unknown> = {};
        Object.keys(row).forEach((key) => {
          newRow[mapToResponseKey(key)] = row[key];
        });
        return newRow;
      });
      
      res.json(mappedData);
    } catch (err) {
      sendServerError(res, err, `Error fetching from ${tableName}`);
    }
  });

  app.post("/api/:collection", async (req, res) => {
    const collection = req.params.collection.toLowerCase();
    const tableName = TABLE_MAP[collection];
    if (!tableName) return res.status(404).json({ message: "Collection not supported in SQL yet" });

    if (COLLECTION_TO_MODULE[collection]) {
      if (!(await assertCollectionPermission(req, res, collection, "create"))) return;
    } else {
      const writeRoles = GENERIC_WRITE_ROLES[collection] || ADMIN_ROLES;
      if (!req.auth || !writeRoles.has(req.auth.role)) {
        return res.status(403).json({ message: "Forbidden — insufficient role" });
      }
    }

    if (collection === "expenses" && req.body.campusId) {
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const campusErr = await assertCampusWrite(authUser, String(req.body.campusId));
      if (campusErr) return res.status(403).json({ message: campusErr });
    }

    const whitelist = TABLE_INSERT_WHITELIST[tableName];
    const id = req.body.id || crypto.randomUUID();
    const raw = { ...req.body, id };
    const keys = Object.keys(raw).filter((k) => !whitelist || whitelist.has(k));
    if (keys.length === 0) {
      return res.status(400).json({ message: "No allowed fields to insert" });
    }
    const data: Record<string, unknown> = {};
    keys.forEach((k) => {
      data[k] = raw[k];
    });
    const dbColumns = keys.map((k) => mapToDbColumn(k)).join(", ");
    const paramValues = keys.map((key) => `@${key}`).join(", ");

    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      if (collection === "attendance" && req.body.studentId) {
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const studentResult = await pool.request()
          .input("studentId", req.body.studentId)
          .query("SELECT campus_id FROM Students WHERE id = @studentId");
        const student = studentResult.recordset[0];
        if (!student) return res.status(404).json({ message: "Student not found" });
        const campusErr = await assertCampusWrite(authUser, student.campus_id);
        if (campusErr) return res.status(403).json({ message: campusErr });
      }
      const request = pool.request();
      keys.forEach((key) => {
        request.input(key, data[key]);
      });

      await request.query(`INSERT INTO ${tableName} (${dbColumns}) VALUES (${paramValues})`);
      const response =
        collection === "quickpay-config" ? redactQuickPayConfig(data as Record<string, unknown>) : data;
      res.status(201).json(response);
    } catch (err) {
      sendServerError(res, err, `Error adding to ${tableName}`);
    }
  });

  app.put("/api/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    const col = collection.toLowerCase();
    const tableName = TABLE_MAP[col];
    if (!tableName) return res.status(404).json({ message: "Collection not supported in SQL yet" });

    if (COLLECTION_TO_MODULE[col]) {
      if (!(await assertCollectionPermission(req, res, col, "update"))) return;
    } else {
      const writeRoles = GENERIC_WRITE_ROLES[col] || ADMIN_ROLES;
      if (!req.auth || !writeRoles.has(req.auth.role)) {
        return res.status(403).json({ message: "Forbidden — insufficient role" });
      }
    }

    const body = { ...req.body };
    if (col === "quickpay-config") {
      const apiKey = String(body.apiKey ?? "");
      if (!apiKey || apiKey.includes("•")) {
        delete body.apiKey;
      }
    }

    const keys = Object.keys(body).filter(k => k !== 'id');
    if (keys.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    const updates = keys.map(key => `${mapToDbColumn(key)} = @${key}`).join(", ");

    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      if (col === "expenses" && body.campusId) {
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const campusErr = await assertCampusWrite(authUser, String(body.campusId));
        if (campusErr) return res.status(403).json({ message: campusErr });
      }
      if (col === "attendance" && body.studentId) {
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const studentResult = await pool.request()
          .input("studentId", body.studentId)
          .query("SELECT campus_id FROM Students WHERE id = @studentId");
        const student = studentResult.recordset[0];
        if (!student) return res.status(404).json({ message: "Student not found" });
        const campusErr = await assertCampusWrite(authUser, student.campus_id);
        if (campusErr) return res.status(403).json({ message: campusErr });
      }
      const request = pool.request();
      request.input("id", id);
      keys.forEach(key => {
        request.input(key, body[key]);
      });

      await request.query(`UPDATE ${tableName} SET ${updates} WHERE id = @id`);
      const response =
        col === "quickpay-config"
          ? redactQuickPayConfig({ id, ...body } as Record<string, unknown>)
          : { id, ...body };
      res.json(response);
    } catch (err) {
      sendServerError(res, err, `Error updating ${tableName}`);
    }
  });

  app.delete("/api/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    const col = collection.toLowerCase();
    const tableName = TABLE_MAP[col];
    if (!tableName) return res.status(404).json({ message: "Collection not supported in SQL yet" });

    if (!(await assertCollectionPermission(req, res, col, "delete"))) return;
    if (!COLLECTION_TO_MODULE[col] && (!req.auth || !ADMIN_ROLES.has(req.auth.role))) {
      return res.status(403).json({ message: "Forbidden — insufficient role" });
    }

    try {
      if (!pool || !pool.connected) await connectToDb();
      if (!pool) return res.status(503).json({ message: "Database connection not available" });
      await pool.request().input("id", id).query(`DELETE FROM ${tableName} WHERE id = @id`);
      res.status(204).send();
    } catch (err) {
      sendServerError(res, err, `Error deleting from ${tableName}`);
    }
  });

  // Auth Routes
  app.post("/api/auth/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await ensurePool())) {
        return res.status(503).json({ message: "Database connection not available. Please try again later." });
      }

      const { username } = req.body;
      const password = req.body.password ?? req.body.passwordHash;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const result = await pool.request()
        .input("username", username)
        .query("SELECT * FROM Users WHERE username = @username");
      
      const user = result.recordset[0];
      
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const storedHash = user.passwordHash ?? user.password_hash;
      if (!storedHash) {
        return res.status(500).json({ message: "User account is misconfigured (missing password hash)" });
      }

      const isPasswordValid = await bcrypt.compare(password, storedHash);
      
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      if (!isUserActive(user)) {
        return res.status(403).json({ message: "Account is disabled" });
      }

      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          role: user.role,
          campusId: user.campusId || undefined,
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      const permissions = await getRolePermissions(user.role);
      const mapped = mapUserFromRow(user);

      res.json({
        token,
        user: {
          ...mapped,
          campusId: mapped.campusId || undefined,
          permissions,
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Register a user account (used by student onboarding and admin user creation).
  // Auth is enforced by requireAuthForProtectedApi. Non-student accounts require an admin.
  app.post("/api/auth/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await ensurePool())) {
        return res.status(503).json({ message: "Database connection not available. Please try again later." });
      }

      const { fullName, username, email, role, campusId, isActive } = req.body;
      if (!fullName || !username || !role) {
        return res.status(400).json({ message: "fullName, username and role are required" });
      }

      const targetRole = String(role);
      if (targetRole !== "Student" && isStudentRollUsername(String(username))) {
        return res.status(400).json({
          message: "Staff accounts must use a name-based login username, not a student roll number (STU-YYYY-####).",
        });
      }
      if (targetRole === "Super Admin" && req.auth?.role !== "Super Admin") {
        return res.status(403).json({ message: "Forbidden — only Super Admin can create Super Admin accounts" });
      }
      if (req.body.viaUserManagement && targetRole !== "Student") {
        if (!req.auth || !SUPER_ADMIN_ROLES.has(req.auth.role)) {
          return res.status(403).json({ message: "Forbidden — Super Admin required" });
        }
      } else if (targetRole !== "Student" && (!req.auth || !ADMIN_ROLES.has(req.auth.role))) {
        return res.status(403).json({ message: "Forbidden — admin role required to create this account" });
      }

      if (campusId) {
        const authUser = await loadAuthUser(req);
        if (!authUser) return res.status(401).json({ message: "Unauthorized" });
        const campusErr = await assertCampusWrite(authUser, String(campusId));
        if (campusErr) return res.status(403).json({ message: campusErr });
      }

      // Default password is the username (e.g. the student roll number) unless one is provided.
      const password = req.body.password || req.body.passwordHash || username;

      const existing = await pool.request()
        .input("username", username)
        .query("SELECT id FROM Users WHERE username = @username");
      if (existing.recordset.length > 0) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const hashed = await bcrypt.hash(String(password), 10);
      const id = crypto.randomUUID();

      await pool.request()
        .input("id", id)
        .input("fullName", fullName)
        .input("username", username)
        .input("email", email || null)
        .input("passwordHash", hashed)
        .input("role", targetRole)
        .input("campusId", campusId || null)
        .input("isActive", isActive === false ? 0 : 1)
        .query(`
          INSERT INTO Users (id, fullName, username, email, passwordHash, role, campusId, isActive, createdOn)
          VALUES (@id, @fullName, @username, @email, @passwordHash, @role, @campusId, @isActive, GETDATE())
        `);

      res.status(201).json({
        id,
        fullName,
        username,
        email: email || null,
        role: targetRole,
        campusId: campusId || null,
        isActive: isActive !== false,
      });
    } catch (error) {
      next(error);
    }
  });

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack || err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      message: status < 500 ? (err.message || "Request failed") : "Internal server error",
      ...(process.env.NODE_ENV === "development" && {
        error: err instanceof Error ? err.message : String(err),
      }),
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (pool) startScalingWorkers(pool);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

