import XLSX from 'xlsx';
import fs from 'fs';

const src = 'c:\\Users\\DELL\\Desktop\\Software_Working.xlsx';
const dest = 'c:\\Users\\DELL\\Downloads\\faizan-islamic-school-management-system (1)\\server\\bookstore\\courseMasterSeed.json';
const wb = XLSX.readFile(src, { cellDates: true });

function parseSheet(name) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
  const classes = [];
  let current = null;
  for (let i = 2; i < rows.length; i += 1) {
    const grade = String(rows[i][1] || '').trim();
    const title = String(rows[i][2] || '').replace(/\s+/g, ' ').trim();
    const publisher = String(rows[i][4] || '').trim();
    const qty = Number.parseInt(String(rows[i][3] || ''), 10) || 1;
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
      quantity: qty,
      sort: current.items.length + 1,
      sharedStationery: grade === 'All Classes',
    });
  }
  return { name, classes };
}

const regions = wb.SheetNames.map(parseSheet);
fs.writeFileSync(dest, JSON.stringify({ source: 'Software_Working.xlsx', regions }, null, 2));
for (const region of regions) {
  console.log(region.name, region.classes.map((c) => `${c.grade}:${c.items.length}`).join(', '));
}
