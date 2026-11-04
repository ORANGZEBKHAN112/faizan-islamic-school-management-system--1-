import XLSX from 'xlsx';
import fs from 'fs';

const src = 'C:\\Users\\DELL\\Downloads\\book module .xlsx';
const dest = 'c:\\Users\\DELL\\Downloads\\faizan-islamic-school-management-system (1)\\server\\bookstore\\courseMasterSeed.json';
const wb = XLSX.readFile(src, { cellDates: true });

function money(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function copiesOf(unitPrice, lineAmount, qtyText) {
  const stated = Number.parseInt(String(qtyText || ''), 10) || 1;
  const unit = Math.round(unitPrice);
  const line = Math.round(lineAmount);
  if (unit > 0 && line > 0 && line % unit === 0) return line / unit;
  return stated;
}

function parseSheet(name) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
  const classes = [];
  let current = null;
  for (let i = 2; i < rows.length; i += 1) {
    const grade = String(rows[i][1] || '').trim();
    const title = String(rows[i][2] || '').replace(/\s+/g, ' ').trim();
    const unitPrice = money(rows[i][3]);
    const lineAmount = money(rows[i][5]);
    const publisher = String(rows[i][6] || '').trim();
    if (!title) continue;
    if (grade && grade !== 'All Classes') {
      if (!current || current.grade !== grade) {
        current = { grade, items: [] };
        classes.push(current);
      }
    }
    if (!current) continue;
    current.items.push({
      title,
      publisher: publisher || null,
      quantity: copiesOf(unitPrice, lineAmount, rows[i][4]),
      unitPrice,
      sort: current.items.length + 1,
      sharedStationery: grade === 'All Classes',
    });
  }
  return { name, classes };
}

const regions = wb.SheetNames.map(parseSheet);
fs.writeFileSync(dest, JSON.stringify({ source: 'book module .xlsx', regions }, null, 2));
for (const region of regions) {
  console.log(region.name, region.classes.map((c) => `${c.grade}:${c.items.length}`).join(', '));
}
