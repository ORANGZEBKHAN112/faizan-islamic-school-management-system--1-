import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { User } from './types';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CampusManagement from './pages/CampusManagement';
import ClassManagement from './pages/ClassManagement';
import StudentManagement from './pages/StudentManagement';
import FeeManagement from './pages/FeeManagement';
import FeeSettings from './pages/FeeSettings';
import QuickPaySetup from './pages/QuickPaySetup';
import AttendancePage from './pages/Attendance';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import UserManagement from './pages/UserManagement';
import StaffManagement from './pages/StaffManagement';
import StudentPortal from './pages/StudentPortal';
import Exams from './pages/Exams';
import InventoryManagement from './pages/InventoryManagement';
import AdmissionManagement from './pages/AdmissionManagement';
import Documents from './pages/Documents';
import ExamAttendance from './pages/ExamAttendance';
import PublicAdmissionApply from './pages/PublicAdmissionApply';
import Layout from './components/Layout';
import { verifySession } from './services/dataService';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const storedUser = localStorage.getItem('user');
      const token = localStorage.getItem('token');

      if (!storedUser || !token) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const verifiedUser = await verifySession();
        if (!cancelled) {
          setUser(verifiedUser);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading…</p>
      </div>
    );
  }

  const isSuperAdmin = user?.role === 'Super Admin';
  const isAdmin = isSuperAdmin || user?.role === 'Admin';
  const isTeacher = user?.role === 'Teacher';
  const isAccountant = user?.role === 'Accountant';
  const isStudent = user?.role === 'Student';

  return (
    <Router>
      <Toaster position="top-right" richColors closeButton />
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/apply" element={<PublicAdmissionApply />} />

        <Route path="/" element={user ? <Layout user={user} /> : <Navigate to="/login" />}>
          <Route index element={isStudent ? <StudentPortal user={user!} /> : <Dashboard user={user!} />} />

          {isSuperAdmin && (
            <>
              <Route path="users" element={<UserManagement />} />
              <Route path="inventory" element={<InventoryManagement />} />
            </>
          )}

          {isAdmin && (
            <>
              <Route path="campuses" element={<CampusManagement />} />
              {isSuperAdmin && (
                <Route path="fee-settings" element={<FeeSettings />} />
              )}
              <Route path="classes" element={<ClassManagement />} />
              <Route path="students" element={<StudentManagement />} />
              <Route path="admissions" element={<AdmissionManagement />} />
              <Route path="documents" element={<Documents />} />
              <Route path="staff" element={<StaffManagement />} />
              <Route path="exams" element={<Exams />} />
              <Route path="exam-attendance" element={<ExamAttendance />} />
              <Route path="fees" element={<FeeManagement />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="reports" element={<Reports />} />
              <Route path="quickpay" element={<QuickPaySetup />} />
              <Route path="attendance" element={<AttendancePage />} />
            </>
          )}

          {isTeacher && (
            <>
              <Route path="students" element={<StudentManagement />} />
              <Route path="exams" element={<Exams />} />
              <Route path="exam-attendance" element={<ExamAttendance />} />
            </>
          )}

          {isAccountant && (
            <>
              <Route path="fees" element={<FeeManagement />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="reports" element={<Reports />} />
            </>
          )}
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}
