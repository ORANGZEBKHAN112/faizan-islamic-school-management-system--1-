import type { ConnectionPool } from "mssql";

/** Course-selling flow: projection → PO → dispatch → receiving → voucher → issue → adjustment. */
export async function ensureCourseSellingSchema(pool: ConnectionPool): Promise<void> {
  const batches = [
    `IF OBJECT_ID('CourseProjections', 'U') IS NULL
     CREATE TABLE CourseProjections (
       id NVARCHAR(50) PRIMARY KEY,
       academic_session NVARCHAR(30) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       quantity DECIMAL(18, 3) NOT NULL,
       notes NVARCHAR(500) NULL,
       created_by NVARCHAR(50) NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF OBJECT_ID('CourseProjections', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CourseProjections_line' AND object_id = OBJECT_ID('CourseProjections'))
      CREATE UNIQUE INDEX UX_CourseProjections_line
        ON CourseProjections(academic_session, campus_id, class_id, book_id)`,
    `IF OBJECT_ID('CoursePurchaseOrders', 'U') IS NULL
     CREATE TABLE CoursePurchaseOrders (
       id NVARCHAR(50) PRIMARY KEY,
       order_no NVARCHAR(40) NOT NULL,
       academic_session NVARCHAR(30) NOT NULL,
       order_date DATE NOT NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'draft',
       notes NVARCHAR(500) NULL,
       created_by NVARCHAR(50) NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF OBJECT_ID('CoursePurchaseOrders', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CoursePurchaseOrders_no' AND object_id = OBJECT_ID('CoursePurchaseOrders'))
      CREATE UNIQUE INDEX UX_CoursePurchaseOrders_no ON CoursePurchaseOrders(order_no)`,
    `IF OBJECT_ID('CoursePurchaseOrderItems', 'U') IS NULL
     CREATE TABLE CoursePurchaseOrderItems (
       id NVARCHAR(50) PRIMARY KEY,
       po_id NVARCHAR(50) NOT NULL,
       projection_id NVARCHAR(50) NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       quantity DECIMAL(18, 3) NOT NULL,
       unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
       selling_price DECIMAL(18, 2) NOT NULL DEFAULT 0,
       sort_order INT NOT NULL DEFAULT 0,
       CONSTRAINT FK_CoursePOItems_po FOREIGN KEY (po_id) REFERENCES CoursePurchaseOrders(id)
     )`,
    `IF OBJECT_ID('WarehouseDispatches', 'U') IS NULL
     CREATE TABLE WarehouseDispatches (
       id NVARCHAR(50) PRIMARY KEY,
       dispatch_no NVARCHAR(40) NOT NULL,
       po_id NVARCHAR(50) NOT NULL,
       invoice_ref NVARCHAR(100) NULL,
       dispatch_date DATE NOT NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'posted',
       notes NVARCHAR(500) NULL,
       created_by NVARCHAR(50) NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_WhDispatch_po FOREIGN KEY (po_id) REFERENCES CoursePurchaseOrders(id)
     )`,
    `IF OBJECT_ID('WarehouseDispatches', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WarehouseDispatches_no' AND object_id = OBJECT_ID('WarehouseDispatches'))
      CREATE UNIQUE INDEX UX_WarehouseDispatches_no ON WarehouseDispatches(dispatch_no)`,
    `IF OBJECT_ID('WarehouseDispatchItems', 'U') IS NULL
     CREATE TABLE WarehouseDispatchItems (
       id NVARCHAR(50) PRIMARY KEY,
       dispatch_id NVARCHAR(50) NOT NULL,
       po_item_id NVARCHAR(50) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       qty_dispatched DECIMAL(18, 3) NOT NULL,
       unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
       selling_price DECIMAL(18, 2) NOT NULL DEFAULT 0,
       sort_order INT NOT NULL DEFAULT 0,
       CONSTRAINT FK_WhDispatchItems_hdr FOREIGN KEY (dispatch_id) REFERENCES WarehouseDispatches(id)
     )`,
    `IF OBJECT_ID('CampusReceivings', 'U') IS NULL
     CREATE TABLE CampusReceivings (
       id NVARCHAR(50) PRIMARY KEY,
       dispatch_id NVARCHAR(50) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'pending',
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_CampusRecv_dispatch FOREIGN KEY (dispatch_id) REFERENCES WarehouseDispatches(id)
     )`,
    `IF OBJECT_ID('CampusReceivingItems', 'U') IS NULL
     CREATE TABLE CampusReceivingItems (
       id NVARCHAR(50) PRIMARY KEY,
       receiving_id NVARCHAR(50) NOT NULL,
       dispatch_item_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       qty_dispatched DECIMAL(18, 3) NOT NULL,
       qty_received DECIMAL(18, 3) NULL,
       verified BIT NOT NULL DEFAULT 0,
       verified_by NVARCHAR(50) NULL,
       verified_at DATETIME2 NULL,
       sort_order INT NOT NULL DEFAULT 0,
       CONSTRAINT FK_CampusRecvItems_hdr FOREIGN KEY (receiving_id) REFERENCES CampusReceivings(id)
     )`,
    `IF OBJECT_ID('CourseVouchers', 'U') IS NULL
     CREATE TABLE CourseVouchers (
       id NVARCHAR(50) PRIMARY KEY,
       voucher_no NVARCHAR(40) NOT NULL,
       batch_id NVARCHAR(50) NULL,
       kind NVARCHAR(20) NOT NULL,
       mode NVARCHAR(20) NOT NULL,
       student_id NVARCHAR(50) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       store_id NVARCHAR(50) NOT NULL,
       academic_session NVARCHAR(30) NOT NULL,
       pack_id NVARCHAR(50) NULL,
       due_date DATE NULL,
       subtotal DECIMAL(18, 2) NOT NULL DEFAULT 0,
       total DECIMAL(18, 2) NOT NULL DEFAULT 0,
       payment_status NVARCHAR(20) NOT NULL DEFAULT 'unpaid',
       paid_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
       payment_method NVARCHAR(40) NULL,
       payment_ref NVARCHAR(100) NULL,
       paid_at DATETIME2 NULL,
       issue_status NVARCHAR(20) NOT NULL DEFAULT 'not_issued',
       issued_at DATETIME2 NULL,
       issued_by NVARCHAR(50) NULL,
       stock_alert NVARCHAR(500) NULL,
       kuickpay_consumer_number NVARCHAR(18) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'open',
       created_by NVARCHAR(50) NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF OBJECT_ID('CourseVouchers', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CourseVouchers_no' AND object_id = OBJECT_ID('CourseVouchers'))
      CREATE UNIQUE INDEX UX_CourseVouchers_no ON CourseVouchers(voucher_no)`,
    `IF OBJECT_ID('CourseVoucherItems', 'U') IS NULL
     CREATE TABLE CourseVoucherItems (
       id NVARCHAR(50) PRIMARY KEY,
       voucher_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       quantity DECIMAL(18, 3) NOT NULL,
       unit_price DECIMAL(18, 2) NOT NULL,
       unit_cost DECIMAL(18, 4) NOT NULL DEFAULT 0,
       line_total DECIMAL(18, 2) NOT NULL,
       sort_order INT NOT NULL DEFAULT 0,
       CONSTRAINT FK_CourseVoucherItems_v FOREIGN KEY (voucher_id) REFERENCES CourseVouchers(id)
     )`,
    `IF OBJECT_ID('CourseIssues', 'U') IS NULL
     CREATE TABLE CourseIssues (
       id NVARCHAR(50) PRIMARY KEY,
       voucher_id NVARCHAR(50) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       student_id NVARCHAR(50) NOT NULL,
       issued_by NVARCHAR(50) NULL,
       issued_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_CourseIssues_v FOREIGN KEY (voucher_id) REFERENCES CourseVouchers(id)
     )`,
    `IF OBJECT_ID('CourseClassBalances', 'U') IS NULL
     CREATE TABLE CourseClassBalances (
       id NVARCHAR(50) PRIMARY KEY,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       on_hand DECIMAL(18, 3) NOT NULL DEFAULT 0,
       damaged DECIMAL(18, 3) NOT NULL DEFAULT 0,
       updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF OBJECT_ID('CourseClassBalances', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CourseClassBalances' AND object_id = OBJECT_ID('CourseClassBalances'))
      CREATE UNIQUE INDEX UX_CourseClassBalances ON CourseClassBalances(campus_id, class_id, book_id)`,
    `IF OBJECT_ID('CourseStockAdjustments', 'U') IS NULL
     CREATE TABLE CourseStockAdjustments (
       id NVARCHAR(50) PRIMARY KEY,
       adjustment_no NVARCHAR(40) NOT NULL,
       campus_id NVARCHAR(50) NOT NULL,
       class_id NVARCHAR(50) NOT NULL,
       store_id NVARCHAR(50) NOT NULL,
       book_id NVARCHAR(50) NOT NULL,
       adj_type NVARCHAR(30) NOT NULL,
       quantity DECIMAL(18, 3) NOT NULL,
       reason NVARCHAR(500) NOT NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'pending',
       requested_by NVARCHAR(50) NULL,
       approved_by NVARCHAR(50) NULL,
       approved_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF COL_LENGTH('BookStockTransfers', 'reason') IS NULL
      ALTER TABLE BookStockTransfers ADD reason NVARCHAR(500) NULL`,
    `IF COL_LENGTH('BookStockTransferItems', 'class_id') IS NULL
      ALTER TABLE BookStockTransferItems ADD class_id NVARCHAR(50) NULL`,
    `IF OBJECT_ID('CourseMasterLines', 'U') IS NULL
     CREATE TABLE CourseMasterLines (
       id NVARCHAR(50) PRIMARY KEY,
       region_name NVARCHAR(120) NOT NULL,
       class_name NVARCHAR(80) NOT NULL,
       title NVARCHAR(300) NOT NULL,
       publisher NVARCHAR(200) NULL,
       quantity INT NOT NULL DEFAULT 1,
       sort_order INT NOT NULL,
       shared_stationery BIT NOT NULL DEFAULT 0
     )`,
    `IF OBJECT_ID('CourseMasterLines', 'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CourseMasterLines_region' AND object_id = OBJECT_ID('CourseMasterLines'))
      CREATE INDEX IX_CourseMasterLines_region ON CourseMasterLines(region_name, class_name, sort_order)`,
    `IF OBJECT_ID('CourseMasterMeta', 'U') IS NULL
     CREATE TABLE CourseMasterMeta (
       source_name NVARCHAR(80) PRIMARY KEY,
       line_count INT NOT NULL,
       loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF COL_LENGTH('CourseVouchers', 'kuickpay_consumer_number') IS NULL
      ALTER TABLE CourseVouchers ADD kuickpay_consumer_number NVARCHAR(18) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CourseVouchers_kuickpay_cn' AND object_id = OBJECT_ID('CourseVouchers'))
      CREATE UNIQUE INDEX UX_CourseVouchers_kuickpay_cn ON CourseVouchers(kuickpay_consumer_number)
      WHERE kuickpay_consumer_number IS NOT NULL`,
    `IF COL_LENGTH('Students', 'course_issue_status') IS NULL
      ALTER TABLE Students ADD course_issue_status NVARCHAR(20) NULL`,
    `IF COL_LENGTH('Students', 'course_issued_session') IS NULL
      ALTER TABLE Students ADD course_issued_session NVARCHAR(30) NULL`,
    `IF COL_LENGTH('BookPackItems', 'sort_order') IS NULL
      ALTER TABLE BookPackItems ADD sort_order INT NOT NULL CONSTRAINT DF_BookPackItems_sort DEFAULT 0`,
  ];

  for (const q of batches) {
    await pool.request().query(q);
  }
}
