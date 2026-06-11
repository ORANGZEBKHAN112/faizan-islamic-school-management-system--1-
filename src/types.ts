export type UserRole = 'Super Admin' | 'Admin' | 'Teacher' | 'Accountant' | 'Student';

export interface User {
  id: string;
  fullName: string;
  username: string;
  email?: string;
  role: UserRole;
  campusId?: string;
  isActive: boolean;
  createdOn: string;
  uid?: string;
}

export interface Campus {
  id: string;
  campusCode: string;
  campusName: string;
  city?: string;
  region?: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdOn: string;
}

export interface Class {
  id: string;
  campusId: string;
  className: string;
  sectionName?: string;
  capacity?: number;
  enrolledCount?: number;
  shift?: string;
}

export interface Student {
  id: string;
  campusId: string;
  classId: string;
  serialNo?: string;
  dateOfBirth?: string;
  admissionDate?: string;
  registrationDate?: string;
  gender?: string;
  studentCode?: string;
  rollNumber: string;
  contactNumber?: string;
  cnicBForm?: string;
  address?: string;
  campusName?: string;
  country?: string;
  province?: string;
  city?: string;
  tehsil?: string;
  firstName: string;
  lastName?: string;
  fatherName?: string;
  className?: string;
  sectionName?: string;
  session?: string;
  status: 'Active' | 'Left' | 'Graduated';
  outstandingFees: number;
  campusType?: string;
  profileImage?: string;
}

export interface FeeStructure {
  id: string;
  campusId: string;
  classId?: string | null;
  sessionLabel: string;
  tuitionFee: number;
  monthlyFee?: number;
  admissionFee: number;
  securityFee?: number;
  examFee: number;
  transportFee: number;
  miscFee: number;
  summerCampFee?: number;
  idCardFee?: number;
  tripFee?: number;
  lastUpdated?: string;
}

export interface Fee {
  id: string;
  studentId: string;
  campusId?: string;
  classId?: string;
  month: number;
  year: number;
  amount: number;
  status: 'Paid' | 'Unpaid' | 'Partially Paid' | 'Pending' | 'Overdue';
  feeType: 'Monthly' | 'Admission' | 'Arrears' | 'Fine' | 'Security Deposit' | 'Summer Camp' | 'ID Card' | 'Educational Trip';
  monthsLabel?: string;
  campusName?: string;
  securityFee?: number;
  summerCampFee?: number;
  idCardFee?: number;
  tripFee?: number;
  dueDate: string;
  paymentDate?: string;
  paymentMethod?: string;
  transactionRef?: string;
  createdAt?: string;
  voucherNo?: string;
  paidAmount?: number;
  discountAmount?: number;
  fineAmount?: number;
  balanceAmount?: number;
  paymentHistory?: string; // JSON string of payments
  tuitionFee?: number;
  admissionFee?: number;
  examFee?: number;
  transportFee?: number;
  miscFee?: number;
  arrears?: number;
  // Optional display fields from joins
  studentName?: string;
  fatherName?: string;
  rollNumber?: string;
  className?: string;
  sectionName?: string;
  outstandingFees?: number;
}

export interface QuickPayConfig {
  id: string;
  merchantId: string;
  apiKey: string;
  apiKeySet?: boolean;
  callbackUrl: string;
  mode: 'Sandbox' | 'Live';
  isEnabled: boolean;
}

export interface Attendance {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  status: 'Present' | 'Absent' | 'Leave' | 'Late';
  remarks?: string;
  recordedBy?: string;
}

export interface Transaction {
  id: string;
  studentId: string;
  voucherId: string;
  amount: number;
  status: 'Pending' | 'Success' | 'Failed';
  transactionDate: string;
  responseLog?: string;
}

export interface LoginRequest {
  username: string;
  passwordHash: string;
}

export interface RegisterRequest {
  fullName: string;
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  campusId?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface FeeSetting {
  id: string;
  classId: string;
  className?: string;
  monthlyFee: number;
  admissionFee: number;
  securityFee: number;
  examFee?: number;
  transportFee?: number;
  miscFee?: number;
  summerCampFee?: number;
  idCardFee?: number;
  tripFee?: number;
  lastUpdated: string;
}

export interface ExamAttendanceRecord {
  id?: string;
  examId: string;
  personType: 'Student' | 'Staff';
  personId: string;
  status: 'Present' | 'Absent' | 'Leave' | 'Late';
  recordedBy?: string;
  recordedOn?: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  cnic: string;
  qualification?: string;
  salary?: number;
  joiningDate?: string;
  campusId: string;
  campusName?: string;
  role: string;
  email?: string;
  isActive: boolean;
  profileImage?: string;
}

export interface Exam {
  id: string;
  title: string;
  examType: string;
  classId: string;
  className?: string;
  campusId: string;
  campusName?: string;
  examDate?: string;
  totalMarks: number;
  createdOn?: string;
}

export interface ExamResult {
  id: string;
  examId: string;
  studentId: string;
  studentName?: string;
  rollNumber?: string;
  obtainedMarks: number;
  grade?: string;
  remarks?: string;
  recordedOn?: string;
}

export interface InventoryItem {
  id: string;
  itemName: string;
  category?: string;
  quantity: number;
  unit?: string;
  minThreshold: number;
  lastUpdated?: string;
}

export interface FeeGenerationRun {
  id: string;
  runOn: string;
  runBy?: string;
  campusId?: string;
  campusName?: string;
  year: number;
  monthsCsv: string;
  processedCount: number;
  skippedMissingFeeSettings: number;
  newAdmissionsCount: number;
  arrearsCount: number;
  notes?: Array<{ className: string; campusName: string; count: number }> | null;
}

export interface FeeGenerationJob {
  id: string;
  campusId?: string;
  year: number;
  monthsCsv: string;
  includeAdmissions?: boolean;
  includeArrears?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
  processedCount: number;
  totalCount: number;
  skippedMissingFeeSettings: number;
  newAdmissionsCount: number;
  arrearsCount: number;
  errorMessage?: string;
  runBy?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
}

export interface FeeExportJob {
  id: string;
  campusId?: string;
  year?: number;
  month?: number;
  statusFilter?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  processedCount: number;
  totalCount: number;
  filePath?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface FeeStats {
  totalCount: number;
  totalPaid: number;
  totalOutstanding: number;
  defaulters: number;
}

export interface AdmissionApplication {
  id: string;
  campusId: string;
  campusName?: string;
  classId?: string;
  className?: string;
  applicantName: string;
  fatherName?: string;
  dateOfBirth?: string;
  gender?: string;
  contactNumber?: string;
  address?: string;
  previousSchool?: string;
  appliedOn?: string;
  status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected' | 'Enrolled';
  testMarks?: number;
  remarks?: string;
  reviewedBy?: string;
  reviewedOn?: string;
  studentId?: string;
  interviewAt?: string;
  interviewSmsSent?: boolean;
  interviewSmsSentOn?: string;
  campusAddress?: string;
  campusPhone?: string;
}

export interface DashboardStats {
  activeStudents: number;
  totalCollected: number;
  totalOutstanding: number;
  campusCount: number;
  classCount: number;
  defaulters: number;
  pendingAdmissions: number;
  examsScheduled: number;
  onlineCollections: number;
  totalExpenses: number;
  monthlyFees: Array<{ month: number; monthName: string; collected: number; pending: number }>;
  recentPayments: Array<{ id: string; amount: number; studentName?: string; transactionDate?: string }>;
}

export interface StudentPortalData {
  student: Student;
  fees: Fee[];
  attendanceSummary: { present: number; absent: number; late: number; total: number };
}
