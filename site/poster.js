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
