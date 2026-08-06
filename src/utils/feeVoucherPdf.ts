import { jsPDF } from 'jspdf';
import type { Fee } from '../types';
import { formatRollNumberForDisplay } from './rollNumber';

const TEAL: [number, number, number] = [32, 175, 171];
const TEAL_DARK: [number, number, number] = [15, 83, 127];
const GREY: [number, number, number] = [100, 116, 139];

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type FeeVoucherPdfContext = {
  campusName?: string;
  sealDataUrl?: string;
  notesDataUrl?: string;
};

let cachedAssets: { sealDataUrl?: string; notesDataUrl?: string } | null = null;

async function loadAssetAsDataUrl(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(path);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function loadFeeVoucherPdfAssets(): Promise<FeeVoucherPdfContext> {
  if (cachedAssets) return cachedAssets;
  const [sealDataUrl, notesDataUrl] = await Promise.all([
    loadAssetAsDataUrl('/voucher-fiss-seal.png'),
    loadAssetAsDataUrl('/voucher-urdu-notes.png'),
  ]);
  cachedAssets = { sealDataUrl, notesDataUrl };
  return cachedAssets;
}

function amountInWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero Rupees Only.';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const underThousand = (num: number): string => {
    if (num < 20) return ones[num];
    if (num < 100) return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ''}`.trim();
    return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${underThousand(num % 100)}` : ''}`.trim();
  };

  const parts: string[] = [];
  let rem = n;
  const crore = Math.floor(rem / 10000000);
  if (crore) {
    parts.push(`${underThousand(crore)} Crore`);
    rem %= 10000000;
  }
  const lakh = Math.floor(rem / 100000);
  if (lakh) {
    parts.push(`${underThousand(lakh)} Lakh`);
    rem %= 100000;
  }
  const thousand = Math.floor(rem / 1000);
  if (thousand) {
    parts.push(`${underThousand(thousand)} Thousand`);
    rem %= 1000;
  }
  if (rem) parts.push(underThousand(rem));
  return `${parts.join(' ')} Rupees Only.`;
}

function formatDateParts(raw?: string | null): string {
  if (!raw) return '— — —';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]} - ${m[2]} - ${m[1]}`;
    return String(raw);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd} - ${mm} - ${yyyy}`;
}

function dashedLine(doc: jsPDF, x1: number, y: number, x2: number) {
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([1.2, 1.1], 0);
  doc.line(x1, y, x2, y);
  doc.setLineDashPattern([], 0);
}

function fieldRow(doc: jsPDF, x: number, y: number, w: number, label: string, value: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEAL);
  doc.text(label, x, y);
  const labelW = doc.getTextWidth(label) + 2;
  dashedLine(doc, x + labelW, y + 0.6, x + w);
  if (value) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEAL_DARK);
    doc.setFontSize(8.5);
    doc.text(value, x + labelW + 1.5, y - 0.3);
  }
}

function voucherGrossPayable(voucher: Fee): number {
  return (voucher.amount || 0) + (voucher.arrears || 0) + (voucher.fineAmount || 0) - (voucher.discountAmount || 0);
}

function voucherRemaining(voucher: Fee): number {
  return voucher.balanceAmount ?? Math.max(0, voucherGrossPayable(voucher) - (voucher.paidAmount || 0));
}

function buildFeeHeads(voucher: Fee): Array<{ label: string; months: string; amount: number }> {
  const monthHint = voucher.month ? '1' : '—';
  const heads: Array<{ label: string; months: string; amount: number }> = [
    { label: 'Tuition Fee', months: monthHint, amount: Number(voucher.tuitionFee || 0) || (voucher.feeType === 'Monthly' ? Number(voucher.amount || 0) : 0) },
    { label: 'Admission Fee', months: voucher.admissionFee ? '1' : '—', amount: Number(voucher.admissionFee || 0) },
    { label: 'ID Card Charges', months: voucher.idCardFee ? '1' : '—', amount: Number(voucher.idCardFee || 0) },
  ];
  const extras: Array<[string, number]> = [
    ['Security Fee', Number(voucher.securityFee || 0)],
    ['Exam Fee', Number(voucher.examFee || 0)],
    ['Transport Fee', Number(voucher.transportFee || 0)],
    ['Registration / Misc', Number(voucher.miscFee || 0)],
    ['Summer Camp', Number(voucher.summerCampFee || 0)],
    ['Educational Trip', Number(voucher.tripFee || 0)],
    ['Arrears', Number(voucher.arrears || 0)],
    ['Fine', Number(voucher.fineAmount || 0)],
  ];
  for (const [label, amount] of extras) {
    if (amount > 0) heads.push({ label, months: '—', amount });
  }
  if ((voucher.discountAmount || 0) > 0) {
    heads.push({ label: 'Discount', months: '—', amount: -Number(voucher.discountAmount || 0) });
  }
  // Keep design-like rows even when zero for the first three
  return heads.filter((h, i) => i < 3 || h.amount !== 0).slice(0, 8);
}

function drawCopy(
  doc: jsPDF,
  originX: number,
  copyW: number,
  copyLabel: 'Bank Copy' | 'Student Copy',
  voucher: Fee,
  campusName: string,
  assets: FeeVoucherPdfContext,
) {
  const pad = 4;
  const x = originX + pad;
  const w = copyW - pad * 2;
  const right = x + w;
  let y = 8;

  // Print meta
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  const printMeta = `Print:  — — — — — —  (${copyLabel})`;
  doc.text(printMeta, x + w / 2, y, { align: 'center' });
  y += 3;

  // Teal header
  const headerH = 22;
  doc.setFillColor(...TEAL);
  doc.rect(x, y, w, headerH, 'F');
  if (assets.sealDataUrl) {
    try {
      doc.addImage(assets.sealDataUrl, 'PNG', x + 2, y + 1.5, 18, 18);
    } catch {
      // ignore image decode issues
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('FAIZAN ISLAMIC SCHOOL SYSTEM', x + w / 2 + 4, y + 10, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('DAWAT-E-ISLAMI', right - 3, y + 17, { align: 'right' });
  y += headerH + 5;

  // KuickPay blurb
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEAL);
  const blurb = [
    'For convenience, pay online or',
    'cash at affiliate banks using the',
    'kuickpay Option',
  ];
  blurb.forEach((line, i) => doc.text(line, x, y + i * 3.6));
  y += 13;

  const kuickId = voucher.transactionRef || voucher.id;
  const payable = voucherRemaining(voucher);

  // KuickPay ID box
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.7);
  doc.roundedRect(x, y, w, 8, 0.5, 0.5, 'S');
  doc.setFillColor(...TEAL);
  doc.rect(x, y, 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('KuickPay ID', x + 14, y + 5.2, { align: 'center' });
  doc.setTextColor(...TEAL_DARK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(String(kuickId).slice(0, 28), x + 30, y + 5.3);
  y += 10;

  // Kuick Pay Amount (split box)
  doc.setDrawColor(...TEAL);
  doc.roundedRect(x, y, w, 8, 0.5, 0.5, 'S');
  doc.setFillColor(...TEAL);
  doc.rect(x, y, 38, 8, 'F');
  doc.line(x + w * 0.55, y, x + w * 0.55, y + 8);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('Kuick Pay Amount', x + 19, y + 5.2, { align: 'center' });
  doc.setTextColor(...TEAL_DARK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(String(Math.round(payable)), x + w * 0.55 + 2, y + 5.4);
  y += 12;

  // Campus / month
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...TEAL_DARK);
  doc.text('Faizan Islamic School System', x + w / 2, y, { align: 'center' });
  y += 4.5;
  doc.setTextColor(...TEAL);
  doc.setFontSize(10);
  const campusLabel = campusName ? `"${campusName}"` : '"Campus"';
  doc.text(campusLabel, x + w / 2, y, { align: 'center' });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEAL);
  const monthLabel = voucher.monthsLabel
    || (voucher.month ? `${MONTHS[voucher.month] || voucher.month} - ${voucher.year}` : `— - ${voucher.year || ''}`);
  doc.text(`For the Month of  ${monthLabel}`, x + w / 2, y, { align: 'center' });
  y += 7;

  const admissionNo = formatRollNumberForDisplay(voucher.rollNumber);
  const challanNo = voucher.voucherNo || voucher.id.substring(0, 8).toUpperCase();
  const section = voucher.sectionName || '—';

  fieldRow(doc, x, y, w, 'Admission No.', admissionNo);
  y += 6;
  fieldRow(doc, x, y, w, 'Challan No.', challanNo);
  y += 6;
  fieldRow(doc, x, y, w, 'Name:', voucher.studentName || '—');
  y += 6;
  fieldRow(doc, x, y, w, 'F-Name:', voucher.fatherName || '—');
  y += 6;
  fieldRow(doc, x, y, w, 'Class:', voucher.className || '—');
  y += 6;
  fieldRow(doc, x, y, w, 'Section:', section);
  y += 8;

  // Dates row
  const colW = w / 3;
  const issue = formatDateParts(voucher.createdAt || new Date().toISOString());
  const due = formatDateParts(voucher.dueDate);
  const expiry = formatDateParts(voucher.validityDate || voucher.dueDate);
  const dateCols: Array<[string, string]> = [
    ['Issue Date', issue],
    ['Due Date', due],
    ['Expiry Date', expiry],
  ];
  dateCols.forEach(([label, value], i) => {
    const cx = x + i * colW;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEAL);
    doc.text(label, cx + colW / 2, y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEAL_DARK);
    doc.text(value, cx + colW / 2, y + 4.2, { align: 'center' });
  });
  y += 10;

  // Fee table
  const heads = buildFeeHeads(voucher);
  const rowH = 6.2;
  const colHeads = [
    { title: 'Head/s of\nAccount/s', width: w * 0.42 },
    { title: 'Rs.', width: w * 0.14 },
    { title: 'Moth/s', width: w * 0.16 },
    { title: 'Amount', width: w * 0.28 },
  ];
  doc.setFillColor(...TEAL);
  doc.rect(x, y, w, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  let cx = x;
  colHeads.forEach((c) => {
    const lines = c.title.split('\n');
    lines.forEach((line, li) => {
      doc.text(line, cx + c.width / 2, y + 3.2 + li * 2.8, { align: 'center' });
    });
    cx += c.width;
  });
  y += 9;

  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.3);
  heads.forEach((head) => {
    doc.setTextColor(...TEAL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(head.label, x + 1.5, y + 4);
    // dashed value cells
    let vx = x + colHeads[0].width;
    for (let i = 1; i < 4; i++) {
      const cellW = colHeads[i].width;
      dashedLine(doc, vx + 1, y + 4.5, vx + cellW - 1);
      if (i === 2) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...TEAL_DARK);
        doc.text(head.months, vx + cellW / 2, y + 3.8, { align: 'center' });
      }
      if (i === 3) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...TEAL_DARK);
        doc.text(head.amount ? String(Math.round(head.amount)) : '—', vx + cellW / 2, y + 3.8, { align: 'center' });
      }
      vx += cellW;
    }
    doc.setDrawColor(...TEAL);
    doc.line(x, y + rowH, right, y + rowH);
    y += rowH;
  });

  // Outer table border
  const tableTop = y - heads.length * rowH - 9;
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.6);
  doc.rect(x, tableTop, w, 9 + heads.length * rowH);

  y += 3;

  // Amount payable bar
  const barH = 8;
  doc.setFillColor(...TEAL);
  doc.rect(x, y, w * 0.62, barH, 'F');
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.7);
  doc.rect(x + w * 0.62, y, w * 0.38, barH, 'S');
  doc.setFillColor(...TEAL);
  doc.rect(x + w * 0.62, y, 10, barH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('Amount Payable within Due Date:', x + 2, y + 5.2);
  doc.text('Rs.', x + w * 0.62 + 5, y + 5.2, { align: 'center' });
  doc.setTextColor(...TEAL_DARK);
  doc.setFontSize(10);
  doc.text(String(Math.round(payable)).padStart(4, '0'), x + w * 0.62 + 12, y + 5.5);
  y += barH + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEAL);
  doc.text(amountInWords(payable), x + w / 2, y, { align: 'center' });
  y += 4;

  // Urdu notes
  if (assets.notesDataUrl) {
    const notesH = 42;
    try {
      doc.addImage(assets.notesDataUrl, 'PNG', x, y, w, notesH);
      y += notesH + 2;
    } catch {
      y += 2;
    }
  } else {
    doc.setFontSize(7);
    doc.setTextColor(...TEAL_DARK);
    doc.text('Note: Pay via KuickPay at affiliate banks. Fees not accepted after expiry.', x, y + 3, { maxWidth: w });
    y += 10;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEAL);
  doc.text('Bank Stamp & Signature.', x, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  doc.text(`Gr No:  ${challanNo}`, x + w / 2, 290, { align: 'center' });
}

/** Draw Bank + Student copies of the official FISS voucher onto a page. */
export function drawFeeVoucherPage(
  doc: jsPDF,
  voucher: Fee,
  options?: FeeVoucherPdfContext & { campusName?: string },
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const gap = 3;
  const copyW = (pageW - gap - 6) / 2;
  const leftX = 3;
  const rightX = 3 + copyW + gap;
  const campusName = options?.campusName
    || voucher.campusName
    || 'Campus';

  // Outer page frame
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.4);
  doc.rect(2, 2, pageW - 4, pageH - 4);

  // Perforation / cut line
  doc.setDrawColor(...GREY);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setLineWidth(0.25);
  doc.line(3 + copyW + gap / 2, 6, 3 + copyW + gap / 2, pageH - 6);
  doc.setLineDashPattern([], 0);

  const assets: FeeVoucherPdfContext = {
    sealDataUrl: options?.sealDataUrl,
    notesDataUrl: options?.notesDataUrl,
  };

  drawCopy(doc, leftX, copyW, 'Bank Copy', voucher, campusName, assets);
  drawCopy(doc, rightX, copyW, 'Student Copy', voucher, campusName, assets);
}

export async function downloadFeeVoucherPdf(
  voucher: Fee,
  options?: { campusName?: string; fileName?: string; existingDoc?: jsPDF },
): Promise<jsPDF> {
  const assets = await loadFeeVoucherPdfAssets();
  const doc = options?.existingDoc || new jsPDF('p', 'mm', 'a4');
  drawFeeVoucherPage(doc, voucher, { ...assets, campusName: options?.campusName });
  if (!options?.existingDoc) {
    const month = MONTHS[voucher.month] || 'Fee';
    const name = options?.fileName
      || `${voucher.studentName || 'Student'}_${month}_${voucher.year || ''}_Voucher.pdf`;
    doc.save(name.replace(/\s+/g, '_'));
  }
  return doc;
}
