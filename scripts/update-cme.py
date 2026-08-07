#!/usr/bin/env python3
# ============================================================================
# update-cme.py
# 업데이트 탭(홈페이지)에서 올린 CME FedWatch 값(data-intake/incoming/cme.json)을
# data.js 의 <<FEDWATCH_AUTO_START>> ~ <<FEDWATCH_AUTO_END>> 블록에 반영합니다.
#
# cme.json 예시:
#   { "meetingDate": "2026-09-16",
#     "asOf": "2026-08-06 07:00:55 (CT)",
#     "hold": 45.4, "hike": 54.6, "cut": 0.0 }
#
# 규칙(정확도 우선):
#   - outcomes 의 label(문구)은 기존 값을 그대로 보존하고 pct(확률)만 바꿉니다.
#     (동결/인상/인하 라벨은 실제 기준금리가 바뀔 때만 손대므로 관리자가 직접 수정)
#   - meetingDate / asOf 는 새 값으로 교체.
#   - nextConsensus 문구의 "선물시장 인상 XX%" 숫자도 hike 값으로 갱신.
#
# 사용법: python3 scripts/update-cme.py [cme.json 경로]
# ============================================================================
import sys, os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "data.js")
DEFAULT_INPUT = os.path.join(ROOT, "data-intake", "incoming", "cme.json")
START = "// <<FEDWATCH_AUTO_START>>"
END = "// <<FEDWATCH_AUTO_END>>"


def fmt_pct(v):
    # 45.0 -> 45, 45.4 -> 45.4 (불필요한 소수점 제거)
    f = float(v)
    return str(int(f)) if f == int(f) else str(round(f, 1))


def main():
    inp = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    if not os.path.exists(inp):
        sys.exit(f"입력 파일이 없습니다: {inp}")
    payload = json.load(open(inp, encoding="utf-8"))

    for k in ("meetingDate", "asOf", "hold", "hike", "cut"):
        if k not in payload:
            sys.exit(f"cme.json 에 '{k}' 값이 없습니다.")

    src = open(DATA_JS, encoding="utf-8").read()
    if START not in src or END not in src:
        sys.exit("data.js 에 FedWatch 마커(<<FEDWATCH_AUTO_START/END>>)가 없습니다.")

    head, rest = src.split(START, 1)
    start_line, rest2 = rest.split("\n", 1)  # START 주석의 나머지(설명文) 보존
    block, tail = rest2.split(END, 1)

    # 기존 label(동결/인상/인하) 문구 보존
    labels = re.findall(r'label:\s*"((?:[^"\\]|\\.)*)"', block)
    if len(labels) < 3:
        sys.exit(f"FedWatch 블록에서 outcomes label 3개를 찾지 못했습니다(발견 {len(labels)}).")
    hold_label, hike_label, cut_label = labels[0], labels[1], labels[2]

    # 기존 source 라인 보존
    m_src = re.search(r'(source:\s*\{[^\n]*\},)', block)
    source_line = m_src.group(1) if m_src else 'source: { title: "CME FedWatch", url: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" },'

    new_block = f"""    cmeProbability: {{
      meetingDate: "{payload['meetingDate']}",
      asOf: "{payload['asOf']}",
      outcomes: [
        {{ label: "{hold_label}", pct: {fmt_pct(payload['hold'])} }},
        {{ label: "{hike_label}", pct: {fmt_pct(payload['hike'])} }},
        {{ label: "{cut_label}", pct: {fmt_pct(payload['cut'])} }},
      ],
      {source_line}
    }},
    """

    out = head + START + start_line + "\n" + new_block + END + tail

    # nextConsensus 의 "선물시장 인상 XX%" 갱신(있을 때만)
    out = re.sub(r"(선물시장 인상 )[\d.]+%", rf"\g<1>{fmt_pct(payload['hike'])}%", out)

    open(DATA_JS, "w", encoding="utf-8").write(out)
    print(f"✅ CME FedWatch 갱신: {payload['meetingDate']} 회의 · 동결 {fmt_pct(payload['hold'])}% / "
          f"인상 {fmt_pct(payload['hike'])}% / 인하 {fmt_pct(payload['cut'])}% (asOf {payload['asOf']})")


if __name__ == "__main__":
    main()
