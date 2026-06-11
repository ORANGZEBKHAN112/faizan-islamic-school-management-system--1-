import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Save, XCircle, Banknote, School, Calendar, Copy } from 'lucide-react';
import { FeeStructure, Campus } from '../types';
import { dataService } from '../services/dataService';
import PageHeader from '../components/ui/PageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import EmptyState from '../components/ui/EmptyState';
import TableShell from '../components/ui/TableShell';
import { useConfirm } from '../context/ConfirmContext';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { deriveAcademicSession, normalizeSessionLabel } from '../utils/academicSession';

const emptyForm = {
  tuitionFee: 0,
  admissionFee: 0,
  securityFee: 0,
  examFee: 0,
  transportFee: 0,
  miscFee: 0,
  summerCampFee: 0,
  idCardFee: 0,
  tripFee: 0,
};

export default function FeeSettings() {
  const confirm = useConfirm();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingToClasses, setApplyingToClasses] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<string>('');
  const [newSessionInput, setNewSessionInput] = useState('');
  const [formData, setFormData] = useState(emptyForm);

  const defaultSession = useMemo(
    () => deriveAcademicSession(new Date().getFullYear(), new Date().getMonth() + 1),
    []
  );

  useEffect(() => {
    const loadCampuses = async () => {
      try {
        const campusesData = await dataService.fetchCampuses();
        setCampuses(campusesData);
        if (campusesData.length > 0) {
          setSelectedCampusId(campusesData[0].id);
        }
      } catch (error) {
        console.error('Error loading campuses:', error);
        toast.error('Failed to load campuses');
      }
    };
    loadCampuses();
  }, []);

  const loadStructures = async (campusId: string) => {
    if (!campusId) return;
    setLoading(true);
    try {
      const rows = await dataService.fetchCampusFeeStructures(campusId);
      setStructures(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error('Error loading fee structures:', error);
      toast.error('Failed to load campus fee structures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStructures(selectedCampusId);
  }, [selectedCampusId]);

  const openCreate = () => {
    setEditingSession('');
    setNewSessionInput(defaultSession);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEdit = (row: FeeStructure) => {
    setEditingSession(row.sessionLabel);
    setNewSessionInput(row.sessionLabel);
    setFormData({
      tuitionFee: row.tuitionFee ?? row.monthlyFee ?? 0,
      admissionFee: row.admissionFee ?? 0,
      securityFee: row.securityFee ?? 0,
      examFee: row.examFee ?? 0,
      transportFee: row.transportFee ?? 0,
      miscFee: row.miscFee ?? 0,
      summerCampFee: row.summerCampFee ?? 0,
      idCardFee: row.idCardFee ?? 0,
      tripFee: row.tripFee ?? 0,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampusId) return;

    const sessionLabel = normalizeSessionLabel(
      editingSession || newSessionInput,
      new Date().getFullYear()
    );
    if (!/^\d{4}-\d{4}$/.test(sessionLabel)) {
      toast.error('Session must be in format 2026-2027');
      return;
    }

    try {
      setSaving(true);
      await dataService.saveCampusFeeStructure({
        campusId: selectedCampusId,
        sessionLabel,
        ...formData,
        monthlyFee: formData.tuitionFee,
      });
      toast.success(`Fee structure saved for session ${sessionLabel}`);
      setIsModalOpen(false);
      await loadStructures(selectedCampusId);
    } catch (error) {
      console.error('Error saving fee structure:', error);
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save fee structure');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyToClasses = async (sessionLabel: string) => {
    if (!selectedCampusId) return;
    if (!await confirm({
      title: 'Sync to class settings?',
      message: `Copy session ${sessionLabel} fees to all class fee settings on this campus?`,
      confirmLabel: 'Sync classes',
    })) return;
    try {
      setApplyingToClasses(true);
      const result = await dataService.applyCampusFeeStructureToClasses(selectedCampusId, sessionLabel);
      toast.success(`${result.updatedCount} class setting(s) updated from campus structure`);
    } catch (error) {
      console.error('Error applying campus structure to classes:', error);
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to apply structure to classes');
    } finally {
      setApplyingToClasses(false);
    }
  };

  const campusName = campuses.find((c) => c.id === selectedCampusId)?.campusName || 'Campus';

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Fee Settings"
        description="One fee structure per campus per academic session (e.g. 2026-2027). All students on that campus use the session structure for voucher generation."
        filters={
          <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <div className="p-2 bg-primary/10 rounded-xl text-primary">
              <School className="w-4 h-4" />
            </div>
            <SearchableSelect
              variant="inline"
              value={selectedCampusId}
              onChange={setSelectedCampusId}
              options={campuses.map((campus) => ({ value: campus.id, label: campus.campusName }))}
              placeholder="Select campus"
              searchPlaceholder="Search campuses…"
            />
          </div>
        }
        actions={
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openCreate}
            disabled={!selectedCampusId}
            className="vibrant-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            Add session
          </motion.button>
        }
      />

      {!loading && structures.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No fee structure for this campus"
          description={`Add a session for ${campusName} (e.g. ${defaultSession}) before generating vouchers.`}
          actionLabel="Add session"
          onAction={openCreate}
        />
      ) : (
      <div className="vibrant-card overflow-hidden">
        <div className="px-8 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-6 flex-wrap">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Campus: <span className="text-slate-900 dark:text-white">{campusName}</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-success">
            Sessions configured: <span>{structures.length}</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Current session: {defaultSession}
          </div>
        </div>
        <div className="overflow-x-auto">
          <TableShell hint="Swipe to see all fee columns">
            <table className="w-full min-w-[720px] text-left border-collapse table-sticky-head">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Academic Session</th>
                <th className="px-8 py-5">Monthly Fee</th>
                <th className="px-8 py-5">Admission</th>
                <th className="px-8 py-5">Security</th>
                <th className="px-8 py-5">Last Updated</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-8 py-10 text-center">
                    <div className="flex items-center justify-center gap-3 text-slate-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Loading structures…</span>
                    </div>
                  </td>
                </tr>
              ) : structures.length === 0 ? null : (
                structures.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">
                        {row.sessionLabel}
                      </div>
                    </td>
                    <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                      Rs. {row.tuitionFee ?? row.monthlyFee ?? 0}
                    </td>
                    <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                      Rs. {row.admissionFee ?? 0}
                    </td>
                    <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                      Rs. {row.securityFee ?? 0}
                    </td>
                    <td className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {row.lastUpdated ? new Date(row.lastUpdated).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <motion.button
                          whileHover={{ scale: 1.06 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => handleApplyToClasses(row.sessionLabel)}
                          disabled={applyingToClasses}
                          className="p-2.5 text-slate-400 hover:text-secondary hover:bg-secondary/10 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
                          title="Copy to per-class fee settings (legacy)"
                        >
                          <Copy className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">
                            Sync Classes
                          </span>
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => openEdit(row)}
                          className="p-2.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-xl transition-all flex items-center gap-2"
                        >
                          <Edit2 className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Edit</span>
                        </motion.button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </TableShell>
        </div>
      </div>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="vibrant-card w-full max-w-lg overflow-hidden border-none shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <Banknote className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                      {editingSession ? 'Edit Session Fees' : 'New Session Fees'}
                    </h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{campusName}</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-10 space-y-6 bg-white dark:bg-slate-900">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Academic Session (e.g. 2026-2027)
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!!editingSession}
                    className="vibrant-input font-black"
                    value={editingSession || newSessionInput}
                    onChange={(e) => setNewSessionInput(e.target.value)}
                    placeholder="2026-2027"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Monthly / Tuition Fee (Rs.)</label>
                  <input
                    type="number"
                    required
                    className="vibrant-input"
                    value={formData.tuitionFee}
                    onChange={(e) => setFormData({ ...formData, tuitionFee: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Admission (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.admissionFee} onChange={(e) => setFormData({ ...formData, admissionFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Security (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.securityFee} onChange={(e) => setFormData({ ...formData, securityFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Exam (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.examFee} onChange={(e) => setFormData({ ...formData, examFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Transport (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.transportFee} onChange={(e) => setFormData({ ...formData, transportFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Summer Camp (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.summerCampFee} onChange={(e) => setFormData({ ...formData, summerCampFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID Card (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.idCardFee} onChange={(e) => setFormData({ ...formData, idCardFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Trip (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.tripFee} onChange={(e) => setFormData({ ...formData, tripFee: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Misc (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.miscFee} onChange={(e) => setFormData({ ...formData, miscFee: parseFloat(e.target.value) || 0 })} />
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
                    disabled={saving}
                    className="vibrant-btn-primary flex-1 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving…' : 'Save Structure'}
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
