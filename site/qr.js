import {
  SLOTS, findContentBox, normalizeLink, qrRuns, pdfFileName,
  squareToPx, pxToSquare, clampSquare, moveSquare, resizeSquare, defaultSquares, sanitizeSquares,
} from './poster.js';

// qrcode-generator 기본값은 비ASCII(한글)를 깨뜨리므로 UTF-8 로 바꾼다.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const $ = (s, root = document) => root.querySelector(s);
const QR_QUIET = 2;      // 생성 QR 둘레 여백(모듈 수). 칸 자체가 흰색이라 표준 4 보다 작게.
const PX_TO_PT = 0.75;   // 이미지 1px = 1/96in → PDF pt(1/72in)

// ---------- QR 위치 보관 (localStorage, 브라우저별 편의 기능) ----------
const SQUARES_KEY = 'qr-poster:squares';
function loadSquares() {
  try { return sanitizeSquares(JSON.parse(localStorage.getItem(SQUARES_KEY))); } catch { return defaultSquares(); }
}
function saveSquares() {
  try { localStorage.setItem(SQUARES_KEY, JSON.stringify(state.squares)); } catch { /* 저장 못 해도 이번 작업엔 지장 없음 */ }
}

const state = {
  base: null,      // { img, name, box }
  baseLoads: 0,    // 기본 이미지 로드 순번. 늦게 끝난 이전 로드가 새 이미지를 덮지 않게 한다.
  loadError: '',   // 파일을 못 읽은 오류. 다음 로드가 성공할 때까지 계속 보여준다.
  squares: loadSquares(), // 칸별 QR 자리 { x, y, size } (포스터 대비 비율)
  slots: Object.fromEntries(Object.keys(SLOTS).map((k) => [k, { mode: 'link', link: '', image: null, imageName: '' }])),
};

// ---------- 기본 이미지 보관 (IndexedDB, 브라우저별 편의 기능이라 실패해도 무시) ----------
const DB = 'qr-poster', STORE = 'files', BASE_KEY = 'base';
const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function saveBase(file) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ blob: file, name: file.name }, BASE_KEY);
  } catch { /* 저장 못 해도 이번 작업엔 지장 없음 */ }
}
async function loadSavedBase() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(BASE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

// ---------- 이미지 로딩 ----------
const loadImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열지 못했습니다. PNG/JPG 파일인지 확인해 주세요.')); };
  img.src = url;
});

function measureBox(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return findContentBox(ctx.getImageData(0, 0, c.width, c.height));
}

// 더 늦게 시작한 로드가 있으면 false (결과를 버림)
async function setBase(blob, name) {
  const ticket = ++state.baseLoads;
  const img = await loadImage(blob);
  if (ticket !== state.baseLoads) return false;
  state.base = { img, name, box: measureBox(img) };
  const drop = $('#drop-base');
  drop.classList.add('loaded');
  $('.drop-file', drop).textContent = name;
  return true;
}

// 칸의 현재 자리 (이미지 px, 포스터 안으로 보정)
const squarePx = (key) => clampSquare(squareToPx(state.squares[key], state.base.box), state.base.box);

// ---------- QR 배치 ----------
function makeQr(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  try { qr.make(); } catch { throw new Error('링크가 너무 길어 QR로 만들 수 없습니다.'); }
  return qr;
}

// 칸마다 무엇을 어디에 그릴지 (포스터 영역 기준 px). 미리보기·PDF·상태 표시가 같이 쓴다.
//   { key, empty:true } | { key, error } | { key, kind:'image', img, rect } | { key, kind:'qr', text, cell, rects }
function layoutSlots() {
  if (!state.base) return Object.keys(SLOTS).map((key) => ({ key, empty: true }));
  return Object.keys(SLOTS).map((key) => {
    const s = state.slots[key];
    const sq = squarePx(key);
    if (s.mode === 'image') {
      if (!s.image) return { key, empty: true };
      const { naturalWidth: iw, naturalHeight: ih } = s.image;
      const k = Math.min(sq.size / iw, sq.size / ih);
      const w = iw * k, h = ih * k;
      return { key, kind: 'image', img: s.image, rect: { x: sq.x + (sq.size - w) / 2, y: sq.y + (sq.size - h) / 2, w, h } };
    }
    const text = normalizeLink(s.link);
    if (!text) return { key, empty: true };
    let qr;
    try { qr = makeQr(text); } catch (e) { return { key, error: e.message }; }
    const n = qr.getModuleCount();
    const cell = sq.size / (n + QR_QUIET * 2);
    const x0 = sq.x + cell * QR_QUIET, y0 = sq.y + cell * QR_QUIET;
    const rects = qrRuns(n, (r, c) => qr.isDark(r, c)).map(({ row, col, len }) => ({ x: x0 + col * cell, y: y0 + row * cell, w: len * cell }));
    return { key, kind: 'qr', text, cell, rects };
  });
}

// ---------- 미리보기 ----------
function render() {
  const slots = layoutSlots();
  const errors = [state.loadError, ...slots.filter((p) => p.error).map((p) => `${SLOTS[p.key].label}: ${p.error}`)].filter(Boolean);
  slots.forEach(updateStatus);
  showError(errors.join('\n'));
  $('#btn-pdf').disabled = !state.base || slots.some((p) => p.error);
  if (!state.base) return;

  const { img, box } = state.base;
  const canvas = $('#preview');
  canvas.width = box.width; canvas.height = box.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, -box.y);
  ctx.fillStyle = '#000';
  for (const p of slots) {
    if (p.kind === 'image') ctx.drawImage(p.img, p.rect.x, p.rect.y, p.rect.w, p.rect.h);
    if (p.kind === 'qr') for (const r of p.rects) ctx.fillRect(r.x, r.y, r.w, p.cell + 0.5);
  }
  canvas.hidden = false;
  $('#preview-empty').hidden = true;
  $('.preview-bar').hidden = false;
  placeBoxes();
}

// ---------- 위치 편집 ----------
const overlay = $('.overlay');
for (const key of Object.keys(SLOTS)) {
  const el = document.createElement('div');
  el.className = 'qr-box';
  el.dataset.slot = key;
  el.tabIndex = 0;
  el.setAttribute('aria-label', `${SLOTS[key].label} QR 위치`);
  el.innerHTML = `<span class="qr-box-label">${SLOTS[key].label}</span>` + ['nw', 'ne', 'sw', 'se'].map((c) => `<i data-corner="${c}"></i>`).join('');
  overlay.append(el);
}

function placeBoxes() {
  const { box } = state.base;
  for (const el of overlay.children) {
    const { x, y, size } = squarePx(el.dataset.slot);
    Object.assign(el.style, { left: `${x / box.width * 100}%`, top: `${y / box.height * 100}%`, width: `${size / box.width * 100}%` });
  }
}

// 드래그 중엔 프레임당 한 번만 다시 그린다.
let renderFrame = 0;
const renderSoon = () => { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); }); };

// 칸 자리를 px 로 바꾸고 다시 그린다. 저장은 조작이 끝났을 때 한 번.
function setSquarePx(key, px) {
  state.squares[key] = pxToSquare(px, state.base.box);
  renderSoon();
}

function setEditing(on) {
  overlay.hidden = !on;
  $('#btn-edit').textContent = on ? '편집 완료' : '위치 편집';
  $('#btn-edit').setAttribute('aria-pressed', String(on));
  $('#btn-reset').hidden = !on;
  $('.preview-hint').hidden = !on;
}

overlay.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.qr-box');
  if (!el || !state.base || e.button !== 0) return;
  e.preventDefault();
  el.focus();
  const key = el.dataset.slot, corner = e.target.dataset.corner, { box } = state.base;
  const start = squarePx(key);
  const scale = box.width / overlay.clientWidth; // 화면 px → 이미지 px
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  const listening = new AbortController();
  const mine = (ev) => ev.pointerId === e.pointerId;
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  el.addEventListener('pointermove', (ev) => {
    if (!mine(ev)) return;
    const dx = (ev.clientX - sx) * scale, dy = (ev.clientY - sy) * scale;
    moved = true;
    setSquarePx(key, corner ? resizeSquare(start, corner, dx, dy, box) : moveSquare(start, dx, dy, box));
  }, { signal: listening.signal });
  const end = (ev) => {
    if (!mine(ev)) return;
    listening.abort();
    el.classList.remove('dragging');
    if (moved) saveSquares();
  };
  el.addEventListener('pointerup', end, { signal: listening.signal });
  el.addEventListener('pointercancel', end, { signal: listening.signal });
});

// 방향키: 이미지 기준 1px, Shift 10px
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
overlay.addEventListener('keydown', (e) => {
  const el = e.target.closest('.qr-box'), dir = ARROWS[e.key];
  if (!el || !dir || !state.base) return;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1, key = el.dataset.slot;
  setSquarePx(key, moveSquare(squarePx(key), dir[0] * step, dir[1] * step, state.base.box));
  saveSquares();
});

$('#btn-edit').addEventListener('click', () => setEditing(overlay.hidden));
$('#btn-reset').addEventListener('click', () => {
  state.squares = defaultSquares();
  saveSquares();
  render();
});

function updateStatus(p) {
  const el = $(`.slot-card[data-slot="${p.key}"] .slot-status`);
  el.classList.toggle('bad', !!p.error);
  el.textContent = p.error ? p.error
    : p.empty ? '비어 있음 — 원래 칸 그대로 저장됩니다.'
    : p.kind === 'image' ? `이미지: ${state.slots[p.key].imageName}`
    : `QR 내용: ${p.text}`;
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- PDF ----------
function toDataUrl(draw, w, h, type, quality) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  return c.toDataURL(type, quality);
}

function savePdf() {
  const { img, box } = state.base;
  const pt = (v) => v * PX_TO_PT;
  const pw = pt(box.width), ph = pt(box.height);
  const doc = new jspdf.jsPDF({ unit: 'pt', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });

  // 포스터 (원본 픽셀 그대로, QR 은 아래에서 따로 얹어 선명하게)
  const poster = toDataUrl((ctx) => ctx.drawImage(img, 0, -box.y), box.width, box.height, 'image/jpeg', 0.95);
  doc.addImage(poster, 'JPEG', 0, 0, pw, ph);

  doc.setFillColor(0, 0, 0);
  for (const p of layoutSlots()) {
    if (p.kind === 'image') {
      const png = toDataUrl((ctx) => ctx.drawImage(p.img, 0, 0), p.img.naturalWidth, p.img.naturalHeight, 'image/png');
      doc.addImage(png, 'PNG', pt(p.rect.x), pt(p.rect.y), pt(p.rect.w), pt(p.rect.h));
    }
    // 링크 QR 은 벡터 사각형으로 그려 인쇄·확대해도 깨지지 않게 한다.
    if (p.kind === 'qr') for (const r of p.rects) doc.rect(pt(r.x), pt(r.y), pt(r.w), pt(p.cell) * 1.02, 'F');
  }
  doc.save(pdfFileName($('#pdf-name').value));
}

// ---------- 이벤트 ----------
function wireDrop(drop, input, onFile) {
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
}

wireDrop($('#drop-base'), $('#file-base'), async (file) => {
  try {
    if (!(await setBase(file, file.name))) return;
    state.loadError = '';
    saveBase(file);
  } catch (e) { state.loadError = e.message; }
  render();
});

for (const card of document.querySelectorAll('.slot-card')) {
  const key = card.dataset.slot, s = state.slots[key];
  const linkInput = $('.slot-link', card), drop = $('.slot-drop', card);

  for (const btn of card.querySelectorAll('.seg button')) {
    btn.addEventListener('click', () => {
      s.mode = btn.dataset.mode;
      card.querySelectorAll('.seg button').forEach((b) => {
        b.classList.toggle('on', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      linkInput.hidden = s.mode !== 'link';
      drop.hidden = s.mode !== 'image';
      render();
    });
  }
  linkInput.addEventListener('input', () => { s.link = linkInput.value; render(); });
  wireDrop(drop, $('.slot-file', card), async (file) => {
    try {
      s.image = await loadImage(file);
      s.imageName = file.name;
      state.loadError = '';
      drop.classList.add('loaded');
      $('.drop-file', drop).textContent = file.name;
    } catch (e) { state.loadError = `${SLOTS[key].label}: ${e.message}`; }
    render();
  });
}

$('#btn-pdf').addEventListener('click', () => {
  try { savePdf(); } catch (e) { showError(`PDF 저장 실패: ${e.message}`); }
});

(async () => {
  const saved = await loadSavedBase();
  // 저장본을 읽는 사이 사용자가 이미 올렸으면 건드리지 않는다 (setBase 순번으로도 한 번 더 막힘).
  if (saved && !state.baseLoads) {
    try { await setBase(saved.blob, saved.name); } catch { /* 저장본이 깨졌으면 새로 올리면 됨 */ }
  }
  render();
})();
