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
    state.result = compare(state.assign, state.apply, { langAlias: $('#opt-lang-alias').checked });
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

function exportXlsx() {
  const { results, unassigned } = state.result;
  const header = ['배정행', '매칭', '이름(배정)', '이름(신청)', '전화(배정)', '전화(신청)', '이메일(배정)', '이메일(신청)',
    '화상/전화(배정)', '화상/전화(신청)', '언어(배정)', '언어(신청)', '횟수(배정)', '횟수(신청)', '수업시간(배정)', '희망시간(신청)',
    '담당강사', '불일치 수', '불일치 항목'];
  const rows = results.map((r) => {
    const bad = CHECKS.filter((c) => !r.checks[c.key].ok).map((c) => c.label).join(', ');
    const v = (k, side) => r.checks[k][side];
    return [r.assignRow, r.matched ? r.matchedBy : '신청 없음',
      v('name', 'a'), v('name', 'b'), v('phone', 'a'), v('phone', 'b'), v('email', 'a'), v('email', 'b'),
      v('mode', 'a'), v('mode', 'b'), v('lang', 'a'), v('lang', 'b'), v('interval', 'a'), v('interval', 'b'),
      v('time', 'a'), v('time', 'b'), r.teacher, r.mismatchCount, bad];
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), '대조결과');
  if (unassigned.length) {
    const uh = ['신청행', '이름', '전화번호', '이메일', '언어', '화상/전화', '횟수', '희망시간', '상태'];
    const ur = unassigned.map((u) => [u.applyRow, u.name, u.phone, u.email, u.lang, u.mode, u.interval, u.wish, u.status]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([uh, ...ur]), '배정없음');
  }
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `배정검토_대조결과_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
}

wireDrop('#drop-assign', '#file-assign', 'assign');
wireDrop('#drop-apply', '#file-apply', 'apply');
$('#opt-lang-alias').addEventListener('change', run);
$('#opt-only-bad').addEventListener('change', () => state.result && render());
$('#btn-export').addEventListener('click', exportXlsx);
