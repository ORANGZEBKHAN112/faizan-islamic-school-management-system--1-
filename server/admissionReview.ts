import type sql from "mssql";
import crypto from "crypto";

export type AdmissionMatchType = "new" | "re_enrollment" | "sibling" | "duplicate_active" | "duplicate_application";

/** Default sibling tuition discount (%). Override via campus columns when present. */
export const DEFAULT_SIBLING_DISCOUNT_2ND = 10;
export const DEFAULT_SIBLING_DISCOUNT_3RD = 15;

export const ADMISSION_REJECTION_REASONS = [
  "Incomplete documents",
  "Eligibility not met",
  "Failed entrance test",
  "Capacity full",
  "Duplicate application",
  "Already enrolled",
  "Other",
] as const;

export interface UnpaidFeeMonth {
  month: number;
  year: number;
  balanceAmount: number;
  label?: string;
}

export interface MatchedStudentRow {
  id: string;
  firstName: string;
  rollNumber: string;
  fatherName?: string;
  status: string;
  className?: string;
  campusName?: string;
  dateOfBirth?: string;
  outstandingFees: number;
  unpaidBalance: number;
  unpaidMonths: UnpaidFeeMonth[];
  nameScore: number;
  dobMatch: boolean;
  isExactMatch: boolean;
}

export interface DuplicateApplicationRow {
  id: string;
  applicantName: string;
  status: string;
  appliedOn?: string;
}

export interface AdmissionFeePreviewLine {
  label: string;
  amount: number;
}

export interface AdmissionFeePreview {
  classAssigned: boolean;
  tuitionFee: number;
  admissionFee: number;
  securityFee: number;
  examFee: number;
  transportFee: number;
  miscFee: number;
  subtotal: number;
  manualDiscountAmount: number;
  manualDiscountPercent: number;
  siblingDiscountPercent: number;
  siblingDiscountAmount: number;
  totalDiscount: number;
  carryArrears: number;
  totalDue: number;
  lines: AdmissionFeePreviewLine[];
}

export interface AdmissionReviewResult {
  matchType: AdmissionMatchType;
  cnicEntriesCount: number;
  normalizedCnic: string;
  matchedStudents: MatchedStudentRow[];
  duplicateApplications: DuplicateApplicationRow[];
  suggestedLinkedStudentId: string | null;
  totalFamilyOutstanding: number;
  message: string;
  activeSiblingCount: number;
  suggestedSiblingDiscountPercent: number;
  feePreview: AdmissionFeePreview | null;
}

export interface FeeStructureRow {
  monthlyFee: number;
  admissionFee: number;
  securityFee: number;
  examFee: number;
  transportFee: number;
  miscFee: number;
}

export function normalizeCnic(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D/g, "");
}

export function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(na.split(/\s+/).filter(Boolean));
  const tb = new Set(nb.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((t) => { if (tb.has(t)) overlap++; });
  return overlap / Math.max(ta.size, tb.size);
}

export function resolveSiblingDiscountPercent(
  activeSiblingCount: number,
  campusRates?: { second?: number; third?: number },
): number {
  const second = campusRates?.second ?? DEFAULT_SIBLING_DISCOUNT_2ND;
  const third = campusRates?.third ?? DEFAULT_SIBLING_DISCOUNT_3RD;
  if (activeSiblingCount >= 2) return third;
  if (activeSiblingCount >= 1) return second;
  return 0;
}

function dobMatches(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const da = String(a).slice(0, 10);
  const db = String(b).slice(0, 10);
  return da === db;
}

function isStrongNameMatch(nameScore: number): boolean {
  return nameScore >= 0.85;
}

function isExactStudentMatch(
  applicantName: string,
  applicantDob: string | null | undefined,
  studentName: string,
  studentDob: string | null | undefined,
): boolean {
  const nameScore = nameSimilarity(applicantName, studentName);
  if (!isStrongNameMatch(nameScore)) return false;
  const dobOk = dobMatches(applicantDob, studentDob);
  if (dobOk) return true;
  if (!applicantDob || !studentDob) return true;
  if (nameScore >= 0.95) return true;
  return false;
}

export function computeAdmissionFeePreview(
  feeStructure: FeeStructureRow | null,
  options: {
    waiveAdmissionFee?: boolean;
    discountAmount?: number;
    discountPercent?: number;
    siblingDiscountPercent?: number;
    carryArrears?: number;
  },
): AdmissionFeePreview | null {
  if (!feeStructure) return null;

  let tuitionFee = Number(feeStructure.monthlyFee) || 0;
  let admissionFee = options.waiveAdmissionFee ? 0 : (Number(feeStructure.admissionFee) || 0);
  const securityFee = Number(feeStructure.securityFee) || 0;
  const examFee = Number(feeStructure.examFee) || 0;
  const transportFee = Number(feeStructure.transportFee) || 0;
  const miscFee = Number(feeStructure.miscFee) || 0;
  const carryArrears = Number(options.carryArrears) || 0;

  const siblingDiscountPercent = Number(options.siblingDiscountPercent) || 0;
  const siblingDiscountAmount = siblingDiscountPercent > 0
    ? Math.round((tuitionFee * siblingDiscountPercent) / 100)
    : 0;

  const grossSubtotal = tuitionFee + admissionFee + securityFee + examFee + transportFee + miscFee;
  let manualDiscountAmount = Number(options.discountAmount) || 0;
  const manualDiscountPercent = Number(options.discountPercent) || 0;
  if (manualDiscountPercent > 0) {
    manualDiscountAmount += Math.round((grossSubtotal * manualDiscountPercent) / 100);
  }

  const totalDiscount = Math.min(grossSubtotal, siblingDiscountAmount + manualDiscountAmount);
  const totalDue = grossSubtotal - totalDiscount + carryArrears;

  const lines: AdmissionFeePreviewLine[] = [
    { label: "Tuition (monthly)", amount: tuitionFee },
  ];
  if (admissionFee > 0) lines.push({ label: "Admission fee", amount: admissionFee });
  if (securityFee > 0) lines.push({ label: "Security deposit", amount: securityFee });
  if (examFee > 0) lines.push({ label: "Exam fee", amount: examFee });
  if (transportFee > 0) lines.push({ label: "Transport", amount: transportFee });
  if (miscFee > 0) lines.push({ label: "Misc", amount: miscFee });
  if (siblingDiscountAmount > 0) {
    lines.push({ label: `Sibling discount (${siblingDiscountPercent}% on tuition)`, amount: -siblingDiscountAmount });
  }
  if (manualDiscountAmount > 0) {
    const manualLabel = manualDiscountPercent > 0
      ? `Additional discount (${manualDiscountPercent}%)`
      : "Additional discount (Rs.)";
    lines.push({ label: manualLabel, amount: -manualDiscountAmount });
  }
  if (carryArrears > 0) lines.push({ label: "Carried arrears", amount: carryArrears });

  return {
    classAssigned: true,
    tuitionFee,
    admissionFee,
    securityFee,
    examFee,
    transportFee,
    miscFee,
    subtotal: grossSubtotal,
    manualDiscountAmount,
    manualDiscountPercent,
    siblingDiscountPercent,
    siblingDiscountAmount,
    totalDiscount,
    carryArrears,
    totalDue,
    lines: lines.filter((l) => l.amount !== 0),
  };
}

export function classifyAdmissionMatch(
  applicantName: string,
  applicantDob: string | null | undefined,
  matchedStudents: MatchedStudentRow[],
  duplicateApplications: DuplicateApplicationRow[],
): Pick<AdmissionReviewResult, "matchType" | "suggestedLinkedStudentId" | "message"> {
  const pickBestNameMatch = (candidates: MatchedStudentRow[]) =>
    [...candidates].sort((a, b) => b.nameScore - a.nameScore)[0];

  const activeSamePerson = pickBestNameMatch(
    matchedStudents.filter((s) => s.status === "Active" && isStrongNameMatch(s.nameScore)),
  );
  if (activeSamePerson) {
    const dobWarning = applicantDob && activeSamePerson.dateOfBirth && !activeSamePerson.dobMatch
      ? " Date of birth on application differs from student record — please verify."
      : "";
    return {
      matchType: "duplicate_active",
      suggestedLinkedStudentId: activeSamePerson.id,
      message: `${activeSamePerson.firstName} is already an active student (Roll ${activeSamePerson.rollNumber}). Outstanding: Rs. ${activeSamePerson.unpaidBalance.toLocaleString()}. A new admission is not allowed.${dobWarning}`,
    };
  }

  const inactiveSamePerson = pickBestNameMatch(
    matchedStudents.filter(
      (s) => (s.status === "Left" || s.status === "Graduated") && isStrongNameMatch(s.nameScore),
    ),
  );
  if (inactiveSamePerson) {
    const dobWarning = applicantDob && inactiveSamePerson.dateOfBirth && !inactiveSamePerson.dobMatch
      ? " (DOB differs — verify before re-enrolling)"
      : "";
    return {
      matchType: "re_enrollment",
      suggestedLinkedStudentId: inactiveSamePerson.id,
      message: `${inactiveSamePerson.firstName} was previously enrolled here (status: ${inactiveSamePerson.status}, Roll ${inactiveSamePerson.rollNumber}). Outstanding: Rs. ${inactiveSamePerson.unpaidBalance.toLocaleString()}.${dobWarning}`,
    };
  }

  if (matchedStudents.length > 0) {
    const activeCount = matchedStudents.filter((s) => s.status === "Active").length;
    const siblingNames = matchedStudents.map((s) => s.firstName).join(", ");
    return {
      matchType: "sibling",
      suggestedLinkedStudentId: null,
      message: `This CNIC has ${matchedStudents.length} student record(s)${activeCount ? ` (${activeCount} active)` : ""}: ${siblingNames}. Applicant name does not match — this appears to be a new sibling.`,
    };
  }

  if (duplicateApplications.length > 0) {
    return {
      matchType: "duplicate_application",
      suggestedLinkedStudentId: null,
      message: `${duplicateApplications.length} other pending application(s) exist on this CNIC.`,
    };
  }

  return {
    matchType: "new",
    suggestedLinkedStudentId: null,
    message: "No existing student records found for this CNIC. New admission.",
  };
}

async function fetchUnpaidMonthsByStudent(
  pool: sql.ConnectionPool,
  studentIds: string[],
): Promise<Map<string, UnpaidFeeMonth[]>> {
  const map = new Map<string, UnpaidFeeMonth[]>();
  if (studentIds.length === 0) return map;

  const placeholders = studentIds.map((_, i) => `@sid${i}`).join(",");
  const request = pool.request();
  studentIds.forEach((id, i) => request.input(`sid${i}`, id));

  const result = await request.query(`
    SELECT f.student_id AS studentId, f.month, f.year,
           ISNULL(f.balance_amount, 0) AS balanceAmount,
           f.months_label AS monthsLabel
    FROM Fees f
    WHERE f.student_id IN (${placeholders})
      AND ISNULL(f.balance_amount, 0) > 0
      AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
    ORDER BY f.year DESC, f.month DESC
  `);

  for (const row of result.recordset as Array<Record<string, unknown>>) {
    const sid = String(row.studentId);
    const list = map.get(sid) || [];
    list.push({
      month: Number(row.month),
      year: Number(row.year),
      balanceAmount: Number(row.balanceAmount) || 0,
      label: row.monthsLabel ? String(row.monthsLabel) : undefined,
    });
    map.set(sid, list);
  }
  return map;
}

export async function fetchClassFeeStructure(
  pool: sql.ConnectionPool,
  classId: string,
): Promise<FeeStructureRow | null> {
  const feeResult = await pool.request()
    .input("classId", classId)
    .query(`
      SELECT
        ISNULL(fs.monthly_fee, 0) AS monthlyFee,
        ISNULL(fs.admission_fee, 0) AS admissionFee,
        ISNULL(fs.security_fee, 0) AS securityFee,
        ISNULL(fs.exam_fee, 0) AS examFee,
        ISNULL(fs.transport_fee, 0) AS transportFee,
        ISNULL(fs.misc_fee, 0) AS miscFee
      FROM Classes cl
      LEFT JOIN FeeSettings fs ON fs.class_id = cl.id
      WHERE cl.id = @classId
    `);
  const fs = feeResult.recordset[0];
  if (!fs) return null;
  return {
    monthlyFee: Number(fs.monthlyFee) || 0,
    admissionFee: Number(fs.admissionFee) || 0,
    securityFee: Number(fs.securityFee) || 0,
    examFee: Number(fs.examFee) || 0,
    transportFee: Number(fs.transportFee) || 0,
    miscFee: Number(fs.miscFee) || 0,
  };
}

export async function fetchCampusSiblingDiscountRates(
  pool: sql.ConnectionPool,
  campusId: string,
): Promise<{ second: number; third: number }> {
  try {
    const result = await pool.request()
      .input("campusId", campusId)
      .query(`
        SELECT
          ISNULL(sibling_discount_2nd, ${DEFAULT_SIBLING_DISCOUNT_2ND}) AS secondRate,
          ISNULL(sibling_discount_3rd, ${DEFAULT_SIBLING_DISCOUNT_3RD}) AS thirdRate
        FROM Campuses WHERE id = @campusId
      `);
    const row = result.recordset[0];
    if (!row) return { second: DEFAULT_SIBLING_DISCOUNT_2ND, third: DEFAULT_SIBLING_DISCOUNT_3RD };
    return { second: Number(row.secondRate) || DEFAULT_SIBLING_DISCOUNT_2ND, third: Number(row.thirdRate) || DEFAULT_SIBLING_DISCOUNT_3RD };
  } catch {
    return { second: DEFAULT_SIBLING_DISCOUNT_2ND, third: DEFAULT_SIBLING_DISCOUNT_3RD };
  }
}

export async function runAdmissionCnicReview(
  pool: sql.ConnectionPool,
  params: {
    fatherCnic: string;
    applicantName: string;
    dateOfBirth?: string | null;
    excludeApplicationId?: string | null;
    classId?: string | null;
    campusId?: string | null;
    waiveAdmissionFee?: boolean;
    discountAmount?: number;
    discountPercent?: number;
    applySiblingDiscount?: boolean;
    siblingDiscountPercent?: number;
  },
): Promise<AdmissionReviewResult> {
  const normalizedCnic = normalizeCnic(params.fatherCnic);
  if (normalizedCnic.length !== 13) {
    throw new Error("Father CNIC must be 13 digits");
  }

  const studentsResult = await pool.request()
    .input("cnic", normalizedCnic)
    .query(`
      SELECT
        s.id,
        s.student_name AS firstName,
        s.admission_no AS rollNumber,
        s.father_name AS fatherName,
        s.status,
        CONVERT(VARCHAR, s.dob, 23) AS dateOfBirth,
        ISNULL(s.outstanding_fees, 0) AS outstandingFees,
        cl.class_name AS className,
        c.campus_name AS campusName,
        ISNULL((
          SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END)
          FROM Fees f
          WHERE f.student_id = s.id
            AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
        ), 0) AS unpaidBalance
      FROM Students s
      LEFT JOIN Classes cl ON cl.id = s.class_id
      LEFT JOIN Campuses c ON c.id = s.campus_id
      WHERE REPLACE(REPLACE(REPLACE(ISNULL(s.father_cnic, ''), '-', ''), ' ', ''), '.', '') = @cnic
      ORDER BY s.admission_date DESC
    `);

  const studentIds = studentsResult.recordset.map((r: { id: string }) => String(r.id));
  const unpaidMap = await fetchUnpaidMonthsByStudent(pool, studentIds);

  const matchedStudents: MatchedStudentRow[] = studentsResult.recordset.map((row: Record<string, unknown>) => {
    const id = String(row.id);
    const firstName = String(row.firstName || "");
    const nameScore = nameSimilarity(params.applicantName, firstName);
    const dobMatch = dobMatches(params.dateOfBirth, row.dateOfBirth as string);
    const isExactMatch = isExactStudentMatch(
      params.applicantName,
      params.dateOfBirth,
      firstName,
      row.dateOfBirth as string,
    );
    return {
      id,
      firstName,
      rollNumber: String(row.rollNumber || ""),
      fatherName: row.fatherName ? String(row.fatherName) : undefined,
      status: String(row.status || "Active"),
      className: row.className ? String(row.className) : undefined,
      campusName: row.campusName ? String(row.campusName) : undefined,
      dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth) : undefined,
      outstandingFees: Number(row.outstandingFees) || 0,
      unpaidBalance: Number(row.unpaidBalance) || 0,
      unpaidMonths: unpaidMap.get(id) || [],
      nameScore,
      dobMatch,
      isExactMatch,
    };
  });

  const appRequest = pool.request().input("cnic", normalizedCnic);
  let appWhere = `
    REPLACE(REPLACE(REPLACE(ISNULL(a.father_cnic, ''), '-', ''), ' ', ''), '.', '') = @cnic
    AND a.status IN ('Pending', 'Under Review', 'Approved')
  `;
  if (params.excludeApplicationId) {
    appRequest.input("excludeId", params.excludeApplicationId);
    appWhere += " AND a.id <> @excludeId";
  }

  const appsResult = await appRequest.query(`
    SELECT a.id, a.applicant_name AS applicantName, a.status,
           CONVERT(VARCHAR, a.applied_on, 120) AS appliedOn
    FROM AdmissionApplications a
    WHERE ${appWhere}
    ORDER BY a.applied_on DESC
  `);

  const duplicateApplications: DuplicateApplicationRow[] = appsResult.recordset.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    applicantName: String(row.applicantName || ""),
    status: String(row.status || ""),
    appliedOn: row.appliedOn ? String(row.appliedOn) : undefined,
  }));

  const classification = classifyAdmissionMatch(
    params.applicantName,
    params.dateOfBirth,
    matchedStudents,
    duplicateApplications,
  );

  const totalFamilyOutstanding = matchedStudents.reduce((sum, s) => sum + s.unpaidBalance, 0);
  const activeSiblingCount = matchedStudents.filter((s) => s.status === "Active").length;

  let campusRates = { second: DEFAULT_SIBLING_DISCOUNT_2ND, third: DEFAULT_SIBLING_DISCOUNT_3RD };
  if (params.campusId) {
    campusRates = await fetchCampusSiblingDiscountRates(pool, params.campusId);
  }

  const suggestedSiblingDiscountPercent = params.applySiblingDiscount !== false && classification.matchType === "sibling"
    ? resolveSiblingDiscountPercent(activeSiblingCount, campusRates)
    : 0;

  const linkedStudent = classification.suggestedLinkedStudentId
    ? matchedStudents.find((s) => s.id === classification.suggestedLinkedStudentId)
    : null;
  const carryArrears = classification.matchType === "re_enrollment" && linkedStudent
    ? linkedStudent.unpaidBalance
    : 0;

  let feePreview: AdmissionFeePreview | null = null;
  if (params.classId) {
    const feeStructure = await fetchClassFeeStructure(pool, params.classId);
    const siblingPercent = params.applySiblingDiscount !== false && classification.matchType === "sibling"
      ? (params.siblingDiscountPercent ?? suggestedSiblingDiscountPercent)
      : (params.siblingDiscountPercent ?? 0);
    feePreview = computeAdmissionFeePreview(feeStructure, {
      waiveAdmissionFee: params.waiveAdmissionFee,
      discountAmount: params.discountAmount,
      discountPercent: params.discountPercent,
      siblingDiscountPercent: siblingPercent,
      carryArrears,
    });
  }

  return {
    matchType: classification.matchType,
    cnicEntriesCount: matchedStudents.length + duplicateApplications.length,
    normalizedCnic,
    matchedStudents,
    duplicateApplications,
    suggestedLinkedStudentId: classification.suggestedLinkedStudentId,
    totalFamilyOutstanding,
    message: classification.message,
    activeSiblingCount,
    suggestedSiblingDiscountPercent,
    feePreview,
  };
}

export async function createEnrollmentFeeVoucher(
  pool: sql.ConnectionPool,
  studentId: string,
  classId: string,
  options: {
    waiveAdmissionFee?: boolean;
    discountAmount?: number;
    discountPercent?: number;
    siblingDiscountPercent?: number;
    carryArrears?: number;
  },
): Promise<{ feeId: string | null; totalDue: number }> {
  const feeStructure = await fetchClassFeeStructure(pool, classId);
  const preview = computeAdmissionFeePreview(feeStructure, options);
  if (!preview || preview.totalDue <= 0) return { feeId: null, totalDue: 0 };

  const campusResult = await pool.request()
    .input("classId", classId)
    .query(`SELECT c.campus_name AS campusName FROM Classes cl LEFT JOIN Campuses c ON c.id = cl.campus_id WHERE cl.id = @classId`);
  const campusName = campusResult.recordset[0]?.campusName || null;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const dueDate = new Date(year, month - 1, 10).toISOString().split("T")[0];
  const feeType = preview.admissionFee > 0 || preview.securityFee > 0 ? "Admission" : "Monthly";
  const feeId = crypto.randomUUID();
  const amountAfterDiscount = preview.subtotal - preview.totalDiscount;

  await pool.request()
    .input("id", feeId)
    .input("student_id", studentId)
    .input("amount", amountAfterDiscount)
    .input("month", month)
    .input("year", year)
    .input("due_date", dueDate)
    .input("fee_type", feeType)
    .input("tuition_fee", preview.tuitionFee)
    .input("admission_fee", preview.admissionFee)
    .input("security_fee", preview.securityFee)
    .input("exam_fee", preview.examFee)
    .input("transport_fee", preview.transportFee)
    .input("misc_fee", preview.miscFee)
    .input("arrears", preview.carryArrears)
    .input("discount_amount", preview.totalDiscount)
    .input("balance_amount", preview.totalDue)
    .input("campus_name_snapshot", campusName)
    .input("months_label", `Admission — ${month}/${year}`)
    .query(`
      INSERT INTO Fees (
        id, student_id, amount, month, year, status, due_date, fee_type,
        tuition_fee, admission_fee, security_fee, exam_fee, transport_fee, misc_fee,
        arrears, discount_amount, balance_amount, paid_amount, campus_name_snapshot, months_label
      ) VALUES (
        @id, @student_id, @amount, @month, @year, 'Unpaid', @due_date, @fee_type,
        @tuition_fee, @admission_fee, @security_fee, @exam_fee, @transport_fee, @misc_fee,
        @arrears, @discount_amount, @balance_amount, 0, @campus_name_snapshot, @months_label
      )
    `);

  return { feeId, totalDue: preview.totalDue };
}
