/**
 * Wipe all application data except Users, AppRoles, and AppRolePermissions.
 *
 * Usage:
 *   # Local (.env)
 *   CONFIRM=YES node scripts/wipe-except-users-roles.mjs
 *
 *   # Live via Backend appsettings.json
 *   CONFIRM=YES TARGET=live node scripts/wipe-except-users-roles.mjs
 *
 *   # Custom connection (PowerShell wrapper sets these)
 *   CONFIRM=YES TARGET=custom SQL_SERVER=... SQL_DATABASE=... SQL_USER=... SQL_PASSWORD=... node scripts/wipe-except-users-roles.mjs
 *
 * Or run:  .\scripts\wipe-except-users-roles.ps1
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import tediousSql from "mssql";

const TARGET = String(process.env.TARGET || "env").toLowerCase();
if (TARGET === "env") {
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

const KEEP = new Set(["Users", "AppRoles", "AppRolePermissions"]);

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

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

async function buildConfig() {
  /** @type {import('mssql').config} */
  let config = {
    user: process.env.SQL_USER || "",
    password: process.env.SQL_PASSWORD || "",
    database: process.env.SQL_DATABASE || "",
    server: process.env.SQL_SERVER || "",
    port: parseInt(process.env.SQL_PORT || "1433", 10),
    options: {
      encrypt: parseBooleanEnv("SQL_ENCRYPT", true),
      trustServerCertificate: parseBooleanEnv("SQL_TRUST_SERVER_CERTIFICATE", true),
      trustedConnection: parseBooleanEnv("SQL_TRUSTED_CONNECTION", false),
      enableArithAbort: true,
    },
    requestTimeout: 300000,
    connectionTimeout: 30000,
  };

  const appSettingsPath = path.join(
    process.cwd(),
    "Backend",
    "FaizanIslamicSchool.WebApi",
    "appsettings.json"
  );

  // TARGET=live → always appsettings. TARGET=custom → env vars only.
  if (TARGET === "live") {
    if (!fs.existsSync(appSettingsPath)) {
      throw new Error("appsettings.json not found for live connection");
    }
    const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));
    const connString = appSettings?.ConnectionStrings?.DefaultConnection;
    if (!connString) throw new Error("DefaultConnection missing in appsettings.json");
    const conn = parseConnectionString(connString);
    config.server = conn.server || conn["data source"] || "";
    config.database = conn.database || conn["initial catalog"] || "";
    config.user = conn["user id"] || conn.uid || "";
    config.password = conn.password || "";
    config.options.encrypt =
      conn.encrypt == null ? true : String(conn.encrypt).toLowerCase() === "true";
    config.options.trustServerCertificate =
      conn.trustservercertificate == null
        ? true
        : String(conn.trustservercertificate).toLowerCase() === "true";
    config.options.trustedConnection = false;
  } else if (TARGET === "env" && (!config.server || !config.database) && fs.existsSync(appSettingsPath)) {
    const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));
    const connString = appSettings?.ConnectionStrings?.DefaultConnection;
    if (connString) {
      const conn = parseConnectionString(connString);
      config.server = config.server || conn.server || conn["data source"] || "";
      config.database = config.database || conn.database || conn["initial catalog"] || "";
      config.user = config.user || conn["user id"] || conn.uid || "";
      config.password = config.password || conn.password || "";
    }
  }

  if (!config.server || !config.database) {
    throw new Error("Missing SQL_SERVER / SQL_DATABASE (or appsettings connection string)");
  }

  let sql = tediousSql;
  const useMsNodeSqlV8 =
    process.env.SQL_DRIVER === "msnodesqlv8" ||
    String(config.server).toLowerCase().includes("localdb");

  if (useMsNodeSqlV8 && process.platform === "win32") {
    sql = (await import("mssql/msnodesqlv8.js")).default;
    config = { ...config, driver: "msnodesqlv8" };
    delete config.port;
  }

  return { sql, config };
}

async function main() {
  if (process.env.CONFIRM !== "YES") {
    console.error(
      "Refusing to run. Set CONFIRM=YES (or use wipe-except-users-roles.ps1)."
    );
    process.exit(1);
  }

  const { sql, config } = await buildConfig();
  console.log(`TARGET=${TARGET} → Connecting to ${config.server} / ${config.database} ...`);
  const pool = await sql.connect(config);

  try {
    const tablesResult = await pool.request().query(`
      SELECT t.name AS tableName
      FROM sys.tables t
      WHERE t.is_ms_shipped = 0
        AND SCHEMA_NAME(t.schema_id) = 'dbo'
      ORDER BY t.name
    `);
    const allTables = tablesResult.recordset.map((r) => r.tableName);
    const wipeTables = allTables.filter((name) => !KEEP.has(name));
    const keepTables = allTables.filter((name) => KEEP.has(name));

    console.log("Keeping:", keepTables.join(", ") || "(none found)");
    console.log("Wiping:", wipeTables.length, "tables");

    const beforeCounts = {};
    for (const name of allTables) {
      const count = await pool.request().query(`SELECT COUNT(1) AS n FROM [${name}]`);
      beforeCounts[name] = count.recordset[0].n;
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const req = new sql.Request(tx);
    req.timeout = 300000;

    try {
      for (const name of wipeTables) {
        await req.query(`ALTER TABLE [${name}] NOCHECK CONSTRAINT ALL`);
      }
      for (const name of keepTables) {
        await req.query(`ALTER TABLE [${name}] NOCHECK CONSTRAINT ALL`);
      }

      for (const name of wipeTables) {
        const before = beforeCounts[name] || 0;
        process.stdout.write(`  DELETE ${name} (${before} rows)... `);
        await req.query(`DELETE FROM [${name}]`);
        console.log("ok");
      }

      for (const name of [...wipeTables, ...keepTables]) {
        await req.query(`ALTER TABLE [${name}] WITH CHECK CHECK CONSTRAINT ALL`);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    const afterCounts = {};
    for (const name of allTables) {
      const count = await pool.request().query(`SELECT COUNT(1) AS n FROM [${name}]`);
      afterCounts[name] = count.recordset[0].n;
    }

    console.log(
      JSON.stringify(
        {
          kept: Object.fromEntries(
            keepTables.map((n) => [n, { before: beforeCounts[n], after: afterCounts[n] }])
          ),
          wipedNonZero: Object.fromEntries(
            wipeTables
              .filter((n) => (beforeCounts[n] || 0) > 0)
              .map((n) => [n, { before: beforeCounts[n], after: afterCounts[n] }])
          ),
          wipedEmptyCount: wipeTables.filter((n) => (beforeCounts[n] || 0) === 0).length,
        },
        null,
        2
      )
    );
    console.log("Done. Users / AppRoles / AppRolePermissions preserved.");
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
