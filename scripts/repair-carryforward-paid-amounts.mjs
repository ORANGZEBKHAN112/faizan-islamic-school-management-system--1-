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

function paidFromHistory(raw) {
  try {
    const history = JSON.parse(raw || "[]");
    if (!Array.isArray(history)) return 0;
    return history.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
  } catch {
    return 0;
  }
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

  const before = await pool.request().query(`
    SELECT
      COUNT(1) AS affectedVouchers,
      ISNULL(SUM(paid_amount), 0) AS inflatedCollected
    FROM Fees
    WHERE ISNULL(paid_amount, 0) > 0
      AND (
        status = 'Carried Forward'
        OR payment_method IN ('Carried Forward', 'System Adjustment')
      )
  `);

  const candidates = await pool.request().query(`
    SELECT id, payment_history
    FROM Fees
    WHERE ISNULL(paid_amount, 0) > 0
      AND (
        status = 'Carried Forward'
        OR payment_method IN ('Carried Forward', 'System Adjustment')
      )
  `);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const row of candidates.recordset) {
      const actualPaid = paidFromHistory(row.payment_history);
      await new sql.Request(tx)
        .input("id", row.id)
        .input("paidAmount", actualPaid)
        .query(`
          UPDATE Fees
          SET
            paid_amount = @paidAmount,
            balance_amount = 0,
            status = 'Carried Forward',
            payment_method = 'Carried Forward',
            payment_date = CASE WHEN @paidAmount > 0 THEN payment_date ELSE NULL END
          WHERE id = @id
        `);
    }

    await new sql.Request(tx).query(`
      UPDATE s
      SET outstanding_fees = ISNULL(agg.totalOutstanding, 0)
      FROM Students s
      OUTER APPLY (
        SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END) AS totalOutstanding
        FROM Fees f
        WHERE f.student_id = s.id
          AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
      ) agg
    `);

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  const after = await pool.request().query(`
    SELECT
      COUNT(1) AS affectedVouchers,
      ISNULL(SUM(paid_amount), 0) AS remainingCollected
    FROM Fees
    WHERE ISNULL(paid_amount, 0) > 0
      AND (
        status = 'Carried Forward'
        OR payment_method IN ('Carried Forward', 'System Adjustment')
      )
  `);

  console.log(JSON.stringify({
    before: before.recordset[0],
    repairedCount: candidates.recordset.length,
    after: after.recordset[0],
  }, null, 2));
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
