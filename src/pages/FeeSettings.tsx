import React, { useEffect, useState } from 'react';
import { Settings, Edit2, Save, XCircle, Banknote, School, Copy } from 'lucide-react';
import { Class, FeeSetting, Campus } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export default function FeeSettings() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [feeSettings, setFeeSettings] = useState<FeeSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingClassWide, setApplyingClassWide] = useState<string | null>(null);
  const [syncingFromStructures, setSyncingFromStructures] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    monthlyFee: 0,
    admissionFee: 0,
    securityFee: 0,
    examFee: 0,
    transportFee: 0,
    miscFee: 0,
    summerCampFee: 0,
    idCardFee: 0,
    tripFee: 0,
  });

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

  useEffect(() => {
    const loadFeeSettings = async () => {
      if (!selectedCampusId) return;
      setLoading(true);
      try {
        const feesData = await dataService.fetchFeeSettings(selectedCampusId);
        setFeeSettings(feesData);
      } catch (error) {
        console.error('Error loading fee settings:', error);
        toast.error('Failed to load fee settings');
      } finally {
        setLoading(false);
      }
    };
    loadFeeSettings();
  }, [selectedCampusId]);

  const handleEdit = (fee: any) => {
    setSelectedClass(fee);
    setFormData({
      monthlyFee: fee.monthlyFee || 0,
      admissionFee: fee.admissionFee || 0,
      securityFee: fee.securityFee || 0,
      examFee: fee.examFee || 0,
      transportFee: fee.transportFee || 0,
      miscFee: fee.miscFee || 0,
      summerCampFee: fee.summerCampFee || 0,
      idCardFee: fee.idCardFee || 0,
      tripFee: fee.tripFee || 0,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;

    try {
      await dataService.add('fee-settings', {
        classId: selectedClass.classId,
        ...formData
      });
      toast.success('Fee settings updated successfully');
      setIsModalOpen(false);
      // Refresh data
      const feesData = await dataService.fetchFeeSettings(selectedCampusId);
      setFeeSettings(feesData);
    } catch (error) {
      console.error('Error saving fee settings:', error);
      const msg = (error as any)?.response?.data?.message;
      toast.error(msg || 'Failed to save fee settings');
    }
  };

  const handleApplyClassWide = async (classId: string) => {
    try {
      setApplyingClassWide(classId);
      const result = await dataService.applyClassWideFeeSettings(classId);
      toast.success(`${result.className}: updated ${result.updatedCount} section(s)`);
      const feesData = await dataService.fetchFeeSettings(selectedCampusId);
      setFeeSettings(feesData);
    } catch (error) {
      console.error('Error applying class-wide fee settings:', error);
      const msg = (error as any)?.response?.data?.message;
      toast.error(msg || 'Failed to apply settings to all sections');
    } finally {
      setApplyingClassWide(null);
    }
  };

  const handleSyncFromStructures = async () => {
    if (!selectedCampusId) return;
    try {
      setSyncingFromStructures(true);
      const result = await dataService.syncFeeSettingsFromStructures(selectedCampusId, false);
      toast.success(`Synced ${result.updatedCount + result.insertedCount} class setting(s) from structures`);
      const feesData = await dataService.fetchFeeSettings(selectedCampusId);
      setFeeSettings(feesData);
    } catch (error) {
      console.error('Error syncing fee settings from structures:', error);
      const msg = (error as any)?.response?.data?.message;
      toast.error(msg || 'Failed to sync fee settings from structures');
    } finally {
      setSyncingFromStructures(false);
    }
  };

  const coverage = {
    totalClasses: feeSettings.length,
    configuredClasses: feeSettings.filter((f: any) => Number(f.monthlyFee || 0) > 0).length,
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Fee Settings</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Configure fee structures for each class.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncFromStructures}
            disabled={syncingFromStructures || !selectedCampusId}
            className="vibrant-btn-secondary px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
          >
            {syncingFromStructures ? 'Syncing…' : 'Sync From Structures'}
          </button>
          <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="p-2 bg-primary/10 rounded-xl text-primary">
            <School className="w-5 h-5" />
          </div>
          <select 
            className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest pr-8 cursor-pointer"
            value={selectedCampusId}
            onChange={(e) => setSelectedCampusId(e.target.value)}
          >
            {campuses.map(campus => (
              <option key={campus.id} value={campus.id}>{campus.campusName}</option>
            ))}
          </select>
          </div>
        </div>
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="px-8 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-6">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Total classes: <span className="text-slate-900 dark:text-white">{coverage.totalClasses}</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-success">
            Configured: <span>{coverage.configuredClasses}</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-danger">
            Missing: <span>{Math.max(0, coverage.totalClasses - coverage.configuredClasses)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Class Name</th>
                <th className="px-8 py-5">Monthly Fee</th>
                <th className="px-8 py-5">Admission Fee</th>
                <th className="px-8 py-5">Security Fee</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-10 text-center">
                    <div className="flex items-center justify-center gap-3 text-slate-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Loading Settings...</span>
                    </div>
                  </td>
                </tr>
              ) : feeSettings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-10 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest">
                    No classes found for this campus.
                  </td>
                </tr>
              ) : feeSettings.map((fee: any) => (
                <tr key={fee.classId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">{fee.className}</div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{fee.sectionName}</div>
                  </td>
                  <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                    Rs. {fee.monthlyFee || 0}
                  </td>
                  <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                    Rs. {fee.admissionFee || 0}
                  </td>
                  <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                    Rs. {fee.securityFee || 0}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <motion.button 
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => handleApplyClassWide(fee.classId)}
                        disabled={applyingClassWide === fee.classId}
                        className="p-2.5 text-slate-400 hover:text-secondary hover:bg-secondary/10 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
                        title="Apply these fees to all sections of same class name"
                      >
                        <Copy className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          {applyingClassWide === fee.classId ? 'Applying…' : 'Apply All Sections'}
                        </span>
                      </motion.button>
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleEdit(fee)}
                        className="p-2.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-xl transition-all flex items-center gap-2"
                      >
                        <Edit2 className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Edit Fees</span>
                      </motion.button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && selectedClass && (
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
                    <Banknote className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                      Set Fees
                    </h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedClass.className}</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-10 space-y-8 bg-white dark:bg-slate-900">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Monthly Fee (Rs.)</label>
                  <input
                    type="number"
                    required
                    className="vibrant-input"
                    value={formData.monthlyFee}
                    onChange={(e) => setFormData({ ...formData, monthlyFee: parseFloat(e.target.value) })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Admission Fee (Rs.)</label>
                  <input
                    type="number"
                    required
                    className="vibrant-input"
                    value={formData.admissionFee}
                    onChange={(e) => setFormData({ ...formData, admissionFee: parseFloat(e.target.value) })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Security Fee (Rs.)</label>
                  <input
                    type="number"
                    required
                    className="vibrant-input"
                    value={formData.securityFee}
                    onChange={(e) => setFormData({ ...formData, securityFee: parseFloat(e.target.value) })}
                    placeholder="0.00"
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Exam Fee (Rs.)</label>
                    <input
                      type="number"
                      className="vibrant-input"
                      value={formData.examFee}
                      onChange={(e) => setFormData({ ...formData, examFee: parseFloat(e.target.value) })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Transport (Rs.)</label>
                    <input
                      type="number"
                      className="vibrant-input"
                      value={formData.transportFee}
                      onChange={(e) => setFormData({ ...formData, transportFee: parseFloat(e.target.value) })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Summer Camp (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.summerCampFee} onChange={(e) => setFormData({ ...formData, summerCampFee: parseFloat(e.target.value) })} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID Card (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.idCardFee} onChange={(e) => setFormData({ ...formData, idCardFee: parseFloat(e.target.value) })} placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Educational Trip (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.tripFee} onChange={(e) => setFormData({ ...formData, tripFee: parseFloat(e.target.value) })} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Misc Fee (Rs.)</label>
                    <input type="number" className="vibrant-input" value={formData.miscFee} onChange={(e) => setFormData({ ...formData, miscFee: parseFloat(e.target.value) })} placeholder="0.00" />
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
                    Save Changes
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
