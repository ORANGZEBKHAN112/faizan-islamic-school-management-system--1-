import { jsPDF } from 'jspdf';
import type { Student, Campus, ExamResult } from '../types';
import { formatRollNumberForDisplay } from './rollNumber';

const SCHOOL_NAME = 'Faizan Islamic School';
const SCHOOL_PHONE = '+92 300 0000000';
const SCHOOL_ADDRESS = 'Faizan Islamic School Network, Pakistan';

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl: string): 'JPEG' | 'PNG' | 'WEBP' {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function clip(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

async function drawIdCardFront(doc: jsPDF, student: Student, campus?: Campus) {
  doc.setFillColor(0, 59, 92);
  doc.rect(0, 0, 86, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(SCHOOL_NAME, 43, 6, { align: 'center' });
  doc.setFontSize(6);
  doc.text(clip(doc, campus?.campusName || student.campusName || 'Main Campus', 78), 43, 11, { align: 'center' });

  doc.setDrawColor(0, 169, 157);
  doc.setLineWidth(0.5);
  doc.rect(4, 16, 20, 24);

  if (student.profileImage) {
    const dataUrl = await loadImageDataUrl(student.profileImage);
    if (dataUrl) {
      doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), 4, 16, 20, 24);
    } else {
      doc.setFontSize(5);
      doc.setTextColor(150, 150, 150);
      doc.text('PHOTO', 14, 30, { align: 'center' });
    }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(150, 150, 150);
    doc.text('PHOTO', 14, 30, { align: 'center' });
  }

  const roll = formatRollNumberForDisplay(student.rollNumber);
  const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ') || student.firstName || '—';
  const classLabel = `${student.className || '—'} ${student.sectionName || ''}`.trim();

  doc.setTextColor(0, 59, 92);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(clip(doc, fullName, 52), 28, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(60, 60, 60);
  doc.text(`Adm / Roll: ${roll}`, 28, 25);
  doc.text(`Father: ${clip(doc, student.fatherName || '—', 50)}`, 28, 30);
  doc.text(`Class: ${clip(doc, classLabel, 50)}`, 28, 35);
  doc.text(`Batch: ${student.sectionName || student.className || '—'}`, 28, 40);
  doc.text(`Session: ${student.session || new Date().getFullYear()}`, 28, 45);

  doc.setFillColor(0, 169, 157);
  doc.rect(0, 48, 86, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5);
  doc.text('STUDENT ID CARD — FRONT', 43, 51.5, { align: 'center' });
}

function drawIdCardBack(doc: jsPDF, student: Student, campus?: Campus) {
  doc.setFillColor(0, 169, 157);
  doc.rect(0, 0, 86, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('STUDENT ID CARD — BACK', 43, 6.5, { align: 'center' });

  const contact = student.contactNumber || '—';
  const emergency = student.contactNumber || '—';
  const address = student.address || campus?.address || '—';
  const campusPhone = campus?.phone || SCHOOL_PHONE;
  const campusAddress = campus?.address || SCHOOL_ADDRESS;
  const session = String(student.session || new Date().getFullYear());

  doc.setTextColor(0, 59, 92);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Student Address', 4, 15);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  const addrLines = doc.splitTextToSize(address, 78);
  doc.text(addrLines.slice(0, 2), 4, 19);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 59, 92);
  doc.text('Contact', 4, 28);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  doc.text(contact, 22, 28);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 59, 92);
  doc.text('Emergency', 4, 33);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  doc.text(emergency, 22, 33);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 59, 92);
  doc.text('School Contact', 4, 38);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  doc.text(campusPhone, 28, 38);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 59, 92);
  doc.text('School Address', 4, 43);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  doc.text(clip(doc, campusAddress, 54), 28, 43);

  doc.setFontSize(5.5);
  doc.setTextColor(80, 80, 80);
  doc.text(`Validity: Academic Session ${session}`, 4, 48);
  doc.text('If found, please return to the school office. Property of FISS.', 4, 51.5);
}

export async function downloadIdCard(student: Student, campus?: Campus) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });
  await drawIdCardFront(doc, student, campus);
  doc.addPage([86, 54], 'landscape');
  drawIdCardBack(doc, student, campus);
  doc.save(`ID_${formatRollNumberForDisplay(student.rollNumber)}.pdf`);
}

export async function downloadIdCardsBulk(students: Student[], campusMap: Record<string, Campus>) {
  if (students.length === 0) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });
  for (let i = 0; i < students.length; i += 1) {
    if (i > 0) doc.addPage([86, 54], 'landscape');
    const student = students[i];
    const campus = campusMap[student.campusId];
    await drawIdCardFront(doc, student, campus);
    doc.addPage([86, 54], 'landscape');
    drawIdCardBack(doc, student, campus);
  }
  doc.save(`ID_Cards_Batch_${new Date().toISOString().split('T')[0]}.pdf`);
}

export function downloadSummerCampCertificate(student: Student, campus?: Campus, programYear?: string) {
  downloadCertificate(student, 'SummerCamp', campus, undefined, programYear);
}

export function downloadCertificate(
  student: Student,
  type: 'Completion' | 'Character' | 'Result' | 'SummerCamp',
  campus?: Campus,
  examResults?: ExamResult[],
  programYear?: string
) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const roll = formatRollNumberForDisplay(student.rollNumber);

  doc.setFillColor(0, 59, 92);
  doc.rect(0, 0, pageW, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(SCHOOL_NAME, pageW / 2, 15, { align: 'center' });
  doc.setFontSize(10);
  doc.text(campus?.campusName || student.campusName || '', pageW / 2, 24, { align: 'center' });
  doc.setFontSize(8);
  doc.text('Excellence in Islamic Education', pageW / 2, 30, { align: 'center' });

  doc.setTextColor(0, 59, 92);
  doc.setFontSize(18);
  const titles = {
    Completion: 'CERTIFICATE OF COMPLETION',
    Character: 'CHARACTER CERTIFICATE',
    Result: 'EXAMINATION RESULT CERTIFICATE',
    SummerCamp: 'SUMMER CAMP CERTIFICATE',
  };
  doc.text(titles[type], pageW / 2, 55, { align: 'center' });

  doc.setDrawColor(0, 169, 157);
  doc.setLineWidth(0.8);
  doc.line(40, 60, pageW - 40, 60);

  doc.setTextColor(40, 40, 40);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');

  const body =
    type === 'Character'
      ? `This is to certify that ${student.firstName}, son/daughter of ${student.fatherName || '—'}, bearing Roll No. ${roll}, is/was a bonafide student of ${student.className || 'this institution'}. He/She bears a good moral character and we wish success in future endeavors.`
      : type === 'Completion'
        ? `This is to certify that ${student.firstName}, Roll No. ${roll}, has successfully completed the required course of study at ${SCHOOL_NAME} for the academic session ${student.session || new Date().getFullYear()}.`
        : type === 'SummerCamp'
          ? `This is to certify that ${student.firstName}, Roll No. ${roll}, Class ${student.className || '—'}, successfully participated in the ${SCHOOL_NAME} Summer Camp program for ${programYear || student.session || new Date().getFullYear()}.`
          : `This certifies the examination results of ${student.firstName}, Roll No. ${roll}, Class ${student.className || '—'}.`;

  const lines = doc.splitTextToSize(body, pageW - 50);
  doc.text(lines, 25, 75);

  if (type === 'Result' && examResults && examResults.length > 0) {
    let y = 75 + lines.length * 6 + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Exam Results:', 25, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    examResults.forEach((r) => {
      doc.text(`• Marks: ${r.obtainedMarks}${r.grade ? ` (Grade: ${r.grade})` : ''}`, 30, y);
      y += 7;
    });
  }

  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.text(`Date: ${dateStr}`, 25, 240);
  doc.text('_____________________', pageW - 70, 235);
  doc.setFontSize(9);
  doc.text('Principal / Authorized Signatory', pageW - 70, 242);

  doc.save(`${type}_${roll}.pdf`);
}

export function downloadExamResultSheet(
  examTitle: string,
  className: string,
  rows: Array<{ studentName: string; rollNumber: string; obtainedMarks: number; grade?: string; totalMarks?: number }>
) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(0, 59, 92);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(SCHOOL_NAME, pageW / 2, 12, { align: 'center' });
  doc.setFontSize(10);
  doc.text(examTitle, pageW / 2, 22, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(`Class: ${className}`, 14, 40);

  let y = 52;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Roll No.', 14, y);
  doc.text('Student', 40, y);
  doc.text('Marks', 120, y);
  doc.text('Grade', 150, y);
  y += 8;
  doc.setFont('helvetica', 'normal');

  rows.forEach((row) => {
    doc.text(formatRollNumberForDisplay(row.rollNumber), 14, y);
    doc.text(row.studentName, 40, y);
    doc.text(String(row.obtainedMarks), 120, y);
    doc.text(row.grade || '—', 150, y);
    y += 7;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  });

  doc.save(`Results_${examTitle.replace(/\s+/g, '_')}.pdf`);
}
