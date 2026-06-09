import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, FileText, Download, CheckCircle, AlertCircle, Filter, XCircle, CreditCard, Clock } from 'lucide-react';
import { Fee, Student, Campus, Class, FeeStructure, FeeSetting, FeeGenerationRun } from '../types';
import { dataService } from '../services/dataService';
import { feeCollectedTotal, feeOutstandingTotal } from '../utils/feeStats';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { canPickCampus, defaultCampusFilter, getStoredUser, getUserCampusScope } from '../utils/campusScope';
import PageLoader from '../components/ui/PageLoader';
import Pagination from '../components/ui/Pagination';

const scopeUser = getStoredUser();

export default function FeeManagement() {
  const [searchParams] = useSearchParams();
  const urlStudentId = searchParams.get('studentId') || '';
  const [vouchers, setVouchers] = useState<Fee[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [feeSettings, setFeeSettings] = useState<FeeSetting[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const initialLoaded = useRef<Record<string, boolean>>({});
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStructureModalOpen, setIsStructureModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Fee | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    receivedAmount: 0,
    discountAmount: 0,
    fineAmount: 0,
    paymentMethod: 'Quick Pay',
    transactionRef: ''
  });
  const [isExtraChargeOpen, setIsExtraChargeOpen] = useState(false);
  const [extraChargeForm, setExtraChargeForm] = useState({
    studentId: '',
    feeType: 'Security Deposit' as Fee['feeType'],
    amount: 0,
    description: '',
  });
  const [extraStudentQuery, setExtraStudentQuery] = useState('');
  const [extraStudentOptions, setExtraStudentOptions] = useState<Array<{ id: string; firstName: string; lastName?: string; rollNumber: string }>>([]);
  const [extraStudentLoading, setExtraStudentLoading] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [activeTab, setActiveTab] = useState<'vouchers' | 'generate' | 'runs'>('vouchers');
  const [generationRuns, setGenerationRuns] = useState<FeeGenerationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  
  const stats = {
    totalPaid: feeCollectedTotal(vouchers),
    totalUnpaid: feeOutstandingTotal(vouchers),
    defaulters: vouchers.filter(v => v.status === 'Unpaid' || v.status === 'Partially Paid').length,
    vouchersCount: vouchers.length
  };
  
  const [structureForm, setStructureForm] = useState({
    campusId: '',
    classId: '',
    tuitionFee: 0,
    admissionFee: 0,
    examFee: 0,
    transportFee: 0,
    miscFee: 0
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCampus, setSelectedCampus] = useState<string>(() =>
    scopeUser ? defaultCampusFilter(scopeUser) : 'all'
  );
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncingStructures, setIsSyncingStructures] = useState(false);
  const [generationParams, setGenerationParams] = useState({
    campusId: scopeUser && getUserCampusScope(scopeUser) ? getUserCampusScope(scopeUser)! : 'all',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    includeAdmissions: true,
    includeArrears: true
  });
  const [generationSummary, setGenerationSummary] = useState<any>(null);

  const parsePaymentHistory = (raw?: string) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getVoucherGrossPayable = (voucher: Fee) =>
    (voucher.amount || 0) + (voucher.arrears || 0) + (voucher.fineAmount || 0) - (voucher.discountAmount || 0);

  const getVoucherRemaining = (voucher: Fee) =>
    voucher.balanceAmount ?? Math.max(0, getVoucherGrossPayable(voucher) - (voucher.paidAmount || 0));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCampus, selectedStatus]);

  useEffect(() => {
    initialLoaded.current = {
      vouchers: false,
      students: false,
      campuses: false,
      classes: false,
      structures: false,
      settings: selectedCampus === 'all',
    };
    setDataLoading(true);

    const markLoaded = (key: string, loading: boolean) => {
      if (!loading) initialLoaded.current[key] = true;
      const allDone = Object.values(initialLoaded.current).every(Boolean);
      if (allDone) setDataLoading(false);
    };

    const unsubVouchers = dataService.subscribe('fees', setVouchers, { campusId: selectedCampus }, undefined, (state) => markLoaded('vouchers', state.loading));
    const unsubStudents = dataService.subscribe('students', setStudents, undefined, undefined, (state) => markLoaded('students', state.loading));
    const unsubCampuses = dataService.subscribe('campuses', setCampuses, undefined, undefined, (state) => markLoaded('campuses', state.loading));
    const unsubClasses = dataService.subscribe('classes', setClasses, undefined, undefined, (state) => markLoaded('classes', state.loading));
    const unsubStructures = dataService.subscribe('feeStructures', setFeeStructures, undefined, undefined, (state) => markLoaded('structures', state.loading));
    let unsubSettings = () => {};
    if (selectedCampus !== 'all') {
      unsubSettings = dataService.subscribe('fee-settings', setFeeSettings, { campusId: selectedCampus }, undefined, (state) => markLoaded('settings', state.loading));
    } else {
      setFeeSettings([]);
      markLoaded('settings', false);
    }

    return () => {
      unsubVouchers();
      unsubStudents();
      unsubCampuses();
      unsubClasses();
      unsubStructures();
      unsubSettings();
    };
  }, [selectedCampus]);

  useEffect(() => {
    if (!dataLoading) return;
    const timeout = setTimeout(() => setDataLoading(false), 12000);
    return () => clearTimeout(timeout);
  }, [dataLoading]);

  useEffect(() => {
    if (activeTab !== 'runs') return;
    const loadRuns = async () => {
      try {
        setRunsLoading(true);
        const rows = await dataService.fetchFeeGenerationRuns({
          campusId: selectedCampus !== 'all' ? selectedCampus : undefined,
          limit: 100,
        });
        setGenerationRuns(rows);
      } catch (error) {
        console.error('Error loading generation runs:', error);
        toast.error('Failed to load generation run history');
      } finally {
        setRunsLoading(false);
      }
    };
    loadRuns();
  }, [activeTab, selectedCampus]);

  useEffect(() => {
    if (!isExtraChargeOpen) return;
    const timer = setTimeout(async () => {
      try {
        setExtraStudentLoading(true);
        const results = await dataService.fetchStudentOptions({
          search: extraStudentQuery.trim() || undefined,
          campusId: selectedCampus !== 'all' ? selectedCampus : undefined,
          limit: 30,
        });
        setExtraStudentOptions(results);
      } catch (err) {
        console.error('Failed to search students for extra charge:', err);
      } finally {
        setExtraStudentLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [isExtraChargeOpen, extraStudentQuery, selectedCampus]);

  const generateVouchers = async () => {
    if (generationParams.campusId === 'all' && !window.confirm('Generate fees for ALL campuses? This cannot be easily undone.')) {
      return;
    }
    setIsGenerating(true);
    setGenerationSummary(null);
    try {
      const result = await dataService.fetchGenerateFees({
        ...generationParams,
        months: selectedMonths.length > 0 ? selectedMonths : [generationParams.month],
      });
      setGenerationSummary(result);
      toast.success(result.message);
    } catch (error) {
      console.error('Error generating fees:', error);
      const msg = (error as any)?.response?.data?.message;
      toast.error(msg || 'Failed to generate monthly fees');
    } finally {
      setIsGenerating(false);
    }
  };

  if (dataLoading) {
    return <PageLoader label="Loading fee data…" />;
  }

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVoucher) return;

    try {
      await dataService.update('fees', selectedVoucher.id, paymentForm);
      const refreshed = await dataService.refresh('fees', { campusId: selectedCampus });
      setVouchers(refreshed);

      toast.success('Payment recorded successfully');
      setIsPaymentModalOpen(false);
    } catch (error) {
      console.error('Error recording payment:', error);
      toast.error('Failed to record payment');
    }
  };

  const openPaymentModal = (voucher: Fee) => {
    setSelectedVoucher(voucher);
    const totalPayable = getVoucherRemaining(voucher);
    setPaymentForm({
      receivedAmount: totalPayable,
      discountAmount: 0,
      fineAmount: 0,
      paymentMethod: 'Quick Pay',
      transactionRef: ''
    });
    setIsPaymentModalOpen(true);
  };

  const handleAdvanceYearPayment = async () => {
    if (!selectedVoucher) return;
    const year = selectedVoucher.year;
    const unpaid = vouchers.filter(
      (v) => v.studentId === selectedVoucher.studentId && v.year === year &&
        (v.status === 'Unpaid' || v.status === 'Partially Paid') &&
        (v.feeType === 'Monthly' || v.feeType === 'Admission')
    );
    const total = unpaid.reduce((sum, v) => {
      const bal = v.balanceAmount ?? (v.amount + (v.arrears || 0) - (v.paidAmount || 0));
      return sum + Math.max(0, bal);
    }, 0);
    if (total <= 0) {
      toast.error('No unpaid monthly vouchers for this year');
      return;
    }
    if (!window.confirm(`Pay full year advance (Rs. ${total.toLocaleString()}) for all ${unpaid.length} remaining month(s)?`)) return;
    try {
      const result = await dataService.advanceYearPayment({
        studentId: selectedVoucher.studentId,
        year,
        receivedAmount: total,
        paymentMethod: paymentForm.paymentMethod,
        transactionRef: paymentForm.transactionRef || `ADV-${year}`,
      });
      toast.success(`Advance applied to ${result.vouchersUpdated} voucher(s)`);
      setIsPaymentModalOpen(false);
      const refreshed = await dataService.refresh('fees', { campusId: selectedCampus });
      setVouchers(refreshed);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Advance payment failed');
    }
  };

  const handleExtraCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraChargeForm.studentId || extraChargeForm.amount <= 0) {
      toast.error('Select student and enter amount');
      return;
    }
    try {
      await dataService.createExtraFeeCharge({
        ...extraChargeForm,
        month: generationParams.month,
        year: generationParams.year,
      });
      toast.success('Extra charge created');
      setIsExtraChargeOpen(false);
      const refreshed = await dataService.refresh('fees', { campusId: selectedCampus });
      setVouchers(refreshed);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create charge');
    }
  };

  const toggleMonth = (m: number) => {
    setSelectedMonths((prev) =>
      prev.includes(m) ? (prev.length > 1 ? prev.filter((x) => x !== m) : prev) : [...prev, m].sort((a, b) => a - b)
    );
  };

  const downloadPDF = (voucher: Fee, existingDoc?: jsPDF) => {
    const student = students.find(s => s.id === voucher.studentId);
    const campus = campuses.find(c => c.id === voucher.campusId);
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[voucher.month] || "Recurring";
    const voucherPeriodKey = (voucher.year || 0) * 100 + (voucher.month || 0);
    const previousPending = vouchers
      .filter((v) =>
        v.studentId === voucher.studentId &&
        ((v.year || 0) * 100 + (v.month || 0)) < voucherPeriodKey &&
        ['Unpaid', 'Partially Paid', 'Overdue', 'Pending'].includes(v.status) &&
        getVoucherRemaining(v) > 0
      )
      .sort((a, b) => ((a.year || 0) * 100 + (a.month || 0)) - ((b.year || 0) * 100 + (b.month || 0)));
    const carriedForwardPrevious = vouchers
      .filter((v) =>
        v.studentId === voucher.studentId &&
        ((v.year || 0) * 100 + (v.month || 0)) < voucherPeriodKey &&
        ['Monthly', 'Admission', 'Arrears'].includes(v.feeType || '') &&
        String(v.paymentMethod || '').toLowerCase() === 'carried forward'
      )
      .sort((a, b) => ((a.year || 0) * 100 + (a.month || 0)) - ((b.year || 0) * 100 + (b.month || 0)));
    const pendingArrearsTotal = previousPending.reduce((sum, row) => sum + getVoucherRemaining(row), 0);
    const arrearsMonthLabels = (
      previousPending.length > 0 ? previousPending : carriedForwardPrevious
    )
      .map((row) => row.monthsLabel || `${monthNames[row.month] || row.month}/${row.year}`)
      .filter(Boolean);
    const arrearsMonthLabelText = arrearsMonthLabels.length > 0
      ? arrearsMonthLabels.join(", ")
      : "Previous Months";
    const quickPayTrackingRef = voucher.transactionRef || `QP-${voucher.id.substring(0, 8).toUpperCase()}`;

    const doc = existingDoc || new jsPDF('p', 'mm', 'a4');
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.rect(10, 8, 190, 280);
    doc.setFillColor(248, 250, 252);
    doc.rect(10, 8, 190, 24, 'F');

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(139, 92, 246);
    doc.text("FAIZAN ISLAMIC SCHOOL", 16, 18);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(campus?.campusName?.toUpperCase() || "MAIN CAMPUS SYSTEM", 16, 24);

    doc.setFillColor(139, 92, 246);
    doc.rect(150, 12, 46, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text("SINGLE STUDENT COPY", 173, 17.2, { align: "center" });

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Voucher #:", 16, 40);
    doc.setFont("helvetica", "bold");
    doc.text(voucher.voucherNo || voucher.id.substring(0, 8), 42, 40);
    doc.setFont("helvetica", "normal");
    doc.text("Student:", 16, 46);
    doc.setFont("helvetica", "bold");
    doc.text(voucher.studentName || 'N/A', 42, 46);
    doc.setFont("helvetica", "normal");
    doc.text("Father:", 16, 52);
    doc.text(student?.fatherName || 'N/A', 42, 52);
    doc.text("Roll No:", 16, 58);
    doc.text(voucher.rollNumber || 'N/A', 42, 58);

    doc.text("Issue Date:", 138, 40);
    doc.text(new Date().toLocaleDateString(), 196, 40, { align: "right" });
    doc.text("Class:", 138, 46);
    doc.setFont("helvetica", "bold");
    doc.text(voucher.className || 'N/A', 196, 46, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text("Current Month:", 138, 52);
    doc.text(voucher.monthsLabel || `${monthName} ${voucher.year}`, 196, 52, { align: "right" });
    doc.setTextColor(239, 68, 68);
    doc.text("Due Date:", 138, 58);
    doc.setFont("helvetica", "bold");
    doc.text(voucher.dueDate || '10th of Month', 196, 58, { align: "right" });

    const breakdown = [
      ['Tuition Fee', (voucher.tuitionFee || voucher.amount).toLocaleString()],
      voucher.admissionFee ? ['Admission Fee', voucher.admissionFee.toLocaleString()] : null,
      voucher.securityFee ? ['Security Deposit', voucher.securityFee.toLocaleString()] : null,
      voucher.summerCampFee ? ['Summer Camp', voucher.summerCampFee.toLocaleString()] : null,
      voucher.idCardFee ? ['ID Card Fee', voucher.idCardFee.toLocaleString()] : null,
      voucher.tripFee ? ['Educational Trip', voucher.tripFee.toLocaleString()] : null,
      voucher.examFee ? ['Exam Fee', voucher.examFee.toLocaleString()] : null,
      voucher.transportFee ? ['Transport Fee', voucher.transportFee.toLocaleString()] : null,
      voucher.miscFee ? ['Misc Fee', voucher.miscFee.toLocaleString()] : null,
      (voucher.arrears || 0) > 0 ? [`Arrears Added (${arrearsMonthLabelText})`, (voucher.arrears || 0).toLocaleString()] : null,
      (voucher.fineAmount || 0) > 0 ? ['Late Fee / Fine', (voucher.fineAmount || 0).toLocaleString()] : null,
      (voucher.discountAmount || 0) > 0 ? ['Discount (Less)', `(${voucher.discountAmount.toLocaleString()})`] : null,
    ].filter(Boolean) as string[][];
    const totalAmount = getVoucherGrossPayable(voucher);
    const remaining = getVoucherRemaining(voucher);

    autoTable(doc, {
      startY: 66,
      head: [['Current Month Fee Details', 'Amount (PKR)']],
      body: [
        ...breakdown,
        [{ content: 'TOTAL PAYABLE', styles: { fontStyle: 'bold' as any } }, { content: `Rs. ${totalAmount.toLocaleString()}`, styles: { fontStyle: 'bold' as any } }],
        (voucher.paidAmount || 0) > 0 ? [{ content: 'PAID SO FAR', styles: { fontStyle: 'bold' as any, textColor: [34, 197, 94] } }, { content: `Rs. ${(voucher.paidAmount || 0).toLocaleString()}`, styles: { fontStyle: 'bold' as any, textColor: [34, 197, 94] } }] : null,
        [{ content: 'CURRENT BALANCE DUE', styles: { fontStyle: 'bold' as any, textColor: [139, 92, 246] } }, { content: `Rs. ${remaining.toLocaleString()}`, styles: { fontStyle: 'bold' as any, textColor: [139, 92, 246] } }],
      ].filter(Boolean) as any[],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [248, 250, 252], textColor: [71, 85, 105], fontStyle: 'bold' },
      margin: { left: 15, right: 15 },
    });

    const pendingRows = previousPending.length > 0
      ? previousPending.map((row) => [
          row.monthsLabel || `${monthNames[row.month] || row.month}/${row.year}`,
          row.feeType || 'Monthly',
          `Rs. ${getVoucherRemaining(row).toLocaleString()}`,
        ])
      : carriedForwardPrevious.length > 0
      ? carriedForwardPrevious.map((row) => [
          row.monthsLabel || `${monthNames[row.month] || row.month}/${row.year}`,
          'Carried Forward',
          `Rs. ${Number(row.paidAmount || row.amount || 0).toLocaleString()}`,
        ])
      : [['None', '-', 'Rs. 0']];

    autoTable(doc, {
      startY: 160,
      head: [['Previous Unpaid Months', 'Type', 'Pending Amount']],
      body: [
        ...pendingRows,
        [{ content: 'TOTAL PREVIOUS ARREARS', colSpan: 2, styles: { fontStyle: 'bold' as any } }, { content: `Rs. ${pendingArrearsTotal.toLocaleString()}`, styles: { fontStyle: 'bold' as any } }],
      ],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [248, 250, 252], textColor: [71, 85, 105], fontStyle: 'bold' },
      margin: { left: 15, right: 15 },
    });

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("QuickPay Tracking", 16, 248);
    doc.setFont("helvetica", "normal");
    doc.text(`QuickPay Fee ID: ${voucher.id}`, 16, 254);
    doc.text(`QuickPay Reference: ${quickPayTrackingRef}`, 16, 260);
    doc.text("- Use QuickPay Fee ID to reconcile callback transactions.", 16, 266);

    doc.setFont("helvetica", "bold");
    doc.text("Authorized Signature: ________________", 196, 280, { align: "right" });

    if (!existingDoc) {
      doc.save(`${voucher.studentName}_${monthName}_${voucher.year}.pdf`);
    }
  };

  const downloadAllVouchers = () => {
    if (filteredVouchers.length === 0) {
      toast.error('No vouchers to download.');
      return;
    }
    
    const doc = new jsPDF('p', 'mm', 'a4');
    const toastId = toast.loading(`Generating ${filteredVouchers.length} vouchers...`);

    filteredVouchers.forEach((voucher, index) => {
      if (index > 0) {
        doc.addPage();
      }
      downloadPDF(voucher, doc);
    });

    doc.save(`Bulk_Vouchers_${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('Bulk download complete!', { id: toastId });
  };

  const filteredVouchers = vouchers.filter(v => {
    const searchStr = v.studentName ? `${v.studentName} ${v.rollNumber}` : '';
    const matchesSearch = searchStr.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCampus = selectedCampus === 'all' || v.campusId === selectedCampus;
    const matchesStatus = selectedStatus === 'all' || v.status === selectedStatus;
    const matchesStudent = !urlStudentId || v.studentId === urlStudentId;
    return matchesSearch && matchesCampus && matchesStatus && matchesStudent;
  });

  const totalPages = Math.ceil(filteredVouchers.length / itemsPerPage);
  const paginatedVouchers = filteredVouchers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleAddStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!structureForm.campusId) {
      toast.error('Please select a campus');
      return;
    }
    if (!structureForm.classId) {
      toast.error('Please select a class');
      return;
    }

    try {
      await dataService.add('feeStructures', structureForm);
      toast.success('Fee structure saved successfully');
      setIsStructureModalOpen(false);
      setStructureForm({ campusId: '', classId: '', tuitionFee: 0, admissionFee: 0, examFee: 0, transportFee: 0, miscFee: 0 });
    } catch (error) {
      console.error('Error saving fee structure:', error);
      toast.error('Failed to save fee structure');
    }
  };

  const handleSyncStructures = async () => {
    const targetLabel = selectedCampus === 'all' ? 'all campuses' : 'selected campus';
    if (!window.confirm(`Create missing fee structures for ${targetLabel}?`)) return;
    try {
      setIsSyncingStructures(true);
      const result = await dataService.syncFeeStructuresForAllClasses(
        selectedCampus === 'all' ? undefined : selectedCampus
      );
      const refreshed = await dataService.refresh('feeStructures');
      setFeeStructures(refreshed);
      toast.success(`${result.createdCount} class structure(s) added`);
    } catch (error) {
      console.error('Error syncing fee structures:', error);
      toast.error('Failed to initialize fee structures for classes');
    } finally {
      setIsSyncingStructures(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Fee Management</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Generate vouchers, record payments, and track collections. Fee amounts are configured in Fee Settings.</p>
        </div>
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSyncStructures}
            disabled={isSyncingStructures}
            className="vibrant-btn-secondary px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
          >
            <Filter className="w-4 h-4" />
            {isSyncingStructures ? 'Syncing…' : 'Sync Structures'}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsExtraChargeOpen(true)}
            className="vibrant-btn-secondary px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
          >
            <Plus className="w-4 h-4" />
            Extra Charge
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={downloadAllVouchers}
            className="vibrant-glass text-primary px-6 py-3 rounded-2xl border border-white dark:border-slate-800 flex items-center gap-2 hover:bg-white dark:hover:bg-slate-800 transition-all shadow-sm text-[10px] font-black uppercase tracking-widest"
          >
            <Download className="w-4 h-4" />
            Bulk Download
          </motion.button>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="vibrant-card p-6 bg-success/5 border-success/10 relative overflow-hidden group"
        >
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-success/5 rounded-full blur-2xl group-hover:bg-success/10 transition-all" />
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Collected</span>
            <span className="text-3xl font-black text-success mt-1">Rs. {stats.totalPaid.toLocaleString()}</span>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[10px] font-medium text-success/60">Live Updates</span>
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="vibrant-card p-6 bg-accent/5 border-accent/10 relative overflow-hidden group"
        >
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-accent/5 rounded-full blur-2xl group-hover:bg-accent/10 transition-all" />
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Outstanding</span>
            <span className="text-3xl font-black text-accent mt-1">Rs. {stats.totalUnpaid.toLocaleString()}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-medium text-accent/60">Includes arrears</span>
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="vibrant-card p-6 bg-primary/5 border-primary/10 relative overflow-hidden group"
        >
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-all" />
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Defaulters</span>
            <span className="text-3xl font-black text-primary mt-1">{stats.defaulters}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-medium text-primary/60">Unpaid vouchers</span>
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="vibrant-card p-6 bg-slate-50 dark:bg-slate-800/50 relative overflow-hidden group"
        >
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-slate-200 dark:bg-slate-700/50 rounded-full blur-2xl group-hover:scale-125 transition-all" />
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Vouchers</span>
            <span className="text-3xl font-black text-slate-900 dark:text-white mt-1">{stats.vouchersCount}</span>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-medium text-slate-400">Current Session</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('vouchers')}
          className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'vouchers' 
              ? 'bg-white dark:bg-slate-800 text-primary shadow-sm ring-1 ring-slate-200 dark:ring-slate-700' 
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Voucher History
          </div>
        </button>
        <button
          onClick={() => setActiveTab('runs')}
          className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'runs'
              ? 'bg-white dark:bg-slate-800 text-primary shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Run Logs
          </div>
        </button>
        <button
          onClick={() => setActiveTab('generate')}
          className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'generate' 
              ? 'bg-white dark:bg-slate-800 text-primary shadow-sm ring-1 ring-slate-200 dark:ring-slate-700' 
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Bulk Generate
          </div>
        </button>
      </div>

      {activeTab === 'generate' && (
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="vibrant-card p-10 bg-primary/5 border-primary/10"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-3xl">
                  <Clock className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Bulk Voucher Generation</h3>
                  <p className="text-sm font-medium text-slate-500">Generate monthly vouchers for all active students instantly.</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Campus</label>
                  {(!scopeUser || canPickCampus(scopeUser)) ? (
                    <select 
                      className="vibrant-input"
                      value={generationParams.campusId}
                      onChange={(e) => setGenerationParams({...generationParams, campusId: e.target.value})}
                    >
                      <option value="all">All Campuses</option>
                      {campuses.map(c => <option key={c.id} value={c.id}>{c.campusName}</option>)}
                    </select>
                  ) : (
                    <div className="vibrant-input flex items-center text-sm font-bold text-slate-600 dark:text-slate-300">
                      {campuses.find((c) => c.id === generationParams.campusId)?.campusName || 'Your campus'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Month</label>
                  <select 
                    className="vibrant-input"
                    value={generationParams.month}
                    onChange={(e) => setGenerationParams({...generationParams, month: parseInt(e.target.value)})}
                  >
                    {Array.from({length: 12}, (_, i) => (
                      <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Year</label>
                  <select 
                    className="vibrant-input"
                    value={generationParams.year}
                    onChange={(e) => setGenerationParams({...generationParams, year: parseInt(e.target.value)})}
                  >
                    {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Split by months (select one or more)</label>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMonth(m)}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                        selectedMonths.includes(m)
                          ? 'bg-primary text-white border-primary'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-primary/40'
                      }`}
                    >
                      {new Date(0, m - 1).toLocaleString('default', { month: 'short' })}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-8 py-4 px-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input 
                      type="checkbox" 
                      className="peer w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all font-black"
                      checked={generationParams.includeAdmissions}
                      onChange={(e) => setGenerationParams({...generationParams, includeAdmissions: e.target.checked})}
                    />
                  </div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest group-hover:text-primary transition-colors">Include New Admissions</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input 
                      type="checkbox" 
                      className="peer w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary/20 transition-all"
                      checked={generationParams.includeArrears}
                      onChange={(e) => setGenerationParams({...generationParams, includeArrears: e.target.checked})}
                    />
                  </div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest group-hover:text-primary transition-colors">Process Arrears</span>
                </label>
              </div>

              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={generateVouchers}
                disabled={isGenerating}
                className="vibrant-btn-primary w-full py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-primary/20 text-xs font-black uppercase tracking-widest"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Run Billing Engine
                  </>
                )}
              </motion.button>
            </div>

            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-primary/10 flex flex-col justify-center min-h-[300px]">
              {generationSummary ? (
                <div className="space-y-8">
                  <div className="flex items-center gap-3 text-success">
                    <CheckCircle className="w-6 h-6" />
                    <span className="text-sm font-black uppercase tracking-widest">Generation Successful</span>
                  </div>
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Vouchers</p>
                      <p className="text-4xl font-black text-slate-900 dark:text-white">{generationSummary.processedCount}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">New Admissions</p>
                      <p className="text-4xl font-black text-success">{generationSummary.newAdmissionsCount}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Arrears Fixed</p>
                      <p className="text-4xl font-black text-accent">{generationSummary.arrearsCount}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Skipped (Missing Fee Settings)</p>
                      <p className="text-4xl font-black text-danger">{generationSummary.skippedMissingFeeSettings || 0}</p>
                    </div>
                  </div>
                  {Array.isArray(generationSummary.skippedMissingFeeSettingsByClass) && generationSummary.skippedMissingFeeSettingsByClass.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top missing classes</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {generationSummary.skippedMissingFeeSettingsByClass.slice(0, 8).map((row: { campusName: string; className: string; count: number }, idx: number) => (
                          <div key={`${row.campusName}-${row.className}-${idx}`} className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{row.campusName} — {row.className}</span>
                            <span className="font-black text-danger">{row.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button 
                    onClick={() => setActiveTab('vouchers')}
                    className="text-[10px] font-black text-primary uppercase tracking-widest hover:underline"
                  >
                    View generated vouchers →
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-300">
                    <Clock className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Ready to start</h4>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest mt-1">Vouchers will appear here after generation</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'runs' && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="vibrant-card overflow-hidden shadow-2xl shadow-slate-200/50"
        >
          <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">Fee Generation Runs</h4>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500 mt-1">Recent billing runs and skip diagnostics</p>
            </div>
            <button
              onClick={() => setActiveTab('generate')}
              className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
            >
              New Run →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                  <th className="px-8 py-4">Run Time</th>
                  <th className="px-8 py-4">Campus</th>
                  <th className="px-8 py-4">Months</th>
                  <th className="px-8 py-4">Created</th>
                  <th className="px-8 py-4">Skipped</th>
                  <th className="px-8 py-4">Admissions</th>
                  <th className="px-8 py-4">Arrears</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {runsLoading && (
                  <tr>
                    <td colSpan={7} className="px-8 py-10 text-center text-sm text-slate-500">Loading run history…</td>
                  </tr>
                )}
                {!runsLoading && generationRuns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-8 py-10 text-center text-sm text-slate-500">No generation runs yet.</td>
                  </tr>
                )}
                {!runsLoading && generationRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/30 transition-colors">
                    <td className="px-8 py-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {new Date(run.runOn).toLocaleString()}
                    </td>
                    <td className="px-8 py-4 text-sm">{run.campusName || 'All Campuses'}</td>
                    <td className="px-8 py-4 text-sm font-semibold">{run.monthsCsv} / {run.year}</td>
                    <td className="px-8 py-4 text-sm text-success font-bold">{run.processedCount}</td>
                    <td className="px-8 py-4 text-sm text-danger font-bold">{run.skippedMissingFeeSettings}</td>
                    <td className="px-8 py-4 text-sm text-primary font-bold">{run.newAdmissionsCount}</td>
                    <td className="px-8 py-4 text-sm text-accent font-bold">{run.arrearsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {activeTab === 'vouchers' && (
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="vibrant-card overflow-hidden shadow-2xl shadow-slate-200/50"
        >
          <div className="p-8 border-b border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder="Search by student name or roll..."
                className="vibrant-input pl-12"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {(!scopeUser || canPickCampus(scopeUser)) ? (
              <select
                className="vibrant-input appearance-none"
                value={selectedCampus}
                onChange={(e) => setSelectedCampus(e.target.value)}
              >
                <option value="all">All Campuses</option>
                {campuses.map(c => (
                  <option key={c.id} value={c.id}>{c.campusName}</option>
                ))}
              </select>
            ) : (
              <div className="vibrant-input flex items-center text-sm font-bold text-slate-600 dark:text-slate-300">
                {campuses.find((c) => c.id === selectedCampus)?.campusName || 'Your campus'}
              </div>
            )}
            <select
              className="vibrant-input appearance-none"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">Any Payment Status</option>
              <option value="Paid">Paid Only</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Unpaid">Unpaid Only</option>
              <option value="Pending">Processing (Quick Pay)</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                  <th className="px-8 py-5">Voucher ID</th>
                  <th className="px-8 py-5">Student</th>
                  <th className="px-8 py-5">Class</th>
                  <th className="px-8 py-5">Month/Year</th>
                  <th className="px-8 py-5">Payable</th>
                  <th className="px-8 py-5">History</th>
                  <th className="px-8 py-5">Remaining</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedVouchers.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                          <FileText className="w-8 h-8" />
                        </div>
                        <div>
                          <p className="text-slate-900 dark:text-white font-bold">No vouchers found</p>
                          <p className="text-slate-500 text-sm">No vouchers found for this campus/month. Please generate fees first.</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {paginatedVouchers.map((voucher) => {
                  return (
                    <tr key={voucher.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-8 py-5 font-mono text-[10px] font-black text-slate-400">{voucher.id.substring(0, 8)}</td>
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">{voucher.studentName || 'Unknown Student'}</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{voucher.rollNumber || 'N/A'}</div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{voucher.className || 'N/A'}</div>
                      </td>
                      <td className="px-8 py-5 text-sm font-medium text-slate-500 dark:text-slate-400">
                        <div>{voucher.monthsLabel || `${voucher.month}/${voucher.year}`}</div>
                        {voucher.feeType && voucher.feeType !== 'Monthly' && (
                          <div className="text-[9px] font-black text-primary uppercase">{voucher.feeType}</div>
                        )}
                      </td>
                      <td className="px-8 py-5 font-medium text-slate-900 dark:text-white">
                        <div className="text-primary font-black">Rs. {getVoucherGrossPayable(voucher).toLocaleString()}</div>
                        {(voucher.fineAmount || 0) > 0 && <div className="text-[9px] text-accent font-bold">+ Rs. {voucher.fineAmount} Fine</div>}
                        {(voucher.discountAmount || 0) > 0 && <div className="text-[9px] text-success font-bold">- Rs. {voucher.discountAmount} Disc</div>}
                      </td>
                      <td className="px-8 py-5">
                        <div className="font-bold text-success/80">Paid: Rs. {voucher.paidAmount || 0}</div>
                        {voucher.paymentHistory && (
                          <div className="text-[9px] text-slate-400 font-medium">
                            {parsePaymentHistory(voucher.paymentHistory).length} installments
                          </div>
                        )}
                      </td>
                      <td className="px-8 py-5 font-black text-slate-900 dark:text-white">
                        Rs. {getVoucherRemaining(voucher).toLocaleString()}
                      </td>
                      <td className="px-8 py-5">
                        {voucher.status === 'Paid' ? (
                          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-success/10 text-success">
                            <CheckCircle className="w-3 h-3" /> Paid
                          </span>
                        ) : voucher.status === 'Partially Paid' ? (
                          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-sky-500/10 text-sky-500">
                            <Clock className="w-3 h-3" /> Partial
                          </span>
                        ) : voucher.status === 'Pending' ? (
                          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500">
                            <Clock className="w-3 h-3" /> Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-accent/10 text-accent">
                            <AlertCircle className="w-3 h-3" /> Unpaid
                          </span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {voucher.status !== 'Paid' && (
                            <motion.button 
                              whileHover={{ scale: 1.05, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => openPaymentModal(voucher)}
                              className="flex items-center gap-2 px-4 py-2 bg-success/10 text-success rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-success hover:text-white transition-all"
                            >
                              <CreditCard className="w-4 h-4" />
                              Pay
                            </motion.button>
                          )}
                          <motion.button 
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => downloadPDF(voucher)}
                            className="p-3 text-primary hover:bg-primary/10 rounded-xl transition-all border border-transparent hover:border-primary/20"
                            title="Download PDF"
                          >
                            <Download className="w-5 h-5" />
                          </motion.button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredVouchers.length}
            itemsPerPage={itemsPerPage}
            itemLabel="Vouchers"
            onPageChange={setCurrentPage}
          />
        </motion.div>
      )}

      <AnimatePresence>
        {isStructureModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="vibrant-card w-full max-w-lg overflow-hidden border-none shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <AlertCircle className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Fee Structures</h3>
                </div>
                <button onClick={() => setIsStructureModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleAddStructure} className="p-10 space-y-8 bg-white dark:bg-slate-900">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Campus</label>
                    <select required className="vibrant-input appearance-none" value={structureForm.campusId} onChange={(e) => setStructureForm({ ...structureForm, campusId: e.target.value })}>
                      <option value="">Select Campus</option>
                      {campuses.map(c => <option key={c.id} value={c.id}>{c.campusName}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Class</label>
                    <select required className="vibrant-input appearance-none" value={structureForm.classId} onChange={(e) => setStructureForm({ ...structureForm, classId: e.target.value })}>
                      <option value="">Select Class</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.className}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tuition Fee</label>
                    <input type="number" required className="vibrant-input font-black text-primary" value={structureForm.tuitionFee} onChange={(e) => setStructureForm({ ...structureForm, tuitionFee: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Admission Fee</label>
                    <input type="number" required className="vibrant-input font-black text-primary" value={structureForm.admissionFee} onChange={(e) => setStructureForm({ ...structureForm, admissionFee: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Exam Fee</label>
                    <input type="number" required className="vibrant-input font-black text-primary" value={structureForm.examFee} onChange={(e) => setStructureForm({ ...structureForm, examFee: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Transport Fee</label>
                    <input type="number" required className="vibrant-input font-black text-primary" value={structureForm.transportFee} onChange={(e) => setStructureForm({ ...structureForm, transportFee: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Misc Fee</label>
                  <input type="number" required className="vibrant-input font-black text-primary" value={structureForm.miscFee} onChange={(e) => setStructureForm({ ...structureForm, miscFee: Number(e.target.value) })} />
                </div>
                <div className="flex gap-4 pt-10 border-t border-slate-100 dark:border-slate-800">
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button" 
                    onClick={() => setIsStructureModalOpen(false)} 
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
                    Save Structure
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isPaymentModalOpen && selectedVoucher && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="vibrant-card w-full max-w-md overflow-hidden border-none shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-success/5">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-success/10 rounded-2xl">
                    <CheckCircle className="w-6 h-6 text-success" />
                  </div>
                  <h3 className="text-2xl font-black text-success tracking-tight uppercase">Record Payment</h3>
                </div>
                <button onClick={() => setIsPaymentModalOpen(false)} className="text-success/40 hover:text-success transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handlePayment} className="p-10 space-y-8 bg-white dark:bg-slate-900">
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-700 space-y-4">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                    <span className="text-slate-400">Voucher Total</span>
                    <span className="text-slate-900 dark:text-white">Rs. {((selectedVoucher.amount || 0) + (selectedVoucher.arrears || 0)).toLocaleString()}</span>
                  </div>
                  {(selectedVoucher.paidAmount || 0) > 0 && (
                    <>
                      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-success border-t border-slate-100 dark:border-slate-700 pt-2">
                        <span>Already Paid</span>
                        <span>- Rs. {selectedVoucher.paidAmount}</span>
                      </div>
                      <div className="space-y-1 mt-2">
                        {parsePaymentHistory(selectedVoucher.paymentHistory).map((h: any, i: number) => (
                           <div key={i} className="flex justify-between text-[8px] font-medium text-slate-400 font-mono">
                             <span>{new Date(h.date).toLocaleDateString()} ({h.method})</span>
                             <span>Rs. {h.amount}</span>
                           </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm font-black border-t border-slate-100 dark:border-slate-700 pt-4">
                    <span className="text-slate-400 uppercase tracking-widest text-[10px]">Net Remaining</span>
                    <span className="text-primary text-lg">
                      Rs. {Math.max(0, (selectedVoucher.amount || 0) + (selectedVoucher.arrears || 0) - (selectedVoucher.paidAmount || 0))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Add Fine</label>
                    <input 
                      type="number" 
                      className="vibrant-input font-black text-accent" 
                      value={paymentForm.fineAmount} 
                      onChange={(e) => setPaymentForm({ ...paymentForm, fineAmount: Number(e.target.value) })} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Apply Discount</label>
                    <input 
                      type="number" 
                      className="vibrant-input font-black text-success" 
                      value={paymentForm.discountAmount} 
                      onChange={(e) => setPaymentForm({ ...paymentForm, discountAmount: Number(e.target.value) })} 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Received Amount</label>
                  <input 
                    type="number" 
                    required 
                    className="vibrant-input font-black text-primary text-xl" 
                    value={paymentForm.receivedAmount} 
                    onChange={(e) => setPaymentForm({ ...paymentForm, receivedAmount: Number(e.target.value) })} 
                  />
                  <div className="flex gap-2 mt-2">
                   <button 
                    type="button"
                    onClick={() => {
                        const remaining = ((selectedVoucher.amount || 0) + (selectedVoucher.arrears || 0) + paymentForm.fineAmount - paymentForm.discountAmount - (selectedVoucher.paidAmount || 0));
                        setPaymentForm({...paymentForm, receivedAmount: remaining});
                    }}
                    className="text-[9px] font-bold text-primary uppercase border border-primary/20 px-2 py-1 rounded-lg hover:bg-primary/5"
                   >
                     Pay Full Amount
                   </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAdvanceYearPayment}
                  className="w-full py-3 rounded-2xl border border-primary/30 text-primary text-[10px] font-black uppercase tracking-widest hover:bg-primary/5 transition-all"
                >
                  Pay Full Year Advance
                </button>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Method</label>
                    <select
                      className="vibrant-input appearance-none"
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    >
                      <option value="Quick Pay">Quick Pay (Online)</option>
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Transaction Ref #</label>
                    <input 
                      type="text" 
                      placeholder="QP-XXXXXX"
                      required
                      className="vibrant-input" 
                      value={paymentForm.transactionRef} 
                      onChange={(e) => setPaymentForm({ ...paymentForm, transactionRef: e.target.value })} 
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-6">
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button" 
                    onClick={() => setIsPaymentModalOpen(false)} 
                    className="flex-1 px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit" 
                    className="vibrant-btn-primary bg-success hover:bg-success/90 flex-1 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-success/20"
                  >
                    Confirm Payment
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isExtraChargeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="vibrant-card w-full max-w-md p-8 space-y-6">
              <h3 className="text-xl font-black uppercase">Extra Fee Charge</h3>
              <form onSubmit={handleExtraCharge} className="space-y-4">
                <input
                  className="vibrant-input"
                  placeholder="Search student (name / roll no)"
                  value={extraStudentQuery}
                  onChange={(e) => setExtraStudentQuery(e.target.value)}
                />
                <select
                  required
                  className="vibrant-input"
                  value={extraChargeForm.studentId}
                  onChange={(e) => setExtraChargeForm({ ...extraChargeForm, studentId: e.target.value })}
                >
                  <option value="">{extraStudentLoading ? 'Loading students…' : 'Select student'}</option>
                  {extraStudentOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.firstName} — {s.rollNumber}</option>
                  ))}
                </select>
                <select
                  className="vibrant-input"
                  value={extraChargeForm.feeType}
                  onChange={(e) => setExtraChargeForm({ ...extraChargeForm, feeType: e.target.value as Fee['feeType'] })}
                >
                  <option value="Security Deposit">Security Deposit</option>
                  <option value="Summer Camp">Summer Camp</option>
                  <option value="ID Card">ID Card</option>
                  <option value="Educational Trip">Educational Trip</option>
                </select>
                <input
                  type="number"
                  required
                  min={1}
                  className="vibrant-input"
                  placeholder="Amount (Rs.)"
                  value={extraChargeForm.amount || ''}
                  onChange={(e) => setExtraChargeForm({ ...extraChargeForm, amount: Number(e.target.value) })}
                />
                <input
                  className="vibrant-input"
                  placeholder="Description / months (optional)"
                  value={extraChargeForm.description}
                  onChange={(e) => setExtraChargeForm({ ...extraChargeForm, description: e.target.value })}
                />
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setIsExtraChargeOpen(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-[10px] font-black uppercase">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary py-3 text-[10px] font-black uppercase">Create Charge</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
