// QR 포스터 계산 로직. 브라우저/Node 양쪽에서 쓰는 순수 모듈 (DOM 의존 없음).

// QR 칸 위치: 포스터 영역(상하 검은 띠를 뺀 부분) 대비 비율.
// 기준 샘플: 1170×2240 포스터에서 수강신청 (400,362) 132×120, 레벨테스트 (658,362) 136×120.
// 포스터 디자인이 같으면 해상도가 달라도 같은 자리에 들어간다.
const BASE_W = 1170, BASE_H = 2240;
export const SLOTS = {
  enroll: { label: '수강신청', x: 400 / BASE_W, y: 362 / BASE_H, w: 132 / BASE_W, h: 120 / BASE_H },
  level: { label: '레벨테스트', x: 658 / BASE_W, y: 362 / BASE_H, w: 136 / BASE_W, h: 120 / BASE_H },
};

// 행의 절반 이상이 거의 검정이면 폰 스크린샷 상태바/하단바로 본다 (시계 같은 흰 글자가 섞여도 됨).
const isBarRow = ({ width, data }, y) => {
  let dark = 0;
  for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] < 90) dark++;
  }
  return dark * 2 >= width;
};

// ImageData({width,height,data}) 에서 상하 검은 띠를 뺀 포스터 영역.
// 폰 스크린샷처럼 위·아래 둘 다 얇은 띠(각각 높이의 10% 이하)가 있을 때만 자른다.
// 한쪽만 어둡거나 띠가 두꺼우면 포스터 디자인의 일부로 보고 그대로 둔다.
const MAX_BAR = 0.1;
export function findContentBox(image) {
  const { width, height } = image;
  const whole = { x: 0, y: 0, width, height };
  let top = 0, bottom = height - 1;
  while (top < height && isBarRow(image, top)) top++;
  if (top >= height) return whole;
  while (bottom > top && isBarRow(image, bottom)) bottom--;
  const bottomBar = height - 1 - bottom, maxBar = height * MAX_BAR;
  if (!top || !bottomBar || top > maxBar || bottomBar > maxBar) return whole;
  return { x: 0, y: top, width, height: bottom - top + 1 };
}

// 비율 칸 → 원본 이미지 픽셀 좌표.
export function slotRect(slot, box) {
  return {
    x: box.x + slot.x * box.width,
    y: box.y + slot.y * box.height,
    w: slot.w * box.width,
    h: slot.h * box.height,
  };
}

// 칸 가운데 정사각형. inset 은 짧은 변 대비 한쪽 여백 비율.
export function fitSquare(rect, inset) {
  const size = Math.min(rect.w, rect.h) * (1 - 2 * inset);
  return { x: rect.x + (rect.w - size) / 2, y: rect.y + (rect.h - size) / 2, size };
}

// 입력 링크 정리. 스킴 없이 도메인으로 시작하면 https:// 를 붙여 폰 카메라가 링크로 인식하게 한다.
export function normalizeLink(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[^\s/?#@:]+\.[a-z]{2,}(?:[/?#]\S*)?$/i.test(s)) return 'https://' + s; // 도메인.최상위(영문)
  return s;
}

// 검은 모듈을 행별 연속 구간으로 합친다 (PDF 에 사각형 수를 줄여 그리기 위함).
export function qrRuns(count, isDark) {
  const runs = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!isDark(row, col)) continue;
      const start = col;
      while (col + 1 < count && isDark(row, col + 1)) col++;
      runs.push({ row, col: start, len: col - start + 1 });
    }
  }
  return runs;
}

export function pdfFileName(name) {
  const base = String(name ?? '').trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  return (base || 'qr-poster') + '.pdf';
}

// ---------- QR 위치 편집 ----------
// 사용자가 옮긴 QR 자리는 정사각형 { x, y, size } 비율로 둔다.
// x·size 는 포스터 가로, y 는 세로 대비라서 기본 이미지를 바꿔도 같은 비율 자리에 온다.
const QR_INSET = 0.03;      // 기본 위치: 흰 칸 가장자리(둥근 모서리)에서 살짝 띄움
const MIN_SIZE = 20;        // 편집 시 최소 한 변(이미지 px)
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const squareToPx = (sq, box) => ({ x: sq.x * box.width, y: sq.y * box.height, size: sq.size * box.width });
export const pxToSquare = (px, box) => ({ x: px.x / box.width, y: px.y / box.height, size: px.size / box.width });

export function defaultSquares() {
  const base = { x: 0, y: 0, width: BASE_W, height: BASE_H };
  return Object.fromEntries(Object.entries(SLOTS).map(([key, slot]) => {
    const { x, y, size } = fitSquare(slotRect(slot, base), QR_INSET);
    return [key, pxToSquare({ x, y, size }, base)];
  }));
}

// 저장된 비율을 다른 비율의 이미지에 쓰면 밖으로 나갈 수 있어 포스터 안으로 당긴다.
export function clampSquare(sq, box) {
  const size = Math.min(sq.size, box.width, box.height);
  return { x: clamp(sq.x, 0, box.width - size), y: clamp(sq.y, 0, box.height - size), size };
}

// px 정사각형을 (dx, dy) 만큼 옮기되 포스터 밖으로는 못 나가게.
export function moveSquare(sq, dx, dy, box) {
  return {
    x: clamp(sq.x + dx, 0, box.width - sq.size),
    y: clamp(sq.y + dy, 0, box.height - sq.size),
    size: sq.size,
  };
}

// corner('nw'|'ne'|'sw'|'se') 를 끌어 크기 조절. 반대쪽 모서리는 고정, 정사각형 유지.
export function resizeSquare(sq, corner, dx, dy, box) {
  const left = corner[1] === 'w', top = corner[0] === 'n';
  const ax = left ? sq.x + sq.size : sq.x;   // 고정 모서리
  const ay = top ? sq.y + sq.size : sq.y;
  const delta = ((left ? -dx : dx) + (top ? -dy : dy)) / 2;
  const room = Math.min(left ? ax : box.width - ax, top ? ay : box.height - ay);
  const size = clamp(sq.size + delta, Math.min(MIN_SIZE, room), room);
  return { x: left ? ax - size : ax, y: top ? ay - size : ay, size };
}

// localStorage 에서 읽은 값 검증. 칸마다 이상하면 그 칸만 기본 위치로.
export function sanitizeSquares(saved) {
  const defaults = defaultSquares();
  const ok = (s) => s && [s.x, s.y, s.size].every(Number.isFinite)
    && s.x >= 0 && s.y >= 0 && s.size > 0 && s.x + s.size <= 1 && s.y < 1;
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, ok(saved?.[k]) ? { x: saved[k].x, y: saved[k].y, size: saved[k].size } : defaults[k]]));
}
