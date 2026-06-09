import fs from "node:fs";
import path from "node:path";
import sql from "mssql";

function parseConnectionString(connectionString) {
  return Object.fromEntries(
    connectionString
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const idx = segment.indexOf("=");
        return [segment.slice(0, idx).trim().toLowerCase(), segment.slice(idx + 1).trim()];
      })
  );
}

async function main() {
  const appSettingsPath = path.join(process.cwd(), "Backend", "FaizanIslamicSchool.WebApi", "appsettings.json");
  const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));
  const conn = parseConnectionString(appSettings.ConnectionStrings.DefaultConnection);

  const pool = await sql.connect({
    server: conn.server,
    database: conn.database,
    user: conn["user id"] || conn.user,
    password: conn.password,
    options: {
      encrypt: String(conn.encrypt).toLowerCase() === "true",
      trustServerCertificate: String(conn.trustservercertificate).toLowerCase() === "true",
    },
  });

  const sample = await pool.request().query(`
    SELECT TOP 1 f.student_id AS studentId
    FROM Fees f
    WHERE f.year = 2026
      AND f.month = 6
      AND f.fee_type IN ('Monthly', 'Admission')
      AND f.status <> 'Paid'
      AND ISNULL(f.balance_amount, 0) > 0
  `);
  if (!sample.recordset[0]) {
    console.log("No unpaid June vouchers found.");
    await pool.close();
    return;
  }

  const studentId = sample.recordset[0].studentId;
  const details = await pool.request().input("studentId", studentId).query(`
    SELECT id, student_name, outstanding_fees
    FROM Students
    WHERE id = @studentId;

    SELECT
      SUM(CASE WHEN ISNULL(balance_amount, 0) > 0 THEN balance_amount ELSE 0 END) AS carryForwardDue
    FROM Fees
    WHERE student_id = @studentId
      AND fee_type IN ('Monthly', 'Admission')
      AND status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
      AND (year < 2026 OR (year = 2026 AND month < 7));
  `);

  console.log(JSON.stringify({
    student: details.recordsets[0][0],
    carryForwardQuery: details.recordsets[1][0],
  }, null, 2));
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

