import React, { useState } from 'react';
import { Plus, Search, Trash2, Edit2, DollarSign, Calendar, TrendingDown, Filter, XCircle } from 'lucide-react';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useCollection } from '../hooks/useCollection';
import PageLoader from '../components/ui/PageLoader';
import SearchableSelect from '../components/ui/SearchableSelect';

interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  description?: string;
}

export default function Expenses() {
  const { data: expenses, loading } = useCollection<Expense>('expenses');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    category: 'Salaries',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = { ...formData, amount: parseFloat(formData.amount as string) };
      if (editingId) {
        await dataService.update('expenses', editingId, data);
        toast.success('Expense updated');
      } else {
        await dataService.add('expenses', data);
        toast.success('Expense recorded');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || 'Operation failed');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      category: 'Salaries',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      description: ''
    });
    setEditingId(null);
  };

  const handleEdit = (expense: Expense) => {
    setFormData({
      title: expense.title,
      category: expense.category,
      amount: expense.amount.toString(),
      date: expense.date.split('T')[0],
      description: expense.description || ''
    });
    setEditingId(expense.id);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this expense record?')) {
      await dataService.delete('expenses', id);
      toast.success('Expense deleted');
    }
  };

  const categories = ['Salaries', 'Utility Bills', 'Maintenance', 'Rent', 'Miscellaneous'];

  const stats = {
    total: expenses.reduce((acc, e) => acc + e.amount, 0),
    count: expenses.length,
    thisMonth: expenses.filter(e => new Date(e.date).getMonth() === new Date().getMonth()).reduce((acc, e) => acc + e.amount, 0)
  };

  if (loading) {
    return <PageLoader label="Loading expenses…" />;
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            <TrendingDown className="w-10 h-10 text-rose-500" />
            EXPENSES
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">Track school expenditures and bills</p>
        </div>

        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="px-8 py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Expense
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {[
          { label: 'Total Expenses', value: stats.total, icon: DollarSign, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'This Month', value: stats.thisMonth, icon: Calendar, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Total Records', value: stats.count, icon: Filter, color: 'text-primary', bg: 'bg-primary/10', isAmount: false }
        ].map((stat, i) => (
          <div key={i} className="vibrant-card p-6">
            <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center mb-4 shadow-xl`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {stat.isAmount === false ? stat.value : `Rs. ${stat.value.toLocaleString()}`}
            </h3>
          </div>
        ))}
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                <th className="px-8 py-5">Title / Description</th>
                <th className="px-8 py-5">Category</th>
                <th className="px-8 py-5">Amount</th>
                <th className="px-8 py-5">Date</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-sm font-medium text-slate-400 italic">No expense records found.</td>
                </tr>
              ) : (
                [...expenses].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-900 dark:text-white uppercase tracking-tight">{exp.title}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">{exp.description || 'No notes'}</div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[10px] font-black uppercase tracking-widest">
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-8 py-5 font-black text-rose-500 uppercase">
                      Rs. {exp.amount.toLocaleString()}
                    </td>
                    <td className="px-8 py-5 text-xs font-bold text-slate-500">
                      {new Date(exp.date).toLocaleDateString()}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(exp)} className="p-2 text-slate-400 hover:text-primary transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(exp.id)} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
             <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="vibrant-card max-w-lg w-full p-8 shadow-2xl relative"
            >
              <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-slate-400 hover:text-rose-500 transition-colors">
                <XCircle className="w-6 h-6" />
              </button>
              
              <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-6 uppercase tracking-tight">
                {editingId ? 'Edit Expense' : 'Add Expense'}
              </h2>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Title</label>
                    <input 
                      required
                      className="vibrant-input"
                      value={formData.title}
                      onChange={e => setFormData({...formData, title: e.target.value})}
                      placeholder="e.g. Electricity Bill"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                    <SearchableSelect
                      value={formData.category}
                      onChange={(category) => setFormData({ ...formData, category })}
                      searchPlaceholder="Search category…"
                      options={categories.map((c) => ({ value: c, label: c }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Amount</label>
                    <input 
                      required
                      type="number"
                      className="vibrant-input"
                      value={formData.amount}
                      onChange={e => setFormData({...formData, amount: e.target.value})}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date</label>
                    <input 
                      required
                      type="date"
                      className="vibrant-input"
                      value={formData.date}
                      onChange={e => setFormData({...formData, date: e.target.value})}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Description</label>
                  <textarea 
                    className="vibrant-input min-h-[100px]"
                    value={formData.description}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    placeholder="Optional notes..."
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all hover:bg-primary/90"
                  >
                    {editingId ? 'Update Record' : 'Record Expense'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
