import * as pdfjs from './vendor/pdf.min.mjs';
import { parseReportText, resolveCity } from './parser.js';
import { buildWorkbook, fileName } from './export.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const el = { drop: $('drop'), file: $('file'), progress: $('progress'), log: $('log'), result: $('result'),
  count: $('count'), tbody: document.querySelector('#table tbody'), download: $('download'),
  clear: $('clear'), install: $('install') };

const state = { rows: [], nextId: 1 };

// ---------- «Выученные» города: правки пользователя запоминаются по номеру рейса ----------
const loadLearned = () => { try { return JSON.parse(localStorage.getItem('flightCity') || '{}'); } catch { return {}; } };
const saveLearned = (flight, city) => {
  try { const m = loadLearned(); if (city) m[flight] = city; else delete m[flight]; localStorage.setItem('flightCity', JSON.stringify(m)); } catch { /* нет доступа к хранилищу */ }
};

// ---------- Чтение файлов ----------
async function pdfToText(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  await doc.destroy();
  return text;
}

/** Разворачивает загруженные файлы (в т.ч. вложенные ZIP) в список PDF. */
async function collectPdfs(files, report) {
  const out = [];
  const walkZip = async (buf, label) => {
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch { report(label, 'не удалось открыть архив', 'err'); return; }
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || /(^|\/)(__MACOSX\/|\._)/.test(entry.name)) continue;
      const lower = entry.name.toLowerCase();
      const path = `${label} → ${entry.name}`;
      if (lower.endsWith('.pdf')) out.push({ name: path, base: entry.name.split('/').pop(), data: await entry.async('uint8array') });
      else if (lower.endsWith('.zip')) await walkZip(await entry.async('arraybuffer'), path);
    }
  };
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.pdf') || f.type === 'application/pdf') out.push({ name: f.name, base: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    else if (lower.endsWith('.zip')) await walkZip(await f.arrayBuffer(), f.name);
    else if (/\.(rar|7z|tar|gz|tgz)$/.test(lower)) report(f.name, 'формат архива не поддерживается — упакуйте в ZIP', 'err');
    else report(f.name, 'пропущен: нужен PDF или ZIP', 'err');
  }
  return out;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  el.log.hidden = false; el.progress.hidden = false;
  const addLog = (name, msg, cls) => {
    const li = document.createElement('li'); li.className = cls;
    li.textContent = `${name}: ${msg}`; el.log.append(li);
  };
  el.progress.textContent = 'Чтение файлов…';
  const pdfs = await collectPdfs(files, addLog);
  const learned = loadLearned();
  let added = 0;
  for (let i = 0; i < pdfs.length; i++) {
    const p = pdfs[i];
    el.progress.textContent = `Обработка ${i + 1} из ${pdfs.length}…`;
    try {
      const text = await pdfToText(p.data);
      if (!text.replace(/\s+/g, '').length) { addLog(p.name, 'в PDF нет текстового слоя (скан) — распознать нельзя', 'err'); continue; }
      const r = parseReportText(text, p.base);
      if (!r.flight && r.loaded == null && r.pax == null) { addLog(p.name, 'это не похоже на отчёт о питании', 'err'); continue; }
      const { city, source } = resolveCity(r.flight, r.from, r.to, learned);
      const row = { id: state.nextId++, file: p.name, include: true, date: r.date || '', flight: r.flight, city, citySource: source,
        route: r.from && r.to ? `${r.from}–${r.to}` : '', loaded: r.loaded, pax: r.pax, left: r.left, comment: r.comment, warnings: r.warnings };
      state.rows.push(row); added++;
      addLog(p.name, r.ok ? `SU${r.flight}, ${r.date}` : r.warnings.join('; '), r.ok ? 'ok' : 'err');
    } catch (e) {
      addLog(p.name, 'не удалось прочитать PDF (' + (e.message || e) + ')', 'err');
    }
  }
  markDuplicates();
  el.progress.hidden = true;
  if (!added && !state.rows.length) return;
  render();
}

function markDuplicates() {
  const seen = new Map();
  state.rows.forEach((r) => {
    r.dup = false;
    const key = r.date + '|' + r.flight;
    if (!r.date || !r.flight) return;
    if (seen.has(key)) {
      const first = seen.get(key);
      const same = ['loaded', 'pax', 'left'].every((k) => first[k] === r[k]);
      if (same && first.include) r.include = false;
      r.dup = true; first.dup = true;
    } else seen.set(key, r);
  });
}

// ---------- Таблица ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function notesFor(r) {
  const n = [...r.warnings];
  if (r.dup) n.push('такой рейс на эту дату уже есть в списке');
  if (r.citySource === 'airport' || r.citySource === 'code') n.push(`город определён по аэропорту (${r.route}) — проверьте`);
  if (r.citySource === 'none') n.push('укажите направление');
  return n;
}

function render() {
  el.result.hidden = state.rows.length === 0;
  el.count.textContent = state.rows.filter((r) => r.include).length;
  el.tbody.innerHTML = state.rows.map((r) => {
    const notes = notesFor(r);
    const bad = notes.length || r.loaded == null || r.pax == null || !r.date;
    return `<tr data-id="${r.id}" class="${bad ? 'warn' : ''} ${r.include ? '' : 'off'}">
      <td><input type="checkbox" data-k="include" ${r.include ? 'checked' : ''} aria-label="Включить в файл"></td>
      <td data-label="Дата"><input type="date" data-k="date" value="${esc(r.date)}"></td>
      <td data-label="Рейс"><input type="text" class="flight" data-k="flight" inputmode="numeric" value="${esc(r.flight)}"></td>
      <td data-label="Направление"><input type="text" data-k="city" value="${esc(r.city)}">${notes.length ? `<span class="note">${esc(notes.join('; '))}</span>` : ''}</td>
      <td data-label="Загружено"><input type="number" data-k="loaded" min="0" inputmode="numeric" value="${r.loaded ?? ''}"></td>
      <td data-label="PAX"><input type="number" data-k="pax" min="0" inputmode="numeric" value="${r.pax ?? ''}"></td>
      <td data-label="Остаток"><input type="number" data-k="left" min="0" inputmode="numeric" value="${r.left ?? ''}"></td>
      <td data-label="Комментарий"><input type="text" data-k="comment" value="${esc(r.comment)}"></td>
      <td><button class="x" data-del title="Удалить" aria-label="Удалить">×</button></td></tr>`;
  }).join('');
  el.download.disabled = !state.rows.some((r) => r.include);
}

el.tbody.addEventListener('change', (e) => {
  const input = e.target.closest('input[data-k]'); if (!input) return;
  const row = state.rows.find((r) => r.id === +input.closest('tr').dataset.id);
  const k = input.dataset.k;
  if (k === 'include') row.include = input.checked;
  else if (['loaded', 'pax', 'left'].includes(k)) row[k] = input.value === '' ? null : Math.max(0, parseInt(input.value, 10) || 0);
  else if (k === 'flight') row.flight = input.value.replace(/\D/g, '').replace(/^0+/, '');
  else row[k] = input.value.trim();
  if (k === 'city') { row.citySource = 'learned'; if (row.flight) saveLearned(row.flight, row.city); }
  markDuplicates();
  render();
});
el.tbody.addEventListener('click', (e) => {
  if (!e.target.matches('[data-del]')) return;
  const id = +e.target.closest('tr').dataset.id;
  state.rows = state.rows.filter((r) => r.id !== id);
  markDuplicates(); render();
});

// ---------- Экспорт ----------
el.download.addEventListener('click', async () => {
  const rows = state.rows.filter((r) => r.include);
  if (!rows.length) return;
  el.download.disabled = true;
  try {
    const wb = await buildWorkbook(ExcelJS, rows);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName(rows);
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally { el.download.disabled = false; }
});

el.clear.addEventListener('click', () => {
  state.rows = []; el.log.innerHTML = ''; el.log.hidden = true; render();
});

// ---------- Загрузка файлов ----------
el.file.addEventListener('change', async () => { await handleFiles(el.file.files); el.file.value = ''; });
['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
el.drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

// ---------- PWA ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; el.install.hidden = false; });
el.install.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; el.install.hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
