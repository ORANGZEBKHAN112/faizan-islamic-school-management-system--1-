import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  School,
  BookOpen,
  Users,
  CreditCard,
  FileText,
  Banknote,
  Settings,
  BarChart3,
  Calendar,
  Package,
  UserCog,
  UserPlus,
  Briefcase,
  ClipboardList,
  TrendingDown,
} from 'lucide-react';
import { UserRole } from '../types';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  roles: UserRole[];
  /** Override label for specific roles (e.g. Student portal) */
  roleLabels?: Partial<Record<UserRole, string>>;
}

export interface NavModule {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_MODULES: NavModule[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        name: 'Dashboard',
        path: '/',
        icon: LayoutDashboard,
        roles: ['Super Admin', 'Admin', 'Teacher', 'Accountant', 'Student'],
        roleLabels: { Student: 'My Portal' },
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { name: 'Users', path: '/users', icon: UserCog, roles: ['Super Admin'] },
      { name: 'Campuses', path: '/campuses', icon: School, roles: ['Super Admin', 'Admin'] },
      { name: 'Classes', path: '/classes', icon: BookOpen, roles: ['Super Admin', 'Admin'] },
      { name: 'Staff', path: '/staff', icon: Briefcase, roles: ['Super Admin', 'Admin'] },
      { name: 'Inventory', path: '/inventory', icon: Package, roles: ['Super Admin'] },
    ],
  },
  {
    id: 'students',
    label: 'Students & Admissions',
    items: [
      { name: 'Admissions', path: '/admissions', icon: UserPlus, roles: ['Super Admin', 'Admin'] },
      { name: 'Students', path: '/students', icon: Users, roles: ['Super Admin', 'Admin', 'Teacher'] },
      { name: 'ID & Certificates', path: '/documents', icon: FileText, roles: ['Super Admin', 'Admin'] },
      { name: 'Attendance', path: '/attendance', icon: Calendar, roles: ['Super Admin', 'Admin'] },
    ],
  },
  {
    id: 'academics',
    label: 'Academics',
    items: [
      { name: 'Exams', path: '/exams', icon: ClipboardList, roles: ['Super Admin', 'Admin', 'Teacher'] },
      { name: 'Exam Attendance', path: '/exam-attendance', icon: Calendar, roles: ['Super Admin', 'Admin', 'Teacher'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { name: 'Fee Settings', path: '/fee-settings', icon: Banknote, roles: ['Super Admin'] },
      { name: 'Fees', path: '/fees', icon: CreditCard, roles: ['Super Admin', 'Admin', 'Accountant'] },
      { name: 'Expenses', path: '/expenses', icon: TrendingDown, roles: ['Super Admin', 'Admin', 'Accountant'] },
      { name: 'Reports', path: '/reports', icon: BarChart3, roles: ['Super Admin', 'Admin', 'Accountant'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { name: 'Quick Pay', path: '/quickpay', icon: Settings, roles: ['Super Admin', 'Admin'] },
    ],
  },
];

export function getNavModules(role: UserRole): NavModule[] {
  return NAV_MODULES.map((module) => ({
    ...module,
    items: module.items
      .filter((item) => item.roles.includes(role))
      .map((item) => ({
        ...item,
        name: item.roleLabels?.[role] ?? item.name,
      })),
  })).filter((module) => module.items.length > 0);
}

export function getFlatNavItems(role: UserRole): NavItem[] {
  return getNavModules(role).flatMap((m) => m.items);
}

export function isNavActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** All paths for command palette quick actions */
export function getQuickActions(role: UserRole) {
  return getFlatNavItems(role).filter((item) => item.path !== '/');
}
