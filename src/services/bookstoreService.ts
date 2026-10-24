import { api } from './dataService';

export const bookstoreService = {
  fetchDashboard(params?: { campusId?: string }) {
    return api.get('/bookstore/dashboard', { params }).then((r) => r.data);
  },
  fetchBooks(params?: { page?: number; limit?: number; search?: string }) {
    return api.get('/bookstore/books', { params }).then((r) => r.data);
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
  updateTransferStatus(id: string, status: string) {
    return api.patch(`/bookstore/stock-transfers/${id}/status`, { status }).then((r) => r.data);
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
};
