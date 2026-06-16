import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, Shield, Save, Trash2, Edit2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { dataService } from '../services/dataService';
import { AppRole, PermissionMap, PermissionModuleDef } from '../types';
import { emptyPermissionMap, fullPermissionMap, SUPER_ADMIN_ROLE } from '../config/permissions';
import { useConfirm } from '../context/ConfirmContext';
import { usePermissions } from '../context/PermissionContext';

type ActionKey = 'view' | 'create' | 'update' | 'delete';

const ACTION_LABELS: Record<ActionKey, string> = {
  view: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

export default function RoleManagement() {
  const confirm = useConfirm();
  const { canCreate, canUpdate, canDelete } = usePermissions();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [modules, setModules] = useState<PermissionModuleDef[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AppRole | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  const isSuperAdmin = selectedRole?.name === SUPER_ADMIN_ROLE;

  const groupedModules = useMemo(() => {
    const groups = new Map<string, PermissionModuleDef[]>();
    for (const mod of modules) {
      const list = groups.get(mod.group) ?? [];
      list.push(mod);
      groups.set(mod.group, list);
    }
    return Array.from(groups.entries());
  }, [modules]);

  const loadRoles = async () => {
    const rows = await dataService.fetchAppRoles();
    setRoles(rows);
    if (!selectedRoleId && rows.length > 0) setSelectedRoleId(rows[0].id);
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [roleRows, moduleRows] = await Promise.all([
          dataService.fetchAppRoles(),
          dataService.fetchPermissionModules(),
        ]);
        setRoles(roleRows);
        setModules(moduleRows);
        if (roleRows.length > 0) setSelectedRoleId(roleRows[0].id);
      } catch (error) {
        console.error(error);
        toast.error('Failed to load roles');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!selectedRoleId) {
      setPermissions(emptyPermissionMap(modules.map((m) => m.key)));
      return;
    }
    const loadPerms = async () => {
      try {
        if (roles.find((r) => r.id === selectedRoleId)?.name === SUPER_ADMIN_ROLE) {
          setPermissions(fullPermissionMap());
          return;
        }
        const map = await dataService.fetchRolePermissions(selectedRoleId);
        setPermissions(map);
      } catch (error) {
        console.error(error);
        toast.error('Failed to load permissions');
      }
    };
    loadPerms();
  }, [selectedRoleId, modules, roles]);

  const togglePermission = (moduleKey: string, action: ActionKey) => {
    if (!canUpdate('roles') || isSuperAdmin) return;
    setPermissions((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev[moduleKey] ?? { view: false, create: false, update: false, delete: false }),
        [action]: !prev[moduleKey]?.[action],
      },
    }));
  };

  const setRowAll = (moduleKey: string, value: boolean) => {
    if (!canUpdate('roles') || isSuperAdmin) return;
    setPermissions((prev) => ({
      ...prev,
      [moduleKey]: { view: value, create: value, update: value, delete: value },
    }));
  };

  const handleSavePermissions = async () => {
    if (!selectedRoleId || !canUpdate('roles') || isSuperAdmin) return;
    try {
      setSaving(true);
      await dataService.saveRolePermissions(selectedRoleId, permissions);
      toast.success('Permissions saved. Users must log in again to pick up changes.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingRole(null);
    setFormData({ name: '', description: '' });
    setIsModalOpen(true);
  };

  const openEdit = (role: AppRole) => {
    setEditingRole(role);
    setFormData({ name: role.name, description: role.description || '' });
    setIsModalOpen(true);
  };

  const handleSubmitRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Role name is required');
      return;
    }
    try {
      if (editingRole) {
        if (!canUpdate('roles')) return;
        await dataService.updateAppRole(editingRole.id, {
          name: formData.name.trim(),
          description: formData.description.trim(),
        });
        toast.success('Role updated');
      } else {
        if (!canCreate('roles')) return;
        const created = await dataService.createAppRole({
          name: formData.name.trim(),
          description: formData.description.trim(),
          permissions: emptyPermissionMap(modules.map((m) => m.key)),
        });
        toast.success('Role created');
        setSelectedRoleId(created.id);
      }
      setIsModalOpen(false);
      await loadRoles();
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save role');
    }
  };

  const handleDeleteRole = async (role: AppRole) => {
    if (!canDelete('roles') || role.isSystem) return;
    if (!await confirm({
      title: 'Delete role?',
      message: `Delete "${role.name}"? This cannot be undone.`,
      confirmLabel: 'Delete role',
    })) return;
    try {
      await dataService.deleteAppRole(role.id);
      toast.success('Role deleted');
      if (selectedRoleId === role.id) setSelectedRoleId('');
      await loadRoles();
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to delete role');
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="roles"
        actions={
          canCreate('roles') ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openCreate}
              className="vibrant-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New role
            </motion.button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
        <div className="vibrant-card p-4 space-y-2">
          <p className="section-label px-2 mb-3">Roles</p>
          {loading ? (
            <p className="text-sm text-slate-500 px-2 py-4">Loading roles…</p>
          ) : roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
                selectedRoleId === role.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{role.name}</span>
                {role.isSystem && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">System</span>
                )}
              </div>
              {role.description ? (
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{role.description}</p>
              ) : null}
            </button>
          ))}
        </div>

        <div className="vibrant-card overflow-hidden">
          {selectedRole ? (
            <>
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-primary/10 text-primary">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black">{selectedRole.name}</h3>
                    <p className="text-xs text-slate-500">{selectedRole.description || 'No description'}</p>
                    {isSuperAdmin && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-success mt-1">
                        Full access on all modules — cannot be restricted
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canUpdate('roles') && (
                    <button
                      type="button"
                      onClick={() => openEdit(selectedRole)}
                      className="px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Edit2 className="w-4 h-4 inline mr-1" />
                      Edit
                    </button>
                  )}
                  {canDelete('roles') && !selectedRole.isSystem && (
                    <button
                      type="button"
                      onClick={() => handleDeleteRole(selectedRole)}
                      className="px-4 py-2 rounded-xl border border-danger/30 text-danger text-xs font-black uppercase tracking-widest hover:bg-danger/5"
                    >
                      <Trash2 className="w-4 h-4 inline mr-1" />
                      Delete
                    </button>
                  )}
                  {canUpdate('roles') && !isSuperAdmin && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSavePermissions}
                      className="vibrant-btn-primary px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving…' : 'Save access'}
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="px-6 py-4">Module</th>
                      {(['view', 'create', 'update', 'delete'] as ActionKey[]).map((action) => (
                        <th key={action} className="px-4 py-4 text-center">{ACTION_LABELS[action]}</th>
                      ))}
                      <th className="px-4 py-4 text-center">All</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {groupedModules.map(([group, mods]) => (
                      mods.map((mod, index) => {
                        const perm = permissions[mod.key] ?? { view: false, create: false, update: false, delete: false };
                        const allOn = perm.view && perm.create && perm.update && perm.delete;
                        return (
                          <tr key={mod.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="px-6 py-3">
                              {index === 0 && (
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{group}</p>
                              )}
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{mod.label}</p>
                            </td>
                            {(['view', 'create', 'update', 'delete'] as ActionKey[]).map((action) => (
                              <td key={action} className="px-4 py-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={perm[action]}
                                  disabled={!canUpdate('roles') || isSuperAdmin}
                                  onChange={() => togglePermission(mod.key, action)}
                                  className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>
                            ))}
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={allOn}
                                disabled={!canUpdate('roles') || isSuperAdmin}
                                onChange={() => setRowAll(mod.key, !allOn)}
                                className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                              />
                            </td>
                          </tr>
                        );
                      })
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-slate-500">Select a role to manage access.</div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="vibrant-card w-full max-w-md p-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black">{editingRole ? 'Edit role' : 'New role'}</h3>
                <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-400">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleSubmitRole} className="space-y-4">
                <div>
                  <label className="vibrant-label mb-2">Role name</label>
                  <input
                    required
                    className="vibrant-input"
                    value={formData.name}
                    disabled={Boolean(editingRole?.isSystem)}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="vibrant-label mb-2">Description</label>
                  <input
                    className="vibrant-input"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">Save</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
