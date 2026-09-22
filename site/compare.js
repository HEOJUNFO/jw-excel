// 배정검토 vs 수강신청 비교 로직. 브라우저/Node 양쪽에서 쓰는 순수 모듈 (DOM 의존 없음).

// 헤더 후보: 파일마다 컬럼명이 조금씩 달라도 잡히도록 여러 이름을 둔다.
// 사번 후보. 배정검토의 'ID' 컬럼은 이메일이라 여기 넣지 않는다.
const EMP_ID_COLS = ['사번', '사원번호', '사원 번호', '직원번호', 'Employee ID', 'EmployeeID', 'Emp No', 'EmpNo'];

export const ASSIGN_COLS = {
  empId: EMP_ID_COLS,
  name: ['K-Name', '이름', '성명', 'Name'],
  phone: ['Mobile', '휴대전화번호', '휴대폰', '1st Call'],
  phoneAlt: ['1st Call', '2st Call', '2nd Call'],
  email: ['이메일', 'ID', 'Email', 'E-mail'],
  mode: ['수업유형', '유형'],
  lang: ['언어'],
  interval: ['Interval', '횟수', '주당횟수'],
  perWeek: ['주당횟수'],
  minutes: ['강의시간'],
  time: ['수업시간', '시간'],
  teacher: ['담당강사'],
  days: ['요일'],
};

export const APPLY_COLS = {
  empId: EMP_ID_COLS,
  name: ['이름', '성명', 'K-Name', 'Name'],
  phone: ['휴대전화번호', '휴대폰', 'Mobile', '전화번호'],
  email: ['이메일', 'Email', 'E-mail'],
  mode: ['수업유형', '유형'],
  lang: ['언어'],
  interval: ['횟수', 'Interval'],
  wish1: ['희망시간1', '희망시간 1', '희망시간'],
  wish2: ['희망시간2', '희망시간 2'],
  course: ['과정', '과정선택', '과정명'],
  status: ['상태'],
};

export const CHECKS = [
  { key: 'name', label: '이름' },
  { key: 'phone', label: '전화번호' },
  { key: 'email', label: '이메일' },
  { key: 'mode', label: '화상/전화' },
  { key: 'lang', label: '언어' },
  { key: 'interval', label: '횟수' },
  { key: 'time', label: '수업시간' },
];

const clean = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).replace(/\s+/g, '').toLowerCase();
const digits = (v) => clean(v).replace(/\D/g, '');
// 사번 키: 공백/대소문자 무시, 숫자만이면 앞자리 0 무시 (엑셀이 숫자로 읽으면 0이 사라지므로)
const empKey = (v) => { const n = norm(v); return /^\d+$/.test(n) ? n.replace(/^0+(?=\d)/, '') : n; };

// 시트(2차원 배열)에서 헤더 행을 찾는다: 후보 컬럼명이 가장 많이 들어있는 행.
export function findHeaderRow(rows, colSpec) {
  const wanted = new Set(Object.values(colSpec).flat().map(norm));
  let best = -1, bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const hits = rows[i].filter((c) => wanted.has(norm(c))).length;
    if (hits > bestHits) { best = i; bestHits = hits; }
  }
  return bestHits >= 2 ? best : -1;
}

// 2차원 배열 → { headers, records:[{__row, [헤더]: 값}] }
export function toRecords(rows, colSpec) {
  const h = findHeaderRow(rows, colSpec);
  if (h < 0) throw new Error('헤더 행을 찾지 못했습니다. (이름/이메일/언어 등 컬럼이 있는지 확인하세요)');
  const headers = rows[h].map(clean);
  const records = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => clean(c) === '')) continue;
    const rec = { __row: i + 1 };
    headers.forEach((k, j) => { if (k) rec[k] = clean(r[j]); });
    records.push(rec);
  }
  return { headers, records, headerRow: h };
}

export function pick(rec, candidates) {
  for (const c of candidates) {
    for (const k of Object.keys(rec)) {
      if (norm(k) === norm(c) && rec[k] !== '') return rec[k];
    }
  }
  return '';
}

// "06:30~06:40" → { start: 390, end: 400 } (분 단위). 파싱 실패 시 null.
export function parseRange(s) {
  const m = clean(s).match(/(\d{1,2})\s*[:시]\s*(\d{0,2})\s*분?\s*[~\-–—]\s*(\d{1,2})\s*[:시]\s*(\d{0,2})/);
  if (!m) return null;
  const toMin = (h, mm) => Number(h) * 60 + Number(mm || 0);
  let start = toMin(m[1], m[2]);
  let end = toMin(m[3], m[4]);
  if (end < start) end += 24 * 60; // 자정 넘김
  return { start, end };
}

export function rangeWithin(inner, outer) {
  if (!inner || !outer) return false;
  return inner.start >= outer.start && inner.end <= outer.end;
}

// 언어 동일 취급 그룹: 영어(원어민) = 영어(북미) = 영어(교포) 등. 영어(필리핀)은 별도.
const LANG_ALIASES = [['영어(원어민)', '영어(북미)', '영어(교포)', '영어(미국)', '영어(캐나다)', '영어(영국)', '영어(호주)']];
function langKey(v) {
  const n = norm(v);
  for (const g of LANG_ALIASES) if (g.map(norm).includes(n)) return norm(g[0]);
  return n;
}

// 수강신청 언어 컬럼이 "제2외국어"(또는 비어 있음)이면 실제 언어는 '과정' 컬럼에 있다.
const isSecondLang = (lang) => /제\s*2\s*외국어|기타\s*외국어/.test(norm(lang)) || norm(lang) === '';

// 배정 언어("스페인어") vs 신청 과정("스페인어 과정", "스페인어(원어민)")을 느슨하게 비교
function courseMatches(assignLang, course) {
  const a = norm(assignLang).replace(/\(.*?\)|과정/g, '');
  const c = norm(course).replace(/\(.*?\)|과정/g, '');
  if (!a || !c) return false;
  return a === c || c.includes(a) || a.includes(c);
}

function intervalKey(v) {
  // "주2회15분", "주 2회 15분", "주2회 / 15분" 등을 "2-15" 로 정규화
  const m = norm(v).match(/(\d+)회.*?(\d+)분/);
  return m ? `${m[1]}-${m[2]}` : norm(v);
}

function assignInterval(a) {
  const v = pick(a, ASSIGN_COLS.interval);
  if (v) return v;
  const w = pick(a, ASSIGN_COLS.perWeek), m = pick(a, ASSIGN_COLS.minutes);
  return w && m ? `주${w}회${m}분` : '';
}

// 수강신청 레코드 인덱스: 사번 / 이름 / 전화 / 이메일로 찾을 수 있게
function buildIndex(applies) {
  const byEmpId = new Map(), byName = new Map(), byPhone = new Map(), byEmail = new Map();
  const add = (map, k, r) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(r); };
  for (const r of applies) {
    add(byEmpId, empKey(pick(r, APPLY_COLS.empId)), r);
    add(byName, norm(pick(r, APPLY_COLS.name)), r);
    add(byPhone, digits(pick(r, APPLY_COLS.phone)), r);
    add(byEmail, norm(pick(r, APPLY_COLS.email)), r);
  }
  return { byEmpId, byName, byPhone, byEmail };
}

// 매칭: 사번(양쪽에 값이 있을 때만) → 이름 → (동명이인이면 전화로 좁힘) → 전화 → 이메일 순.
// 사번 컬럼이 없거나 비어 있으면 자연히 이름부터 시작해 기존과 동일하게 동작한다.
function matchApply(a, idx) {
  const empId = empKey(pick(a, ASSIGN_COLS.empId));
  let c = idx.byEmpId.get(empId) || [];
  if (empId && c.length) return { rec: c[0], by: '사번', ambiguous: c.length > 1 };
  const name = norm(pick(a, ASSIGN_COLS.name));
  const phone = digits(pick(a, ASSIGN_COLS.phone)) || digits(pick(a, ASSIGN_COLS.phoneAlt));
  const email = norm(pick(a, ASSIGN_COLS.email));
  c = idx.byName.get(name) || [];
  if (c.length > 1 && phone) {
    const narrowed = c.filter((r) => digits(pick(r, APPLY_COLS.phone)) === phone);
    if (narrowed.length) c = narrowed;
  }
  if (c.length) return { rec: c[0], by: '이름', ambiguous: c.length > 1 };
  c = idx.byPhone.get(phone) || [];
  if (phone && c.length) return { rec: c[0], by: '전화번호', ambiguous: c.length > 1 };
  c = idx.byEmail.get(email) || [];
  if (email && c.length) return { rec: c[0], by: '이메일', ambiguous: c.length > 1 };
  return null;
}

/**
 * @param assignRows 배정검토 시트 2차원 배열
 * @param applyRows 수강신청 시트 2차원 배열
 */
export function compare(assignRows, applyRows) {
  const assign = toRecords(assignRows, ASSIGN_COLS);
  const apply = toRecords(applyRows, APPLY_COLS);
  const idx = buildIndex(apply.records);
  const used = new Set();
  const results = [];

  for (const a of assign.records) {
    const m = matchApply(a, idx);
    const row = {
      assignRow: a.__row,
      name: pick(a, ASSIGN_COLS.name),
      teacher: pick(a, ASSIGN_COLS.teacher),
      days: pick(a, ASSIGN_COLS.days),
      matched: !!m,
      matchedBy: m ? m.by : '',
      ambiguous: m ? m.ambiguous : false,
      applyRow: m ? m.rec.__row : null,
      checks: {},
      mismatchCount: 0,
    };
    if (!m) {
      // 신청 없음: 모든 항목을 불일치로 표시
      for (const c of CHECKS) row.checks[c.key] = { a: '', b: '', ok: false, note: '신청 없음' };
      row.checks.name.a = row.name;
      row.checks.phone.a = pick(a, ASSIGN_COLS.phone);
      row.checks.email.a = pick(a, ASSIGN_COLS.email);
      row.checks.mode.a = pick(a, ASSIGN_COLS.mode);
      row.checks.lang.a = pick(a, ASSIGN_COLS.lang);
      row.checks.interval.a = assignInterval(a);
      row.checks.time.a = pick(a, ASSIGN_COLS.time);
      row.mismatchCount = CHECKS.length;
      results.push(row);
      continue;
    }
    const b = m.rec;
    used.add(b);
    const set = (key, av, bv, ok, note = '') => {
      row.checks[key] = { a: av, b: bv, ok, note };
      if (!ok) row.mismatchCount++;
    };
    const an = pick(a, ASSIGN_COLS.name), bn = pick(b, APPLY_COLS.name);
    set('name', an, bn, norm(an) === norm(bn));

    const ap = pick(a, ASSIGN_COLS.phone), bp = pick(b, APPLY_COLS.phone);
    set('phone', ap, bp, digits(ap) !== '' && digits(ap) === digits(bp));

    const ae = pick(a, ASSIGN_COLS.email), be = pick(b, APPLY_COLS.email);
    set('email', ae, be, norm(ae) !== '' && norm(ae) === norm(be));

    const am = pick(a, ASSIGN_COLS.mode), bm = pick(b, APPLY_COLS.mode);
    set('mode', am, bm, norm(am) !== '' && norm(am) === norm(bm));

    const al = pick(a, ASSIGN_COLS.lang), bl = pick(b, APPLY_COLS.lang);
    if (isSecondLang(bl)) {
      // 제2외국어: 신청 리스트엔 언어가 안 나오므로 '과정' 컬럼으로 판단
      const bc = pick(b, APPLY_COLS.course);
      set('lang', al, bc ? `${bc}${bl ? ` (${bl})` : ''}` : bl, norm(al) !== '' && courseMatches(al, bc), '과정으로 비교');
    } else {
      set('lang', al, bl, norm(al) !== '' && langKey(al) === langKey(bl));
    }

    const ai = assignInterval(a), bi = pick(b, APPLY_COLS.interval);
    set('interval', ai, bi, norm(ai) !== '' && intervalKey(ai) === intervalKey(bi));

    const at = pick(a, ASSIGN_COLS.time);
    const w1 = pick(b, APPLY_COLS.wish1), w2 = pick(b, APPLY_COLS.wish2);
    const inner = parseRange(at);
    const okTime = !!inner && (rangeWithin(inner, parseRange(w1)) || rangeWithin(inner, parseRange(w2)));
    const bt = [w1, w2].filter(Boolean).join(' / ');
    set('time', at, bt, okTime, !inner && at ? '시간 형식 인식 불가' : '');

    results.push(row);
  }

  // 신청은 했는데 배정검토에 없는 사람
  const unassigned = apply.records.filter((r) => !used.has(r)).map((r) => ({
    applyRow: r.__row,
    name: pick(r, APPLY_COLS.name),
    phone: pick(r, APPLY_COLS.phone),
    email: pick(r, APPLY_COLS.email),
    lang: pick(r, APPLY_COLS.lang),
    mode: pick(r, APPLY_COLS.mode),
    interval: pick(r, APPLY_COLS.interval),
    wish: [pick(r, APPLY_COLS.wish1), pick(r, APPLY_COLS.wish2)].filter(Boolean).join(' / '),
    status: pick(r, APPLY_COLS.status),
  }));

  return {
    results,
    unassigned,
    summary: {
      assignCount: assign.records.length,
      applyCount: apply.records.length,
      okCount: results.filter((r) => r.matched && r.mismatchCount === 0).length,
      mismatchCount: results.filter((r) => r.mismatchCount > 0).length,
      unassignedCount: unassigned.length,
    },
  };
}
