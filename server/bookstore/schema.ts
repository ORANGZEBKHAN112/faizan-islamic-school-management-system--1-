import type { ConnectionPool } from "mssql";
import { ensureCourseSellingSchema } from "./courseSchema.js";
import { seedCourseMaster } from "./courseMaster.js";

/** Catalog table only — separate batches so a later inventory script cannot block listing books. */
export async function ensureBookCatalog(pool: ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('BookCatalog', 'U') IS NULL
    CREATE TABLE BookCatalog (
      id NVARCHAR(50) PRIMARY KEY,
      title NVARCHAR(300) NOT NULL,
      isbn NVARCHAR(32) NULL,
      barcode NVARCHAR(64) NULL,
      publisher NVARCHAR(200) NULL,
      edition NVARCHAR(80) NULL,
      subject NVARCHAR(120) NULL,
      description NVARCHAR(MAX) NULL,
      unit_of_measure NVARCHAR(30) NOT NULL DEFAULT N'Unit',
      image_url NVARCHAR(500) NULL,
      is_active BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);
  await pool.request().query(`
    IF OBJECT_ID('BookCatalog', 'U') IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookCatalog') AND name = 'unit_of_measure')
        ALTER TABLE BookCatalog ADD unit_of_measure NVARCHAR(30) NOT NULL DEFAULT N'Unit';
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookCatalog') AND name = 'is_active')
        ALTER TABLE BookCatalog ADD is_active BIT NOT NULL DEFAULT 1;
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookCatalog') AND name = 'created_at')
        ALTER TABLE BookCatalog ADD created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookCatalog') AND name = 'updated_at')
        ALTER TABLE BookCatalog ADD updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID('BookCatalog', 'U') IS NOT NULL
    BEGIN
      UPDATE BookCatalog SET isbn = NULL WHERE isbn IS NOT NULL AND LTRIM(RTRIM(isbn)) = N'';
      UPDATE BookCatalog SET barcode = NULL WHERE barcode IS NOT NULL AND LTRIM(RTRIM(barcode)) = N'';
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID('BookCatalog', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookCatalog_isbn' AND object_id = OBJECT_ID('BookCatalog'))
      CREATE UNIQUE INDEX UX_BookCatalog_isbn ON BookCatalog(isbn) WHERE isbn IS NOT NULL;
    IF OBJECT_ID('BookCatalog', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookCatalog_barcode' AND object_id = OBJECT_ID('BookCatalog'))
      CREATE UNIQUE INDEX UX_BookCatalog_barcode ON BookCatalog(barcode) WHERE barcode IS NOT NULL;
  `);
}

/** Book selling & multi-store inventory — SQL Server DDL (idempotent). */
export async function ensureBookstoreSchema(pool: ConnectionPool): Promise<void> {
  await ensureBookCatalog(pool);
  await pool.request().query(`
    IF OBJECT_ID('BookPrices', 'U') IS NULL
    CREATE TABLE BookPrices (
      id NVARCHAR(50) PRIMARY KEY,
      book_id NVARCHAR(50) NOT NULL,
      academic_session NVARCHAR(30) NOT NULL,
      purchase_cost DECIMAL(18, 2) NOT NULL DEFAULT 0,
      selling_price DECIMAL(18, 2) NOT NULL DEFAULT 0,
      effective_from DATE NOT NULL DEFAULT CAST(GETUTCDATE() AS DATE),
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookPrices_book FOREIGN KEY (book_id) REFERENCES BookCatalog(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookPrices_book_session' AND object_id = OBJECT_ID('BookPrices'))
      CREATE UNIQUE INDEX UX_BookPrices_book_session ON BookPrices(book_id, academic_session);

    IF OBJECT_ID('BookSuppliers', 'U') IS NULL
    CREATE TABLE BookSuppliers (
      id NVARCHAR(50) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      contact_person NVARCHAR(120) NULL,
      phone NVARCHAR(40) NULL,
      email NVARCHAR(120) NULL,
      address NVARCHAR(500) NULL,
      is_active BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('BookstoreStores', 'U') IS NULL
    CREATE TABLE BookstoreStores (
      id NVARCHAR(50) PRIMARY KEY,
      store_type NVARCHAR(20) NOT NULL,
      campus_id NVARCHAR(50) NULL,
      name NVARCHAR(200) NOT NULL,
      is_active BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT CK_BookstoreStores_type CHECK (store_type IN ('central', 'campus'))
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookstoreStores_campus' AND object_id = OBJECT_ID('BookstoreStores'))
      CREATE UNIQUE INDEX UX_BookstoreStores_campus ON BookstoreStores(campus_id) WHERE campus_id IS NOT NULL;

    IF OBJECT_ID('BookInventoryBalances', 'U') IS NULL
    CREATE TABLE BookInventoryBalances (
      id NVARCHAR(50) PRIMARY KEY,
      store_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      on_hand DECIMAL(18, 3) NOT NULL DEFAULT 0,
      reserved DECIMAL(18, 3) NOT NULL DEFAULT 0,
      in_transit DECIMAL(18, 3) NOT NULL DEFAULT 0,
      damaged DECIMAL(18, 3) NOT NULL DEFAULT 0,
      avg_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
      updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookInvBal_store FOREIGN KEY (store_id) REFERENCES BookstoreStores(id),
      CONSTRAINT FK_BookInvBal_book FOREIGN KEY (book_id) REFERENCES BookCatalog(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookInvBal_store_book' AND object_id = OBJECT_ID('BookInventoryBalances'))
      CREATE UNIQUE INDEX UX_BookInvBal_store_book ON BookInventoryBalances(store_id, book_id);

    IF OBJECT_ID('BookInventoryLedger', 'U') IS NULL
    CREATE TABLE BookInventoryLedger (
      id NVARCHAR(50) PRIMARY KEY,
      store_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      campus_id NVARCHAR(50) NULL,
      txn_type NVARCHAR(40) NOT NULL,
      qty_delta DECIMAL(18, 3) NOT NULL,
      unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
      doc_type NVARCHAR(40) NOT NULL,
      doc_id NVARCHAR(50) NOT NULL,
      reason NVARCHAR(500) NULL,
      performed_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BookInventoryLedger_store_book' AND object_id = OBJECT_ID('BookInventoryLedger'))
      CREATE INDEX IX_BookInventoryLedger_store_book ON BookInventoryLedger(store_id, book_id, created_at DESC);

    IF OBJECT_ID('BookPacks', 'U') IS NULL
    CREATE TABLE BookPacks (
      id NVARCHAR(50) PRIMARY KEY,
      campus_id NVARCHAR(50) NOT NULL,
      class_id NVARCHAR(50) NOT NULL,
      academic_session NVARCHAR(30) NOT NULL,
      name NVARCHAR(200) NOT NULL,
      description NVARCHAR(500) NULL,
      pack_discount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      is_active BIT NOT NULL DEFAULT 1,
      copied_from_id NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('BookPackItems', 'U') IS NULL
    CREATE TABLE BookPackItems (
      id NVARCHAR(50) PRIMARY KEY,
      pack_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      CONSTRAINT FK_BookPackItems_pack FOREIGN KEY (pack_id) REFERENCES BookPacks(id) ON DELETE CASCADE,
      CONSTRAINT FK_BookPackItems_book FOREIGN KEY (book_id) REFERENCES BookCatalog(id)
    );

    IF OBJECT_ID('BookPurchaseOrders', 'U') IS NULL
    CREATE TABLE BookPurchaseOrders (
      id NVARCHAR(50) PRIMARY KEY,
      supplier_id NVARCHAR(50) NOT NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'draft',
      order_date DATE NULL,
      notes NVARCHAR(500) NULL,
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookPO_supplier FOREIGN KEY (supplier_id) REFERENCES BookSuppliers(id)
    );

    IF OBJECT_ID('BookPurchaseOrderItems', 'U') IS NULL
    CREATE TABLE BookPurchaseOrderItems (
      id NVARCHAR(50) PRIMARY KEY,
      po_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      qty_ordered DECIMAL(18, 3) NOT NULL,
      qty_received DECIMAL(18, 3) NOT NULL DEFAULT 0,
      unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
      CONSTRAINT FK_BookPOItems_po FOREIGN KEY (po_id) REFERENCES BookPurchaseOrders(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookGoodsReceipts', 'U') IS NULL
    CREATE TABLE BookGoodsReceipts (
      id NVARCHAR(50) PRIMARY KEY,
      po_id NVARCHAR(50) NULL,
      supplier_id NVARCHAR(50) NULL,
      store_id NVARCHAR(50) NOT NULL,
      invoice_ref NVARCHAR(100) NULL,
      receipt_date DATE NOT NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'draft',
      notes NVARCHAR(500) NULL,
      posted_at DATETIME2 NULL,
      posted_by NVARCHAR(50) NULL,
      idempotency_key NVARCHAR(80) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookGRN_store FOREIGN KEY (store_id) REFERENCES BookstoreStores(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookGRN_idempotency' AND object_id = OBJECT_ID('BookGoodsReceipts'))
      CREATE UNIQUE INDEX UX_BookGRN_idempotency ON BookGoodsReceipts(idempotency_key) WHERE idempotency_key IS NOT NULL;

    IF OBJECT_ID('BookGoodsReceiptItems', 'U') IS NULL
    CREATE TABLE BookGoodsReceiptItems (
      id NVARCHAR(50) PRIMARY KEY,
      grn_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      qty_received DECIMAL(18, 3) NOT NULL,
      qty_damaged DECIMAL(18, 3) NOT NULL DEFAULT 0,
      unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
      CONSTRAINT FK_BookGRNItems_grn FOREIGN KEY (grn_id) REFERENCES BookGoodsReceipts(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookStockTransfers', 'U') IS NULL
    CREATE TABLE BookStockTransfers (
      id NVARCHAR(50) PRIMARY KEY,
      from_store_id NVARCHAR(50) NOT NULL,
      to_store_id NVARCHAR(50) NOT NULL,
      academic_session NVARCHAR(30) NULL,
      status NVARCHAR(30) NOT NULL DEFAULT 'draft',
      notes NVARCHAR(500) NULL,
      created_by NVARCHAR(50) NULL,
      submitted_at DATETIME2 NULL,
      approved_at DATETIME2 NULL,
      approved_by NVARCHAR(50) NULL,
      dispatched_at DATETIME2 NULL,
      dispatched_by NVARCHAR(50) NULL,
      received_at DATETIME2 NULL,
      received_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookXfer_from FOREIGN KEY (from_store_id) REFERENCES BookstoreStores(id),
      CONSTRAINT FK_BookXfer_to FOREIGN KEY (to_store_id) REFERENCES BookstoreStores(id)
    );

    IF OBJECT_ID('BookStockTransferItems', 'U') IS NULL
    CREATE TABLE BookStockTransferItems (
      id NVARCHAR(50) PRIMARY KEY,
      transfer_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      qty_requested DECIMAL(18, 3) NOT NULL,
      qty_dispatched DECIMAL(18, 3) NOT NULL DEFAULT 0,
      qty_received DECIMAL(18, 3) NOT NULL DEFAULT 0,
      CONSTRAINT FK_BookXferItems_xfer FOREIGN KEY (transfer_id) REFERENCES BookStockTransfers(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookSales', 'U') IS NULL
    CREATE TABLE BookSales (
      id NVARCHAR(50) PRIMARY KEY,
      invoice_no NVARCHAR(40) NOT NULL,
      student_id NVARCHAR(50) NOT NULL,
      campus_id NVARCHAR(50) NOT NULL,
      store_id NVARCHAR(50) NOT NULL,
      academic_session NVARCHAR(30) NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'posted',
      subtotal DECIMAL(18, 2) NOT NULL DEFAULT 0,
      discount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total DECIMAL(18, 2) NOT NULL DEFAULT 0,
      paid_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      payment_status NVARCHAR(20) NOT NULL DEFAULT 'unpaid',
      idempotency_key NVARCHAR(80) NULL,
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookSales_store FOREIGN KEY (store_id) REFERENCES BookstoreStores(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookSales_invoice' AND object_id = OBJECT_ID('BookSales'))
      CREATE UNIQUE INDEX UX_BookSales_invoice ON BookSales(invoice_no);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookSales_idempotency' AND object_id = OBJECT_ID('BookSales'))
      CREATE UNIQUE INDEX UX_BookSales_idempotency ON BookSales(idempotency_key) WHERE idempotency_key IS NOT NULL;

    IF OBJECT_ID('BookSaleItems', 'U') IS NULL
    CREATE TABLE BookSaleItems (
      id NVARCHAR(50) PRIMARY KEY,
      sale_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      pack_id NVARCHAR(50) NULL,
      quantity DECIMAL(18, 3) NOT NULL,
      unit_price DECIMAL(18, 2) NOT NULL,
      unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
      line_total DECIMAL(18, 2) NOT NULL,
      CONSTRAINT FK_BookSaleItems_sale FOREIGN KEY (sale_id) REFERENCES BookSales(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookSalePayments', 'U') IS NULL
    CREATE TABLE BookSalePayments (
      id NVARCHAR(50) PRIMARY KEY,
      sale_id NVARCHAR(50) NOT NULL,
      amount DECIMAL(18, 2) NOT NULL,
      payment_method NVARCHAR(40) NOT NULL,
      transaction_ref NVARCHAR(100) NULL,
      paid_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      recorded_by NVARCHAR(50) NULL,
      CONSTRAINT FK_BookSalePayments_sale FOREIGN KEY (sale_id) REFERENCES BookSales(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookReturns', 'U') IS NULL
    CREATE TABLE BookReturns (
      id NVARCHAR(50) PRIMARY KEY,
      sale_id NVARCHAR(50) NOT NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'posted',
      reason NVARCHAR(500) NULL,
      refund_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      restock_approved BIT NOT NULL DEFAULT 0,
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookReturns_sale FOREIGN KEY (sale_id) REFERENCES BookSales(id)
    );

    IF OBJECT_ID('BookReturnItems', 'U') IS NULL
    CREATE TABLE BookReturnItems (
      id NVARCHAR(50) PRIMARY KEY,
      return_id NVARCHAR(50) NOT NULL,
      sale_item_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      quantity DECIMAL(18, 3) NOT NULL,
      condition_code NVARCHAR(30) NOT NULL DEFAULT 'good',
      restock_qty DECIMAL(18, 3) NOT NULL DEFAULT 0,
      CONSTRAINT FK_BookReturnItems_return FOREIGN KEY (return_id) REFERENCES BookReturns(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookstoreSequences', 'U') IS NULL
    CREATE TABLE BookstoreSequences (
      seq_key NVARCHAR(50) PRIMARY KEY,
      next_val INT NOT NULL DEFAULT 1,
      updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('BookStockReservations', 'U') IS NULL
    CREATE TABLE BookStockReservations (
      id NVARCHAR(50) PRIMARY KEY,
      reservation_key NVARCHAR(80) NULL,
      store_id NVARCHAR(50) NOT NULL,
      student_id NVARCHAR(50) NULL,
      academic_session NVARCHAR(30) NULL,
      pack_id NVARCHAR(50) NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'active',
      expires_at DATETIME2 NOT NULL,
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_BookRes_store FOREIGN KEY (store_id) REFERENCES BookstoreStores(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookStockReservations_key' AND object_id = OBJECT_ID('BookStockReservations'))
      CREATE UNIQUE INDEX UX_BookStockReservations_key ON BookStockReservations(reservation_key) WHERE reservation_key IS NOT NULL;

    IF OBJECT_ID('BookStockReservationItems', 'U') IS NULL
    CREATE TABLE BookStockReservationItems (
      id NVARCHAR(50) PRIMARY KEY,
      reservation_id NVARCHAR(50) NOT NULL,
      book_id NVARCHAR(50) NOT NULL,
      quantity DECIMAL(18, 3) NOT NULL,
      CONSTRAINT FK_BookResItems_res FOREIGN KEY (reservation_id) REFERENCES BookStockReservations(id) ON DELETE CASCADE
    );

    IF OBJECT_ID('BookSaleItems', 'U') IS NOT NULL
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookSaleItems') AND name = 'academic_session')
        ALTER TABLE BookSaleItems ADD academic_session NVARCHAR(30) NULL;
    END
  `);
  await ensureBookstorePhase3(pool);
  await ensureCourseSellingSchema(pool);
  await seedCourseMaster(pool);
}

/** Returns, refunds, and sale reversal columns. Separate batches from base DDL. */
export async function ensureBookstorePhase3(pool: ConnectionPool): Promise<void> {
  const alters = [
    `IF OBJECT_ID('BookSales', 'U') IS NOT NULL AND COL_LENGTH('BookSales', 'reservation_id') IS NULL
      ALTER TABLE BookSales ADD reservation_id NVARCHAR(50) NULL`,
    `IF OBJECT_ID('BookSales', 'U') IS NOT NULL AND COL_LENGTH('BookSales', 'cancel_reason') IS NULL
      ALTER TABLE BookSales ADD cancel_reason NVARCHAR(500) NULL`,
    `IF OBJECT_ID('BookSales', 'U') IS NOT NULL AND COL_LENGTH('BookSales', 'cancelled_at') IS NULL
      ALTER TABLE BookSales ADD cancelled_at DATETIME2 NULL`,
    `IF OBJECT_ID('BookSales', 'U') IS NOT NULL AND COL_LENGTH('BookSales', 'cancelled_by') IS NULL
      ALTER TABLE BookSales ADD cancelled_by NVARCHAR(50) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'return_no') IS NULL
      ALTER TABLE BookReturns ADD return_no NVARCHAR(40) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'store_id') IS NULL
      ALTER TABLE BookReturns ADD store_id NVARCHAR(50) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'campus_id') IS NULL
      ALTER TABLE BookReturns ADD campus_id NVARCHAR(50) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'idempotency_key') IS NULL
      ALTER TABLE BookReturns ADD idempotency_key NVARCHAR(80) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'submitted_at') IS NULL
      ALTER TABLE BookReturns ADD submitted_at DATETIME2 NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'approved_by') IS NULL
      ALTER TABLE BookReturns ADD approved_by NVARCHAR(50) NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'approved_at') IS NULL
      ALTER TABLE BookReturns ADD approved_at DATETIME2 NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'posted_at') IS NULL
      ALTER TABLE BookReturns ADD posted_at DATETIME2 NULL`,
    `IF OBJECT_ID('BookReturns', 'U') IS NOT NULL AND COL_LENGTH('BookReturns', 'posted_by') IS NULL
      ALTER TABLE BookReturns ADD posted_by NVARCHAR(50) NULL`,
  ];
  for (const q of alters) await pool.request().query(q);

  await pool.request().query(`
    IF OBJECT_ID('BookReturns', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookReturns_idempotency' AND object_id = OBJECT_ID('BookReturns'))
      CREATE UNIQUE INDEX UX_BookReturns_idempotency ON BookReturns(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);

  await pool.request().query(`
    IF OBJECT_ID('BookRefunds', 'U') IS NULL
    CREATE TABLE BookRefunds (
      id NVARCHAR(50) PRIMARY KEY,
      sale_id NVARCHAR(50) NOT NULL,
      return_id NVARCHAR(50) NULL,
      amount DECIMAL(18, 2) NOT NULL,
      payment_method NVARCHAR(40) NOT NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'requested',
      transaction_ref NVARCHAR(100) NULL,
      idempotency_key NVARCHAR(80) NULL,
      created_by NVARCHAR(50) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      completed_by NVARCHAR(50) NULL,
      completed_at DATETIME2 NULL,
      CONSTRAINT FK_BookRefunds_sale FOREIGN KEY (sale_id) REFERENCES BookSales(id)
    );
    IF OBJECT_ID('BookRefunds', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BookRefunds_idempotency' AND object_id = OBJECT_ID('BookRefunds'))
      CREATE UNIQUE INDEX UX_BookRefunds_idempotency ON BookRefunds(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
}

/** Central warehouse + one store per campus. */
export async function seedBookstoreStores(pool: ConnectionPool): Promise<void> {
  const central = await pool.request().query(`
    SELECT id FROM BookstoreStores WHERE store_type = 'central' AND campus_id IS NULL
  `);
  if (central.recordset.length === 0) {
    await pool.request().query(`
      INSERT INTO BookstoreStores (id, store_type, campus_id, name, is_active)
      VALUES ('store-central', 'central', NULL, N'Central Book Warehouse', 1)
    `);
  }

  const campuses = await pool.request().query(`SELECT id, campus_name FROM Campuses WHERE isActive = 1`);
  for (const c of campuses.recordset) {
    const campusId = String(c.id);
    const name = String(c.campus_name || "Campus Store");
    const existing = await pool.request()
      .input("campusId", campusId)
      .query(`SELECT id FROM BookstoreStores WHERE campus_id = @campusId`);
    if (existing.recordset.length === 0) {
      const id = `store-campus-${campusId}`;
      await pool.request()
        .input("id", id)
        .input("campusId", campusId)
        .input("name", `${name} Bookstore`)
        .query(`
          INSERT INTO BookstoreStores (id, store_type, campus_id, name, is_active)
          VALUES (@id, 'campus', @campusId, @name, 1)
        `);
    }
  }
}
