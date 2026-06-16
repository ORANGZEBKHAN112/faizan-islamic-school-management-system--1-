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
import RoleManagement from './pages/RoleManagement';
import StaffManagement from './pages/StaffManagement';
import StudentPortal from './pages/StudentPortal';
import Exams from './pages/Exams';
import InventoryManagement from './pages/InventoryManagement';
import AdmissionManagement from './pages/AdmissionManagement';
import Documents from './pages/Documents';
import ExamAttendance from './pages/ExamAttendance';
import PublicAdmissionApply from './pages/PublicAdmissionApply';
import PublicAdmissionTrack from './pages/PublicAdmissionTrack';
import NoAccessPage from './pages/NoAccessPage';
import Layout from './components/Layout';
import { ConfirmProvider } from './context/ConfirmContext';
import { PermissionProvider } from './context/PermissionContext';
import { I18nProvider, useI18n } from './context/I18nContext';
import { verifySession } from './services/dataService';
import { hasPermission, firstAccessiblePath } from './config/permissions';

function canAccess(user: User | null, module: string, action: 'view' | 'create' | 'update' | 'delete' = 'view') {
  return hasPermission(user?.permissions, module, action, user?.role);
}

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
          if (verifiedUser) {
            localStorage.setItem('user', JSON.stringify(verifiedUser));
          }
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

  const isStudentPortal = user?.role === 'Student';
  const homePath = user ? firstAccessiblePath(user.permissions, user.role) : null;

  return (
    <I18nProvider>
      <AppShell user={user} loading={loading} homePath={homePath} isStudentPortal={isStudentPortal} />
    </I18nProvider>
  );
}

function AppShell({
  user,
  loading,
  homePath,
  isStudentPortal,
}: {
  user: User | null;
  loading: boolean;
  homePath: string | null;
  isStudentPortal: boolean;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('app.loading')}</p>
      </div>
    );
  }

  return (
    <PermissionProvider permissions={user?.permissions} role={user?.role}>
      <ConfirmProvider>
        <Router>
          <Toaster position="top-right" richColors closeButton />
          <Routes>
            <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
            <Route path="/apply" element={<PublicAdmissionApply />} />
            <Route path="/track" element={<PublicAdmissionTrack />} />

            <Route path="/" element={user ? <Layout user={user} /> : <Navigate to="/login" />}>
              <Route
                index
                element={
                  !homePath
                    ? <NoAccessPage user={user!} />
                    : homePath !== '/'
                      ? <Navigate to={homePath} replace />
                      : isStudentPortal
                        ? <StudentPortal user={user!} />
                        : <Dashboard user={user!} />
                }
              />

              {canAccess(user, 'users') && <Route path="users" element={<UserManagement />} />}
              {canAccess(user, 'roles') && <Route path="roles" element={<RoleManagement />} />}
              {canAccess(user, 'inventory') && <Route path="inventory" element={<InventoryManagement />} />}
              {canAccess(user, 'campuses') && <Route path="campuses" element={<CampusManagement />} />}
              {canAccess(user, 'fee-settings') && <Route path="fee-settings" element={<FeeSettings />} />}
              {canAccess(user, 'classes') && <Route path="classes" element={<ClassManagement />} />}
              {canAccess(user, 'students') && <Route path="students" element={<StudentManagement />} />}
              {canAccess(user, 'admissions') && <Route path="admissions" element={<AdmissionManagement />} />}
              {canAccess(user, 'documents') && <Route path="documents" element={<Documents />} />}
              {canAccess(user, 'staff') && <Route path="staff" element={<StaffManagement />} />}
              {canAccess(user, 'exams') && <Route path="exams" element={<Exams />} />}
              {canAccess(user, 'exam-attendance') && <Route path="exam-attendance" element={<ExamAttendance />} />}
              {canAccess(user, 'fees') && <Route path="fees" element={<FeeManagement />} />}
              {canAccess(user, 'expenses') && <Route path="expenses" element={<Expenses />} />}
              {canAccess(user, 'reports') && <Route path="reports" element={<Reports />} />}
              {canAccess(user, 'quickpay') && <Route path="quickpay" element={<QuickPaySetup />} />}
              {canAccess(user, 'attendance') && <Route path="attendance" element={<AttendancePage />} />}
            </Route>

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Router>
      </ConfirmProvider>
    </PermissionProvider>
  );
}
