import { SLOTS, findContentBox, slotRect, fitSquare, normalizeLink, qrRuns, pdfFileName } from './poster.js';

// qrcode-generator 기본값은 비ASCII(한글)를 깨뜨리므로 UTF-8 로 바꾼다.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const $ = (s, root = document) => root.querySelector(s);
const QR_INSET = 0.03;   // 칸 가장자리(둥근 모서리)에서 살짝 띄움
const QR_QUIET = 2;      // 생성 QR 둘레 여백(모듈 수). 칸 자체가 흰색이라 표준 4 보다 작게.
const PX_TO_PT = 0.75;   // 이미지 1px = 1/96in → PDF pt(1/72in)

const state = {
  base: null,      // { img, name, box }
  baseLoads: 0,    // 기본 이미지 로드 순번. 늦게 끝난 이전 로드가 새 이미지를 덮지 않게 한다.
  loadError: '',   // 파일을 못 읽은 오류. 다음 로드가 성공할 때까지 계속 보여준다.
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
  const { box } = state.base ?? { box: { width: 0, height: 0 } };
  return Object.keys(SLOTS).map((key) => {
    const s = state.slots[key];
    const rect = slotRect(SLOTS[key], { x: 0, y: 0, width: box.width, height: box.height });
    const sq = fitSquare(rect, QR_INSET);
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
}

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
