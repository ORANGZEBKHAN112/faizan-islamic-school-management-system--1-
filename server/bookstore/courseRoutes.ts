import type { Express, Response } from "express";
import { BookPricingError } from "./pricing.js";
import { ensureBookstoreSchema, seedBookstoreStores } from "./schema.js";
import {
  CourseFlowError,
  approveStockAdjustment,
  courseDashboard,
  courseExceptions,
  createCourseVouchers,
  createPurchaseOrder,
  createStockAdjustment,
  issueCourseVoucher,
  listAdjustments,
  listClassInventory,
  listCourseVouchers,
  listDispatches,
  listProjections,
  listPurchaseOrders,
  listReceiving,
  listStockHistory,
  postWarehouseDispatch,
  reconciliationReport,
  recordVoucherPayment,
  reportInventory,
  reportIssuance,
  reportProjection,
  reportSales,
  reportTransfers,
  saveProjection,
  verifyReceivingItem,
} from "./courseFlow.js";
import { applyCourseMasterToCampus, listCourseMaster } from "./courseMaster.js";
import type { BookstoreRouteDeps } from "./routes.js";

let schemaReady = false;

function sendCourseError(
  res: Response,
  err: unknown,
  sendServerError: BookstoreRouteDeps["sendServerError"],
  context: string
) {
  if (err instanceof CourseFlowError) {
    res.status(err.status).json({ message: err.message, code: err.code });
    return;
  }
  if (err instanceof BookPricingError) {
    res.status(err.code === "MISSING_PRICE" ? 422 : 400).json({ message: err.message, code: err.code, details: err.details });
    return;
  }
  sendServerError(res, err, context);
}

export function registerCourseSellingRoutes(app: Express, deps: BookstoreRouteDeps): void {
  const { getPool, connectToDb, loadAuthUser, requireBookstore, sendServerError, isSuperAdminRole } = deps;
  const v = requireBookstore("view");
  const c = requireBookstore("create");
  const u = requireBookstore("update");

  async function pool() {
    if (!getPool()?.connected) await connectToDb();
    const db = getPool();
    if (!db) return null;
    if (!schemaReady) {
      await ensureBookstoreSchema(db);
      await seedBookstoreStores(db);
      schemaReady = true;
    }
    return db;
  }

  app.get("/api/bookstore/course/dashboard", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const campusId = req.query.campusId ? String(req.query.campusId) : undefined;
      res.json(await courseDashboard(db, campusId));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading course dashboard");
    }
  });

  app.get("/api/bookstore/course/exceptions", v, async (_req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await courseExceptions(db));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading exceptions");
    }
  });

  app.get("/api/bookstore/course/projections", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listProjections(
        db,
        req.query.academicSession ? String(req.query.academicSession) : undefined,
        req.query.campusId ? String(req.query.campusId) : undefined
      ));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading projections");
    }
  });

  app.post("/api/bookstore/course/projections", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const saved = await saveProjection(db, {
        academicSession: body.academicSession,
        campusId: body.campusId,
        classId: body.classId,
        bookId: body.bookId,
        quantity: Number(body.quantity),
        notes: body.notes,
        createdBy: auth.id,
      });
      res.status(201).json(saved);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error saving projection");
    }
  });

  app.get("/api/bookstore/course/purchase-orders", v, async (_req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listPurchaseOrders(db));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading purchase orders");
    }
  });

  app.post("/api/bookstore/course/purchase-orders", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const created = await createPurchaseOrder(db, {
        projectionIds: req.body?.projectionIds || [],
        notes: req.body?.notes,
        createdBy: auth.id,
      });
      res.status(201).json(created);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error creating purchase order");
    }
  });

  app.get("/api/bookstore/course/dispatches", v, async (_req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listDispatches(db));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading dispatches");
    }
  });

  app.post("/api/bookstore/course/dispatches", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const created = await postWarehouseDispatch(db, {
        poId: body.poId,
        invoiceRef: body.invoiceRef,
        dispatchDate: body.dispatchDate,
        notes: body.notes,
        items: body.items || [],
        createdBy: auth.id,
      });
      res.status(201).json(created);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error posting warehouse dispatch");
    }
  });

  app.get("/api/bookstore/course/receiving", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listReceiving(db, req.query.campusId ? String(req.query.campusId) : undefined));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading campus receiving");
    }
  });

  app.post("/api/bookstore/course/receiving/:itemId/verify", u, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const result = await verifyReceivingItem(db, {
        itemId: String(req.params.itemId),
        qtyReceived: Number(req.body?.qtyReceived),
        performedBy: auth.id,
      });
      res.json(result);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error verifying receipt");
    }
  });

  app.get("/api/bookstore/course/vouchers", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listCourseVouchers(db, req.query.campusId ? String(req.query.campusId) : undefined));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading course vouchers");
    }
  });

  app.post("/api/bookstore/course/vouchers", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const created = await createCourseVouchers(db, {
        kind: body.kind,
        mode: body.mode,
        campusId: body.campusId,
        classId: body.classId,
        academicSession: body.academicSession,
        studentId: body.studentId,
        packId: body.packId,
        dueDate: body.dueDate,
        items: body.items,
        createdBy: auth.id,
      });
      res.status(201).json(created);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error creating course voucher");
    }
  });

  app.post("/api/bookstore/course/vouchers/:id/payment", u, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const result = await recordVoucherPayment(db, {
        voucherId: String(req.params.id),
        amount: Number(body.amount),
        method: body.method || "Cash",
        transactionRef: body.transactionRef,
        performedBy: auth.id,
      });
      res.json(result);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error recording payment");
    }
  });

  app.post("/api/bookstore/course/vouchers/:id/issue", u, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      res.json(await issueCourseVoucher(db, String(req.params.id), auth.id));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error issuing course");
    }
  });

  app.get("/api/bookstore/course/adjustments", v, async (_req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listAdjustments(db));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading adjustments");
    }
  });

  app.post("/api/bookstore/course/adjustments", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const created = await createStockAdjustment(db, {
        campusId: body.campusId,
        classId: body.classId,
        bookId: body.bookId,
        adjType: body.adjType,
        quantity: Number(body.quantity),
        reason: body.reason,
        requestedBy: auth.id,
      });
      res.status(201).json(created);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error creating adjustment");
    }
  });

  app.post("/api/bookstore/course/adjustments/:id/approve", u, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const auth = await loadAuthUser(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });
      const result = await approveStockAdjustment(db, {
        id: String(req.params.id),
        approvedBy: auth.id,
        allowSelf: isSuperAdminRole(auth.role),
      });
      res.json(result);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error approving adjustment");
    }
  });

  app.get("/api/bookstore/course/inventory", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listClassInventory(db, req.query.campusId ? String(req.query.campusId) : undefined));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading class inventory");
    }
  });

  app.get("/api/bookstore/course/inventory/history", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const bookId = String(req.query.bookId || "");
      if (!bookId) return res.status(400).json({ message: "bookId is required" });
      res.json(await listStockHistory(db, bookId, req.query.campusId ? String(req.query.campusId) : undefined));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading stock history");
    }
  });

  app.get("/api/bookstore/course/master", v, async (_req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      res.json(await listCourseMaster(db));
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading course list");
    }
  });

  app.post("/api/bookstore/course/master/apply", c, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const body = req.body || {};
      const result = await applyCourseMasterToCampus(db, {
        campusId: String(body.campusId || ""),
        academicSession: String(body.academicSession || ""),
        regionName: body.regionName ? String(body.regionName) : undefined,
      });
      res.json(result);
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error applying course list");
    }
  });

  app.get("/api/bookstore/course/reports/:kind", v, async (req, res) => {
    try {
      const db = await pool();
      if (!db) return res.status(503).json({ message: "Database unavailable" });
      const kind = String(req.params.kind);
      const poId = req.query.poId ? String(req.query.poId) : undefined;
      if (kind === "inventory") return res.json(await reportInventory(db));
      if (kind === "sales") return res.json(await reportSales(db));
      if (kind === "issuance") return res.json(await reportIssuance(db));
      if (kind === "projection") return res.json(await reportProjection(db));
      if (kind === "transfers") return res.json(await reportTransfers(db));
      if (kind === "reconciliation") return res.json(await reconciliationReport(db, poId));
      return res.status(404).json({ message: "Unknown report" });
    } catch (err) {
      sendCourseError(res, err, sendServerError, "Error loading report");
    }
  });
}
