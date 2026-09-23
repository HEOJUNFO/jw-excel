# 배정검토 비교

배정검토 파일과 수강신청자 리스트(엑셀)를 브라우저에서 대조해 불일치 항목만 빨간색으로 표시하는 정적 사이트.

- 배포: https://jw-excel-compare.vercel.app
- 코드: `site/` (순수 HTML/JS, [SheetJS](https://sheetjs.com) 로 클라이언트에서만 파싱 — 파일이 서버로 전송되지 않음)

## 비교 항목

| 항목 | 배정검토 | 수강신청 | 방식 |
|---|---|---|---|
| 사번 | 사번 / 사원번호 | 사번 / 사원번호 | 양쪽에 있으면 1순위 매칭 키 (없으면 생략) |
| 이름 | K-Name | 이름 | 매칭 키 (동명이인은 전화번호로 구분) |
| 전화번호 | Mobile | 휴대전화번호 | 숫자만 비교 |
| 이메일 | 이메일 | 이메일 | 대소문자·공백 무시 |
| 화상/전화 | 수업유형 | 수업유형 | 정확 일치 |
| 언어 | 언어 | 언어 / 과정 | 원어민·북미·교포는 동일. 신청 언어가 제2외국어면 `과정` 컬럼과 비교 |
| 횟수 | Interval | 횟수 | `주N회M분` 숫자 비교 |
| 수업시간 | 수업시간 | 희망시간1/2 | 둘 중 하나 범위 안에 포함되면 일치 |

## QR 포스터 PDF (`qr.html`)

기본 포스터 이미지의 **수강신청 / 레벨테스트** 칸에 QR을 넣어 PDF 1장으로 저장합니다.

- 칸마다 **링크**(QR 자동 생성, 한글 링크 가능) 또는 **QR 이미지**(그대로 삽입) 중 선택
- 기본 이미지는 교체 가능. 마지막에 올린 이미지는 브라우저(IndexedDB)에 남아 다음에 그대로 씀
- 폰 스크린샷의 위아래 검은 상태바는 자동으로 잘라냄
- QR 칸 위치는 `site/poster.js` 의 `SLOTS` (포스터 영역 대비 비율)에 고정. 포스터 디자인이 바뀌어 칸 위치가 달라지면 여기만 고치면 됨
- 링크 QR은 PDF에 벡터로 그려서 인쇄·확대해도 선명함
- 라이브러리: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [jsPDF](https://github.com/parallax/jsPDF) (`site/vendor/`)

## 로컬 실행

```sh
cd site && npm run dev   # http://localhost:5173
cd site && npm test      # 순수 로직 테스트 (node --test)
```

## 배포

```sh
`main` 브랜치에 푸시하면 Vercel이 자동 배포합니다 (Root Directory: `site`). 수동 배포: `cd site && vercel deploy --prod`
```
