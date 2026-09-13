import { compare, CHECKS } from './compare.js';

const $ = (s) => document.querySelector(s);
const state = { assign: null, apply: null, assignName: '', applyName: '', result: null };

const readSheet = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onerror = () => reject(new Error(`${file.name} 을(를) 읽지 못했습니다.`));
  fr.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
    } catch (e) { reject(new Error(`${file.name} 파싱 실패: ${e.message}`)); }
  };
  fr.readAsArrayBuffer(file);
});

function wireDrop(dropId, inputId, key) {
  const drop = $(dropId), input = $(inputId);
  const handle = async (file) => {
    if (!file) return;
    try {
      state[key] = await readSheet(file);
      state[key + 'Name'] = file.name;
      drop.classList.add('loaded');
      drop.querySelector('.drop-file').textContent = file.name;
      showError('');
      run();
    } catch (e) { showError(e.message); }
  };
  input.addEventListener('change', () => handle(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = !msg;
}

function run() {
  if (!state.assign || !state.apply) return;
  try {
    state.result = compare(state.assign, state.apply);
    render();
    $('#btn-export').disabled = false;
  } catch (e) {
    showError(e.message);
    $('#btn-export').disabled = true;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  const { results, unassigned, summary } = state.result;
  const onlyBad = $('#opt-only-bad').checked;

  $('#summary').hidden = false;
  $('#summary').innerHTML = `
    <span class="chip">배정검토 <b>${summary.assignCount}</b>건</span>
    <span class="chip">수강신청 <b>${summary.applyCount}</b>건</span>
    <span class="chip ok">전 항목 일치 <b>${summary.okCount}</b></span>
    <span class="chip bad">불일치 있음 <b>${summary.mismatchCount}</b></span>
    <span class="chip ${summary.unassignedCount ? 'warn' : ''}">신청만 있고 배정 없음 <b>${summary.unassignedCount}</b></span>`;

  const tbody = $('#table tbody');
  const rows = results.filter((r) => !onlyBad || r.mismatchCount > 0);
  tbody.innerHTML = rows.map((r, i) => {
    const cells = CHECKS.map((c) => {
      const ck = r.checks[c.key];
      const cls = ck.ok ? '' : 'bad';
      const note = ck.note ? `<span class="note">${esc(ck.note)}</span>` : '';
      return `<td class="pair-a ${cls}">${esc(ck.a)}</td><td class="${cls}">${esc(ck.b)}${note}</td>`;
    }).join('');
    const match = !r.matched ? '<span class="tag none">신청 없음</span>'
      : `<span class="tag ${r.ambiguous ? 'warn' : ''}">${esc(r.matchedBy)}${r.ambiguous ? ' · 후보 여러 명' : ''}${r.applyRow ? ` · 신청행 ${r.applyRow}` : ''}</span>`;
    return `<tr class="${r.mismatchCount ? 'row-bad' : 'row-ok'}">
      <td>${i + 1}</td><td>${r.assignRow}</td><td>${match}</td>${cells}
      <td>${esc(r.teacher)}</td>
      <td class="${r.mismatchCount ? 'count-bad' : 'count-ok'}">${r.mismatchCount ? r.mismatchCount + '건' : '일치'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${5 + CHECKS.length * 2}" class="muted">표시할 행이 없습니다.</td></tr>`;
  $('#result').hidden = false;

  const ub = $('#table-unassigned tbody');
  ub.innerHTML = unassigned.map((u, i) => `<tr>
    <td>${i + 1}</td><td>${u.applyRow}</td><td>${esc(u.name)}</td><td>${esc(u.phone)}</td><td>${esc(u.email)}</td>
    <td>${esc(u.lang)}</td><td>${esc(u.mode)}</td><td>${esc(u.interval)}</td><td>${esc(u.wish)}</td><td>${esc(u.status)}</td>
  </tr>`).join('');
  $('#unassigned').hidden = unassigned.length === 0;
}

const FILL = {
  yellow: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
  red: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F7' } },
};
const RED_FONT = { color: { argb: 'FF9C0006' }, bold: true };
const BORDER = { top: { style: 'thin', color: { argb: 'FFD0D4DA' } }, bottom: { style: 'thin', color: { argb: 'FFD0D4DA' } },
  left: { style: 'thin', color: { argb: 'FFD0D4DA' } }, right: { style: 'thin', color: { argb: 'FFD0D4DA' } } };

async function exportXlsx() {
  const { results, unassigned } = state.result;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('대조결과', { views: [{ state: 'frozen', ySplit: 1 }] });

  // 컬럼 정의: key 는 checks 키, side 는 a(배정)/b(신청)
  const cols = [
    { h: '배정행', w: 8 }, { h: '매칭', w: 10 },
    ...CHECKS.flatMap((c) => [
      { h: `${c.label}(배정)`, key: c.key, side: 'a', w: c.key === 'email' ? 24 : 16 },
      { h: `${c.label}(신청)`, key: c.key, side: 'b', w: c.key === 'email' || c.key === 'time' ? 24 : 16, apply: true },
    ]),
    { h: '담당강사', w: 14 }, { h: '불일치 수', w: 9 }, { h: '불일치 항목', w: 28 },
  ];
  ws.columns = cols.map((c) => ({ width: c.w }));

  const head = ws.addRow(cols.map((c) => c.h));
  head.eachCell((cell, i) => {
    cell.fill = cols[i - 1].apply ? FILL.yellow : FILL.head;   // (신청) 제목은 노란색
    cell.font = { bold: true };
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle' };
  });

  for (const r of results) {
    const bad = CHECKS.filter((c) => !r.checks[c.key].ok).map((c) => c.label).join(', ');
    const row = ws.addRow(cols.map((c) => {
      if (c.key) return r.checks[c.key][c.side];
      switch (c.h) {
        case '배정행': return r.assignRow;
        case '매칭': return r.matched ? r.matchedBy : '신청 없음';
        case '담당강사': return r.teacher;
        case '불일치 수': return r.mismatchCount;
        default: return bad;
      }
    }));
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.border = BORDER;
      const c = cols[i - 1];
      const isBad = c.key ? !r.checks[c.key].ok : (c.h === '불일치 수' || c.h === '불일치 항목') && r.mismatchCount > 0;
      if (isBad) { cell.fill = FILL.red; cell.font = RED_FONT; }   // 불일치: 배정+신청 칸 모두 빨간색
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  if (unassigned.length) {
    const us = wb.addWorksheet('배정없음');
    const uh = ['신청행', '이름', '전화번호', '이메일', '언어', '화상/전화', '횟수', '희망시간', '상태'];
    us.columns = [8, 12, 16, 24, 12, 10, 12, 24, 10].map((w) => ({ width: w }));
    const h = us.addRow(uh);
    h.eachCell((cell) => { cell.fill = FILL.yellow; cell.font = { bold: true }; cell.border = BORDER; });
    for (const u of unassigned) {
      const row = us.addRow([u.applyRow, u.name, u.phone, u.email, u.lang, u.mode, u.interval, u.wish, u.status]);
      row.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `배정검토_대조결과_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

wireDrop('#drop-assign', '#file-assign', 'assign');
wireDrop('#drop-apply', '#file-apply', 'apply');
$('#opt-only-bad').addEventListener('change', () => state.result && render());
$('#btn-export').addEventListener('click', exportXlsx);
