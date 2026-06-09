import { jsPDF } from 'jspdf';
import type { Student, Campus, ExamResult } from '../types';

const SCHOOL_NAME = 'Faizan Islamic School';

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

async function drawIdCard(doc: jsPDF, student: Student, campus?: Campus) {
  doc.setFillColor(0, 59, 92);
  doc.rect(0, 0, 86, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(SCHOOL_NAME, 43, 6, { align: 'center' });
  doc.setFontSize(6);
  doc.text(campus?.campusName || student.campusName || 'Main Campus', 43, 11, { align: 'center' });

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

  doc.setTextColor(0, 59, 92);
  doc.setFontSize(10);
  doc.text(student.firstName, 28, 22);
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text(`Roll: ${student.rollNumber}`, 28, 28);
  doc.text(`Class: ${student.className || '—'} ${student.sectionName || ''}`.trim(), 28, 33);
  doc.text(`Father: ${student.fatherName || '—'}`, 28, 38);
  doc.text(`Session: ${student.session || new Date().getFullYear()}`, 28, 43);

  doc.setFillColor(0, 169, 157);
  doc.rect(0, 48, 86, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5);
  doc.text('STUDENT ID CARD — Valid for current academic year', 43, 51.5, { align: 'center' });
}

export async function downloadIdCard(student: Student, campus?: Campus) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });
  await drawIdCard(doc, student, campus);
  doc.save(`ID_${student.rollNumber}.pdf`);
}

export async function downloadIdCardsBulk(students: Student[], campusMap: Record<string, Campus>) {
  if (students.length === 0) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });
  for (let i = 0; i < students.length; i += 1) {
    if (i > 0) doc.addPage([86, 54], 'landscape');
    await drawIdCard(doc, students[i], campusMap[students[i].campusId]);
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
      ? `This is to certify that ${student.firstName}, son/daughter of ${student.fatherName || '—'}, bearing Roll No. ${student.rollNumber}, is/was a bonafide student of ${student.className || 'this institution'}. He/She bears a good moral character and we wish success in future endeavors.`
      : type === 'Completion'
        ? `This is to certify that ${student.firstName}, Roll No. ${student.rollNumber}, has successfully completed the required course of study at ${SCHOOL_NAME} for the academic session ${student.session || new Date().getFullYear()}.`
        : type === 'SummerCamp'
          ? `This is to certify that ${student.firstName}, Roll No. ${student.rollNumber}, Class ${student.className || '—'}, successfully participated in the ${SCHOOL_NAME} Summer Camp program for ${programYear || student.session || new Date().getFullYear()}.`
          : `This certifies the examination results of ${student.firstName}, Roll No. ${student.rollNumber}, Class ${student.className || '—'}.`;

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

  doc.save(`${type}_${student.rollNumber}.pdf`);
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
    doc.text(row.rollNumber, 14, y);
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
