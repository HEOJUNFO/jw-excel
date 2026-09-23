import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, findContentBox, slotRect, fitSquare, normalizeLink, qrRuns, pdfFileName } from './poster.js';

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
