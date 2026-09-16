// Pure computation of all dashboard statistics from parsed rows.
// Every group carries the matching row objects (not just counts) so the
// dashboard can drill down into "who is behind this number" on click.

function pct(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

function fmtPct(n) {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function fmtDate(d) {
  if (!d) return 'Без даты';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
}

function dateKey(d) {
  if (!d) return 'none';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupRows(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function computeStats(rows) {
  const total = rows.length;

  // 1. By department.
  const deptGroups = groupRows(rows, (r) => r.dept);
  const byDept = [...deptGroups.entries()]
    .map(([name, groupedRows]) => ({ name, count: groupedRows.length, pct: pct(groupedRows.length, total), rows: groupedRows }))
    .sort((a, b) => b.count - a.count);

  // 2. Dekret vs without.
  const dekretRows = rows.filter((r) => r.dekret);
  const nonDekretRows = rows.filter((r) => !r.dekret);
  const dekret = {
    count: dekretRows.length,
    pct: pct(dekretRows.length, total),
    withoutCount: nonDekretRows.length,
    withoutPct: pct(nonDekretRows.length, total),
    rows: dekretRows,
    withoutRows: nonDekretRows,
  };

  // 3. Voted by day.
  const dayBuckets = new Map();
  for (const r of rows) {
    const k = dateKey(r.date);
    if (!dayBuckets.has(k)) dayBuckets.set(k, { date: r.date, rows: [], votedRows: [] });
    const b = dayBuckets.get(k);
    b.rows.push(r);
    if (r.voted) b.votedRows.push(r);
  }
  const byDay = [...dayBuckets.values()]
    .sort((a, b) => (a.date && b.date ? a.date - b.date : 0))
    .map((b) => ({
      label: fmtDate(b.date),
      total: b.rows.length,
      voted: b.votedRows.length,
      votedPctOfDay: pct(b.votedRows.length, b.rows.length),
      votedPctOfAll: pct(b.votedRows.length, total),
      rows: b.rows,
      votedRows: b.votedRows,
    }));

  // Overall turnout.
  const votedRows = rows.filter((r) => r.voted);
  const turnout = { count: votedRows.length, pct: pct(votedRows.length, total), rows: votedRows };

  // 4. Dekret turnout: how many of the dekret group voted.
  const dekretVotedRows = dekretRows.filter((r) => r.voted);
  const dekretNotVotedRows = dekretRows.filter((r) => !r.voted);
  const dekretTurnout = {
    count: dekretVotedRows.length,
    pct: pct(dekretVotedRows.length, dekretRows.length),
    baseCount: dekretRows.length,
    rows: dekretVotedRows,
    notVotedRows: dekretNotVotedRows,
  };

  // 5. Dekret voters by format (ДЭГ / ОЧНО).
  const dekretFormatGroups = groupRows(dekretVotedRows, (r) => r.format || 'Не указано');
  const dekretFormat = [...dekretFormatGroups.entries()]
    .map(([name, groupedRows]) => ({ name, count: groupedRows.length, pct: pct(groupedRows.length, dekretVotedRows.length), rows: groupedRows }))
    .sort((a, b) => b.count - a.count);

  // Overall format among all voters.
  const formatGroups = groupRows(votedRows, (r) => r.format || 'Не указано');
  const format = [...formatGroups.entries()]
    .map(([name, groupedRows]) => ({ name, count: groupedRows.length, pct: pct(groupedRows.length, votedRows.length), rows: groupedRows }))
    .sort((a, b) => b.count - a.count);

  // Turnout by department.
  const deptTurnout = byDept.map(({ name, rows: deptRows }) => {
    const deptVotedRows = deptRows.filter((r) => r.voted);
    return { name, total: deptRows.length, voted: deptVotedRows.length, pct: pct(deptVotedRows.length, deptRows.length), rows: deptRows, votedRows: deptVotedRows };
  });

  // Day x format matrix (among voters).
  const dayFormat = byDay.map((d) => {
    const degRows = d.votedRows.filter((r) => r.format === 'ДЭГ');
    const ochnoRows = d.votedRows.filter((r) => r.format === 'ОЧНО');
    return { label: d.label, deg: degRows.length, ochno: ochnoRows.length, degRows, ochnoRows };
  });

  // Instructor load.
  const instrGroups = groupRows(rows, (r) => r.instructor);
  const byInstructor = [...instrGroups.entries()]
    .map(([name, instrRows]) => {
      const instrVotedRows = instrRows.filter((r) => r.voted);
      return { name, count: instrRows.length, voted: instrVotedRows.length, pct: pct(instrVotedRows.length, instrRows.length), rows: instrRows, votedRows: instrVotedRows };
    })
    .sort((a, b) => b.count - a.count);

  return {
    total,
    byDept,
    dekret,
    byDay,
    turnout,
    dekretTurnout,
    dekretFormat,
    format,
    deptTurnout,
    dayFormat,
    byInstructor,
  };
}
