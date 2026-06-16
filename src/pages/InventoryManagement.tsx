import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, Package, AlertTriangle } from 'lucide-react';
import { InventoryItem } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';

export default function InventoryManagement() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    itemName: '',
    category: 'Supplies',
    quantity: 0,
    unit: 'pcs',
    minThreshold: 5,
  });

  useEffect(() => {
    return dataService.subscribe('inventory', setItems);
  }, []);

  const resetForm = () => {
    setFormData({ itemName: '', category: 'Supplies', quantity: 0, unit: 'pcs', minThreshold: 5 });
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemName.trim()) {
      toast.error('Item name is required');
      return;
    }
    try {
      if (editingId) {
        await dataService.update('inventory', editingId, formData);
        toast.success('Item updated');
      } else {
        await dataService.add('inventory', formData);
        toast.success('Item added');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save item');
    }
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setFormData({
      itemName: item.itemName,
      category: item.category || 'Supplies',
      quantity: item.quantity,
      unit: item.unit || 'pcs',
      minThreshold: item.minThreshold,
    });
    setIsModalOpen(true);
  };

  const filtered = items.filter((i) =>
    i.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lowStock = items.filter((i) => i.quantity <= i.minThreshold);

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="inventory"
        actions={
          <PermissionGate module="inventory" action="create">
            <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="vibrant-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
              <Plus className="w-4 h-4" />
              Add item
            </button>
          </PermissionGate>
        }
      />

      {lowStock.length > 0 && (
        <div className="vibrant-card p-6 flex items-center gap-4 border-warning/20 bg-warning/5">
          <AlertTriangle className="w-6 h-6 text-warning shrink-0" />
          <p className="text-sm font-bold text-warning">{lowStock.length} item(s) below minimum threshold</p>
        </div>
      )}

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search inventory..." className="vibrant-input pl-12" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Item</th>
                <th className="px-8 py-5">Category</th>
                <th className="px-8 py-5">Quantity</th>
                <th className="px-8 py-5">Min</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((item) => (
                <tr key={item.id} className={item.quantity <= item.minThreshold ? 'bg-warning/5' : ''}>
                  <td className="px-8 py-5 font-bold flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    {item.itemName}
                  </td>
                  <td className="px-8 py-5 text-sm">{item.category}</td>
                  <td className="px-8 py-5 font-black">{item.quantity} {item.unit}</td>
                  <td className="px-8 py-5 text-sm text-slate-400">{item.minThreshold}</td>
                  <td className="px-8 py-5 text-right">
                    <PermissionGate module="inventory" action="update">
                      <button onClick={() => handleEdit(item)} className="p-2 hover:text-primary text-slate-400"><Edit2 className="w-4 h-4" /></button>
                    </PermissionGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-md p-8">
              <h3 className="text-2xl font-black mb-6">{editingId ? 'Edit Item' : 'New Item'}</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input className="vibrant-input" placeholder="Item name" value={formData.itemName} onChange={(e) => setFormData({ ...formData, itemName: e.target.value })} required />
                <SearchableSelect
                  value={formData.category}
                  onChange={(category) => setFormData({ ...formData, category })}
                  searchPlaceholder="Search category…"
                  options={['Supplies', 'Furniture', 'Books', 'Electronics', 'Uniforms', 'Other'].map((c) => ({ value: c, label: c }))}
                />
                <div className="grid grid-cols-3 gap-4">
                  <input type="number" className="vibrant-input" placeholder="Qty" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })} />
                  <input className="vibrant-input" placeholder="Unit" value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} />
                  <input type="number" className="vibrant-input" placeholder="Min" value={formData.minThreshold} onChange={(e) => setFormData({ ...formData, minThreshold: parseInt(e.target.value) || 0 })} />
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
