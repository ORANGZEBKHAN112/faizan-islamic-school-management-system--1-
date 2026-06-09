import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, UserCog, Shield } from 'lucide-react';
import { User, Campus, UserRole } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import Pagination from '../components/ui/Pagination';

const ROLES: UserRole[] = ['Super Admin', 'Admin', 'Teacher', 'Accountant', 'Student'];

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
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
        const [userList, campusList] = await Promise.all([
          dataService.fetchUsers(),
          dataService.fetchCampuses(),
        ]);
        setUsers(userList);
        setCampuses(campusList);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">User Management</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Create and manage login accounts for staff and students</p>
        </div>
        <button
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="vibrant-btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          <span className="text-[10px] font-black uppercase tracking-widest">Add User</span>
        </button>
      </div>

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
                <th className="px-8 py-5">User</th>
                <th className="px-8 py-5">Username</th>
                <th className="px-8 py-5">Role</th>
                <th className="px-8 py-5">Campus</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginated.map((user) => (
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
                  <td className="px-8 py-5 font-mono text-sm text-slate-600 dark:text-slate-300">{user.username}</td>
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
                    <button onClick={() => handleEdit(user)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-primary transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
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
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Username</label>
                  <input className="vibrant-input" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required disabled={!!editingId} />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
                  <input type="email" className="vibrant-input" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Role</label>
                    <select className="vibrant-input" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Campus</label>
                    <select className="vibrant-input" value={formData.campusId} onChange={(e) => setFormData({ ...formData, campusId: e.target.value })} disabled={formData.role === 'Super Admin'}>
                      <option value="">— None / School-wide —</option>
                      {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
                    </select>
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
