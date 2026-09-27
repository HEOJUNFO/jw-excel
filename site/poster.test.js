import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, findContentBox, slotRect, fitSquare, normalizeLink, pdfLinkUrl, qrRuns, pdfFileName,
  defaultSquares, squareToPx, pxToSquare, moveSquare, resizeSquare, sanitizeSquares, clampSquare,
  fitWidth, stepZoom, clampZoom, wheelZoom, anchoredScroll,
} from './poster.js';

// width×height RGBA 이미지. rowColor(y) 가 [r,g,b] 를 돌려준다.
const img = (width, height, rowColor) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const [r, g, b] = rowColor(y);
    for (let x = 0; x < width; x++) data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { width, height, data };
};
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];

test('상하 검은 띠(폰 스크린샷 상태바)를 잘라낸 포스터 영역을 찾는다', () => {
  const im = img(10, 100, (y) => (y < 7 || y >= 95 ? BLACK : WHITE));
  assert.deepEqual(findContentBox(im), { x: 0, y: 7, width: 10, height: 88 });
});

test('검은 띠에 흰 글자(시계 등)가 조금 있어도 띠로 본다', () => {
  const im = img(10, 100, (y) => (y < 5 || y >= 95 ? BLACK : WHITE));
  im.data.set([255, 255, 255, 255], (2 * 10 + 3) * 4); // 2번째 행에 흰 점 하나
  assert.equal(findContentBox(im).y, 5);
});

test('위쪽만 어두운 디자인(한쪽 띠)은 자르지 않는다', () => {
  const im = img(10, 100, (y) => (y < 5 ? BLACK : WHITE));
  assert.deepEqual(findContentBox(im), { x: 0, y: 0, width: 10, height: 100 });
});

test('띠가 높이의 10%를 넘으면 포스터 내용으로 보고 자르지 않는다', () => {
  const im = img(10, 100, (y) => (y < 15 || y >= 95 ? BLACK : WHITE));
  assert.deepEqual(findContentBox(im), { x: 0, y: 0, width: 10, height: 100 });
});

test('검은 띠가 없으면 이미지 전체가 포스터 영역', () => {
  const im = img(10, 30, () => WHITE);
  assert.deepEqual(findContentBox(im), { x: 0, y: 0, width: 10, height: 30 });
});

test('전부 검으면 잘라내지 않는다', () => {
  const im = img(4, 6, () => BLACK);
  assert.deepEqual(findContentBox(im), { x: 0, y: 0, width: 4, height: 6 });
});

test('샘플 포스터(1170×2240)에서 QR 칸이 실측 위치에 온다', () => {
  const box = { x: 0, y: 146, width: 1170, height: 2240 };
  const e = slotRect(SLOTS.enroll, box);
  assert.deepEqual([e.x, e.y, e.w, e.h].map(Math.round), [400, 508, 132, 120]);
  const l = slotRect(SLOTS.level, box);
  assert.deepEqual([l.x, l.y, l.w, l.h].map(Math.round), [658, 508, 136, 120]);
});

test('해상도가 두 배인 포스터에서도 같은 비율 위치', () => {
  const r = slotRect(SLOTS.enroll, { x: 0, y: 0, width: 2340, height: 4480 });
  assert.deepEqual([r.x, r.y, r.w, r.h].map(Math.round), [800, 724, 264, 240]);
});

test('직사각형 칸 가운데에 정사각형을 여백만큼 안쪽으로 맞춘다', () => {
  assert.deepEqual(fitSquare({ x: 0, y: 0, w: 140, h: 100 }, 0.1), { x: 30, y: 10, size: 80 });
  assert.deepEqual(fitSquare({ x: 10, y: 20, w: 50, h: 50 }, 0), { x: 10, y: 20, size: 50 });
});

test('링크 정리: 공백 제거, 스킴 없는 도메인엔 https:// 를 붙인다', () => {
  assert.equal(normalizeLink('  https://a.com/x  '), 'https://a.com/x');
  assert.equal(normalizeLink('www.a.com/신청'), 'https://www.a.com/신청');
  assert.equal(normalizeLink('a.co.kr'), 'https://a.co.kr');
  assert.equal(normalizeLink('http://a.com'), 'http://a.com');
  assert.equal(normalizeLink('   '), '');
  assert.equal(normalizeLink('그냥 텍스트'), '그냥 텍스트');
});

test('링크 정리: 이메일·숫자는 도메인으로 보지 않는다', () => {
  assert.equal(normalizeLink('user@a.com'), 'user@a.com');
  assert.equal(normalizeLink('010.1234'), '010.1234');
  assert.equal(normalizeLink('a.com?x=1'), 'https://a.com?x=1');
});

test('PDF 클릭 링크: 웹·메일·전화 주소만, 한글은 퍼센트 인코딩', () => {
  assert.equal(pdfLinkUrl('https://a.com/x'), 'https://a.com/x');
  assert.equal(pdfLinkUrl('https://www.a.com/신청'), 'https://www.a.com/%EC%8B%A0%EC%B2%AD');
  assert.equal(pdfLinkUrl('mailto:user@a.com'), 'mailto:user@a.com');
  assert.equal(pdfLinkUrl('tel:010-1234-5678'), 'tel:010-1234-5678');
  assert.equal(pdfLinkUrl('그냥 텍스트'), '');
  assert.equal(pdfLinkUrl('javascript:alert(1)'), '');
  assert.equal(pdfLinkUrl(''), '');
});

test('QR 모듈을 행 단위 연속 구간으로 합친다', () => {
  // 3×3: ■■□ / □□□ / ■□■
  const grid = [[1, 1, 0], [0, 0, 0], [1, 0, 1]];
  const runs = qrRuns(3, (r, c) => grid[r][c] === 1);
  assert.deepEqual(runs, [
    { row: 0, col: 0, len: 2 },
    { row: 2, col: 0, len: 1 },
    { row: 2, col: 2, len: 1 },
  ]);
});

test('PDF 파일명: 금지 문자 제거, 비면 기본값, .pdf 한 번만', () => {
  assert.equal(pdfFileName('삼성전자'), '삼성전자.pdf');
  assert.equal(pdfFileName('a/b:c*?.pdf'), 'a_b_c__.pdf');
  assert.equal(pdfFileName('  '), 'qr-poster.pdf');
});

// ---------- QR 위치 편집 ----------
const BOX = { width: 1170, height: 2240 };
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));

test('기본 위치 = 흰 칸 안쪽 정사각형 (기존 고정 좌표와 동일)', () => {
  const d = defaultSquares();
  assert.deepEqual(round(squareToPx(d.enroll, BOX)), { x: 409.6, y: 365.6, size: 112.8 });
  assert.deepEqual(round(squareToPx(d.level, BOX)), { x: 669.6, y: 365.6, size: 112.8 });
});

test('px ↔ 비율 왕복', () => {
  const px = { x: 100, y: 200, size: 50 };
  assert.deepEqual(round(squareToPx(pxToSquare(px, BOX), BOX)), px);
});

test('비율은 포스터 크기를 따라간다 (크기는 가로 기준)', () => {
  const sq = pxToSquare({ x: 100, y: 200, size: 50 }, BOX);
  assert.deepEqual(round(squareToPx(sq, { width: 2340, height: 4480 })), { x: 200, y: 400, size: 100 });
});

test('이동: 포스터 밖으로 나가지 않게 막는다', () => {
  const sq = { x: 100, y: 100, size: 50 };
  assert.deepEqual(moveSquare(sq, 10, -5, BOX), { x: 110, y: 95, size: 50 });
  assert.deepEqual(moveSquare(sq, -500, -500, BOX), { x: 0, y: 0, size: 50 });
  assert.deepEqual(moveSquare(sq, 5000, 5000, BOX), { x: 1120, y: 2190, size: 50 });
});

test('크기: 반대쪽 모서리를 고정하고 정사각형으로 늘린다', () => {
  const sq = { x: 100, y: 100, size: 50 };
  assert.deepEqual(resizeSquare(sq, 'se', 10, 10, BOX), { x: 100, y: 100, size: 60 });
  assert.deepEqual(resizeSquare(sq, 'nw', -10, -10, BOX), { x: 90, y: 90, size: 60 });
  assert.deepEqual(resizeSquare(sq, 'ne', 10, -10, BOX), { x: 100, y: 90, size: 60 });
  assert.deepEqual(resizeSquare(sq, 'sw', -10, 10, BOX), { x: 90, y: 100, size: 60 });
});

test('크기: 최소 크기와 포스터 경계를 넘지 않는다', () => {
  const sq = { x: 100, y: 100, size: 50 };
  assert.equal(resizeSquare(sq, 'se', -100, -100, BOX).size, 20);
  assert.deepEqual(resizeSquare(sq, 'nw', -500, -500, BOX), { x: 0, y: 0, size: 150 });
  assert.equal(resizeSquare({ x: 1100, y: 100, size: 50 }, 'se', 100, 100, BOX).size, 70);
});

test('저장된 위치 검증: 이상한 값은 기본 위치로', () => {
  const d = defaultSquares();
  assert.deepEqual(sanitizeSquares(null), d);
  assert.deepEqual(sanitizeSquares({ enroll: { x: 'a', y: 0, size: 0.1 } }), d);
  const ok = { enroll: { x: 0.1, y: 0.2, size: 0.1 }, level: { x: 2, y: 0, size: 0.1 } };
  assert.deepEqual(sanitizeSquares(ok), { enroll: ok.enroll, level: d.level });
});

test('비율이 다른 이미지로 바꿔 칸이 밖으로 나가면 포스터 안으로 당긴다', () => {
  const wide = { width: 1000, height: 300 };
  assert.deepEqual(clampSquare({ x: 100, y: 280, size: 50 }, wide), { x: 100, y: 250, size: 50 });
  assert.deepEqual(clampSquare({ x: 900, y: 0, size: 400 }, wide), { x: 700, y: 0, size: 300 });
  assert.deepEqual(clampSquare({ x: 10, y: 20, size: 30 }, wide), { x: 10, y: 20, size: 30 });
});

// ---------- 미리보기 확대 ----------
test('맞춤 폭: 가로·세로 한도 중 작은 쪽에 맞춘다', () => {
  assert.equal(fitWidth(BOX, 600, 2000), 600);             // 가로가 먼저 참
  assert.equal(fitWidth(BOX, 600, 896), 468);              // 세로가 먼저 참 (896 × 1170/2240)
  assert.equal(fitWidth({ width: 100, height: 100 }, 0, 500), 1); // 한도가 0 이어도 최소 1px
});

test('확대 단계: 버튼은 다음 단계로, 끝에서는 멈춘다', () => {
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1.5, 1), 2);
  assert.equal(stepZoom(4, 1), 4);
  assert.equal(stepZoom(2, -1), 1.5);
  assert.equal(stepZoom(1, -1), 1);
  // 휠로 단계 사이에 있을 때도 가까운 다음 단계로
  assert.equal(stepZoom(1.7, 1), 2);
  assert.equal(stepZoom(1.7, -1), 1.5);
});

test('확대 배율은 맞춤(1) ~ 4 사이', () => {
  assert.equal(clampZoom(0.5), 1);
  assert.equal(clampZoom(2.3), 2.3);
  assert.equal(clampZoom(9), 4);
  assert.equal(clampZoom(NaN), 1);
});

test('휠 확대: 위로 굴리면 커지고, 한 번에 너무 크게 뛰지 않는다', () => {
  assert.ok(wheelZoom(1, -10) > 1);
  assert.ok(wheelZoom(2, 10) < 2);
  assert.equal(wheelZoom(2, -100), wheelZoom(2, -30));  // 마우스 휠 한 칸도 핀치 한 번 만큼만
  assert.equal(wheelZoom(2, 3, 1), wheelZoom(2, 30));    // 줄 단위(Firefox) → px
  assert.equal(wheelZoom(4, -30), 4);                    // 범위 밖으로는 안 나감
});

test('확대 기준점: 커서 아래 지점이 확대 후에도 같은 자리에 남는다', () => {
  // 스크롤 0, 커서가 보이는 영역 100px, 포스터 시작 오프셋 0 → 2배 확대하면 200 지점이 커서 아래로 와야 함
  assert.equal(anchoredScroll(0, 100, 0, 0, 2), 100);
  // 이미 스크롤된 상태에서 절반으로 축소
  assert.equal(anchoredScroll(300, 50, 0, 0, 0.5), 125);
  // 맞춤 상태에서 가운데 정렬로 포스터가 40px 들어가 있던 경우
  assert.equal(anchoredScroll(0, 140, 40, 0, 2), 60);
});
