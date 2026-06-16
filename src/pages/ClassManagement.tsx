import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, Trash2, BookOpen, XCircle } from 'lucide-react';
import { Class, Campus } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { collectErrors, hasErrors, positiveNumber, required } from '../utils/validation';
import { useCollection } from '../hooks/useCollection';
import PageLoader from '../components/ui/PageLoader';
import TableSkeleton from '../components/ui/TableSkeleton';
import Pagination from '../components/ui/Pagination';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { useConfirm } from '../context/ConfirmContext';
import { PermissionGate } from '../context/PermissionContext';
import SearchableSelect from '../components/ui/SearchableSelect';

export default function ClassManagement() {
  const confirm = useConfirm();
  const { data: classes, loading: classesLoading } = useCollection<Class>('classes');
  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCampus, setSelectedCampus] = useState<string>('all');
  const [formData, setFormData] = useState({
    campusId: '',
    className: '',
    sectionName: '',
    capacity: 40,
    shift: 'Morning'
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCampus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const errors = collectErrors({
      campusId: required(formData.campusId, 'Campus'),
      className: required(formData.className, 'Class name'),
      capacity: positiveNumber(formData.capacity, 'Capacity'),
    });
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    try {
      if (editingId) {
        await dataService.update('classes', editingId, formData);
        toast.success('Class updated successfully');
      } else {
        await dataService.add('classes', formData);
        toast.success('Class added successfully');
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFieldErrors({});
      setFormData({ campusId: '', className: '', sectionName: '', capacity: 40, shift: 'Morning' });
    } catch (error) {
      console.error('Error saving class:', error);
      const msg = (error as any)?.response?.data?.message;
      toast.error(msg || 'Failed to save class');
    }
  };

  const handleEdit = (cls: Class) => {
    setEditingId(cls.id);
    setFormData({
      campusId: cls.campusId,
      className: cls.className,
      sectionName: cls.sectionName || '',
      capacity: cls.capacity || 40,
      shift: cls.shift || 'Morning'
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({
      title: 'Delete class?',
      message: 'Students assigned to this class will need to be moved separately.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })) return;
    try {
      await dataService.delete('classes', id);
      toast.success('Class deleted successfully');
    } catch (error) {
      console.error('Error deleting class:', error);
      toast.error('Failed to delete class');
    }
  };

  const filteredClasses = classes.filter(c => {
    const matchesSearch = c?.className?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCampus = selectedCampus === 'all' || c?.campusId === selectedCampus;
    return matchesSearch && matchesCampus;
  });

  const totalPages = Math.ceil(filteredClasses.length / itemsPerPage);
  const paginatedClasses = filteredClasses.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const loading = classesLoading || campusesLoading;

  if (loading) {
    return <PageLoader label="Loading classes…" />;
  }

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="classes"
        actions={
          <PermissionGate module="classes" action="create">
            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setEditingId(null);
                setFormData({ campusId: '', className: '', sectionName: '', capacity: 40, shift: 'Morning' });
                setIsModalOpen(true);
              }}
              className="vibrant-btn-primary px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              Add class
            </motion.button>
          </PermissionGate>
        }
      />

      <div className="vibrant-card overflow-hidden">
        <div className="p-8 border-b border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search classes..."
              className="vibrant-input pl-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <SearchableSelect
            variant="compact"
            value={selectedCampus}
            onChange={setSelectedCampus}
            placeholder="All Campuses"
            searchPlaceholder="Search campuses…"
            options={[
              { value: 'all', label: 'All Campuses' },
              ...campuses.map((c) => ({ value: c?.id ?? '', label: c?.campusName ?? '' })),
            ]}
          />
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
                <th className="px-8 py-5">Class Name</th>
                <th className="px-8 py-5">Section</th>
                <th className="px-8 py-5">Campus</th>
                <th className="px-8 py-5">Capacity</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedClasses.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-sm text-slate-400 font-medium italic">No classes found.</td>
                </tr>
              )}
              {paginatedClasses.map((cls) => (
                <tr key={cls?.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-primary/10 text-primary rounded-2xl group-hover:bg-primary group-hover:text-white transition-all">
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white">{cls?.className}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {cls?.sectionName || 'N/A'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm font-medium text-slate-500 dark:text-slate-400">
                    {campuses.find((c) => c.id === cls?.campusId)?.campusName || 'Unknown'}
                  </td>
                  <td className="px-8 py-5">
                    <div className="text-sm font-black text-slate-900 dark:text-white">
                      {cls?.enrolledCount ?? 0} / {cls?.capacity ?? '—'}
                    </div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {(cls?.capacity && (cls.enrolledCount ?? 0) >= cls.capacity) ? 'Full' : 'Enrolled'}
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <PermissionGate module="classes" action="update">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleEdit(cls)}
                          className="p-2.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-xl transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </motion.button>
                      </PermissionGate>
                      <PermissionGate module="classes" action="delete">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDelete(cls?.id)}
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
          totalItems={filteredClasses.length}
          itemsPerPage={itemsPerPage}
          itemLabel="Classes"
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
                    <BookOpen className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                    {editingId ? 'Edit Class' : 'Add New Class'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-10 space-y-8 bg-white dark:bg-slate-900">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Campus</label>
                  <SearchableSelect
                    required
                    value={formData.campusId}
                    onChange={(campusId) => setFormData({ ...formData, campusId })}
                    placeholder="Choose a campus..."
                    searchPlaceholder="Search campuses…"
                    options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Name</label>
                    <input
                      required
                      className="vibrant-input"
                      value={formData.className}
                      onChange={(e) => setFormData({ ...formData, className: e.target.value })}
                      placeholder="e.g. Grade 10"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Section Name</label>
                    <input
                      className="vibrant-input"
                      value={formData.sectionName}
                      onChange={(e) => setFormData({ ...formData, sectionName: e.target.value })}
                      placeholder="e.g. Section A"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Capacity</label>
                    <input
                      type="number"
                      className="vibrant-input"
                      value={formData.capacity}
                      onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Shift</label>
                    <SearchableSelect
                      value={formData.shift}
                      onChange={(shift) => setFormData({ ...formData, shift })}
                      options={[
                        { value: 'Morning', label: 'Morning' },
                        { value: 'Evening', label: 'Evening' },
                      ]}
                    />
                  </div>
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
                    {editingId ? 'Update Class' : 'Save Class'}
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
