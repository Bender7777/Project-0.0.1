// Формирование Excel-файла в формате образца «Мониторинг востребованности питания».
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const CENTER = { horizontal: 'center', vertical: 'middle' };
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

const pad = (n) => String(n).padStart(2, '0');
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

export function sortRows(rows) {
  return [...rows].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (parseInt(a.flight, 10) || 0) - (parseInt(b.flight, 10) || 0));
}

/** Название листа в стиле образца: «09.09.-31.10.26г.» */
export function sheetName(rows) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return 'Мониторинг';
  const [y1, m1, d1] = dates[0].split('-');
  const [y2, m2, d2] = dates[dates.length - 1].split('-');
  return `${d1}.${m1}.-${d2}.${m2}.${y2.slice(2)}г.`;
}

export function fileName(rows) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return 'Мониторинг_питания.xlsx';
  const [y1, m1, d1] = dates[0].split('-');
  const [y2, m2, d2] = dates[dates.length - 1].split('-');
  const range = dates[0] === dates[dates.length - 1] ? `${d1}.${m1}.${y1}` : `${d1}.${m1}-${d2}.${m2}.${y2}`;
  return `Мониторинг_востребованности_питания_${range}.xlsx`;
}

export async function buildWorkbook(ExcelJS, inputRows) {
  const rows = sortRows(inputRows);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meal Report PWA';
  const ws = wb.addWorksheet(sheetName(rows), {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const widths = [11.3, 9.1, 21.1, 10.3, 10.4, 9.1, 9.1, 10.3, 9.1, 9.1, 9.1, 78.4];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Заголовок
  ws.mergeCells('A1:L1');
  const title = ws.getCell('A1');
  title.value = 'Мониторинг востребованности питания';
  title.font = { name: 'Calibri', size: 11, bold: true };
  title.alignment = CENTER;
  for (let c = 1; c <= 12; c++) ws.getCell(1, c).border = BORDER;

  // Шапка таблицы
  const head = ['Дата', '№ рейса', 'Направление', 'Загружено пит', 'Кол-во PAX', 'Остаток', 'Перегруз'];
  head.forEach((h, i) => { ws.getCell(2, i + 1).value = h; });
  ws.mergeCells('H2:I2');
  ws.getCell('H2').value = 'Не востребовано\n(от кол-ва PAX)';
  ws.mergeCells('J2:K2');
  ws.getCell('J2').value = 'Не востребовано\n(от кол-ва порций)';
  ws.getCell('L2').value = 'Комментарии';
  ws.getRow(2).height = 36;
  for (let c = 1; c <= 12; c++) {
    const cell = ws.getCell(2, c);
    cell.font = { name: 'Calibri', size: c === 12 ? 11 : 10, bold: c !== 12 };
    cell.alignment = { ...CENTER, wrapText: true };
    cell.border = BORDER;
  }

  // Данные
  rows.forEach((r, idx) => {
    const n = idx + 3;
    const hasData = r.loaded != null && r.pax != null;
    const flagged = !hasData || r.loaded === 0;
    const set = (col, value, fmt) => {
      const cell = ws.getCell(n, col);
      if (value !== undefined && value !== null && value !== '') cell.value = value;
      if (fmt) cell.numFmt = fmt;
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = CENTER;
      cell.border = BORDER;
      if (flagged) cell.fill = YELLOW;
      return cell;
    };
    set(1, r.date ? toDate(r.date) : null, 'dd.mm.yyyy');
    set(2, r.flight ? `SU${r.flight}` : null);
    set(3, r.city);
    set(4, r.loaded);
    set(5, r.pax);
    set(6, r.left);
    if (hasData) {
      const g = r.loaded - r.pax;
      const h = (r.left ?? 0) - g;
      set(7, { formula: `D${n}-E${n}`, result: g });
      set(8, { formula: `F${n}-G${n}`, result: h });
      set(9, { formula: `IFERROR(H${n}/E${n},"")`, result: r.pax ? h / r.pax : '' }, '0%');
      set(10, { formula: `IFERROR(F${n}/D${n},"")`, result: r.loaded ? (r.left ?? 0) / r.loaded : '' }, '0%');
    } else {
      [7, 8, 9, 10].forEach((c) => set(c, null));
    }
    set(11, null);
    set(12, r.comment);
  });

  const last = Math.max(rows.length + 2, 2);
  ws.autoFilter = { from: 'A2', to: `L${last}` };
  return wb;
}
