import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { User, AppRole, PermissionMap, PermissionModuleDef } from '../types';

const API_BASE_URL = '/api';
const REFERENCE_COLLECTIONS = new Set(['campuses', 'classes']);
const PAGINATED_COLLECTIONS = new Set(['students', 'fees', 'feevouchers']);
const CACHE_TTL_MS = 60_000;
const DEFAULT_LIST_LIMIT = 50;

type Params = Record<string, unknown> | undefined;
type CacheEntry = {
  data: unknown;
  fetchedAt: number;
};

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export function getStoredToken(): string | null {
  const raw = localStorage.getItem('token');
  if (!raw) return null;
  const token = raw.trim().replace(/^Bearer\s+/i, '');
  return token || null;
}

export function clearSession(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function attachAuthHeader(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = getStoredToken();
  if (!token) return config;

  const value = `Bearer ${token}`;
  if (typeof config.headers?.set === 'function') {
    config.headers.set('Authorization', value);
  } else if (config.headers) {
    config.headers.Authorization = value;
  }
  return config;
}

api.interceptors.request.use(attachAuthHeader);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSession();
    }
    return Promise.reject(error);
  }
);

export async function verifySession(): Promise<User | null> {
  if (!getStoredToken()) return null;
  try {
    const { data } = await api.get<User>('/auth/me');
    return data;
  } catch {
    clearSession();
    return null;
  }
}

const getEndpoint = (collectionName: string) => {
  const name = collectionName.toLowerCase();
  switch (name) {
    case 'students': return `/students`;
    case 'campuses': return `/campuses`;
    case 'classes': return `/classes`;
    case 'users': return `/auth/register`;
    case 'staff': return `/staff`;
    case 'exams': return `/exams`;
    case 'exam-results': return `/exam-results`;
    case 'student-portal': return `/student-portal/me`;
    case 'fees':
    case 'feevouchers': return `/fees`;
    case 'feestructures': return `/feestructures`;
    case 'transactions': return `/transactions`;
    case 'import-students': return `/import-students`;
    default: return `/${name}`;
  }
};

const subscriptions = new Map<string, Set<() => void>>();
const cache = new Map<string, CacheEntry>();

function normalizeCollection(collectionName: string): string {
  return collectionName.toLowerCase();
}

function cacheKey(collectionName: string, params?: Params): string {
  const name = normalizeCollection(collectionName);
  if (!params || Object.keys(params).length === 0) return `${name}::all`;
  const ordered = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `${name}::${JSON.stringify(ordered)}`;
}

function shouldUseCache(collectionName: string): boolean {
  return REFERENCE_COLLECTIONS.has(normalizeCollection(collectionName));
}

function getCached(collectionName: string, params?: Params): unknown | null {
  if (!shouldUseCache(collectionName)) return null;
  const key = cacheKey(collectionName, params);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(collectionName: string, params: Params, data: unknown): void {
  if (!shouldUseCache(collectionName)) return;
  cache.set(cacheKey(collectionName, params), { data, fetchedAt: Date.now() });
}

function registerSubscription(collectionName: string, refetch: () => void): () => void {
  const key = normalizeCollection(collectionName);
  if (!subscriptions.has(key)) subscriptions.set(key, new Set());
  subscriptions.get(key)!.add(refetch);
  return () => {
    subscriptions.get(key)?.delete(refetch);
    if (subscriptions.get(key)?.size === 0) subscriptions.delete(key);
  };
}

function notifySubscriptions(collectionName: string): void {
  subscriptions.get(normalizeCollection(collectionName))?.forEach((refetch) => refetch());
}

export const dataService = {
  invalidateCollection(collectionName: string) {
    const name = normalizeCollection(collectionName);
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${name}::`)) cache.delete(key);
    }
    notifySubscriptions(name);
  },

  async add(collectionName: string, data: any) {
    try {
      const endpoint = getEndpoint(collectionName);
      const response = await api.post(endpoint, data);
      this.invalidateCollection(collectionName);
      return response.data;
    } catch (error) {
      console.error(`Error adding to ${collectionName}:`, error);
      throw error;
    }
  },

  async update(collectionName: string, id: string, data: any) {
    try {
      const endpoint = `${getEndpoint(collectionName)}/${id}`;
      await api.put(endpoint, data);
      this.invalidateCollection(collectionName);
    } catch (error) {
      console.error(`Error updating ${collectionName}:`, error);
      throw error;
    }
  },

  async delete(collectionName: string, id: string) {
    try {
      const endpoint = `${getEndpoint(collectionName)}/${id}`;
      await api.delete(endpoint);
      this.invalidateCollection(collectionName);
    } catch (error) {
      console.error(`Error deleting from ${collectionName}:`, error);
      throw error;
    }
  },

  async getAll(collectionName: string, params?: Record<string, unknown>) {
    const name = normalizeCollection(collectionName);
    const mergedParams = { ...params };
    if (PAGINATED_COLLECTIONS.has(name)) {
      if (!mergedParams.limit) mergedParams.limit = DEFAULT_LIST_LIMIT;
      if (!mergedParams.page) mergedParams.page = 1;
      const result = await this.getPaginated(collectionName, mergedParams);
      return result.data;
    }
    const cached = getCached(collectionName, params);
    if (cached) return cached;
    const endpoint = getEndpoint(collectionName);
    const response = await api.get(endpoint, { params: mergedParams });
    const body = response.data;
    const parsed = body && Array.isArray(body.data) ? body.data : body;
    setCached(collectionName, params, parsed);
    return parsed;
  },

  async getPaginated(collectionName: string, params?: Record<string, unknown>) {
    const endpoint = getEndpoint(collectionName);
    const response = await api.get(endpoint, { params });
    const body = response.data;
    if (body && Array.isArray(body.data)) {
      return {
        data: body.data,
        total: Number(body.total ?? body.data.length ?? 0),
        page: Number(body.page ?? 1),
        limit: Number(body.limit ?? params?.limit ?? body.data.length ?? 0),
      };
    }
    const arr = Array.isArray(body) ? body : body?.data ?? [];
    return {
      data: arr,
      total: Array.isArray(arr) ? arr.length : 0,
      page: 1,
      limit: Array.isArray(arr) ? arr.length : 0,
    };
  },

  async prefetchReferenceData() {
    await Promise.all([
      this.getAll('campuses'),
      this.getAll('classes'),
    ]);
  },

  async fetchStudents() {
    return this.getAll('students');
  },

  async fetchStudentOptions(params?: { search?: string; campusId?: string; limit?: number }) {
    const response = await api.get('/students/options', { params });
    return response.data as Array<{ id: string; firstName: string; lastName?: string; rollNumber: string; classId: string; campusId: string }>;
  },

  async fetchCampuses() {
    return this.getAll('campuses');
  },

  async fetchClasses() {
    return this.getAll('classes');
  },

  async fetchFeeSettings(campusId?: string) {
    return this.getAll('fee-settings', campusId ? { campusId } : undefined);
  },

  async fetchCampusFeeStructures(campusId: string, sessionLabel?: string) {
    const response = await api.get('/fee-structures/campus', {
      params: { campusId, ...(sessionLabel ? { session: sessionLabel } : {}) },
    });
    return response.data;
  },

  async fetchCampusFeeSessions(campusId: string) {
    const response = await api.get('/fee-structures/sessions', { params: { campusId } });
    return response.data as Array<{ sessionLabel: string }>;
  },

  async saveCampusFeeStructure(data: Record<string, unknown>) {
    const response = await api.post('/fee-structures/campus', data);
    this.invalidateCollection('feeStructures');
    return response.data;
  },

  async applyCampusFeeStructureToClasses(campusId: string, sessionLabel: string) {
    const response = await api.post('/fee-structures/apply-to-classes', { campusId, sessionLabel });
    this.invalidateCollection('fee-settings');
    return response.data as { message: string; sessionLabel: string; updatedCount: number };
  },

  async applyClassWideFeeSettings(classId: string) {
    const response = await api.post('/fee-settings/apply-class-wide', { classId });
    this.invalidateCollection('fee-settings');
    return response.data as { message: string; className: string; updatedCount: number };
  },

  async syncFeeSettingsFromStructures(campusId?: string, overwrite = false) {
    const response = await api.post('/fee-settings/sync-from-structures', { campusId: campusId || null, overwrite });
    this.invalidateCollection('fee-settings');
    return response.data as { message: string; updatedCount: number; insertedCount: number; overwrite: boolean };
  },

  async syncFeeStructuresForAllClasses(campusId?: string) {
    const response = await api.post('/fee-structures/sync-all-classes', { campusId: campusId || null });
    this.invalidateCollection('feeStructures');
    return response.data as { message: string; createdCount: number; templateCopiedCount: number; zeroDefaultCount: number };
  },

  async fetchUsers() {
    const response = await api.get('/users');
    return response.data;
  },

  async updateUser(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/users/${id}`, data);
    this.invalidateCollection('users');
    return response.data;
  },

  async registerUser(data: Record<string, unknown>) {
    const response = await api.post('/auth/register', { ...data, viaUserManagement: true });
    this.invalidateCollection('users');
    return response.data;
  },

  async addStaff(data: Record<string, unknown>) {
    const response = await api.post('/staff', data);
    this.invalidateCollection('staff');
    return response.data;
  },

  async updateStaff(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/staff/${id}`, data);
    this.invalidateCollection('staff');
    return response.data;
  },

  async addExam(data: Record<string, unknown>) {
    const response = await api.post('/exams', data);
    this.invalidateCollection('exams');
    return response.data;
  },

  async updateExam(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/exams/${id}`, data);
    this.invalidateCollection('exams');
    return response.data;
  },

  async deleteExam(id: string) {
    await api.delete(`/exams/${id}`);
    this.invalidateCollection('exams');
  },

  async saveExamResults(examId: string, results: Array<{ studentId: string; obtainedMarks: number; grade?: string; remarks?: string }>) {
    const response = await api.post('/exam-results', { examId, results });
    return response.data;
  },

  async fetchStudentPortal() {
    const response = await api.get('/student-portal/me');
    return response.data;
  },

  async fetchAdmissions(params?: Record<string, unknown>) {
    const response = await api.get('/admissions', { params });
    return response.data;
  },

  async addAdmission(data: Record<string, unknown>) {
    const response = await api.post('/admissions', data);
    this.invalidateCollection('admissions');
    return response.data;
  },

  async updateAdmission(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/admissions/${id}`, data);
    this.invalidateCollection('admissions');
    return response.data;
  },

  async reviewAdmissionCheck(id: string, options?: {
    fatherCnic?: string;
    classId?: string;
    waiveAdmissionFee?: boolean;
    feeDiscountAmount?: number;
    feeDiscountPercent?: number;
    siblingDiscountPercent?: number;
  }) {
    const body = options || {};
    const response = await api.post(`/admissions/${id}/review-check`, body);
    return response.data;
  },

  async reviewAdmission(id: string, data: Record<string, unknown>) {
    const response = await api.post(`/admissions/${id}/review`, data);
    this.invalidateCollection('admissions');
    return response.data;
  },

  async enrollAdmission(id: string) {
    const response = await api.post(`/admissions/${id}/enroll`);
    this.invalidateCollection('admissions');
    this.invalidateCollection('students');
    return response.data;
  },

  async fetchPublicCampuses() {
    const response = await axios.get(`${API_BASE_URL}/public/campuses`);
    return response.data;
  },

  async fetchPublicClasses(campusId: string) {
    const response = await axios.get(`${API_BASE_URL}/public/classes`, { params: { campusId } });
    return response.data;
  },

  async submitPublicAdmission(data: Record<string, unknown>) {
    const response = await axios.post(`${API_BASE_URL}/public/admissions`, data);
    return response.data as { id: string; trackingNo: string; status: string; smsSent?: boolean };
  },

  async trackPublicAdmission(trackingNo: string, contact: string) {
    const response = await axios.get(`${API_BASE_URL}/public/admissions/track`, {
      params: { trackingNo, contact },
    });
    return response.data;
  },

  async fetchAdmissionPolicy() {
    const response = await api.get('/admissions/policy');
    return response.data as {
      rejectionReasons: string[];
      testPassMarks: number;
      documentTypes: string[];
      siblingDiscountDefaults: { secondChildPercent: number; thirdChildPercent: number };
    };
  },

  async fetchAdmissionReport(params?: Record<string, unknown>) {
    const response = await api.get('/admissions/report', { params });
    return response.data;
  },

  async fetchAdmissionDocuments(applicationId: string) {
    const response = await api.get(`/admissions/${applicationId}/documents`);
    return response.data;
  },

  async uploadAdmissionDocument(applicationId: string, file: File, docType: string) {
    const token = getStoredToken();
    if (!token) throw new Error('Please log in again.');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    const response = await api.post(`/admissions/${applicationId}/documents`, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  async deleteAdmissionDocument(applicationId: string, docId: string) {
    await api.delete(`/admissions/${applicationId}/documents/${docId}`);
  },

  async uploadStudentPhoto(studentId: string, file: File) {
    const token = getStoredToken();
    if (!token) throw new Error('Please log in again.');
    const formData = new FormData();
    formData.append('photo', file);
    const response = await api.post(`/students/${studentId}/photo`, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
    });
    this.invalidateCollection('students');
    return response.data as { profileImage: string };
  },

  async fetchDashboardStats(params?: Record<string, unknown>) {
    const response = await api.get('/dashboard-stats', { params });
    return response.data;
  },

  async fetchReportSummary(params?: { campusId?: string; year?: number | string }) {
    const response = await api.get('/reports/summary', { params });
    return response.data;
  },

  async fetchGenerateFees(params?: {
    campusId?: string;
    month?: number;
    months?: number[];
    year?: number;
    session?: string;
    sessionLabel?: string;
    includeAdmissions?: boolean;
    includeArrears?: boolean;
  }) {
    try {
      const response = await api.post(`/generate-monthly-fees`, params);
      return response.data as {
        message: string;
        jobId: string;
        months: number[];
        async: boolean;
      };
    } catch (error) {
      console.error('Error generating fees:', error);
      throw error;
    }
  },

  async fetchFeeGenerationJob(jobId: string) {
    const response = await api.get(`/fee-generation-jobs/${jobId}`);
    return response.data;
  },

  async fetchFeeStats(params?: Record<string, unknown>) {
    const response = await api.get('/fees/stats', { params });
    return response.data;
  },

  async startFeeExport(params?: Record<string, unknown>) {
    const response = await api.post('/fees/export', params);
    return response.data as { message: string; jobId: string; async: boolean };
  },

  async fetchFeeExportJob(jobId: string) {
    const response = await api.get(`/fees/export/${jobId}`);
    return response.data;
  },

  getFeeExportDownloadUrl(jobId: string) {
    return `${API_BASE_URL}/fees/export/${jobId}/download`;
  },

  async refreshDashboardStats(campusId?: string) {
    const response = await api.post('/dashboard-stats/refresh', { campusId: campusId || null });
    return response.data;
  },

  async archiveOldFees(beforeYear?: number) {
    const response = await api.post('/fees/archive', { beforeYear });
    return response.data;
  },

  async fetchFeeGenerationRuns(params?: { campusId?: string; limit?: number }) {
    const response = await api.get('/fee-generation-runs', { params });
    return response.data;
  },

  async createExtraFeeCharge(data: Record<string, unknown>) {
    const response = await api.post('/fees/extra-charge', data);
    this.invalidateCollection('fees');
    return response.data;
  },

  async advanceYearPayment(data: Record<string, unknown>) {
    const response = await api.post('/fees/advance-year-payment', data);
    this.invalidateCollection('fees');
    return response.data;
  },

  async fetchExamAttendance(examId: string) {
    const response = await api.get('/exam-attendance', { params: { examId } });
    return response.data;
  },

  async saveExamAttendance(examId: string, records: Array<{ personType: string; personId: string; status: string }>) {
    const response = await api.post('/exam-attendance', { examId, records });
    this.invalidateCollection('exam-attendance');
    return response.data;
  },

  async importStudents(file: File) {
    const token = getStoredToken();
    if (!token) throw new Error('Please log in again.');
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/import-students', formData, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 1200000,
    });
    this.invalidateCollection('students');
    this.invalidateCollection('classes');
    this.invalidateCollection('campuses');
    return response.data as {
      message: string;
      totalRows: number;
      imported: number;
      updated?: number;
      skipped?: number;
      failed: number;
      newCampuses?: number;
      newClasses?: number;
      arrearsVouchers?: number;
      errorDetails?: string[];
    };
  },

  async upload(collectionName: string, formData: FormData) {
    const token = getStoredToken();
    if (!token) {
      const err = new Error('Please log in again.') as Error & { response?: { data: { message: string } } };
      err.response = { data: { message: 'Please log in again.' } };
      throw err;
    }

    try {
      const endpoint = getEndpoint(collectionName);
      // Do not set Content-Type — axios must add multipart boundary automatically.
      const response = await api.post(endpoint, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      this.invalidateCollection(collectionName);
      return response.data;
    } catch (error) {
      console.error(`Error uploading to ${collectionName}:`, error);
      throw error;
    }
  },

  /** Fetch once on mount; optional refreshMs for periodic polling (e.g. Dashboard: 60000). */
  subscribe(
    collectionName: string,
    callback: (data: any[]) => void,
    params?: Record<string, unknown>,
    refreshMs?: number,
    onStateChange?: (state: { loading: boolean; error: Error | null }) => void
  ) {
    const fetchData = async () => {
      onStateChange?.({ loading: true, error: null });
      try {
        const data = await this.getAll(collectionName, params);
        callback(Array.isArray(data) ? data : data?.data ?? []);
        onStateChange?.({ loading: false, error: null });
      } catch (error) {
        console.error(`Error in subscription for ${collectionName}:`, error);
        onStateChange?.({ loading: false, error: error as Error });
      }
    };

    fetchData();
    const unreg = registerSubscription(collectionName, fetchData);
    if (refreshMs && refreshMs > 0) {
      const interval = setInterval(fetchData, refreshMs);
      return () => {
        clearInterval(interval);
        unreg();
      };
    }
    return () => unreg();
  },

  async refresh(collectionName: string, params?: Record<string, unknown>) {
    const name = normalizeCollection(collectionName);
    if (PAGINATED_COLLECTIONS.has(name)) {
      const result = await this.getPaginated(collectionName, {
        page: 1,
        limit: params?.limit ?? DEFAULT_LIST_LIMIT,
        ...params,
      });
      return result.data;
    }
    return this.getAll(collectionName, params);
  },

  async fetchPermissionModules() {
    const response = await api.get<PermissionModuleDef[]>('/permission-modules');
    return response.data;
  },

  async fetchAppRoles() {
    const response = await api.get<AppRole[]>('/app-roles');
    return response.data;
  },

  async fetchRolePermissions(roleId: string) {
    const response = await api.get<PermissionMap>(`/app-roles/${roleId}/permissions`);
    return response.data;
  },

  async createAppRole(payload: { name: string; description?: string; permissions: PermissionMap }) {
    const response = await api.post<AppRole>('/app-roles', payload);
    return response.data;
  },

  async updateAppRole(id: string, payload: Partial<Pick<AppRole, 'name' | 'description' | 'isActive'>>) {
    const response = await api.put<AppRole>(`/app-roles/${id}`, payload);
    return response.data;
  },

  async saveRolePermissions(roleId: string, permissions: PermissionMap) {
    const response = await api.put(`/app-roles/${roleId}/permissions`, { permissions });
    return response.data;
  },

  async deleteAppRole(id: string) {
    await api.delete(`/app-roles/${id}`);
  },
};
