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

  const result = await pool.request().query(`
    SELECT
      COUNT(1) AS julyCount,
      SUM(CASE WHEN ISNULL(arrears, 0) > 0 THEN 1 ELSE 0 END) AS julyWithArrears,
      MAX(ISNULL(arrears, 0)) AS maxArrears
    FROM Fees
    WHERE [year] = 2026 AND [month] = 7
  `);
  console.log(JSON.stringify(result.recordset[0], null, 2));
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

