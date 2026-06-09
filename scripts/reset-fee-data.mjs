import fs from "node:fs";
import path from "node:path";
import sql from "mssql";

function parseConnectionString(connectionString) {
  const pairs = connectionString
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const idx = segment.indexOf("=");
      const key = segment.slice(0, idx).trim().toLowerCase();
      const value = segment.slice(idx + 1).trim();
      return [key, value];
    });
  return Object.fromEntries(pairs);
}

async function main() {
  const appSettingsPath = path.join(
    process.cwd(),
    "Backend",
    "FaizanIslamicSchool.WebApi",
    "appsettings.json"
  );
  const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));
  const conn = parseConnectionString(appSettings.ConnectionStrings.DefaultConnection);

  const config = {
    server: conn.server,
    database: conn.database,
    user: conn["user id"] || conn.user,
    password: conn.password,
    options: {
      encrypt: String(conn.encrypt).toLowerCase() === "true",
      trustServerCertificate: String(conn.trustservercertificate).toLowerCase() === "true",
    },
  };

  const pool = await sql.connect(config);
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const req = new sql.Request(tx);
    const before = await req.query(`
      SELECT
        (SELECT COUNT(1) FROM Fees) AS feesCount,
        (SELECT COUNT(1) FROM Transactions) AS txCount,
        (SELECT COUNT(1) FROM FeeGenerationRuns) AS runCount
    `);

    await req.query("DELETE FROM Transactions");
    await req.query("DELETE FROM Fees");
    await req.query("IF OBJECT_ID('FeeGenerationRuns', 'U') IS NOT NULL DELETE FROM FeeGenerationRuns");
    await req.query("UPDATE Students SET outstanding_fees = 0");

    const after = await req.query(`
      SELECT
        (SELECT COUNT(1) FROM Fees) AS feesCount,
        (SELECT COUNT(1) FROM Transactions) AS txCount,
        (SELECT COUNT(1) FROM FeeGenerationRuns) AS runCount,
        (SELECT COUNT(1) FROM Students WHERE ISNULL(outstanding_fees, 0) != 0) AS studentsNonZeroOutstanding
    `);

    await tx.commit();
    console.log(JSON.stringify({ before: before.recordset[0], after: after.recordset[0] }));
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

