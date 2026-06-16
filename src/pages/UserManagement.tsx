import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, UserCog, Shield } from 'lucide-react';
import { User, Campus, UserRole, AppRole } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import Pagination from '../components/ui/Pagination';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import EmptyState from '../components/ui/EmptyState';
import { PermissionGate } from '../context/PermissionContext';
import { isStudentRollUsername, suggestLoginUsername, staffUsernameFromRoll } from '../utils/username';

const ROLES: UserRole[] = ['Super Admin', 'Admin', 'Teacher', 'Accountant', 'Student'];

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [roleOptions, setRoleOptions] = useState<AppRole[]>([]);
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    email: '',
    role: 'Teacher' as UserRole,
    campusId: '',
    isActive: true,
    password: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [userList, campusList, roles] = await Promise.all([
          dataService.fetchUsers(),
          dataService.fetchCampuses(),
          dataService.fetchAppRoles().catch(() => []),
        ]);
        setUsers(userList);
        setCampuses(campusList);
        setRoleOptions(roles.filter((r) => r.isActive));
      } catch (err) {
        console.error(err);
        toast.error('Failed to load users');
      }
    };
    load();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (editingId || formData.role === 'Student') return;
    if (!formData.fullName.trim()) return;
    if (!formData.username.trim() || isStudentRollUsername(formData.username)) {
      setFormData((prev) => ({ ...prev, username: suggestLoginUsername(formData.fullName) }));
    }
  }, [formData.fullName, formData.role, editingId]);

  const resetForm = () => {
    setFormData({
      fullName: '',
      username: '',
      email: '',
      role: 'Teacher',
      campusId: '',
      isActive: true,
      password: '',
    });
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim() || !formData.username.trim()) {
      toast.error('Full name and username are required');
      return;
    }
    if (formData.role !== 'Super Admin' && formData.role !== 'Student' && !formData.campusId) {
      toast.error('Campus is required for this role');
      return;
    }

    try {
      if (editingId) {
        const payload: Record<string, unknown> = {
          fullName: formData.fullName,
          email: formData.email || null,
          role: formData.role,
          campusId: formData.campusId || null,
          isActive: formData.isActive,
        };
        if (formData.password.trim()) payload.password = formData.password;
        if (formData.username.trim() && formData.username !== users.find((u) => u.id === editingId)?.username) {
          payload.username = formData.username.trim();
        }
        await dataService.updateUser(editingId, payload);
        toast.success('User updated');
      } else {
        await dataService.registerUser({
          fullName: formData.fullName,
          username: formData.username,
          email: formData.email || null,
          role: formData.role,
          campusId: formData.campusId || null,
          isActive: formData.isActive,
          password: formData.password || formData.username,
        });
        toast.success('User created');
      }
      const userList = await dataService.fetchUsers();
      setUsers(userList);
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save user');
    }
  };

  const handleEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({
      fullName: user.fullName,
      username: user.username,
      email: user.email || '',
      role: user.role,
      campusId: user.campusId || '',
      isActive: user.isActive,
      password: '',
    });
    setIsModalOpen(true);
  };

  const filtered = users.filter((u) =>
    u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="users"
        actions={
          <PermissionGate module="users" action="create">
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="vibrant-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              Add user
            </button>
          </PermissionGate>
        }
      />

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search users..."
              className="vibrant-input pl-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Name</th>
                <th className="px-8 py-5">Login username</th>
                <th className="px-8 py-5">Role</th>
                <th className="px-8 py-5">Campus</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-4">
                    <EmptyState
                      compact
                      title={searchTerm ? 'No users match your search' : 'No users yet'}
                      description={searchTerm ? 'Try a different name, username, or role.' : 'Add staff or student login accounts to get started.'}
                      icon={UserCog}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-xl text-primary">
                        <UserCog className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{user.fullName}</p>
                        <p className="text-xs text-slate-400">{user.email || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <p className="font-mono text-sm text-slate-600 dark:text-slate-300">{user.username}</p>
                    {user.linkedStudentRoll && user.role !== 'Student' && (
                      <p className="text-[10px] text-slate-400 mt-0.5">Student roll: {user.linkedStudentRoll}</p>
                    )}
                    {staffUsernameFromRoll(user.role, user.username) && (
                      <p className="text-[10px] text-accent font-bold mt-0.5">Uses student roll as login — edit to fix</p>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-[10px] font-black uppercase tracking-widest">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-slate-500">
                    {campuses.find((c) => c.id === user.campusId)?.campusName || (user.role === 'Super Admin' ? 'All' : '—')}
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${user.isActive ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {user.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <PermissionGate module="users" action="update">
                      <button onClick={() => handleEdit(user)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-primary transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </PermissionGate>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filtered.length}
          itemsPerPage={itemsPerPage}
          itemLabel="Users"
          onPageChange={setCurrentPage}
        />
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="vibrant-card w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-8">
                <Shield className="w-6 h-6 text-primary" />
                <h3 className="text-2xl font-black text-slate-900 dark:text-white">{editingId ? 'Edit User' : 'New User'}</h3>
              </div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Full Name</label>
                  <input className="vibrant-input" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Login username
                  </label>
                  <input
                    className="vibrant-input font-mono"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.replace(/\s+/g, '').toLowerCase() })}
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {formData.role === 'Student'
                      ? 'Students use their roll number (e.g. STU-2026-0001) to log in.'
                      : 'Staff use a short name (e.g. danish2), not a student roll number.'}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
                  <input type="email" className="vibrant-input" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Role</label>
                    <SearchableSelect
                      value={formData.role}
                      onChange={(role) => {
                        const nextRole = role as UserRole;
                        const nextUsername = nextRole === 'Student'
                          ? formData.username
                          : (isStudentRollUsername(formData.username)
                            ? suggestLoginUsername(formData.fullName)
                            : formData.username);
                        setFormData({ ...formData, role: nextRole, username: nextUsername });
                      }}
                      searchPlaceholder="Search role…"
                      options={(roleOptions.length > 0
                        ? roleOptions
                        : ROLES.map((name) => ({ id: name, name, isSystem: true, isActive: true } as AppRole))
                      ).map((r) => ({ value: r.name, label: r.name }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Campus</label>
                    <SearchableSelect
                      value={formData.campusId}
                      onChange={(campusId) => setFormData({ ...formData, campusId })}
                      disabled={formData.role === 'Super Admin'}
                      placeholder="— None / School-wide —"
                      searchPlaceholder="Search campuses…"
                      options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    {editingId ? 'New Password (optional)' : 'Password (defaults to username)'}
                  </label>
                  <input type="password" className="vibrant-input" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder={editingId ? 'Leave blank to keep current' : formData.username} />
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="rounded border-slate-300 text-primary" />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Account active</span>
                </label>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">{editingId ? 'Update' : 'Create'}</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
