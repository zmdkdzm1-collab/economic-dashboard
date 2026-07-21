#!/usr/bin/env node
// ============================================================================
// update-estat.mjs
// 일본 e-Stat API에서 지정 통계를 가져와 data.js의
// <<ESTAT_AUTO_START>> ~ <<ESTAT_AUTO_END>> 블록(const estatReference)을 갱신합니다.
// GitHub Actions(매일)에서 실행. 로컬에선 ESTAT_APP_ID 만 있으면 동작.
//
// 필요한 환경변수: ESTAT_APP_ID (필수, e-Stat "アプリケーションID")
// 미설정 시 정상 종료(exit 0).
//
// ⚠️ statsDataId(통계표 ID)와 시간축 코드(@time)는 통계표마다 다릅니다.
//    아래 SERIES 설정을 실제 값으로 확정하면 됩니다(첫 실행 시 검증).
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(__dirname, "..", "data.js");
const START = "// <<ESTAT_AUTO_START>>";
const END = "// <<ESTAT_AUTO_END>>";

const APP_ID = process.env.ESTAT_APP_ID;

// 가져올 일본 시계열. statsDataId 는 e-Stat 통계표 ID(예: 전국 소비자물가지수).
// cdCat01 등 분류코드로 특정 계열을 선택할 수 있습니다(선택).
const SERIES = [
  {
    key: "jp_cpi",
    statsDataId: "0003427113", // 消費者物価指数 全国 (총합) — 첫 실행 시 확정
    label: "일본 소비자물가지수(전국, 총합)",
    unit: "지수",
    filters: {}, // 예: { cdCat01: "0001" }
  },
];

if (!APP_ID) {
  console.log("[estat] ESTAT_APP_ID 미설정 — 갱신 건너뜀 (정상 종료).");
  process.exit(0);
}

// e-Stat @time (예 "2026000101" = 2026년 1월, "2026001212"=2026년 12월) → ISO
function estatTimeToDate(t) {
  const s = String(t);
  const y = s.slice(0, 4);
  // 월 코드: 위치 6~8 이 "01".."12" (연간은 "000000")
  const mm = s.slice(6, 8);
  if (mm && mm !== "00") return `${y}-${mm}`;
  return y;
}

async function fetchSeries(cfg) {
  const params = new URLSearchParams({
    appId: APP_ID,
    statsDataId: cfg.statsDataId,
    metaGetFlg: "N",
    cntGetFlg: "N",
    ...cfg.filters,
  });
  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?${params}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`e-Stat ${cfg.statsDataId} → ${res.status} ${res.statusText}`);
  const json = await res.json();
  const root = json.GET_STATS_DATA;
  const status = root?.RESULT?.STATUS;
  if (status !== 0) {
    console.warn(`[estat] ${cfg.key} (${cfg.statsDataId}): STATUS ${status} ${root?.RESULT?.ERROR_MSG || ""}`);
    return [];
  }
  let values = root?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];
  if (!Array.isArray(values)) values = [values];
  return values
    .map((v) => ({ date: estatTimeToDate(v["@time"]), value: Number(v["$"]) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function jsBlock(obj) {
  const entries = Object.entries(obj.series)
    .map(([k, s]) => {
      const recent = s.recent.map((p) => `{ date: ${JSON.stringify(p.date)}, value: ${p.value} }`).join(", ");
      const latest = `{ date: ${JSON.stringify(s.latest.date)}, value: ${s.latest.value} }`;
      return `    ${k}: { statsDataId: ${JSON.stringify(s.statsDataId)}, label: ${JSON.stringify(s.label)}, unit: ${JSON.stringify(s.unit)}, latest: ${latest}, recent: [${recent}] },`;
    })
    .join("\n");
  return (
    `${START} 이 블록은 .github/workflows/update-estat.yml(매일)이 e-Stat API로 자동 갱신합니다. 수동 편집 시 주석 마커를 지우지 마세요.\n` +
    `const estatReference = {\n` +
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
  if (s === -1 || e === -1) throw new Error("data.js 에서 ESTAT 마커를 찾지 못함");
  const next = src.slice(0, s) + jsBlock(obj) + src.slice(e + END.length);
  if (next === src) return console.log("[estat] 변경 없음."), false;
  writeFileSync(DATA_JS, next);
  console.log("[estat] data.js 갱신 완료.");
  return true;
}

(async () => {
  const out = { asOf: new Date().toISOString().slice(0, 10), source: { title: "일본 e-Stat", url: "https://www.e-stat.go.jp/" }, series: {} };
  for (const cfg of SERIES) {
    const obs = await fetchSeries(cfg);
    if (!obs.length) continue;
    out.series[cfg.key] = { statsDataId: cfg.statsDataId, label: cfg.label, unit: cfg.unit, latest: obs[obs.length - 1], recent: obs.slice(-130) };
  }
  if (Object.keys(out.series).length === 0) throw new Error("가져온 시계열이 하나도 없음 — appId/statsDataId 확인");
  updateDataJs(out);
})().catch((err) => {
  console.error("[estat] 실패:", err.message);
  process.exit(1);
});
