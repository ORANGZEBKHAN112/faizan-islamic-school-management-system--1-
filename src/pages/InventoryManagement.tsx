import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Edit2, Package, AlertTriangle } from 'lucide-react';
import { InventoryItem } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';
import {
  ASSET_STATUSES,
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  LED_SIZES,
  emptyItSpecs,
  isItInventoryCategory,
  itemsForCategory,
  parseItSpecs,
  type ItAssetSpecs,
} from '../utils/inventoryCatalog';

const defaultForm = {
  category: 'Furniture' as string,
  itemName: '',
  quantity: 0,
  unit: 'PCS',
  minThreshold: 5,
  itSpecs: emptyItSpecs(),
};

export default function InventoryManagement() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(defaultForm);

  useEffect(() => {
    return dataService.subscribe('inventory', setItems);
  }, []);

  const itemOptions = useMemo(() => itemsForCategory(formData.category), [formData.category]);
  const showItFields = isItInventoryCategory(formData.category);

  const resetForm = () => {
    setFormData({ ...defaultForm, itSpecs: emptyItSpecs() });
    setEditingId(null);
  };

  const setItSpec = (key: keyof ItAssetSpecs, value: string) => {
    setFormData((prev) => ({ ...prev, itSpecs: { ...prev.itSpecs, [key]: value } }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category.trim()) {
      toast.error('Item category is required');
      return;
    }
    if (!formData.itemName.trim()) {
      toast.error('Item name is required');
      return;
    }
    const payload = {
      category: formData.category,
      itemName: formData.itemName,
      quantity: formData.quantity,
      unit: formData.unit,
      minThreshold: formData.minThreshold,
      itSpecs: showItFields ? JSON.stringify(formData.itSpecs) : null,
    };
    try {
      if (editingId) {
        await dataService.update('inventory', editingId, payload);
        toast.success('Item updated');
      } else {
        await dataService.add('inventory', payload);
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
      category: item.category || 'Furniture',
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit || 'PCS',
      minThreshold: item.minThreshold ?? 5,
      itSpecs: parseItSpecs(item.itSpecs),
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
                <th className="px-8 py-5">Asset</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((item) => {
                const specs = parseItSpecs(item.itSpecs);
                return (
                  <tr key={item.id} className={item.quantity <= item.minThreshold ? 'bg-warning/5' : ''}>
                    <td className="px-8 py-5 font-bold">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-primary" />
                        {item.itemName}
                      </div>
                      {specs.systemSerialNo ? (
                        <p className="text-[10px] text-slate-400 mt-1 font-mono">S/N: {specs.systemSerialNo}</p>
                      ) : null}
                    </td>
                    <td className="px-8 py-5 text-sm">{item.category}</td>
                    <td className="px-8 py-5 font-black">{item.quantity} {item.unit || 'PCS'}</td>
                    <td className="px-8 py-5 text-sm text-slate-500">{specs.assetStatus || '—'}</td>
                    <td className="px-8 py-5 text-right">
                      <PermissionGate module="inventory" action="update">
                        <button onClick={() => handleEdit(item)} className="p-2 hover:text-primary text-slate-400"><Edit2 className="w-4 h-4" /></button>
                      </PermissionGate>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-2xl p-8 max-h-[calc(100vh-3rem)] overflow-y-auto">
                <h3 className="text-2xl font-black mb-6">{editingId ? 'Edit Item' : 'New Item'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item Category</label>
                    <SearchableSelect
                      className="w-full"
                      value={formData.category}
                      onChange={(category) => {
                        const names = itemsForCategory(category);
                        setFormData({
                          ...formData,
                          category,
                          itemName: names.includes(formData.itemName) ? formData.itemName : (names[0] || ''),
                          itSpecs: isItInventoryCategory(category) ? formData.itSpecs : emptyItSpecs(),
                        });
                      }}
                      searchPlaceholder="Search category…"
                      options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item Name</label>
                    <SearchableSelect
                      className="w-full"
                      value={formData.itemName}
                      onChange={(itemName) => setFormData({ ...formData, itemName })}
                      searchPlaceholder="Search item…"
                      options={itemOptions.map((n) => ({ value: n, label: n }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Quantity (Qty)</label>
                      <input
                        type="number"
                        min={0}
                        className="vibrant-input"
                        value={formData.quantity}
                        onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Unit</label>
                      <SearchableSelect
                        value={formData.unit}
                        onChange={(unit) => setFormData({ ...formData, unit })}
                        searchPlaceholder="Unit…"
                        options={INVENTORY_UNITS.map((u) => ({ value: u, label: u }))}
                      />
                    </div>
                  </div>

                  {showItFields && (
                    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                      <h4 className="text-xs font-black uppercase tracking-widest text-primary">Hardware Details</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input className="vibrant-input" placeholder="Computer Model" value={formData.itSpecs.computerModel} onChange={(e) => setItSpec('computerModel', e.target.value)} />
                        <input className="vibrant-input" placeholder="System Serial No." value={formData.itSpecs.systemSerialNo} onChange={(e) => setItSpec('systemSerialNo', e.target.value)} />
                        <input className="vibrant-input" placeholder="Processor" value={formData.itSpecs.processor} onChange={(e) => setItSpec('processor', e.target.value)} />
                        <input className="vibrant-input" placeholder="RAM" value={formData.itSpecs.ram} onChange={(e) => setItSpec('ram', e.target.value)} />
                        <input className="vibrant-input" placeholder="HDD Capacity" value={formData.itSpecs.hddCapacity} onChange={(e) => setItSpec('hddCapacity', e.target.value)} />
                        <input className="vibrant-input" placeholder="SSD Capacity" value={formData.itSpecs.ssdCapacity} onChange={(e) => setItSpec('ssdCapacity', e.target.value)} />
                        <input className="vibrant-input" placeholder="Keyboard" value={formData.itSpecs.keyboard} onChange={(e) => setItSpec('keyboard', e.target.value)} />
                        <input className="vibrant-input" placeholder="Mouse" value={formData.itSpecs.mouse} onChange={(e) => setItSpec('mouse', e.target.value)} />
                        <input className="vibrant-input" placeholder="LED Model" value={formData.itSpecs.ledModel} onChange={(e) => setItSpec('ledModel', e.target.value)} />
                        <SearchableSelect
                          value={formData.itSpecs.ledSize || ''}
                          onChange={(ledSize) => setItSpec('ledSize', ledSize)}
                          placeholder="LED Size"
                          searchPlaceholder="LED size…"
                          options={LED_SIZES.map((s) => ({ value: s, label: s }))}
                        />
                        <input className="vibrant-input" placeholder="LED Serial Number" value={formData.itSpecs.ledSerialNumber} onChange={(e) => setItSpec('ledSerialNumber', e.target.value)} />
                        <input className="vibrant-input" placeholder="Printer Model" value={formData.itSpecs.printerModel} onChange={(e) => setItSpec('printerModel', e.target.value)} />
                        <input className="vibrant-input" placeholder="Printer Serial Number" value={formData.itSpecs.printerSerialNumber} onChange={(e) => setItSpec('printerSerialNumber', e.target.value)} />
                        <SearchableSelect
                          value={formData.itSpecs.assetStatus || 'Own Asset'}
                          onChange={(assetStatus) => setItSpec('assetStatus', assetStatus)}
                          searchPlaceholder="Asset status…"
                          options={ASSET_STATUSES.map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="flex-1 vibrant-btn-secondary">Cancel</button>
                    <button type="submit" className="flex-1 vibrant-btn-primary">Save</button>
                  </div>
                </form>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
