/**
 * Update Working Remarks on FISS NEW ERP ISSUES.xlsx for closed items.
 */
import XLSX from "xlsx";
import fs from "fs";

const PATH = "c:/Users/DELL/Downloads/FISS NEW ERP ISSUES.xlsx";

const REMARKS = {
  26: "Done — Marks Entry page with class/section filters, student list, save/update",
  27: "Done — Books: Region→Campus cascade, book title dropdown, labeled stock fields",
  28: "Done — Principal role available in User Management; campus required for Principal",
  29: "Done — Exam subjects with total/passing marks on exam create",
  30: "Done — Campus form order: State then Region (zones for Balochistan)",
  31: "Done — Admission Voucher generate/print/preview in Admission Management",
  32: "Done — Enroll disabled until admission voucher Paid; server-side enroll gate",
  33: "Done — Admission stats use 16th cut-off (1–16 current month, 17+ next month)",
  34: "Done — Transaction Type column on student fee record / ledger",
  35: "Done — Registration Fee separate head in fee settings / vouchers",
  36: "Done — UI labels use Kuickpay spelling (setup, fees, i18n)",
  37: "Done — Collection reversal via reverse-payment + FeeAuditLog audit trail",
  38: "Done — Partially Paid status with remaining balance / arrears",
  39: "Done — Kuickpay BPS docs + Postman collection + UAT pack shared for process",
  40: "Done — Title-case on blur for admissions, students, campus, staff, users, classes, expenses",
  41: "Done — Admission Reference dropdown saved on student/admission record",
  42: "Done — Pending inquiry toasts in Layout (campus-scoped vs head office)",
  43: "Done — Fee Adjustment API/UI with amount, type, reason, ledger entry",
  44: "Done — Income Reversal in Reports (authorized reverse-payment path)",
  45: "Done — Books Import book list (Excel/CSV) + master catalog; rate auto-fill on title",
  46: "Done — Dashboard campusParams memoized; campus filter reload loop fixed",
  47: "Done — Bulk fee Excel upload (POST /api/import-fees) in Fee Management",
  48: "Done — Admission voucher stores gross + discount_amount (no double discount)",
  49: "Done — Bulk Voucher Generation in Fee Management",
  50: "Done — Collection reversal after payment (reverse-payment)",
  51: "Done — Fee Excel import maps Discount column",
  52: "Done — Account Roll report supports all campuses",
  53: "Done — Voucher Reverse (POST /api/fees/:id/reverse-voucher) + UI",
  54: "Done — Kuickpay/QuickPay reverse callback updates ERP payment status",
  55: "Done — Fee Excel import can mark Paid/Partial from collection columns",
};

const wb = XLSX.readFile(PATH);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
const header = rows[0];
const wrIdx = header.findIndex((h) => String(h).trim().toLowerCase() === "working remarks");
const srIdx = header.findIndex((h) => String(h).trim().toLowerCase().startsWith("sr"));

if (wrIdx < 0 || srIdx < 0) {
  console.error("Could not find Sr. No / Working Remarks columns", header);
  process.exit(1);
}

let updated = 0;
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row.length) continue;
  const sr = Number(row[srIdx]);
  if (!REMARKS[sr]) continue;
  row[wrIdx] = REMARKS[sr];
  updated += 1;
}

const outSheet = XLSX.utils.aoa_to_sheet(rows);
wb.Sheets[wb.SheetNames[0]] = outSheet;
XLSX.writeFile(wb, PATH);

// Also write a repo copy for reference
const repoCopy = "docs/FISS-NEW-ERP-ISSUES-Working-Remarks-updated.xlsx";
fs.mkdirSync("docs", { recursive: true });
XLSX.writeFile(wb, repoCopy);

console.log(`Updated ${updated} Working Remarks rows in ${PATH}`);
console.log(`Repo copy: ${repoCopy}`);
