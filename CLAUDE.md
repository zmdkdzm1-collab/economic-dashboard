# economic-dashboard — 프로젝트 안내

정적(HTML/CSS/JS) 경제지표 대시보드. 서버 없음. GitHub Pages로 배포.

## 구조
- `index.html` — 탭: 홈 / 지표 사전 / 발표 캘린더 / 통화정책 / AI 분석 / 업데이트
- `app.js` — 렌더링·상호작용 전체 로직
- `data.js` — `indicators`, `policyRates`, `bondYields`, `marketAssets`, `calendarEvents`
  및 자동갱신 참조 블록(`fredReference`/`ecosReference`/`estatReference`)
- `bloomberg-data.js` — 홈 카드·지표 사전에 보이는 **실측 값의 주 소스**(수동 갱신)
- `rate-data.js` — 금리/환율/크레딧 상세 시계열
- 로드 순서: data.js → rate-data.js → bloomberg-data.js → app.js

## 배포 흐름
- `master`에 push 되면 `.github/workflows/deploy-pages.yml`가 자동 배포.
- 작업 → 커밋 → push → (필요시 PR) → master 병합 = 배포.

## 자동 매일 갱신 (GitHub Actions, 손 안 대도 됨)
- FRED / ECOS / e-Stat 참조 시계열(비교 도구용). 키는 저장소 Secrets에 있음.
- FedWatch는 CME 유료 API라 사실상 수동.

## 셀프서비스 업데이트 (홈페이지 🔐 업데이트 탭 — 담당자 없이도 갱신)
- 목적: 회의용 대시보드를 비개발자 동료도 파일 업로드만으로 갱신.
- 흐름: 비밀번호로 잠금 해제 → 파일 업로드/CME 숫자 입력 → 브라우저가 GitHub
  Contents API로 `data-intake/incoming/`에 커밋 → `.github/workflows/data-intake.yml`가
  기존 파이썬 스크립트(update-calendar/rates/bloomberg/cme)를 실행해 데이터 파일을
  갱신·커밋하고 Pages를 재배포(약 1~2분). 원본 파일은 처리 후 자동 삭제.
- 받는 4종: `calendar.xlsx`, `info_daily.xlsx`, `bloomberg.xlsx`(파일) + `cme.json`(폼 입력).
- 인증(중요): GitHub 토큰·비밀번호는 **소스에 저장하지 않고** 사용자 브라우저
  localStorage에만 보관(AI 키와 동일). 공개 사이트라 비밀번호는 보조 잠금이고 실제
  쓰기 권한은 토큰이 가짐 → 방문자는 토큰이 없어 아무것도 못 바꿈. 관리자가 회의용
  PC 브라우저에서 최초 1회 토큰(Fine-grained, 이 저장소 Contents 읽기/쓰기)+공용
  비밀번호를 저장하면, 이후 동료는 비밀번호만으로 사용.
- 관련 파일: `scripts/update-cme.py`, `.github/workflows/data-intake.yml`,
  `data-intake/incoming/`, app.js의 `setupUpdateTab`/`UPDATE_CFG`.

## 수동 업데이트 방법 (담당자 로컬에서 CLI로)
- **경제 캘린더**: 엑셀을 `data-imports/calendar.xlsx`로 저장 후
  `python3 scripts/update-calendar.py` 실행. (자세한 규칙은 `data-imports/README.md`)
  data.js의 `<<CALENDAR_RAW_START>>`~`<<CALENDAR_RAW_END>>` 사이만 자동으로 다시 씀.
- **블룸버그 매크로**: 엑셀을 `data-imports/bloomberg.xlsx`로 저장 후
  `python3 scripts/update-bloomberg.py` 실행(최신값만 이어붙임, 과거 이력 보존).
  수동으로 넣을 땐 `bloomberg-data.js`의 series/releases에 값 추가.
- **일별 금리/환율**: 엑셀을 `data-imports/info_daily.xlsx`로 저장 후
  `python3 scripts/update-rates.py` 실행(rate-data.js에 최신 영업일 추가 + 블룸버그와
  교차검증). 홈 국채 카드(10Y)의 주 소스.
- **기준금리 변경**: `data.js`의 `policyRates[].series`에 `{date,value}` 추가.

## 로컬 확인
```bash
python3 -m http.server 8099   # http://127.0.0.1:8099/index.html
```
Playwright/Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (`--no-sandbox`).

## 주의
- 커밋/PR/코드에 모델 식별자를 넣지 말 것.
- 발표값은 확실히 확인된 것만 반영(정확도 우선). 애매하면 건너뛰고 표기.
