import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { Campus } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import FormField from '../components/ui/FormField';
import { collectErrors, email, hasErrors, phone, required } from '../utils/validation';
import { useCollection } from '../hooks/useCollection';
import PageLoader from '../components/ui/PageLoader';
import TableSkeleton from '../components/ui/TableSkeleton';
import Pagination from '../components/ui/Pagination';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { useConfirm } from '../context/ConfirmContext';
import { PermissionGate } from '../context/PermissionContext';

export default function CampusManagement() {
  const confirm = useConfirm();
  const { data: campuses, loading } = useCollection<Campus>('campuses');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    campusCode: '',
    campusName: '',
    city: '',
    region: '',
    address: '',
    phone: '',
    email: '',
    isActive: true,
    siblingDiscount2nd: 10,
    siblingDiscount3rd: 15,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = collectErrors({
      campusCode: required(formData.campusCode, 'Campus code'),
      campusName: required(formData.campusName, 'Campus name'),
      email: email(formData.email),
      phone: phone(formData.phone),
    });
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    try {
      if (editingId) {
        await dataService.update('campuses', editingId, formData);
        toast.success('Campus updated successfully');
      } else {
        await dataService.add('campuses', formData);
        toast.success('Campus added successfully');
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFieldErrors({});
      setFormData({ campusCode: '', campusName: '', city: '', region: '', address: '', phone: '', email: '', isActive: true, siblingDiscount2nd: 10, siblingDiscount3rd: 15 });
    } catch (error) {
      console.error('Error saving campus:', error);
      toast.error('Failed to save campus');
    }
  };

  const handleEdit = (campus: Campus) => {
    setEditingId(campus.id);
    setFormData({
      campusCode: campus.campusCode,
      campusName: campus.campusName,
      city: campus.city || '',
      region: campus.region || '',
      address: campus.address || '',
      phone: campus.phone || '',
      email: campus.email || '',
      isActive: campus.isActive,
      siblingDiscount2nd: campus.siblingDiscount2nd ?? 10,
      siblingDiscount3rd: campus.siblingDiscount3rd ?? 15,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({
      title: 'Delete campus?',
      message: 'This removes the campus record. Classes and students linked to it may be affected.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })) return;
    try {
      await dataService.delete('campuses', id);
      toast.success('Campus deleted successfully');
    } catch (error) {
      console.error('Error deleting campus:', error);
      toast.error('Failed to delete campus');
    }
  };

  const filteredCampuses = campuses.filter(c => 
    c?.campusName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c?.campusCode?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredCampuses.length / itemsPerPage);
  const paginatedCampuses = filteredCampuses.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return <PageLoader label="Loading campuses…" />;
  }

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="campuses"
        actions={
          <PermissionGate module="campuses" action="create">
            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setEditingId(null);
                setFormData({ campusCode: '', campusName: '', city: '', region: '', address: '', phone: '', email: '', isActive: true, siblingDiscount2nd: 10, siblingDiscount3rd: 15 });
                setIsModalOpen(true);
              }}
              className="vibrant-btn-primary px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              Add campus
            </motion.button>
          </PermissionGate>
        }
      />
      <div className="vibrant-card overflow-hidden">
        <div className="p-8 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="relative group max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search campuses..."
              className="vibrant-input pl-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8">
            <TableSkeleton rows={8} columns={6} />
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Code</th>
                <th className="px-8 py-5">Campus Name</th>
                <th className="px-8 py-5">Contact</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedCampuses.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                        <CheckCircle className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-slate-900 dark:text-white font-bold">No campuses found</p>
                        <p className="text-slate-500 text-sm">Try adjusting your search.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {paginatedCampuses.map((campus) => (
                <tr key={campus?.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="px-8 py-5 font-mono text-[10px] font-black text-primary uppercase tracking-widest">{campus?.campusCode}</td>
                  <td className="px-8 py-5">
                    <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">{campus?.campusName}</div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="text-sm font-medium text-slate-600 dark:text-slate-400">{campus?.email}</div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{campus?.phone}</div>
                  </td>
                  <td className="px-8 py-5">
                    {campus?.isActive ? (
                      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-success/10 text-success">
                        <CheckCircle className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-accent/10 text-accent">
                        <XCircle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <PermissionGate module="campuses" action="update">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleEdit(campus)}
                          className="p-2.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-xl transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </motion.button>
                      </PermissionGate>
                      <PermissionGate module="campuses" action="delete">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDelete(campus?.id)}
                          className="p-2.5 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-xl transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </motion.button>
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredCampuses.length}
          itemsPerPage={itemsPerPage}
          itemLabel="Campuses"
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="vibrant-card w-full max-w-lg overflow-hidden border-none shadow-2xl"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                    {editingId ? 'Edit Campus' : 'Add New Campus'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-10 space-y-6 bg-white dark:bg-slate-900" noValidate>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <FormField label="Campus Name" required error={fieldErrors.campusName} className="sm:col-span-2">
                    <input
                      className={`vibrant-input ${fieldErrors.campusName ? 'vibrant-input-error' : ''}`}
                      value={formData.campusName}
                      onChange={(e) => setFormData({ ...formData, campusName: e.target.value })}
                      placeholder="e.g. Faizan Campus Multan"
                    />
                  </FormField>
                  <FormField label="Campus Code" required error={fieldErrors.campusCode}>
                    <input
                      className={`vibrant-input ${fieldErrors.campusCode ? 'vibrant-input-error' : ''}`}
                      value={formData.campusCode}
                      onChange={(e) => setFormData({ ...formData, campusCode: e.target.value })}
                      placeholder="e.g. MAIN-01"
                    />
                  </FormField>
                  <FormField label="City">
                    <input className="vibrant-input" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="e.g. Multan" />
                  </FormField>
                  <FormField label="Region" className="sm:col-span-2">
                    <input className="vibrant-input" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} placeholder="e.g. Punjab" />
                  </FormField>
                </div>
                <FormField label="Email Address" error={fieldErrors.email}>
                  <input
                    type="email"
                    className={`vibrant-input ${fieldErrors.email ? 'vibrant-input-error' : ''}`}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="campus@school.com"
                  />
                </FormField>
                <FormField label="Phone Number" error={fieldErrors.phone}>
                  <input
                    className={`vibrant-input ${fieldErrors.phone ? 'vibrant-input-error' : ''}`}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+92 300 1234567"
                  />
                </FormField>
                <FormField label="Address">
                  <textarea
                    className="vibrant-input min-h-[80px]"
                    rows={3}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Full street address..."
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-4 sm:col-span-2">
                  <FormField label="Sibling discount (2nd child) %">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="vibrant-input"
                      value={formData.siblingDiscount2nd}
                      onChange={(e) => setFormData({ ...formData, siblingDiscount2nd: Number(e.target.value) || 0 })}
                    />
                  </FormField>
                  <FormField label="Sibling discount (3rd+ child) %">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="vibrant-input"
                      value={formData.siblingDiscount3rd}
                      onChange={(e) => setFormData({ ...formData, siblingDiscount3rd: Number(e.target.value) || 0 })}
                    />
                  </FormField>
                </div>
                <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-5 h-5 text-primary rounded-lg focus:ring-primary border-slate-300 dark:border-slate-600"
                  />
                  <label htmlFor="isActive" className="text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer">Active Campus</label>
                </div>
                <div className="flex gap-4 pt-6 border-t border-slate-100 dark:border-slate-800">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="vibrant-btn-primary flex-1 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20"
                  >
                    {editingId ? 'Update Campus' : 'Save Campus'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
