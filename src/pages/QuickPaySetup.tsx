import React, { useEffect, useState } from 'react';
import { Settings, Save, ShieldCheck, History, BarChart3, AlertCircle, CreditCard, Activity, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { QuickPayConfig, Transaction } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import SearchableSelect from '../components/ui/SearchableSelect';

export default function QuickPaySetup() {
  const [config, setConfig] = useState<QuickPayConfig | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubConfig = dataService.subscribe('quickpay-config', (data: QuickPayConfig[]) => {
      if (data.length > 0) setConfig(data[0]);
    });
    const unsubTransactions = dataService.subscribe('transactions', setTransactions);
    return () => {
      unsubConfig();
      unsubTransactions();
    };
  }, []);

  const [testAmount, setTestAmount] = useState(100);
  const [isTesting, setIsTesting] = useState(false);

  const handleTestPayment = async () => {
    if (!config?.isEnabled) {
      toast.error('QuickPay must be enabled to test.');
      return;
    }
    setIsTesting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await dataService.add('transactions', {
        studentId: 'TEST_STUDENT',
        voucherId: 'TEST_VOUCHER',
        amount: testAmount,
        status: 'Success',
        transactionDate: new Date().toISOString(),
        paymentMethod: 'QuickPay_Test'
      });
      toast.success('Test transaction successful!');
    } catch (err) {
      console.error('Test transaction error:', err);
      toast.error('Test transaction failed.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    
    // Validation
    if (!config.merchantId.trim()) {
      toast.error('Merchant ID is required');
      return;
    }
    if (!config.apiKey.trim() && !config.apiKeySet) {
      toast.error('API Key is required');
      return;
    }

    setLoading(true);
    try {
      if (config.id) {
        await dataService.update('quickpay-config', config.id, config);
      } else {
        await dataService.add('quickpay-config', config);
      }
      toast.success('Configuration saved successfully!');
    } catch (err) {
      console.error('Error saving config:', err);
      toast.error('Error saving configuration.');
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    today: transactions.filter(t => t.transactionDate && t.transactionDate.startsWith(new Date().toISOString().split('T')[0]) && t.status === 'Success').reduce((acc, t) => acc + t.amount, 0),
    online: transactions.filter(t => t.status === 'Success').reduce((acc, t) => acc + t.amount, 0),
    failed: transactions.filter(t => t.status === 'Failed').length,
    pending: transactions.filter(t => t.status === 'Pending').length
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">QuickPay Integration</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Configure and monitor online payment gateway</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="vibrant-card px-4 py-2 flex items-center gap-4 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Test Amount</span>
            <input 
              type="number" 
              className="w-20 bg-transparent font-black text-primary outline-none text-sm"
              value={testAmount}
              onChange={(e) => setTestAmount(Number(e.target.value))}
            />
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleTestPayment}
              disabled={isTesting}
              className="px-4 py-1.5 bg-primary/10 text-primary rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-white transition-all disabled:opacity-50"
            >
              {isTesting ? 'Testing...' : 'Run Test'}
            </motion.button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Today Collections', value: `Rs. ${stats.today}`, icon: Zap, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'Online Collections', value: `Rs. ${stats.online}`, icon: CreditCard, color: 'text-success', bg: 'bg-success/10' },
          { label: 'Failed Payments', value: stats.failed, icon: XCircle, color: 'text-error', bg: 'bg-error/10' },
          { label: 'Pending Callbacks', value: stats.pending, icon: Clock, color: 'text-warning', bg: 'bg-warning/10' }
        ].map((stat, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="vibrant-card p-6 group relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-24 h-24 ${stat.bg} -mr-12 -mt-12 rounded-full blur-3xl opacity-50 group-hover:opacity-100 transition-opacity`}></div>
            <div className="flex items-center gap-4 relative z-10">
              <div className={`w-12 h-12 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
                <p className={`text-2xl font-black tracking-tight ${stat.color}`}>{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="vibrant-card overflow-hidden">
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm flex items-center gap-3">
                <Settings className="w-5 h-5 text-primary" />
                Configuration
              </h3>
            </div>
            <form onSubmit={handleSave} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Merchant ID</label>
                <input 
                  className="vibrant-input"
                  value={config?.merchantId || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev!, merchantId: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">API Key</label>
                <input 
                  type="password"
                  className="vibrant-input"
                  value={config?.apiKey || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev!, apiKey: e.target.value }))}
                  placeholder={config?.apiKeySet ? 'Key configured — enter a new value to replace' : 'Enter API key'}
                  required={!config?.apiKeySet}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Callback URL</label>
                <input 
                  className="vibrant-input"
                  value={config?.callbackUrl || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev!, callbackUrl: e.target.value }))}
                  placeholder={`${window.location.origin}/api/payments/quickpay-callback`}
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Payment Mode</span>
                <SearchableSelect
                  variant="inline"
                  className="text-xs font-black text-primary uppercase tracking-widest"
                  value={config?.mode || 'Sandbox'}
                  onChange={(mode) => setConfig((prev) => ({ ...prev!, mode: mode as QuickPayConfig['mode'] }))}
                  searchable={false}
                  options={[
                    { value: 'Sandbox', label: 'Sandbox' },
                    { value: 'Live', label: 'Live' },
                  ]}
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Enable QuickPay</span>
                <button 
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev!, isEnabled: !prev?.isEnabled }))}
                  className={`w-14 h-7 rounded-full transition-all relative ${config?.isEnabled ? 'bg-success shadow-lg shadow-success/20' : 'bg-slate-300 dark:bg-slate-700'}`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-sm ${config?.isEnabled ? 'left-8' : 'left-1'}`} />
                </button>
              </div>
              <motion.button 
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                type="submit" 
                disabled={loading}
                className="w-full vibrant-btn-primary py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 flex items-center justify-center gap-3"
              >
                <Save className="w-5 h-5" />
                {loading ? 'Saving...' : 'Save Configuration'}
              </motion.button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="vibrant-card overflow-hidden">
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm flex items-center gap-3">
                <History className="w-5 h-5 text-warning" />
                Transaction Logs
              </h3>
              <button className="text-[10px] font-black text-primary uppercase tracking-widest hover:underline">Reconcile All</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/30 dark:bg-slate-900/30 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                    <th className="px-8 py-5">Date & Time</th>
                    <th className="px-8 py-5">Student ID</th>
                    <th className="px-8 py-5">Amount</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-8 py-12 text-center">
                        <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <Activity className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        </div>
                        <p className="text-slate-400 font-medium italic">No transactions recorded yet.</p>
                      </td>
                    </tr>
                  )}
                  {transactions.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-900 dark:text-white">{t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : 'N/A'}</span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.transactionDate ? new Date(t.transactionDate).toLocaleTimeString() : 'N/A'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="font-mono text-xs font-black text-slate-400 group-hover:text-primary transition-colors">{t.studentId.substring(0, 8)}...</span>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-slate-900 dark:text-white">Rs. {t.amount}</span>
                      </td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                          t.status === 'Success' ? 'bg-success/10 text-success border-success/20' : 
                          t.status === 'Failed' ? 'bg-error/10 text-error border-error/20' : 'bg-warning/10 text-warning border-warning/20'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 text-slate-400 hover:text-primary hover:border-primary transition-all"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </motion.button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
