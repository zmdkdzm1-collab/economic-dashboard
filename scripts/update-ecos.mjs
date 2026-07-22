#!/usr/bin/env node
// ============================================================================
// update-ecos.mjs
// 한국은행 ECOS API에서 지정 통계를 가져와 data.js의
// <<ECOS_AUTO_START>> ~ <<ECOS_AUTO_END>> 블록(const ecosReference)을 갱신합니다.
// GitHub Actions(매일)에서 실행. 로컬에선 ECOS_API_KEY 만 있으면 동작.
//
// 필요한 환경변수: ECOS_API_KEY (필수)
// 미설정 시 정상 종료(exit 0).
//
// ⚠️ 각 시리즈의 statCode/itemCode/cycle 은 ECOS 통계표마다 다릅니다.
//    아래 SERIES 설정을 실제 코드로 확정하면 됩니다(첫 실행 시 검증).
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(__dirname, "..", "data.js");
const START = "// <<ECOS_AUTO_START>>";
const END = "// <<ECOS_AUTO_END>>";

const API_KEY = process.env.ECOS_API_KEY;

// 가져올 한국 시계열. cycle: D(일)/M(월)/Q(분기)/A(년)
const SERIES = [
  // 기준금리는 월간이 커버리지가 좋음(일별 D는 갱신이 늦음). 7월 인상은 월말에 반영되는 특성.
  { key: "kr_base_rate", statCode: "722Y001", itemCode: "0101000", cycle: "M", label: "한국은행 기준금리", unit: "%", yearsBack: 6 },
  { key: "kr_10y", statCode: "817Y002", itemCode: "010210000", cycle: "D", label: "국고채 10년", unit: "%", yearsBack: 2 },
  { key: "fx_usdkrw", statCode: "731Y001", itemCode: "0000001", cycle: "D", label: "원/달러(매매기준율)", unit: "원", yearsBack: 2 },
  { key: "kr_cpi", statCode: "901Y009", itemCode: "0", cycle: "M", label: "소비자물가지수(2020=100)", unit: "지수", yearsBack: 6 },
];

if (!API_KEY) {
  console.log("[ecos] ECOS_API_KEY 미설정 — 갱신 건너뜀 (정상 종료).");
  process.exit(0);
}

// cycle 별 시작/종료 TIME 문자열 생성
function periodBounds(cycle, yearsBack) {
  const now = new Date();
  const y = now.getFullYear();
  const startY = y - yearsBack;
  const pad = (n) => String(n).padStart(2, "0");
  if (cycle === "A") return [String(startY), String(y + 1)];
  if (cycle === "Q") return [`${startY}Q1`, `${y + 1}Q4`];
  if (cycle === "M") return [`${startY}01`, `${y + 1}12`];
  // D
  return [`${startY}0101`, `${y + 1}1231`];
}

// ECOS TIME → ISO 날짜
function timeToDate(cycle, t) {
  if (cycle === "M") return `${t.slice(0, 4)}-${t.slice(4, 6)}`;
  if (cycle === "A") return t;
  if (cycle === "Q") return t; // "2026Q1"
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`; // D
}

async function fetchSeries(cfg) {
  const [s, e] = periodBounds(cfg.cycle, cfg.yearsBack);
  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${API_KEY}/json/kr/1/1000/` +
    `${cfg.statCode}/${cfg.cycle}/${s}/${e}/${cfg.itemCode}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ECOS ${cfg.statCode} → ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.RESULT) {
    // INFO-200 = 해당 기간 데이터 없음 / 그 외 = 코드·키 오류
    console.warn(`[ecos] ${cfg.key} (${cfg.statCode}/${cfg.itemCode}): ${json.RESULT.CODE} ${json.RESULT.MESSAGE}`);
    return [];
  }
  const rows = json.StatisticSearch?.row || [];
  return rows
    .map((r) => ({ date: timeToDate(cfg.cycle, String(r.TIME)), value: Number(r.DATA_VALUE) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function jsBlock(obj) {
  const entries = Object.entries(obj.series)
    .map(([k, s]) => {
      const recent = s.recent.map((p) => `{ date: ${JSON.stringify(p.date)}, value: ${p.value} }`).join(", ");
      const latest = `{ date: ${JSON.stringify(s.latest.date)}, value: ${s.latest.value} }`;
      return `    ${k}: { statCode: ${JSON.stringify(s.statCode)}, label: ${JSON.stringify(s.label)}, unit: ${JSON.stringify(s.unit)}, latest: ${latest}, recent: [${recent}] },`;
    })
    .join("\n");
  return (
    `${START} 이 블록은 .github/workflows/update-ecos.yml(매일)이 ECOS API로 자동 갱신합니다. 수동 편집 시 주석 마커를 지우지 마세요.\n` +
    `const ecosReference = {\n` +
    `  asOf: ${JSON.stringify(obj.asOf)},\n` +
    `  source: { title: ${JSON.stringify(obj.source.title)}, url: ${JSON.stringify(obj.source.url)} },\n` +
    `  series: {\n${entries}\n  },\n` +
    `};\n` +
    `${END}`
  );
}

function updateDataJs(obj) {
  const src = readFileSync(DATA_JS, "utf8");
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s === -1 || e === -1) throw new Error("data.js 에서 ECOS 마커를 찾지 못함");
  const next = src.slice(0, s) + jsBlock(obj) + src.slice(e + END.length);
  if (next === src) return console.log("[ecos] 변경 없음."), false;
  writeFileSync(DATA_JS, next);
  console.log("[ecos] data.js 갱신 완료.");
  return true;
}

(async () => {
  const out = { asOf: new Date().toISOString().slice(0, 10), source: { title: "한국은행 ECOS", url: "https://ecos.bok.or.kr/" }, series: {} };
  for (const cfg of SERIES) {
    const obs = await fetchSeries(cfg);
    if (!obs.length) continue;
    out.series[cfg.key] = { statCode: cfg.statCode, label: cfg.label, unit: cfg.unit, latest: obs[obs.length - 1], recent: obs.slice(-130) };
  }
  if (Object.keys(out.series).length === 0) throw new Error("가져온 시계열이 하나도 없음 — 키/통계표코드 확인");
  updateDataJs(out);
})().catch((err) => {
  console.error("[ecos] 실패:", err.message);
  process.exit(1);
});
