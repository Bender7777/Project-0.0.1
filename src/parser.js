// Parses the uploaded workbook into a flat array of row objects.
// Column matching is by header text (trimmed), order-independent, extra columns ignored.

const COLUMN_ALIASES = {
  dept: ['отдел'],
  fio: ['фамилия, имя, отчество', 'фио', 'фамилия имя отчество'],
  tabNum: ['таб.№', 'таб.номер', 'табельный номер', 'таб №'],
  sapNum: ['sap таб', 'sap', 'sap№'],
  dekret: ['декрет'],
  instructor: ['инструктор'],
  fact: ['факт выполнения', 'факт'],
  date: ['дата'],
  format: ['дэг/очно', 'деg/очно', 'способ'],
};

function normalizeHeader(h) {
  return String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnMap(headerRow) {
  const map = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    let idx = -1;
    for (const alias of aliases) {
      idx = normalized.indexOf(alias);
      if (idx !== -1) break;
    }
    map[key] = idx;
  }
  return map;
}

function excelSerialToDate(n) {
  // Excel date serial (1900 system) -> JS Date, UTC-safe.
  const utcDays = Math.floor(n - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
}

function coerceDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return excelSerialToDate(value);
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
    return new Date(year, month, day);
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeYesNo(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'да' || s === 'yes' || s === '1' || s === 'true';
}

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{rows: object[], sheetName: string, warnings: string[]}}
 */
function parseWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

  if (!raw.length) throw new Error('Файл пуст.');

  const headerRow = raw[0];
  const colMap = buildColumnMap(headerRow);

  const warnings = [];
  if (colMap.dept === -1) warnings.push('Не найдена колонка «Отдел».');
  if (colMap.dekret === -1) warnings.push('Не найдена колонка «Декрет».');
  if (colMap.fact === -1) warnings.push('Не найдена колонка «Факт выполнения».');
  if (colMap.date === -1) warnings.push('Не найдена колонка «ДАТА».');
  if (colMap.format === -1) warnings.push('Не найдена колонка «ДЭГ/ОЧНО».');
  if (colMap.instructor === -1) warnings.push('Не найдена колонка «Инструктор».');

  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every((c) => c == null || c === '')) continue;
    const get = (key) => (colMap[key] === -1 ? null : r[colMap[key]]);

    const dept = normalizeText(get('dept')) || 'Без отдела';
    const fio = normalizeText(get('fio'));
    if (!dept && !fio) continue;

    rows.push({
      dept,
      fio,
      tabNum: get('tabNum'),
      sapNum: get('sapNum'),
      dekret: normalizeText(get('dekret')).toUpperCase() === 'ДО',
      instructor: normalizeText(get('instructor')) || 'Не указан',
      voted: normalizeYesNo(get('fact')),
      date: coerceDate(get('date')),
      format: normalizeText(get('format')).toUpperCase() || null,
    });
  }

  if (!rows.length) throw new Error('В файле не найдено ни одной строки с данными.');

  return { rows, sheetName, warnings };
}
