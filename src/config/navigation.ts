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
  Shield,
} from 'lucide-react';
import { UserRole } from '../types';
import { moduleFromPath } from './permissions';

export interface NavItemDef {
  nameKey: string;
  path: string;
  icon: LucideIcon;
  roles: UserRole[];
  moduleKey?: string;
  roleLabelKeys?: Partial<Record<UserRole, string>>;
}

export interface NavModuleDef {
  id: string;
  labelKey: string;
  items: NavItemDef[];
}

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  roles: UserRole[];
  moduleKey?: string;
}

export interface NavModule {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_MODULES: NavModuleDef[] = [
  {
    id: 'overview',
    labelKey: 'nav.modules.overview',
    items: [
      {
        nameKey: 'nav.dashboard',
        path: '/',
        icon: LayoutDashboard,
        roles: ['Super Admin', 'Admin', 'Teacher', 'Accountant', 'Student'],
        moduleKey: 'dashboard',
        roleLabelKeys: { Student: 'nav.myPortal' },
      },
    ],
  },
  {
    id: 'administration',
    labelKey: 'nav.modules.administration',
    items: [
      { nameKey: 'nav.users', path: '/users', icon: UserCog, roles: ['Super Admin'], moduleKey: 'users' },
      { nameKey: 'nav.roles', path: '/roles', icon: Shield, roles: ['Super Admin'], moduleKey: 'roles' },
      { nameKey: 'nav.campuses', path: '/campuses', icon: School, roles: ['Super Admin', 'Admin'], moduleKey: 'campuses' },
      { nameKey: 'nav.classes', path: '/classes', icon: BookOpen, roles: ['Super Admin', 'Admin'], moduleKey: 'classes' },
      { nameKey: 'nav.staff', path: '/staff', icon: Briefcase, roles: ['Super Admin', 'Admin'], moduleKey: 'staff' },
      { nameKey: 'nav.inventory', path: '/inventory', icon: Package, roles: ['Super Admin'], moduleKey: 'inventory' },
    ],
  },
  {
    id: 'students',
    labelKey: 'nav.modules.students',
    items: [
      { nameKey: 'nav.admissions', path: '/admissions', icon: UserPlus, roles: ['Super Admin', 'Admin'], moduleKey: 'admissions' },
      { nameKey: 'nav.students', path: '/students', icon: Users, roles: ['Super Admin', 'Admin', 'Teacher'], moduleKey: 'students' },
      { nameKey: 'nav.documents', path: '/documents', icon: FileText, roles: ['Super Admin', 'Admin'], moduleKey: 'documents' },
      { nameKey: 'nav.attendance', path: '/attendance', icon: Calendar, roles: ['Super Admin', 'Admin'], moduleKey: 'attendance' },
    ],
  },
  {
    id: 'academics',
    labelKey: 'nav.modules.academics',
    items: [
      { nameKey: 'nav.exams', path: '/exams', icon: ClipboardList, roles: ['Super Admin', 'Admin', 'Teacher'], moduleKey: 'exams' },
      { nameKey: 'nav.examAttendance', path: '/exam-attendance', icon: Calendar, roles: ['Super Admin', 'Admin', 'Teacher'], moduleKey: 'exam-attendance' },
    ],
  },
  {
    id: 'finance',
    labelKey: 'nav.modules.finance',
    items: [
      { nameKey: 'nav.feeSettings', path: '/fee-settings', icon: Banknote, roles: ['Super Admin'], moduleKey: 'fee-settings' },
      { nameKey: 'nav.fees', path: '/fees', icon: CreditCard, roles: ['Super Admin', 'Admin', 'Accountant'], moduleKey: 'fees' },
      { nameKey: 'nav.expenses', path: '/expenses', icon: TrendingDown, roles: ['Super Admin', 'Admin', 'Accountant'], moduleKey: 'expenses' },
      { nameKey: 'nav.reports', path: '/reports', icon: BarChart3, roles: ['Super Admin', 'Admin', 'Accountant'], moduleKey: 'reports' },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.modules.system',
    items: [
      { nameKey: 'nav.quickpay', path: '/quickpay', icon: Settings, roles: ['Super Admin', 'Admin'], moduleKey: 'quickpay' },
    ],
  },
];

type TranslateFn = (key: string) => string;

export function getNavModules(
  role: UserRole,
  canViewModule?: (moduleKey: string) => boolean,
  t?: TranslateFn
): NavModule[] {
  const tr = t ?? ((key: string) => key);
  return NAV_MODULES.map((module) => ({
    id: module.id,
    label: tr(module.labelKey),
    items: module.items
      .filter((item) => {
        const moduleKey = item.moduleKey ?? moduleFromPath(item.path);
        if (canViewModule) return canViewModule(moduleKey);
        return item.roles.includes(role);
      })
      .map((item) => ({
        path: item.path,
        icon: item.icon,
        roles: item.roles,
        moduleKey: item.moduleKey,
        name: tr(item.roleLabelKeys?.[role] ?? item.nameKey),
      })),
  })).filter((module) => module.items.length > 0);
}

export function getFlatNavItems(
  role: UserRole,
  canViewModule?: (moduleKey: string) => boolean,
  t?: TranslateFn
): NavItem[] {
  return getNavModules(role, canViewModule, t).flatMap((m) => m.items);
}

export function isNavActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function getPageTitle(
  pathname: string,
  role: UserRole,
  canViewModule?: (moduleKey: string) => boolean,
  t?: TranslateFn
): string {
  const tr = t ?? ((key: string) => key);
  const items = getFlatNavItems(role, canViewModule, t)
    .filter((item) => isNavActive(pathname, item.path))
    .sort((a, b) => b.path.length - a.path.length);
  return items[0]?.name ?? tr('app.name');
}

export function getQuickActions(
  role: UserRole,
  canViewModule?: (moduleKey: string) => boolean,
  t?: TranslateFn
) {
  return getFlatNavItems(role, canViewModule, t).filter((item) => item.path !== '/');
}
