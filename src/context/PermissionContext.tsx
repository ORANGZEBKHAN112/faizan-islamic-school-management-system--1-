import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';
import { PermissionAction, PermissionMap, hasPermission as checkPermission, isSuperAdminRole } from '../config/permissions';

interface PermissionContextValue {
  permissions: PermissionMap;
  can: (moduleKey: string, action?: PermissionAction) => boolean;
  canView: (moduleKey: string) => boolean;
  canCreate: (moduleKey: string) => boolean;
  canUpdate: (moduleKey: string) => boolean;
  canDelete: (moduleKey: string) => boolean;
}

const PermissionContext = createContext<PermissionContextValue>({
  permissions: {},
  can: () => false,
  canView: () => false,
  canCreate: () => false,
  canUpdate: () => false,
  canDelete: () => false,
});

interface PermissionProviderProps {
  permissions?: PermissionMap;
  role?: string | null;
  children: ReactNode;
}

export function PermissionProvider({ permissions = {}, role, children }: PermissionProviderProps) {
  const can = useCallback(
    (moduleKey: string, action: PermissionAction = 'view') => {
      if (isSuperAdminRole(role)) return true;
      return checkPermission(permissions, moduleKey, action, role);
    },
    [permissions, role]
  );

  const value = useMemo(
    () => ({
      permissions,
      can,
      canView: (moduleKey: string) => can(moduleKey, 'view'),
      canCreate: (moduleKey: string) => can(moduleKey, 'create'),
      canUpdate: (moduleKey: string) => can(moduleKey, 'update'),
      canDelete: (moduleKey: string) => can(moduleKey, 'delete'),
    }),
    [permissions, can]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionContext);
}

interface PermissionGateProps {
  module: string;
  action?: PermissionAction;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ module, action = 'view', children, fallback = null }: PermissionGateProps) {
  const { can } = usePermissions();
  if (!can(module, action)) return <>{fallback}</>;
  return <>{children}</>;
}
