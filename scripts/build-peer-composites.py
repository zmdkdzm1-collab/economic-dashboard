#!/usr/bin/env python3
# ============================================================================
# build-peer-composites.py
# 정보단말에서 내려받은 "회사별 채권형 펀드 목록" 엑셀을 읽어, 회사(운용사/보험사)
# 단위로 AUM 가중 컴포짓(수익률 시계열 + 자산배분)을 만들고 채권 퀀트 툴의
# 사내 데이터 파일 `bond-quant-internal.js` 를 생성합니다.
#
# ⚠️ 외부 유출 금지: 생성물(bond-quant-internal.js)에는 경쟁사 분석이 들어갑니다.
#    .gitignore로 커밋이 차단됩니다. 절대 커밋/푸시하지 마세요.
#
# 사용법:
#   1) 펀드목록 엑셀을 data-imports/peer-funds.xlsx 로 저장
#   2) python3 scripts/build-peer-composites.py
#      python3 scripts/build-peer-composites.py --dry   # 미리보기
#
# 입력 엑셀 형식(정보단말 표준 내보내기):
#   한 펀드 = 8행 블록 [코드 / 펀드명 / 일자 / 수정기준가 / 순자산총액 /
#             채권편입비 / 수익증권편입비 / 유동성자산편입비], 열은 날짜(최신→과거).
#   마지막 블록에 종합채권지수(IDX...) 를 넣어두면 벤치마크 후보로 인식합니다.
#
# 회사 분류: 펀드명 앞글자(삼성/교보/한화 ...). 아래 COMPANIES / MINE 수정으로 조정.
#
# 필요: pip install openpyxl
# ============================================================================
import sys, os, json, datetime, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-imports", "peer-funds.xlsx")
OUT = os.path.join(ROOT, "bond-quant-internal.js")
DRY = "--dry" in sys.argv

# ── 설정: 회사 분류와 "우리" 지정 ─────────────────────────────────────────────
MINE = "한화"                       # 펀드명이 이 접두어로 시작하면 '내 펀드'
COMPANIES = ["한화", "삼성", "교보"]  # 컴포짓을 만들 회사(접두어). 첫 회사가 아니어도 MINE 로 구분
BENCHMARK_IS_PRICE_INDEX = True     # KAP '순가격지수'는 가격지수(캐리 제외)라 TR펀드와 직접비교 부적합
# ────────────────────────────────────────────────────────────────────────────


def die(m): print("❌ " + m); sys.exit(1)


def load():
    try:
        import openpyxl
    except ImportError:
        die("openpyxl 필요:  pip install openpyxl")
    if not os.path.exists(SRC):
        die("입력 없음: data-imports/peer-funds.xlsx (정보단말 펀드목록 내보내기)")
    import openpyxl
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb.active
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def dstr(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_blocks(rows):
    n = len(rows)
    funds, index = [], None
    for i in range(n):
        if rows[i] and rows[i][0] == "일자":
            code = rows[i - 2][0] if i - 2 >= 0 else None
            name = rows[i - 1][0] if i - 1 >= 0 else None
            dates = [dstr(v) for v in rows[i][1:]]
            block = {"code": code, "name": name, "dates": dates}
            j = i + 1
            while j < n and rows[j] and rows[j][0] not in (None, "", "일자") \
                    and not str(rows[j][0]).startswith(("KLVL", "IDX")):
                block[rows[j][0]] = [num(v) for v in rows[j][1:]]
                j += 1
            if code and str(code).startswith("IDX"):
                index = block
            else:
                funds.append(block)
    return funds, index


def to_map(block, key):
    d, arr = {}, block.get(key)
    if not arr:
        return d
    for k, dt in enumerate(block["dates"]):
        if dt and k < len(arr) and arr[k] is not None:
            d[dt] = arr[k]
    return d


def company_of(name):
    for c in COMPANIES:
        if name and name.startswith(c):
            return c
    return None


def build_composite(fundlist):
    alldates = set()
    for f in fundlist:
        alldates |= set(f["nav"].keys())
    dates = sorted(alldates)
    navser, lvl = [], 1000.0
    for t, d in enumerate(dates):
        if t == 0:
            navser.append({"date": d, "value": 1000.0}); continue
        dp = dates[t - 1]
        num_, den = 0.0, 0.0
        for f in fundlist:
            if d in f["nav"] and dp in f["nav"] and f["nav"][dp]:
                w = f["aum"].get(dp) or f["aum"].get(d) or 0
                if w > 0:
                    num_ += w * (f["nav"][d] / f["nav"][dp] - 1); den += w
        if den > 0:
            lvl *= (1 + num_ / den)
        navser.append({"date": d, "value": round(lvl, 4)})

    def alloc_latest(key):
        ld = dates[-1]
        num_, den = 0.0, 0.0
        for f in fundlist:
            if ld in f[key] and f["aum"].get(ld):
                num_ += f["aum"][ld] * f[key][ld]; den += f["aum"][ld]
        return round(num_ / den, 2) if den else None

    ld = dates[-1]
    return {
        "nav": navser,
        "allocation": {"bond": alloc_latest("bond"), "benef": alloc_latest("benef"), "liq": alloc_latest("liq")},
        "aum": round(sum((f["aum"].get(ld) or 0) for f in fundlist), 1),
        "nfunds": len(fundlist),
    }


def main():
    rows = load()
    funds_raw, index = parse_blocks(rows)
    byco = {}
    for f in funds_raw:
        c = company_of(f["name"])
        if not c:
            continue
        byco.setdefault(c, []).append({
            "name": f["name"],
            "nav": to_map(f, "수정기준가"), "aum": to_map(f, "순자산총액"),
            "bond": to_map(f, "채권편입비"), "benef": to_map(f, "수익증권편입비"),
            "liq": to_map(f, "유동성자산편입비"),
        })
    if MINE not in byco:
        die("'%s' 로 시작하는 펀드를 못 찾았습니다. COMPANIES/MINE 설정을 확인하세요." % MINE)

    comps = {c: build_composite(byco[c]) for c in COMPANIES if c in byco}
    mine = comps[MINE]
    peers = [{"name": c, "nav": comps[c]["nav"], "allocation": comps[c]["allocation"]}
             for c in COMPANIES if c in comps and c != MINE]

    as_of = mine["nav"][-1]["date"]
    data = {
        "asOf": as_of,
        "isSampleData": False,
        "fund": {"name": MINE + "생명(우리)", "nav": mine["nav"], "holdings": [],
                 "allocation": mine["allocation"]},
        "benchmark": None,   # KAP 순가격지수는 가격지수라 TR펀드와 비교 부적합 → TR지수 확보 후 연결
        "peers": peers,
        "macroNote": "재간접(수익증권 편입) 구조로 NAV가 금리를 1영업일 지연 반영 → 앱이 평가지연 자동보정.",
    }

    print("── 회사별 컴포짓 요약 ─────────────────────────────")
    print("%-8s %5s %12s   채권/재간접/유동성" % ("회사", "펀드수", "총AUM(억)"))
    for c in COMPANIES:
        if c not in comps:
            continue
        x = comps[c]; a = x["allocation"]
        tag = " ★우리" if c == MINE else ""
        print("%-8s %5d %12s   %.1f / %.1f / %.1f%s" %
              (c, x["nfunds"], format(x["aum"], ",.0f"), a["bond"], a["benef"], a["liq"], tag))
    if index:
        print("\n[벤치마크] %s → 순가격지수(가격지수). 총수익(TR)지수 확보 시 연결 권장." %
              (index["name"] if BENCHMARK_IS_PRICE_INDEX else index["name"]))

    if DRY:
        print("\n[--dry] 파일 안 씀."); return
    if os.path.exists(OUT):
        os.replace(OUT, OUT + ".bak"); print("\n• 기존 파일 백업: bond-quant-internal.js.bak")
    hdr = ("// bond-quant-internal.js — 사내(내부) 데이터  ⚠️ 외부 유출/커밋 금지\n"
           "// scripts/build-peer-composites.py 자동 생성 · " +
           datetime.datetime.now().strftime("%Y-%m-%d %H:%M") + "\n")
    with open(OUT, "w", encoding="utf-8") as fp:
        fp.write(hdr + "window.BQ_INTERNAL = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    print("✅ 생성 완료: bond-quant-internal.js  (커밋 안 됨)")
    print("   python3 -m http.server 8099 → http://127.0.0.1:8099/bond-quant.html 의 '경쟁사 비교' 탭")


if __name__ == "__main__":
    main()
