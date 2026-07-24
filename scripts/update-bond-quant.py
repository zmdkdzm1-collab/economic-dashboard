#!/usr/bin/env python3
# ============================================================================
# update-bond-quant.py
# 기준가(NAV)·보유내역 엑셀/CSV를 읽어 채권 퀀트 툴의 사내 데이터 파일
# `bond-quant-internal.js` 를 생성합니다.  (이 파일은 .gitignore로 커밋되지 않음)
#
# ⚠️ 외부 유출 금지: 이 스크립트가 만드는 bond-quant-internal.js 에는 사내 데이터가
#    들어갑니다. 절대 커밋/푸시하지 마세요(.gitignore가 막고 있습니다).
#
# 사용법:
#   1) 아래 입력 파일을 data-imports/ 에 저장 (xlsx 또는 csv):
#        - data-imports/bond-quant-nav.xlsx        (기준가; 필수)
#        - data-imports/bond-quant-holdings.xlsx   (내 보유내역; 선택)
#        - data-imports/bond-quant.config.json     (역할 매핑; 선택)
#   2) python3 scripts/update-bond-quant.py           # 생성
#      python3 scripts/update-bond-quant.py --dry      # 미리보기(파일 안 씀)
#
# ── 입력 형식 ───────────────────────────────────────────────────────────────
# [NAV] 넓은(wide) 형식. 첫 열 = 날짜, 나머지 각 열 = 펀드(헤더=펀드명).
#     날짜        | 우리채권 | 종합채권지수 | 경쟁사A | 경쟁사B | ...
#     2026-01-02 | 1023.45 | 105.32      | 1011.2 | ...
#   · 값이 빈 칸은 건너뜁니다(펀드마다 기간이 달라도 됨).
#   · 날짜는 YYYY-MM-DD / YYYY.MM.DD / 엑셀 날짜셀 모두 허용.
#
# [holdings] 각 행 = 보유 종목. 헤더명(한/영 모두 허용):
#     종목/name, 섹터/sector, 등급/rating, 만기/tenor, 비중/weight, 듀레이션/duration, 금리/ytm
#   · 비중은 % (예: 12) 또는 소수(0.12) 모두 허용(합계로 자동 판별).
#
# [config] data-imports/bond-quant.config.json (없으면: 1열=내펀드, 2열=벤치마크, 나머지=경쟁사)
#     {
#       "mine": "우리채권",            // NAV 파일의 내 펀드 열 이름
#       "benchmark": "종합채권지수",    // 벤치마크 열 이름 (없으면 null)
#       "benchmarkDuration": 5.2,      // 알면 입력, 모르면 null
#       "peers": ["경쟁사A","경쟁사B"], // 비우면: mine/benchmark 제외한 나머지 전부
#       "asOf": null                   // null 이면 NAV 마지막 날짜 자동
#     }
#
# 필요: pip install openpyxl   (xlsx를 쓸 때만. csv만 쓰면 불필요)
# ============================================================================
import sys, os, re, json, csv, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMP = os.path.join(ROOT, "data-imports")
OUT = os.path.join(ROOT, "bond-quant-internal.js")
DRY = "--dry" in sys.argv

NAV_CANDIDATES = ["bond-quant-nav.xlsx", "bond-quant-nav.csv"]
HOLD_CANDIDATES = ["bond-quant-holdings.xlsx", "bond-quant-holdings.csv"]
CONFIG_PATH = os.path.join(IMP, "bond-quant.config.json")

HOLD_ALIASES = {
    "name": ["name", "종목", "종목명", "이름"],
    "sector": ["sector", "섹터", "종류", "구분"],
    "rating": ["rating", "등급", "신용등급"],
    "tenor": ["tenor", "만기", "잔존", "잔존만기"],
    "weight": ["weight", "비중", "편입비중", "비중%"],
    "duration": ["duration", "듀레이션", "듀레이션(년)"],
    "ytm": ["ytm", "금리", "수익률", "매입금리", "평가금리"],
}


def die(msg):
    print("❌ " + msg); sys.exit(1)


def find_file(cands):
    for c in cands:
        p = os.path.join(IMP, c)
        if os.path.exists(p):
            return p
    return None


def norm_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    m = re.match(r"^(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    # 엑셀 일련번호(숫자)로 저장된 경우
    try:
        n = float(s)
        if 20000 < n < 80000:
            base = datetime.date(1899, 12, 30)
            return (base + datetime.timedelta(days=int(n))).strftime("%Y-%m-%d")
    except ValueError:
        pass
    return None


def to_num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "n/a", "NA", "NaN"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def read_grid(path):
    """xlsx/csv 를 2차원 리스트(행×열, 문자열/값)로 읽음."""
    if path.lower().endswith(".csv"):
        with open(path, encoding="utf-8-sig", newline="") as f:
            return [row for row in csv.reader(f)]
    try:
        import openpyxl
    except ImportError:
        die("xlsx를 읽으려면 openpyxl이 필요합니다:  pip install openpyxl  (또는 CSV로 저장하세요)")
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    return [[c.value for c in row] for row in ws.iter_rows()]


def parse_nav(path):
    grid = read_grid(path)
    if not grid or len(grid) < 2:
        die("NAV 파일이 비어있거나 데이터가 없습니다: " + path)
    header = grid[0]
    fund_cols = [(j, str(header[j]).strip()) for j in range(1, len(header)) if header[j] not in (None, "")]
    funds = {name: [] for _, name in fund_cols}
    for r in range(1, len(grid)):
        row = grid[r]
        if not row:
            continue
        d = norm_date(row[0])
        if not d:
            continue
        for j, name in fund_cols:
            val = to_num(row[j]) if j < len(row) else None
            if val is not None:
                funds[name].append({"date": d, "value": round(val, 4)})
    for name in funds:
        funds[name].sort(key=lambda x: x["date"])
    return [name for _, name in fund_cols], funds


def parse_holdings(path):
    grid = read_grid(path)
    if not grid or len(grid) < 2:
        return []
    header = [str(h).strip().lower() if h is not None else "" for h in grid[0]]

    def col(key):
        for alias in HOLD_ALIASES[key]:
            for j, h in enumerate(header):
                if h == alias.lower():
                    return j
        return None

    idx = {k: col(k) for k in HOLD_ALIASES}
    if idx["duration"] is None or idx["weight"] is None:
        die("holdings 파일에 최소한 '비중(weight)'과 '듀레이션(duration)' 열이 필요합니다. 인식된 헤더: " + str(grid[0]))
    rows = []
    for r in range(1, len(grid)):
        row = grid[r]
        if not row or all(c in (None, "") for c in row):
            continue

        def g(key, default=None):
            j = idx[key]
            return row[j] if (j is not None and j < len(row)) else default

        w = to_num(g("weight"))
        dur = to_num(g("duration"))
        if w is None or dur is None:
            continue
        rows.append({
            "name": str(g("name", "")).strip() or "종목",
            "sector": str(g("sector", "")).strip() or "기타",
            "rating": str(g("rating", "")).strip() or "-",
            "tenor": to_num(g("tenor")) or 0,
            "weight": w,
            "duration": dur,
            "ytm": to_num(g("ytm")) or 0,
        })
    # 비중 정규화: 합이 1.5 초과면 %로 간주 → /100
    tot = sum(h["weight"] for h in rows)
    if tot > 1.5:
        for h in rows:
            h["weight"] = round(h["weight"] / 100, 6)
    return rows


def main():
    nav_path = find_file(NAV_CANDIDATES)
    if not nav_path:
        die("NAV 파일이 없습니다. data-imports/bond-quant-nav.xlsx (또는 .csv) 를 만드세요.")
    print("• NAV 읽는 중: " + os.path.relpath(nav_path, ROOT))
    order, funds = parse_nav(nav_path)

    cfg = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        print("• config 적용: bond-quant.config.json")

    mine_name = cfg.get("mine") or (order[0] if order else None)
    bm_name = cfg.get("benchmark") if "benchmark" in cfg else (order[1] if len(order) > 1 else None)
    if mine_name and mine_name not in funds:
        die("config.mine '%s' 가 NAV 열에 없습니다. 사용 가능: %s" % (mine_name, order))
    if bm_name and bm_name not in funds:
        print("  ⚠️ benchmark '%s' 를 NAV에서 못 찾음 → 벤치마크 없이 진행" % bm_name); bm_name = None

    peers_cfg = cfg.get("peers")
    if peers_cfg:
        peer_names = [p for p in peers_cfg if p in funds]
    else:
        peer_names = [n for n in order if n != mine_name and n != bm_name]

    hold_path = find_file(HOLD_CANDIDATES)
    holdings = parse_holdings(hold_path) if hold_path else []
    if hold_path:
        print("• holdings 읽는 중: %s (%d종목)" % (os.path.relpath(hold_path, ROOT), len(holdings)))
    else:
        print("• holdings 파일 없음 → 보유내역 비움(시나리오/DV01 탭 제한)")

    as_of = cfg.get("asOf") or (funds[mine_name][-1]["date"] if funds.get(mine_name) else
                                (max((v[-1]["date"] for v in funds.values() if v), default="")))

    data = {
        "asOf": as_of,
        "isSampleData": False,
        "fund": {"name": mine_name, "nav": funds.get(mine_name, []), "holdings": holdings},
        "benchmark": ({"name": bm_name, "nav": funds.get(bm_name, []),
                       "duration": cfg.get("benchmarkDuration")} if bm_name else None),
        "peers": [{"name": p, "nav": funds[p]} for p in peer_names],
        "macroNote": cfg.get("macroNote", ""),
    }

    print("\n── 요약 ──────────────────────────────")
    print("  내 펀드      : %s (%d일)" % (mine_name, len(funds.get(mine_name, []))))
    print("  벤치마크     : %s%s" % (bm_name or "(없음)",
          " (%d일)" % len(funds.get(bm_name, [])) if bm_name else ""))
    print("  경쟁사(%d)   : %s" % (len(peer_names), ", ".join(
          "%s(%d일)" % (p, len(funds[p])) for p in peer_names) or "(없음)"))
    print("  보유내역     : %d종목  (비중합 %.1f%%)" %
          (len(holdings), sum(h["weight"] for h in holdings) * 100))
    print("  기준일(asOf) : %s" % as_of)

    body = "window.BQ_INTERNAL = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    js = ("// ============================================================================\n"
          "// bond-quant-internal.js — 사내(내부) 데이터  ⚠️ 외부 유출 금지 · 커밋 금지\n"
          "// scripts/update-bond-quant.py 로 자동 생성됨. 직접 수정보다 입력 파일 갱신 후 재실행 권장.\n"
          "// 생성 시각: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "\n"
          "// ============================================================================\n" + body)

    if DRY:
        print("\n[--dry] 파일을 쓰지 않았습니다. 위 요약만 확인하세요.")
        return
    if os.path.exists(OUT):
        bak = OUT + ".bak"
        os.replace(OUT, bak)
        print("\n• 기존 파일 백업: " + os.path.relpath(bak, ROOT))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("✅ 생성 완료: " + os.path.relpath(OUT, ROOT))
    print("   (이 파일은 .gitignore로 커밋되지 않습니다. python3 -m http.server 로 확인하세요.)")


if __name__ == "__main__":
    main()
