// Pure computation of all dashboard statistics from parsed rows.

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

function groupCount(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

function computeStats(rows) {
  const total = rows.length;

  // 1. By department.
  const deptMap = groupCount(rows, (r) => r.dept);
  const byDept = [...deptMap.entries()]
    .map(([name, count]) => ({ name, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);

  // 2. Dekret vs without.
  const dekretRows = rows.filter((r) => r.dekret);
  const nonDekretRows = rows.filter((r) => !r.dekret);
  const dekret = {
    count: dekretRows.length,
    pct: pct(dekretRows.length, total),
    withoutCount: nonDekretRows.length,
    withoutPct: pct(nonDekretRows.length, total),
  };

  // 3. Voted by day.
  const dayBuckets = new Map();
  for (const r of rows) {
    const k = dateKey(r.date);
    if (!dayBuckets.has(k)) dayBuckets.set(k, { date: r.date, total: 0, voted: 0 });
    const b = dayBuckets.get(k);
    b.total += 1;
    if (r.voted) b.voted += 1;
  }
  const byDay = [...dayBuckets.values()]
    .sort((a, b) => (a.date && b.date ? a.date - b.date : 0))
    .map((b) => ({
      label: fmtDate(b.date),
      total: b.total,
      voted: b.voted,
      votedPctOfDay: pct(b.voted, b.total),
      votedPctOfAll: pct(b.voted, total),
    }));

  // Overall turnout.
  const votedRows = rows.filter((r) => r.voted);
  const turnout = { count: votedRows.length, pct: pct(votedRows.length, total) };

  // 4. Dekret turnout: how many of the dekret group voted.
  const dekretVotedRows = dekretRows.filter((r) => r.voted);
  const dekretTurnout = {
    count: dekretVotedRows.length,
    pct: pct(dekretVotedRows.length, dekretRows.length),
    baseCount: dekretRows.length,
  };

  // 5. Dekret voters by format (ДЭГ / ОЧНО).
  const dekretFormatMap = groupCount(dekretVotedRows, (r) => r.format || 'Не указано');
  const dekretFormat = [...dekretFormatMap.entries()]
    .map(([name, count]) => ({ name, count, pct: pct(count, dekretVotedRows.length) }))
    .sort((a, b) => b.count - a.count);

  // Overall format among all voters.
  const formatMap = groupCount(votedRows, (r) => r.format || 'Не указано');
  const format = [...formatMap.entries()]
    .map(([name, count]) => ({ name, count, pct: pct(count, votedRows.length) }))
    .sort((a, b) => b.count - a.count);

  // Turnout by department.
  const deptTurnout = byDept.map(({ name }) => {
    const deptRows = rows.filter((r) => r.dept === name);
    const deptVoted = deptRows.filter((r) => r.voted).length;
    return { name, total: deptRows.length, voted: deptVoted, pct: pct(deptVoted, deptRows.length) };
  });

  // Day x format matrix (among voters).
  const dayFormat = byDay.map((d) => {
    const dayRows = rows.filter((r) => fmtDate(r.date) === d.label && r.voted);
    const deg = dayRows.filter((r) => r.format === 'ДЭГ').length;
    const ochno = dayRows.filter((r) => r.format === 'ОЧНО').length;
    return { label: d.label, deg, ochno };
  });

  // Instructor load.
  const instrMap = groupCount(rows, (r) => r.instructor);
  const byInstructor = [...instrMap.entries()]
    .map(([name, count]) => {
      const instrRows = rows.filter((r) => r.instructor === name);
      const voted = instrRows.filter((r) => r.voted).length;
      return { name, count, voted, pct: pct(voted, count) };
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
