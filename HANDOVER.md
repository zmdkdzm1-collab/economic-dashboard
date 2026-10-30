# 인수인계 안내 (새 관리자용)

글로벌 경제지표 대시보드 — 정적 사이트(HTML/CSS/JS), 서버 없음, GitHub Pages 배포.
개발 맥락·규칙은 `CLAUDE.md`, 팀원용 업데이트 방법은 `사용법.md` 참고.

---

## 1. 인수 체크리스트 (순서대로)

이전 관리자가 개인 키·토큰·예약 작업을 모두 정리한 상태입니다. 아래만 하면 운영이 재개됩니다.

1. **저장소 이전 받기**
   이전 관리자가 Settings → (맨 아래) Danger Zone → **Transfer** 로 넘깁니다.
   부서 공용 GitHub Organization으로 받는 것을 권장(사람이 바뀌어도 멤버만 교체).
2. **Pages 켜졌는지 확인**: Settings → Pages → Source = **GitHub Actions**.
   이전 후 사이트 주소가 `https://<새소유자>.github.io/economic-dashboard/` 로 바뀝니다
   (옛 주소는 자동 연결되지 않음 → **팀에 새 링크 공지**).
3. **업데이트 탭 활성화** (팀원이 비밀번호만으로 데이터 올리게 하는 기능)
   - GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate
     - Repository access: *Only select repositories* → `economic-dashboard`
     - Permissions → Repository permissions → **Contents: Read and write**
     - Expiration: 길게(만료되면 업로드가 멈춤 → 재발급 후 이 단계 반복)
   - 사이트 **🔐 업데이트 탭 → ⚙️ 최초 설정**에 토큰 + **새 팀 비밀번호** 입력 → "암호화해서 사이트에 저장"
   - 1~2분 뒤 어느 PC에서나 그 비밀번호로 사용 가능. 팀에 비밀번호 공지.
4. **(선택) 자동 갱신 API 키 등록** — Settings → Secrets and variables → Actions → New repository secret
   | Secret | 용도 | 발급처 |
   |---|---|---|
   | `FRED_API_KEY` | 미국 FRED 참조 시계열(비교 도구) | fred.stlouisfed.org (무료) |
   | `ECOS_API_KEY` | 한국은행 ECOS 참조 시계열 | ecos.bok.or.kr (무료) |
   | `ESTAT_APP_ID` | 일본 e-Stat 참조 시계열 | e-stat.go.jp (무료) |
   | `CME_API_URL`, `CME_API_KEY` (+`CME_AUTH_HEADER`, `CME_AUTH_SCHEME`) | CME FedWatch 자동 갱신 | CME 유료 |

   키가 없어도 각 워크플로는 "미설정 — 건너뜀"으로 정상 종료하므로 사이트는 문제없이 동작합니다(해당 참조 데이터만 갱신 안 됨).

---

## 2. 데이터가 들어오는 길

| 데이터 | 파일 | 갱신 방법 |
|---|---|---|
| 경제 캘린더(발표 일정·실제/컨센/이전) | `data.js` 의 `<<CALENDAR_RAW_START/END>>` 블록 | 업데이트 탭 업로드 → `scripts/update-calendar.py` |
| 일별 금리·환율·크레딧(국채 카드 주 소스) | `rate-data.js` | 업데이트 탭 업로드 → `scripts/update-rates.py` |
| 블룸버그 매크로·시장(홈 카드·지표 사전 실측값 주 소스) | `bloomberg-data.js` | 업데이트 탭 업로드 → `scripts/update-bloomberg.py` |
| CME FedWatch 확률 | `data.js` 의 `<<FEDWATCH_AUTO_START/END>>` 블록 | 업데이트 탭 숫자 입력 → `scripts/update-cme.py` |
| FRED/ECOS/e-Stat 참조 시계열 | `data.js` 참조 블록 | 매일 GitHub Actions(키 필요) |
| 기준금리 변경 | `data.js` `policyRates[].series` | 수동 편집 |

**업데이트 탭 동작**: 브라우저가 파일을 `data-intake/incoming/`에 커밋 →
`.github/workflows/data-intake.yml`이 위 파이썬 스크립트를 실행 → 결과 커밋 + Pages 배포 → 원본 파일 삭제.
진행/오류는 저장소 **Actions** 탭(“Apply data intake”)에서 확인.

---

## 3. 개발 방법

- 로컬 확인: `python3 -m http.server 8099` → http://127.0.0.1:8099/index.html
- **master 에 push = 즉시 배포.** 작업은 브랜치 → PR → 병합 권장.
- 업데이트 탭/자동 갱신이 master 에 수시로 커밋하므로 **작업 전 항상 `git pull`**.
- 스크립트는 `--dry` 로 미리보기 가능(예: `python3 scripts/update-calendar.py --dry`).
- 필요 패키지: `pip install openpyxl` (파이썬 스크립트), Node 20+ (자동 갱신 .mjs).
- Claude Code를 쓰면 `CLAUDE.md`를 자동으로 읽어 구조를 파악합니다.

---

## 4. 알려진 이슈 / 주의

- **인포맥스 원/달러 열이 1555.8로 고정**되어 들어옴(원천 피드 문제). 교차검증에서 ⚠️로 표시되며, 홈 환율 카드는 블룸버그 값을 사용하므로 화면엔 영향 없음.
- **지표 사전 history가 오래된 지표가 있음**(예: 미국 실업률). 캘린더의 "예정 지표" 이벤트는 history에서 값을 가져오므로 비어 보일 수 있음.
  비농업·실업률은 엑셀 실제값 행을 우선 표시하도록 처리됨(`app.js` `RAW_MATCH` + `update-calendar.py` `CONCEPT`에서 제외).
  CPI·PCE 등도 같은 증상이 보이면 같은 방식으로 추가하면 됨.
- **캘린더 ↔ 지표 사전 연동 규칙**: `app.js`의 `RAW_MATCH`(국가 + 포함/제외 키워드). 새 지표 연결 시 여기에 추가.
- **업데이트 탭 보안**: 공개 저장소라 암호화된 토큰(`update-config.js`)은 누구나 내려받을 수 있음 → 보안은 비밀번호 세기에 달림. 유출 의심 시 GitHub에서 토큰 삭제 후 3번 단계 재실행. **비밀번호를 코드·문서에 적지 말 것.**
- `app.js`의 `UPDATE_CFG`는 사이트 주소(`<소유자>.github.io/<저장소>`)에서 저장소 위치를 자동으로 읽음. 로컬(127.0.0.1)에서만 코드 안의 기본값을 씀.
