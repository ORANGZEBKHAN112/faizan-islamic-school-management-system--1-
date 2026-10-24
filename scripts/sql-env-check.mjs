/**
 * Verify .env SQL settings (no password printed). Run with tunnel open if using 14333.
 *   node scripts/sql-env-check.mjs
 */
import "dotenv/config";
import sql from "mssql";

function parseBool(name, fallback) {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

const user = process.env.SQL_USER ?? "";
const password = process.env.SQL_PASSWORD ?? "";
const server = (process.env.SQL_SERVER ?? "127.0.0.1").trim();
const port = parseInt(process.env.SQL_PORT ?? "1433", 10);
const database = (process.env.SQL_DATABASE ?? "").trim();

console.log("--- SQL .env check (password hidden) ---");
console.log("SQL_SERVER:", server);
console.log("SQL_PORT:", port);
console.log("SQL_DATABASE:", database || "(empty)");
console.log("SQL_USER:", user || "(empty)");
console.log("SQL_PASSWORD length:", password.length);
if (password.length && (password !== password.trim() || password.includes("\r"))) {
  console.warn("WARN: password has leading/trailing spaces or CR — fix .env (save as UTF-8).");
}
console.log("SQL_ENCRYPT:", parseBool("SQL_ENCRYPT", true));
console.log("");

if (!database || !user) {
  console.error("Set SQL_DATABASE and SQL_USER in .env");
  process.exit(1);
}

const config = {
  user,
  password,
  server,
  port,
  database,
  options: {
    encrypt: parseBool("SQL_ENCRYPT", true),
    trustServerCertificate: parseBool("SQL_TRUST_SERVER_CERTIFICATE", true),
    enableArithAbort: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 15000,
};

try {
  const pool = await sql.connect(config);
  await pool.request().query("SELECT 1 AS ok");
  console.log("OK — login and database access succeeded.");
  await pool.close();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("FAILED:", msg);
  if (/login failed/i.test(msg)) {
    console.error(`
Login failed usually means:
  1) Wrong password in .env (re-copy from VPS cat .env — not env.production.example)
  2) Tunnel points to wrong SQL host — on VPS run: grep SQL_SERVER .env
     If SQL_SERVER is an IP (not 127.0.0.1), tunnel must forward to THAT host:
       ssh -N -L 14333:THAT_IP:1433 user@VPS_IP
  3) Password with # or $ — wrap in double quotes in .env
  4) SQL_USER on live is not sa — use exact SQL_USER from VPS .env
`);
  }
  process.exit(1);
}
