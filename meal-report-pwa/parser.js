import { FLIGHT_CITY, AIRPORT_CITY, MOSCOW } from './cities.js';

const norm = (s) => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

const num = (text, labelRe) => {
  const m = text.match(new RegExp(labelRe.source + '\\s*[:：]?\\s*(\\d+)', 'i'));
  return m ? parseInt(m[1], 10) : null;
};

/** Разбор текста одного отчёта «Мониторинг питания». Возвращает объект с полями или null-значениями. */
export function parseReportText(rawText, fileName = '') {
  const text = norm(rawText);
  const warnings = [];

  const flightNo = (text.match(/Рейс\s*№\s*(\d+)/i) || [])[1]
    || (fileName.match(/SU\s*0*(\d{1,4})/i) || [])[1] || null;
  const from = (text.match(/А\/п\s+вылета\s+([A-Z]{3})/i) || [])[1]?.toUpperCase() || null;
  const to = (text.match(/А\/п\s+прилета\s+([A-Z]{3})/i) || [])[1]?.toUpperCase() || null;
  const dm = text.match(/Дата\s+вылета\s+(\d{2})[-./](\d{2})[-./](\d{4})/i);
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;

  // Блоки питания по классам обслуживания (на случай, если в отчёте их несколько).
  const foodPart = text.split(/Данные\s+по\s+питанию/i)[1] ?? '';
  const blocks = foodPart.split(/Класс\s+обслуживания/i).slice(1).map((b) => ({
    cls: (b.match(/^\s*([^•]+?)\s*(?:•|Количество)/) || [])[1] || '',
    loaded: num(b, /Количество\s+загруженных\s+порций\s+питания[^0-9]*?накладной/),
    pax: num(b, /Фактическое\s+количество\s+пассажиров/),
    left: num(b, /Количество\s+порций\s+невостребованного\s+питания/),
    comment: ((b.match(/т\.\s*д\.\s*(.*)$/i) || [])[1] || '').trim(),
  }));
  let block = blocks.find((b) => /эконом/i.test(b.cls)) || blocks[0];
  if (blocks.length > 1) {
    warnings.push(`В отчёте несколько классов (${blocks.map((b) => b.cls).join(', ')}) — взят «${block.cls}»`);
  }
  if (!block) {
    // Запасной вариант: ищем подписи по всему тексту.
    block = {
      cls: '',
      loaded: num(text, /Количество\s+загруженных\s+порций\s+питания[^0-9]*?накладной/),
      pax: num(text, /Фактическое\s+количество\s+пассажиров/),
      left: num(text, /Количество\s+порций\s+невостребованного\s+питания/),
      comment: ((text.match(/т\.\s*д\.\s*(.*)$/i) || [])[1] || '').trim(),
    };
  }

  let comment = block.comment.replace(/[«»"“”]/g, '').trim();
  if (/^[-–—\s.]*$/.test(comment)) comment = '';

  const missing = [];
  if (!flightNo) missing.push('номер рейса');
  if (!date) missing.push('дата вылета');
  if (block.loaded == null) missing.push('загружено порций');
  if (block.pax == null) missing.push('кол-во пассажиров');
  if (block.left == null) missing.push('невостребовано');
  if (missing.length) warnings.push('Не найдено: ' + missing.join(', '));

  return {
    flight: flightNo ? String(parseInt(flightNo, 10)) : '',
    from, to, date,
    loaded: block.loaded, pax: block.pax, left: block.left,
    comment, warnings,
    ok: missing.length === 0,
  };
}

/** Город для строки таблицы: сначала выученный пользователем, потом справочник рейсов, потом по аэропортам. */
export function resolveCity(flight, from, to, learned = {}) {
  if (learned[flight]) return { city: learned[flight], source: 'learned' };
  if (FLIGHT_CITY[flight]) return { city: FLIGHT_CITY[flight], source: 'flight' };
  let code = null;
  if (from && MOSCOW.has(from)) code = to;
  else if (to && MOSCOW.has(to)) code = from;
  else code = to || from;
  if (!code) return { city: '', source: 'none' };
  return AIRPORT_CITY[code] ? { city: AIRPORT_CITY[code], source: 'airport' } : { city: code, source: 'code' };
}
