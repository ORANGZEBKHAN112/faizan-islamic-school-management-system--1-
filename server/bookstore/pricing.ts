import type { ConnectionPool } from "mssql";

export type BookPriceRow = {
  bookId: string;
  academicSession: string;
  sellingPrice: number;
  purchaseCost: number;
  effectiveFrom: string | null;
};

export class BookPricingError extends Error {
  code: "MISSING_PRICE" | "INVALID_SESSION" | "CONFLICT";
  details?: unknown;
  constructor(code: BookPricingError["code"], message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function assertValidSessionLabel(session: string): string {
  const s = String(session || "").trim();
  if (!/^\d{4}-\d{4}$/.test(s)) {
    throw new BookPricingError("INVALID_SESSION", "Academic session must be in YYYY-YYYY format");
  }
  return s;
}

/** Exact session match only — no fallback to other sessions. */
export async function resolveBookPricesForSession(
  pool: ConnectionPool,
  academicSession: string,
  bookIds: string[]
): Promise<Map<string, BookPriceRow>> {
  const session = assertValidSessionLabel(academicSession);
  const ids = [...new Set(bookIds.filter(Boolean))];
  const map = new Map<string, BookPriceRow>();
  if (ids.length === 0) return map;

  const request = pool.request().input("session", session);
  ids.forEach((id, i) => request.input(`b${i}`, id));
  const inList = ids.map((_, i) => `@b${i}`).join(", ");
  const rows = await request.query(`
    SELECT book_id AS bookId, academic_session AS academicSession,
           selling_price AS sellingPrice, purchase_cost AS purchaseCost,
           CONVERT(VARCHAR(10), effective_from, 23) AS effectiveFrom
    FROM BookPrices
    WHERE academic_session = @session AND book_id IN (${inList})
  `);

  for (const row of rows.recordset) {
    map.set(String(row.bookId), {
      bookId: String(row.bookId),
      academicSession: String(row.academicSession),
      sellingPrice: Number(row.sellingPrice),
      purchaseCost: Number(row.purchaseCost),
      effectiveFrom: row.effectiveFrom ? String(row.effectiveFrom) : null,
    });
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new BookPricingError(
      "MISSING_PRICE",
      `No price configured for academic session ${session}`,
      { academicSession: session, missingBookIds: missing }
    );
  }

  return map;
}
