import { api } from './dataService';

export const bookstoreService = {
  fetchDashboard(params?: { campusId?: string }) {
    return api.get('/bookstore/dashboard', { params }).then((r) => r.data);
  },
  fetchBooks(params?: { page?: number; limit?: number; search?: string; activeOnly?: boolean }) {
    const query =
      params?.activeOnly === false ? { ...params, activeOnly: '0' } : params;
    return api.get('/bookstore/books', { params: query }).then((r) => r.data);
  },
  fetchPrices(academicSession: string, bookIds: string[]) {
    return api
      .get('/bookstore/prices', { params: { academicSession, bookIds: bookIds.join(',') } })
      .then((r) => r.data);
  },
  createBook(payload: Record<string, unknown>) {
    return api.post('/bookstore/books', payload).then((r) => r.data);
  },
  updateBook(id: string, payload: Record<string, unknown>) {
    return api.put(`/bookstore/books/${id}`, payload).then((r) => r.data);
  },
  saveBookPrice(payload: Record<string, unknown>) {
    return api.post('/bookstore/book-prices', payload).then((r) => r.data);
  },
  fetchPosStudent(studentId: string) {
    return api.get(`/bookstore/pos/student/${studentId}`).then((r) => r.data);
  },
  fetchEligiblePacks(studentId: string, academicSession?: string) {
    return api.get('/bookstore/packs/eligible', { params: { studentId, academicSession } }).then((r) => r.data);
  },
  quotePack(packId: string, params: { studentId: string; storeId: string; academicSession?: string }) {
    return api.get(`/bookstore/packs/${packId}/quote`, { params }).then((r) => r.data);
  },
  fetchDemand(params: { campusId: string; classId: string; academicSession: string; packId: string }) {
    return api.get('/bookstore/demand', { params }).then((r) => r.data);
  },
  reserveSale(payload: Record<string, unknown>, reservationKey?: string) {
    return api.post('/bookstore/sales/reserve', payload, {
      headers: reservationKey ? { 'Idempotency-Key': reservationKey } : undefined,
    }).then((r) => r.data);
  },
  releaseReservation(reservationId: string) {
    return api.post(`/bookstore/sales/reserve/${reservationId}/release`, {}).then((r) => r.data);
  },
  fetchStores() {
    return api.get('/bookstore/stores').then((r) => r.data);
  },
  fetchInventory(storeId: string) {
    return api.get('/bookstore/inventory', { params: { storeId } }).then((r) => r.data);
  },
  postOpeningStock(payload: Record<string, unknown>) {
    return api.post('/bookstore/inventory/opening-stock', payload).then((r) => r.data);
  },
  fetchPacks(params?: { campusId?: string; academicSession?: string }) {
    return api.get('/bookstore/packs', { params }).then((r) => r.data);
  },
  fetchPackItems(packId: string, academicSession: string) {
    return api.get(`/bookstore/packs/${packId}/items`, { params: { academicSession } }).then((r) => r.data);
  },
  createPack(payload: Record<string, unknown>) {
    return api.post('/bookstore/packs', payload).then((r) => r.data);
  },
  copyPack(packId: string, academicSession: string) {
    return api.post(`/bookstore/packs/${packId}/copy`, { academicSession }).then((r) => r.data);
  },
  fetchSuppliers() {
    return api.get('/bookstore/suppliers').then((r) => r.data);
  },
  createSupplier(payload: Record<string, unknown>) {
    return api.post('/bookstore/suppliers', payload).then((r) => r.data);
  },
  createGrn(payload: Record<string, unknown>) {
    return api.post('/bookstore/goods-receipts', payload).then((r) => r.data);
  },
  postGrn(id: string, idempotencyKey?: string) {
    return api.post(
      `/bookstore/goods-receipts/${id}/post`,
      {},
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    ).then((r) => r.data);
  },
  fetchTransfers() {
    return api.get('/bookstore/stock-transfers').then((r) => r.data);
  },
  createTransfer(payload: Record<string, unknown>) {
    return api.post('/bookstore/stock-transfers', payload).then((r) => r.data);
  },
  updateTransferStatus(id: string, status: string, items?: Array<{ itemId: string; qtyReceived: number }>) {
    return api.patch(`/bookstore/stock-transfers/${id}/status`, { status, items }).then((r) => r.data);
  },
  saveProjection(payload: Record<string, unknown>) {
    return api.post('/bookstore/course/projections', payload).then((r) => r.data);
  },
  fetchProjections(params?: { academicSession?: string; campusId?: string }) {
    return api.get('/bookstore/course/projections', { params }).then((r) => r.data);
  },
  createCourseOrder(projectionIds: string[], notes?: string) {
    return api.post('/bookstore/course/purchase-orders', { projectionIds, notes }).then((r) => r.data);
  },
  fetchCourseOrders() {
    return api.get('/bookstore/course/purchase-orders').then((r) => r.data);
  },
  postDispatch(payload: Record<string, unknown>) {
    return api.post('/bookstore/course/dispatches', payload).then((r) => r.data);
  },
  fetchDispatches() {
    return api.get('/bookstore/course/dispatches').then((r) => r.data);
  },
  fetchReceiving(campusId?: string) {
    return api.get('/bookstore/course/receiving', { params: campusId ? { campusId } : {} }).then((r) => r.data);
  },
  verifyReceiving(itemId: string, qtyReceived: number) {
    return api.post(`/bookstore/course/receiving/${itemId}/verify`, { qtyReceived }).then((r) => r.data);
  },
  createCourseVoucher(payload: Record<string, unknown>) {
    return api.post('/bookstore/course/vouchers', payload).then((r) => r.data);
  },
  fetchCourseVouchers(campusId?: string) {
    return api.get('/bookstore/course/vouchers', { params: campusId ? { campusId } : {} }).then((r) => r.data);
  },
  payCourseVoucher(id: string, payload: { amount: number; method: string; transactionRef?: string }) {
    return api.post(`/bookstore/course/vouchers/${id}/payment`, payload).then((r) => r.data);
  },
  issueCourseVoucher(id: string) {
    return api.post(`/bookstore/course/vouchers/${id}/issue`, {}).then((r) => r.data);
  },
  fetchCourseDashboard(campusId?: string) {
    return api.get('/bookstore/course/dashboard', { params: campusId ? { campusId } : {} }).then((r) => r.data);
  },
  fetchCourseExceptions() {
    return api.get('/bookstore/course/exceptions').then((r) => r.data);
  },
  fetchClassInventory(campusId?: string) {
    return api.get('/bookstore/course/inventory', { params: campusId ? { campusId } : {} }).then((r) => r.data);
  },
  fetchStockHistory(bookId: string, campusId?: string) {
    return api.get('/bookstore/course/inventory/history', { params: { bookId, campusId } }).then((r) => r.data);
  },
  createAdjustment(payload: Record<string, unknown>) {
    return api.post('/bookstore/course/adjustments', payload).then((r) => r.data);
  },
  fetchAdjustments() {
    return api.get('/bookstore/course/adjustments').then((r) => r.data);
  },
  approveAdjustment(id: string) {
    return api.post(`/bookstore/course/adjustments/${id}/approve`, {}).then((r) => r.data);
  },
  fetchCourseReport(kind: string, params?: { poId?: string }) {
    return api.get(`/bookstore/course/reports/${kind}`, { params }).then((r) => r.data);
  },
  fetchCourseMaster() {
    return api.get('/bookstore/course/master').then((r) => r.data);
  },
  applyCourseMaster(payload: { campusId: string; academicSession: string; regionName?: string }) {
    return api.post('/bookstore/course/master/apply', payload).then((r) => r.data);
  },
  createSale(payload: Record<string, unknown>, idempotencyKey?: string) {
    return api.post('/bookstore/sales', payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }).then((r) => r.data);
  },
  fetchSales(params?: { page?: number; limit?: number; campusId?: string }) {
    return api.get('/bookstore/sales', { params }).then((r) => r.data);
  },
  fetchReportSummary(params?: { from?: string; to?: string }) {
    return api.get('/bookstore/reports/summary', { params }).then((r) => r.data);
  },
  fetchSale(saleId: string) {
    return api.get(`/bookstore/sales/${saleId}`).then((r) => r.data);
  },
  fetchReceipt(saleId: string) {
    return api.get(`/bookstore/sales/${saleId}/receipt`).then((r) => r.data);
  },
  cancelSale(saleId: string, reason: string) {
    return api.post(`/bookstore/sales/${saleId}/cancel`, { reason }).then((r) => r.data);
  },
  createReturn(payload: Record<string, unknown>, idempotencyKey?: string) {
    return api.post('/bookstore/returns', payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }).then((r) => r.data);
  },
  submitReturn(id: string) {
    return api.post(`/bookstore/returns/${id}/submit`, {}).then((r) => r.data);
  },
  approveReturn(id: string) {
    return api.post(`/bookstore/returns/${id}/approve`, {}).then((r) => r.data);
  },
  postReturn(id: string) {
    return api.post(`/bookstore/returns/${id}/post`, {}).then((r) => r.data);
  },
  createRefund(payload: Record<string, unknown>, idempotencyKey?: string) {
    return api.post('/bookstore/refunds', payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }).then((r) => r.data);
  },
  completeRefund(id: string, reference?: string) {
    return api.post(`/bookstore/refunds/${id}/complete`, { reference }).then((r) => r.data);
  },
  fetchReconciliation(saleId: string) {
    return api.get('/bookstore/reports/reconciliation', { params: { saleId } }).then((r) => r.data);
  },
};
