# economic-dashboard — 프로젝트 안내

정적(HTML/CSS/JS) 경제지표 대시보드. 서버 없음. GitHub Pages로 배포.

## 구조
- `index.html` — 탭: 홈 / 지표 사전 / 발표 캘린더 / 통화정책 / AI 분석
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

## 수동 업데이트 방법
- **경제 캘린더**: 엑셀을 `data-imports/calendar.xlsx`로 저장 후
  `python3 scripts/update-calendar.py` 실행. (자세한 규칙은 `data-imports/README.md`)
  data.js의 `<<CALENDAR_RAW_START>>`~`<<CALENDAR_RAW_END>>` 사이만 자동으로 다시 씀.
- **블룸버그 매크로**: 엑셀을 `data-imports/bloomberg.xlsx`로 저장 후
  `python3 scripts/update-bloomberg.py` 실행(최신값만 이어붙임, 과거 이력 보존).
  수동으로 넣을 땐 `bloomberg-data.js`의 series/releases에 값 추가.
- **기준금리 변경**: `data.js`의 `policyRates[].series`에 `{date,value}` 추가.

## 로컬 확인
```bash
python3 -m http.server 8099   # http://127.0.0.1:8099/index.html
```
Playwright/Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (`--no-sandbox`).

## 주의
- 커밋/PR/코드에 모델 식별자를 넣지 말 것.
- 발표값은 확실히 확인된 것만 반영(정확도 우선). 애매하면 건너뛰고 표기.
