# data-intake — 홈페이지 업데이트 탭 처리 폴더

홈페이지의 **🔐 업데이트** 탭에서 파일을 올리면, 그 파일이 `incoming/` 에
커밋되고 `.github/workflows/data-intake.yml` 가 자동으로:

1. 알맞은 파이썬 스크립트를 실행해 data.js / rate-data.js / bloomberg-data.js 를 갱신하고
2. 처리한 원본 파일을 `incoming/` 에서 지운 뒤
3. 커밋 → GitHub Pages 재배포

를 수행합니다. 사람이 이 폴더를 직접 건드릴 필요는 없습니다.

받는 파일 이름(고정):
- `incoming/calendar.xlsx`   → scripts/update-calendar.py
- `incoming/info_daily.xlsx` → scripts/update-rates.py
- `incoming/bloomberg.xlsx`  → scripts/update-bloomberg.py
- `incoming/cme.json`        → scripts/update-cme.py
