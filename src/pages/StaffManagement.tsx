import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, Briefcase } from 'lucide-react';
import { StaffMember, Campus } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import Pagination from '../components/ui/Pagination';
import SearchableSelect from '../components/ui/SearchableSelect';

const scopeUser = getStoredUser();

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [formData, setFormData] = useState({
    fullName: '',
    cnic: '',
    qualification: '',
    salary: 0,
    joiningDate: new Date().toISOString().split('T')[0],
    campusId: scopeUser ? (defaultCampusFilter(scopeUser) !== 'all' ? defaultCampusFilter(scopeUser) : '') : '',
    role: 'Teacher',
    email: '',
    isActive: true,
  });

  const loadStaff = async () => {
    try {
      const data = await dataService.getAll('staff');
      setStaff(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load staff');
    }
  };

  useEffect(() => {
    loadStaff();
    dataService.subscribe('campuses', setCampuses);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const resetForm = () => {
    setFormData({
      fullName: '',
      cnic: '',
      qualification: '',
      salary: 0,
      joiningDate: new Date().toISOString().split('T')[0],
      campusId: scopeUser && getStoredUser()?.campusId ? getStoredUser()!.campusId! : '',
      role: 'Teacher',
      email: '',
      isActive: true,
    });
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim() || !formData.cnic.trim() || !formData.campusId) {
      toast.error('Name, CNIC, and campus are required');
      return;
    }
    try {
      if (editingId) {
        await dataService.updateStaff(editingId, formData);
        toast.success('Staff updated');
      } else {
        await dataService.addStaff(formData);
        toast.success('Staff member added');
      }
      await loadStaff();
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || 'Failed to save staff member');
    }
  };

  const handleEdit = (member: StaffMember) => {
    setEditingId(member.id);
    setFormData({
      fullName: member.fullName,
      cnic: member.cnic,
      qualification: member.qualification || '',
      salary: member.salary || 0,
      joiningDate: member.joiningDate || new Date().toISOString().split('T')[0],
      campusId: member.campusId,
      role: member.role,
      email: member.email || '',
      isActive: member.isActive,
    });
    setIsModalOpen(true);
  };

  const filtered = staff.filter((s) =>
    s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.cnic.includes(searchTerm) ||
    s.role.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Staff Management</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Manage teachers and campus staff records</p>
        </div>
        <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="vibrant-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          <span className="text-[10px] font-black uppercase tracking-widest">Add Staff</span>
        </button>
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search staff..." className="vibrant-input pl-12" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Name</th>
                <th className="px-8 py-5">Role</th>
                <th className="px-8 py-5">Campus</th>
                <th className="px-8 py-5">CNIC</th>
                <th className="px-8 py-5">Salary</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginated.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="px-8 py-5 font-bold text-slate-900 dark:text-white">{member.fullName}</td>
                  <td className="px-8 py-5 text-sm">{member.role}</td>
                  <td className="px-8 py-5 text-sm text-slate-500">{member.campusName || '—'}</td>
                  <td className="px-8 py-5 font-mono text-sm">{member.cnic}</td>
                  <td className="px-8 py-5 text-sm">Rs. {(member.salary || 0).toLocaleString()}</td>
                  <td className="px-8 py-5 text-right">
                    <button onClick={() => handleEdit(member)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-primary">
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
          itemLabel="Staff"
          onPageChange={setCurrentPage}
        />
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="vibrant-card w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-8">
                <Briefcase className="w-6 h-6 text-primary" />
                <h3 className="text-2xl font-black">{editingId ? 'Edit Staff' : 'New Staff Member'}</h3>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input className="vibrant-input" placeholder="Full name" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
                <input className="vibrant-input" placeholder="CNIC" value={formData.cnic} onChange={(e) => setFormData({ ...formData, cnic: e.target.value })} required />
                <div className="grid grid-cols-2 gap-4">
                  <SearchableSelect
                    value={formData.role}
                    onChange={(role) => setFormData({ ...formData, role })}
                    searchPlaceholder="Search role…"
                    options={['Teacher', 'Admin', 'Accountant', 'Principal', 'Coordinator'].map((r) => ({ value: r, label: r }))}
                  />
                  {(!scopeUser || canPickCampus(scopeUser)) ? (
                    <SearchableSelect
                      required
                      value={formData.campusId}
                      onChange={(campusId) => setFormData({ ...formData, campusId })}
                      placeholder="Select campus"
                      searchPlaceholder="Search campuses…"
                      options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                    />
                  ) : (
                    <div className="vibrant-input text-sm font-bold">{campuses.find((c) => c.id === formData.campusId)?.campusName}</div>
                  )}
                </div>
                <input className="vibrant-input" placeholder="Qualification" value={formData.qualification} onChange={(e) => setFormData({ ...formData, qualification: e.target.value })} />
                <input type="email" className="vibrant-input" placeholder="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" className="vibrant-input" placeholder="Salary" value={formData.salary} onChange={(e) => setFormData({ ...formData, salary: parseFloat(e.target.value) || 0 })} />
                  <input type="date" className="vibrant-input" value={formData.joiningDate} onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })} />
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">Save</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
