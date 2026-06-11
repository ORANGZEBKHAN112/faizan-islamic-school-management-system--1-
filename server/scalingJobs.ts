import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import sql from "mssql";

const require = createRequire(import.meta.url);
// archiver CJS default export
const archiver = require("archiver") as (format: string, opts?: { zlib?: { level?: number } }) => import("stream").Duplex & {
  pipe: (dest: fs.WriteStream) => unknown;
  append: (source: Buffer | string, opts: { name: string }) => void;
  finalize: () => Promise<void>;
};

const BATCH_SIZE = 500;
const EXPORT_CHUNK_SIZE = 500;
const exportsDir = path.join(process.cwd(), "wwwroot", "exports");

function deriveAcademicSession(year: number, month = new Date().getMonth() + 1): string {
  if (month >= 4) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

function buildStudentFeeQuery(): string {
  return `
  SELECT 
    s.id AS student_id, 
    s.student_name, 
    cl.class_name, 
    cp.campus_name,
    fs.monthly_fee, 
    fs.admission_fee, 
    fs.security_fee, 
    fs.exam_fee,
    fs.transport_fee,
    fs.misc_fee,
    s.outstanding_fees, 
    s.admission_date,
    ISNULL(arrearsAgg.legacy_arrears, 0) AS legacy_arrears
  FROM Students s
  LEFT JOIN Classes cl ON s.class_id = cl.id
  LEFT JOIN Campuses cp ON s.campus_id = cp.id
  OUTER APPLY (
    SELECT TOP 1
      st.tuition_fee AS monthly_fee,
      st.admission_fee,
      st.security_fee,
      st.exam_fee,
      st.transport_fee,
      st.misc_fee
    FROM FeeStructures st
    WHERE st.campus_id = s.campus_id
      AND st.session = @session
      AND st.class_id IS NULL
  ) fs
  OUTER APPLY (
    SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END) AS legacy_arrears
    FROM Fees f
    WHERE f.student_id = s.id
      AND f.fee_type = 'Arrears'
      AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
  ) arrearsAgg
  WHERE s.status = 'Active'
    AND cp.isActive = 1
`;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export async function ensureScalingSchema(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('FeeGenerationJobs', 'U') IS NULL
    BEGIN
      CREATE TABLE FeeGenerationJobs (
        id NVARCHAR(50) PRIMARY KEY,
        campus_id NVARCHAR(50),
        session NVARCHAR(20),
        year INT NOT NULL,
        months_csv NVARCHAR(100) NOT NULL,
        include_admissions BIT DEFAULT 1,
        include_arrears BIT DEFAULT 1,
        status NVARCHAR(20) DEFAULT 'pending',
        processed_count INT DEFAULT 0,
        total_count INT DEFAULT 0,
        skipped_missing_fee_settings INT DEFAULT 0,
        new_admissions_count INT DEFAULT 0,
        arrears_count INT DEFAULT 0,
        error_message NVARCHAR(MAX),
        run_by NVARCHAR(255),
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME DEFAULT GETDATE()
      );
    END
    ELSE IF OBJECT_ID('FeeGenerationJobs', 'U') IS NOT NULL
      AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeeGenerationJobs') AND name = 'session')
      ALTER TABLE FeeGenerationJobs ADD session NVARCHAR(20);

    IF OBJECT_ID('FeeExportJobs', 'U') IS NULL
    BEGIN
      CREATE TABLE FeeExportJobs (
        id NVARCHAR(50) PRIMARY KEY,
        campus_id NVARCHAR(50),
        year INT,
        month INT,
        status_filter NVARCHAR(30),
        search NVARCHAR(200),
        format NVARCHAR(20) DEFAULT 'csv_zip',
        status NVARCHAR(20) DEFAULT 'pending',
        processed_count INT DEFAULT 0,
        total_count INT DEFAULT 0,
        file_path NVARCHAR(500),
        error_message NVARCHAR(MAX),
        requested_by NVARCHAR(255),
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME DEFAULT GETDATE()
      );
    END

    IF OBJECT_ID('DashboardCampusStats', 'U') IS NULL
    BEGIN
      CREATE TABLE DashboardCampusStats (
        campus_id NVARCHAR(50) NOT NULL,
        active_students INT DEFAULT 0,
        total_collected DECIMAL(18, 2) DEFAULT 0,
        total_outstanding DECIMAL(18, 2) DEFAULT 0,
        defaulters INT DEFAULT 0,
        pending_admissions INT DEFAULT 0,
        exams_scheduled INT DEFAULT 0,
        online_collections DECIMAL(18, 2) DEFAULT 0,
        total_expenses DECIMAL(18, 2) DEFAULT 0,
        refreshed_at DATETIME DEFAULT GETDATE(),
        PRIMARY KEY (campus_id)
      );
    END

    IF OBJECT_ID('FeesArchive', 'U') IS NULL
    BEGIN
      SELECT TOP 0 * INTO FeesArchive FROM Fees;
      ALTER TABLE FeesArchive ADD archived_at DATETIME DEFAULT GETDATE();
    END

    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'IX_Fees_year_month_status_campus'
        AND object_id = OBJECT_ID('Fees')
    )
      CREATE INDEX IX_Fees_year_month_status_campus
        ON Fees(year, month, status)
        INCLUDE (student_id, balance_amount, paid_amount);

    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'IX_Fees_student_id_created'
        AND object_id = OBJECT_ID('Fees')
    )
      CREATE INDEX IX_Fees_student_id_created ON Fees(student_id, created_at DESC);
  `);

  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
}

async function recomputeOutstandingForScope(pool: sql.ConnectionPool, campusId: string | null): Promise<void> {
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

const STUDENT_FEE_QUERY = buildStudentFeeQuery();

export async function runFeeGenerationJob(pool: sql.ConnectionPool, jobId: string): Promise<void> {
  const jobResult = await pool.request()
    .input("id", jobId)
    .query(`SELECT * FROM FeeGenerationJobs WHERE id = @id`);
  const job = jobResult.recordset[0];
  if (!job || job.status !== "pending") return;

  await pool.request()
    .input("id", jobId)
    .query(`UPDATE FeeGenerationJobs SET status = 'running', started_at = GETDATE() WHERE id = @id`);

  const monthsToGenerate = String(job.months_csv || "")
    .split(",")
    .map((m: string) => parseInt(m.trim(), 10))
    .filter((m: number) => m >= 1 && m <= 12);
  const year = job.year;
  const effectiveCampusId = job.campus_id || null;
  const includeAdmissions = Boolean(job.include_admissions);
  const includeArrears = Boolean(job.include_arrears);
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const firstGenerationMonth = [...monthsToGenerate].sort((a, b) => a - b)[0];
  const sessionLabel = job.session
    ? String(job.session)
    : deriveAcademicSession(year, firstGenerationMonth);

  let processedCount = 0;
  let newAdmissionsCount = 0;
  let arrearsCount = 0;
  let skippedMissingFeeSettings = 0;

  try {
    let countQuery = `SELECT COUNT(*) AS total FROM Students s JOIN Campuses cp ON s.campus_id = cp.id WHERE s.status = 'Active' AND cp.isActive = 1`;
    const countReq = pool.request();
    if (effectiveCampusId) {
      countQuery += " AND s.campus_id = @campusId";
      countReq.input("campusId", effectiveCampusId);
    }
    const totalResult = await countReq.query(countQuery);
    const totalCount = totalResult.recordset[0]?.total ?? 0;
    await pool.request()
      .input("id", jobId)
      .input("total", totalCount)
      .query(`UPDATE FeeGenerationJobs SET total_count = @total WHERE id = @id`);

    let offset = 0;
    while (offset < totalCount) {
      let batchQuery = `
        ${STUDENT_FEE_QUERY}
        ${effectiveCampusId ? " AND s.campus_id = @campusId" : ""}
        ORDER BY s.id
        OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY
      `;
      const batchReq = pool.request()
        .input("offset", offset)
        .input("batch", BATCH_SIZE)
        .input("session", sessionLabel);
      if (effectiveCampusId) batchReq.input("campusId", effectiveCampusId);
      const batchResult = await batchReq.query(batchQuery);
      const students = batchResult.recordset;
      if (students.length === 0) break;

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const month of monthsToGenerate) {
          const dueDate = new Date(year, month - 1, 10).toISOString().split("T")[0];
          const monthsLabel = `${monthNames[month]} ${year}`;

          const existingResult = await new sql.Request(transaction)
            .input("m", month)
            .input("y", year)
            .query(`SELECT student_id FROM Fees WHERE month = @m AND year = @y AND fee_type IN ('Monthly', 'Admission')`);
          const existingStudentIds = new Set(
            existingResult.recordset.map((r: { student_id: string }) => r.student_id)
          );

          for (const student of students) {
            if (student.monthly_fee === null) {
              skippedMissingFeeSettings++;
              continue;
            }
            if (existingStudentIds.has(student.student_id)) continue;

            let arrears = 0;
            if (includeArrears && month === firstGenerationMonth && Number(student.legacy_arrears || 0) > 0) {
              arrears = Number(student.legacy_arrears || 0);
              await new sql.Request(transaction)
                .input("sId", student.student_id)
                .query(`
                  UPDATE Fees SET balance_amount = 0, status = 'Carried Forward', payment_method = 'Carried Forward'
                  WHERE student_id = @sId AND fee_type = 'Arrears'
                    AND status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
                    AND ISNULL(balance_amount, 0) > 0
                `);
              arrearsCount++;
            }

            if (includeArrears && month === firstGenerationMonth) {
              const carryForwardDue = Number(student.outstanding_fees || 0);
              if (carryForwardDue > 0) {
                arrears += carryForwardDue;
                await new sql.Request(transaction)
                  .input("studentId", student.student_id)
                  .input("year", year)
                  .input("monthCutoff", firstGenerationMonth)
                  .query(`
                    UPDATE Fees SET balance_amount = 0, status = 'Carried Forward', payment_method = 'Carried Forward'
                    WHERE student_id = @studentId AND fee_type IN ('Monthly', 'Admission', 'Arrears')
                      AND status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
                      AND ISNULL(balance_amount, 0) > 0
                      AND (year < @year OR (year = @year AND month < @monthCutoff))
                  `);
                arrearsCount++;
              }
            }

            let tuitionFee = student.monthly_fee || 0;
            let admissionFee = 0;
            let securityFee = 0;
            let examFee = student.exam_fee || 0;
            let transportFee = student.transport_fee || 0;
            let miscFee = student.misc_fee || 0;
            let feeType = "Monthly";

            if (includeAdmissions && student.admission_date) {
              const admDate = new Date(student.admission_date);
              if (admDate.getMonth() + 1 === month && admDate.getFullYear() === year) {
                admissionFee = student.admission_fee || 0;
                securityFee = student.security_fee || 0;
                feeType = "Admission";
                newAdmissionsCount++;
              }
            }

            const totalAmount = tuitionFee + admissionFee + securityFee + examFee + transportFee + miscFee;
            const id = crypto.randomUUID();

            await new sql.Request(transaction)
              .input("id", id)
              .input("student_id", student.student_id)
              .input("amount", totalAmount)
              .input("month", month)
              .input("year", year)
              .input("due_date", dueDate)
              .input("fee_type", feeType)
              .input("tuition_fee", tuitionFee)
              .input("admission_fee", admissionFee)
              .input("security_fee", securityFee)
              .input("exam_fee", examFee)
              .input("transport_fee", transportFee)
              .input("misc_fee", miscFee)
              .input("arrears", arrears)
              .input("balance_amount", totalAmount + arrears)
              .input("campus_name_snapshot", student.campus_name || null)
              .input("months_label", monthsLabel)
              .query(`
                INSERT INTO Fees (
                  id, student_id, amount, month, year, status, due_date, fee_type,
                  tuition_fee, admission_fee, security_fee, exam_fee, transport_fee, misc_fee, arrears,
                  balance_amount, paid_amount, campus_name_snapshot, months_label
                ) VALUES (
                  @id, @student_id, @amount, @month, @year, 'Unpaid', @due_date, @fee_type,
                  @tuition_fee, @admission_fee, @security_fee, @exam_fee, @transport_fee, @misc_fee, @arrears,
                  @balance_amount, 0, @campus_name_snapshot, @months_label
                )
              `);
            processedCount++;
          }
        }
        await transaction.commit();
      } catch (batchErr) {
        await transaction.rollback();
        throw batchErr;
      }

      offset += BATCH_SIZE;
      await pool.request()
        .input("id", jobId)
        .input("processed", processedCount)
        .input("skipped", skippedMissingFeeSettings)
        .input("admissions", newAdmissionsCount)
        .input("arrears", arrearsCount)
        .query(`
          UPDATE FeeGenerationJobs SET
            processed_count = @processed,
            skipped_missing_fee_settings = @skipped,
            new_admissions_count = @admissions,
            arrears_count = @arrears
          WHERE id = @id
        `);
    }

    await recomputeOutstandingForScope(pool, effectiveCampusId);

    try {
      await pool.request()
        .input("id", crypto.randomUUID())
        .input("run_by", job.run_by)
        .input("campus_id", effectiveCampusId)
        .input("year", year)
        .input("months_csv", job.months_csv)
        .input("processed_count", processedCount)
        .input("skipped_missing_fee_settings", skippedMissingFeeSettings)
        .input("new_admissions_count", newAdmissionsCount)
        .input("arrears_count", arrearsCount)
        .query(`
          INSERT INTO FeeGenerationRuns (
            id, run_on, run_by, campus_id, year, months_csv, processed_count,
            skipped_missing_fee_settings, new_admissions_count, arrears_count
          ) VALUES (
            @id, GETDATE(), @run_by, @campus_id, @year, @months_csv, @processed_count,
            @skipped_missing_fee_settings, @new_admissions_count, @arrears_count
          )
        `);
    } catch {
      // optional log table
    }

    await pool.request()
      .input("id", jobId)
      .input("processed", processedCount)
      .query(`
        UPDATE FeeGenerationJobs SET
          status = 'completed',
          processed_count = @processed,
          finished_at = GETDATE()
        WHERE id = @id
      `);
  } catch (err) {
    await pool.request()
      .input("id", jobId)
      .input("err", err instanceof Error ? err.message : String(err))
      .query(`
        UPDATE FeeGenerationJobs SET status = 'failed', error_message = @err, finished_at = GETDATE()
        WHERE id = @id
      `);
  }
}

function csvEscape(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function runFeeExportJob(pool: sql.ConnectionPool, jobId: string): Promise<void> {
  const jobResult = await pool.request().input("id", jobId).query(`SELECT * FROM FeeExportJobs WHERE id = @id`);
  const job = jobResult.recordset[0];
  if (!job || job.status !== "pending") return;

  await pool.request()
    .input("id", jobId)
    .query(`UPDATE FeeExportJobs SET status = 'running', started_at = GETDATE() WHERE id = @id`);

  try {
    const whereParts: string[] = ["1=1"];
    const countReq = pool.request();
    if (job.campus_id) {
      whereParts.push("s.campus_id = @campusId");
      countReq.input("campusId", job.campus_id);
    }
    if (job.year) {
      whereParts.push("f.year = @year");
      countReq.input("year", job.year);
    }
    if (job.month) {
      whereParts.push("f.month = @month");
      countReq.input("month", job.month);
    }
    if (job.status_filter && job.status_filter !== "all") {
      whereParts.push("f.status = @status");
      countReq.input("status", job.status_filter);
    }
    if (job.search) {
      whereParts.push("(s.student_name LIKE @search OR s.admission_no LIKE @search)");
      countReq.input("search", `%${job.search}%`);
    }

    const whereClause = whereParts.join(" AND ");
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total FROM Fees f
      JOIN Students s ON f.student_id = s.id
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;
    await pool.request().input("id", jobId).input("total", total)
      .query(`UPDATE FeeExportJobs SET total_count = @total WHERE id = @id`);

    const zipName = `vouchers_${jobId}.zip`;
    const zipPath = path.join(exportsDir, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(output);

    const headers = [
      "VoucherId", "RollNumber", "StudentName", "Class", "Campus", "Month", "Year",
      "FeeType", "Amount", "Arrears", "Paid", "Balance", "Status", "DueDate",
    ];

    let offset = 0;
    let chunkIndex = 0;
    while (offset < total) {
      const batchReq = pool.request().input("offset", offset).input("batch", EXPORT_CHUNK_SIZE);
      if (job.campus_id) batchReq.input("campusId", job.campus_id);
      if (job.year) batchReq.input("year", job.year);
      if (job.month) batchReq.input("month", job.month);
      if (job.status_filter && job.status_filter !== "all") batchReq.input("status", job.status_filter);
      if (job.search) batchReq.input("search", `%${job.search}%`);

      const rows = await batchReq.query(`
        SELECT
          f.id, s.admission_no AS rollNumber, s.student_name AS studentName,
          cl.class_name AS className, COALESCE(f.campus_name_snapshot, cp.campus_name) AS campusName,
          f.month, f.year, f.fee_type AS feeType, f.amount, f.arrears,
          f.paid_amount AS paidAmount, f.balance_amount AS balanceAmount,
          f.status, CONVERT(VARCHAR, f.due_date, 23) AS dueDate
        FROM Fees f
        JOIN Students s ON f.student_id = s.id
        LEFT JOIN Classes cl ON s.class_id = cl.id
        LEFT JOIN Campuses cp ON s.campus_id = cp.id
        WHERE ${whereClause}
        ORDER BY f.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @batch ROWS ONLY
      `);

      const lines = [headers.join(",")];
      for (const row of rows.recordset) {
        lines.push([
          row.id, row.rollNumber, row.studentName, row.className, row.campusName,
          row.month, row.year, row.feeType, row.amount, row.arrears,
          row.paidAmount, row.balanceAmount, row.status, row.dueDate,
        ].map(csvEscape).join(","));
      }
      archive.append(Buffer.from(lines.join("\n"), "utf8"), { name: `vouchers_part_${++chunkIndex}.csv` });

      offset += EXPORT_CHUNK_SIZE;
      await pool.request()
        .input("id", jobId)
        .input("processed", Math.min(offset, total))
        .query(`UPDATE FeeExportJobs SET processed_count = @processed WHERE id = @id`);
    }

    await archive.finalize();
    await new Promise<void>((resolve, reject) => {
      output.on("close", () => resolve());
      output.on("error", reject);
    });

    await pool.request()
      .input("id", jobId)
      .input("filePath", `/exports/${zipName}`)
      .input("processed", total)
      .query(`
        UPDATE FeeExportJobs SET
          status = 'completed',
          processed_count = @processed,
          file_path = @filePath,
          finished_at = GETDATE()
        WHERE id = @id
      `);
  } catch (err) {
    await pool.request()
      .input("id", jobId)
      .input("err", err instanceof Error ? err.message : String(err))
      .query(`
        UPDATE FeeExportJobs SET status = 'failed', error_message = @err, finished_at = GETDATE()
        WHERE id = @id
      `);
  }
}

export async function refreshDashboardCampusStats(
  pool: sql.ConnectionPool,
  campusId?: string | null
): Promise<number> {
  const req = pool.request();
  let campusFilter = "";
  if (campusId) {
    campusFilter = "WHERE c.id = @campusId";
    req.input("campusId", campusId);
  }

  await req.query(`
    MERGE DashboardCampusStats AS target
    USING (
      SELECT
        c.id AS campus_id,
        (SELECT COUNT(*) FROM Students s WHERE s.campus_id = c.id AND s.status = 'Active') AS active_students,
        (SELECT ISNULL(SUM(f.paid_amount), 0) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE s.campus_id = c.id) AS total_collected,
        (SELECT ISNULL(SUM(f.balance_amount), 0) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE s.campus_id = c.id AND ISNULL(f.balance_amount, 0) > 0) AS total_outstanding,
        (SELECT COUNT(DISTINCT f.student_id) FROM Fees f JOIN Students s ON f.student_id = s.id WHERE s.campus_id = c.id AND f.status IN ('Unpaid','Partially Paid')) AS defaulters,
        (SELECT COUNT(*) FROM AdmissionApplications a WHERE a.campus_id = c.id AND a.status IN ('Pending','Under Review','Approved')) AS pending_admissions,
        (SELECT COUNT(*) FROM Exams e WHERE e.campus_id = c.id AND MONTH(e.exam_date) = MONTH(GETDATE()) AND YEAR(e.exam_date) = YEAR(GETDATE())) AS exams_scheduled,
        (SELECT ISNULL(SUM(t.amount), 0) FROM Transactions t JOIN Students s ON t.student_id = s.id WHERE s.campus_id = c.id AND t.status = 'Success') AS online_collections,
        (SELECT ISNULL(SUM(e.amount), 0) FROM Expenses e WHERE e.campus_id = c.id) AS total_expenses
      FROM Campuses c
      ${campusFilter}
    ) AS src
    ON target.campus_id = src.campus_id
    WHEN MATCHED THEN UPDATE SET
      active_students = src.active_students,
      total_collected = src.total_collected,
      total_outstanding = src.total_outstanding,
      defaulters = src.defaulters,
      pending_admissions = src.pending_admissions,
      exams_scheduled = src.exams_scheduled,
      online_collections = src.online_collections,
      total_expenses = src.total_expenses,
      refreshed_at = GETDATE()
    WHEN NOT MATCHED THEN INSERT (
      campus_id, active_students, total_collected, total_outstanding, defaulters,
      pending_admissions, exams_scheduled, online_collections, total_expenses, refreshed_at
    ) VALUES (
      src.campus_id, src.active_students, src.total_collected, src.total_outstanding, src.defaulters,
      src.pending_admissions, src.exams_scheduled, src.online_collections, src.total_expenses, GETDATE()
    );
  `);

  const countResult = await pool.request().query(`SELECT COUNT(*) AS n FROM DashboardCampusStats`);
  return countResult.recordset[0]?.n ?? 0;
}

export async function archiveOldFees(pool: sql.ConnectionPool, beforeYear: number): Promise<number> {
  const result = await pool.request()
    .input("beforeYear", beforeYear)
    .query(`
      INSERT INTO FeesArchive
      SELECT f.*, GETDATE() AS archived_at
      FROM Fees f
      WHERE f.year < @beforeYear AND f.status = 'Paid';

      DELETE f FROM Fees f
      WHERE f.year < @beforeYear AND f.status = 'Paid'
        AND EXISTS (SELECT 1 FROM FeesArchive a WHERE a.id = f.id);
    `);
  return Number(result.rowsAffected?.[0] || 0);
}

let workerStarted = false;

export function startScalingWorkers(pool: sql.ConnectionPool): void {
  if (workerStarted) return;
  workerStarted = true;

  const tick = async () => {
    if (!pool.connected) return;
    try {
      const pendingGen = await pool.request().query(`
        SELECT TOP 1 id FROM FeeGenerationJobs WHERE status = 'pending' ORDER BY created_at ASC
      `);
      if (pendingGen.recordset[0]?.id) {
        await runFeeGenerationJob(pool, pendingGen.recordset[0].id);
      }

      const pendingExport = await pool.request().query(`
        SELECT TOP 1 id FROM FeeExportJobs WHERE status = 'pending' ORDER BY created_at ASC
      `);
      if (pendingExport.recordset[0]?.id) {
        await runFeeExportJob(pool, pendingExport.recordset[0].id);
      }
    } catch (err) {
      console.error("Scaling worker tick error:", err);
    }
  };

  setInterval(tick, 3000);

  refreshDashboardCampusStats(pool).catch((err) =>
    console.warn("Initial dashboard stats refresh skipped:", err)
  );
  setInterval(() => {
    refreshDashboardCampusStats(pool).catch((err) =>
      console.warn("Dashboard stats refresh error:", err)
    );
  }, 60 * 60 * 1000);
}
