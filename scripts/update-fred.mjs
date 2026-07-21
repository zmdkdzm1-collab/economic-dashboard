#!/usr/bin/env node
// ============================================================================
// update-fred.mjs
// FRED API에서 지정 시계열을 가져와 data.js의
// <<FRED_AUTO_START>> ~ <<FRED_AUTO_END>> 블록(const fredReference)을 갱신합니다.
// GitHub Actions(매일)에서 실행되며, 로컬에서도 FRED_API_KEY 만 있으면 동작합니다.
//
// 필요한 환경변수 (GitHub Secrets 로 주입):
//   FRED_API_KEY : FRED 무료 API 키 (필수)
//
// 미설정 시 아무것도 하지 않고 정상 종료(exit 0)합니다.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(__dirname, "..", "data.js");
const START = "// <<FRED_AUTO_START>>";
const END = "// <<FRED_AUTO_END>>";

const API_KEY = process.env.FRED_API_KEY;
const RECENT_LIMIT = 130; // 최근 관측치 개수(≈영업일 반년)

// 사용자가 올린 금리·환율과 교차검증할 미국 시계열
const SERIES = [
  { key: "us_10y", fredId: "DGS10", label: "미국 10년 국채금리", unit: "%" },
  { key: "us_2y", fredId: "DGS2", label: "미국 2년 국채금리", unit: "%" },
  { key: "us_fedfunds_upper", fredId: "DFEDTARU", label: "미 연준 기준금리(상단)", unit: "%" },
  { key: "fx_usdkrw", fredId: "DEXKOUS", label: "원/달러 환율", unit: "원" },
  { key: "fx_jpyusd", fredId: "DEXJPUS", label: "엔/달러 환율", unit: "엔" },
  { key: "fx_usdeur", fredId: "DEXUSEU", label: "달러/유로 환율", unit: "달러" },
];

if (!API_KEY) {
  console.log("[fred] FRED_API_KEY 미설정 — 갱신 건너뜀 (정상 종료).");
  process.exit(0);
}

async function fetchSeries(fredId) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(fredId)}` +
    `&api_key=${API_KEY}&file_type=json&sort_order=desc&limit=${RECENT_LIMIT}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FRED ${fredId} → ${res.status} ${res.statusText}`);
  const json = await res.json();
  // "." 는 결측 → 제외, 최신순으로 오므로 다시 과거→현재로 뒤집음
  const obs = (json.observations || [])
    .filter((o) => o.value !== "." && o.value != null && o.value !== "")
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value))
    .reverse();
  return obs;
}

function jsSeries(obj) {
  // 안정적인 diff 를 위해 결정적으로 직렬화
  const seriesEntries = Object.entries(obj.series)
    .map(([k, s]) => {
      const recent = s.recent.map((p) => `{ date: ${JSON.stringify(p.date)}, value: ${p.value} }`).join(", ");
      const latest = `{ date: ${JSON.stringify(s.latest.date)}, value: ${s.latest.value} }`;
      return (
        `    ${k}: { fredId: ${JSON.stringify(s.fredId)}, label: ${JSON.stringify(s.label)}, ` +
        `unit: ${JSON.stringify(s.unit)}, latest: ${latest}, recent: [${recent}] },`
      );
    })
    .join("\n");
  return (
    `${START} 이 블록은 .github/workflows/update-fred.yml(매일)이 FRED API로 자동 갱신합니다. 수동 편집 시 주석 마커를 지우지 마세요.\n` +
    `const fredReference = {\n` +
    `  asOf: ${JSON.stringify(obj.asOf)},\n` +
    `  source: { title: ${JSON.stringify(obj.source.title)}, url: ${JSON.stringify(obj.source.url)} },\n` +
    `  series: {\n${seriesEntries}\n  },\n` +
    `};\n` +
    `${END}`
  );
}

function updateDataJs(obj) {
  const src = readFileSync(DATA_JS, "utf8");
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s === -1 || e === -1) throw new Error("data.js 에서 FRED 마커를 찾지 못함");
  const next = src.slice(0, s) + jsSeries(obj) + src.slice(e + END.length);
  if (next === src) {
    console.log("[fred] 변경 없음.");
    return false;
  }
  writeFileSync(DATA_JS, next);
  console.log("[fred] data.js 갱신 완료.");
  return true;
}

(async () => {
  const out = { asOf: new Date().toISOString().slice(0, 10), source: { title: "FRED (St. Louis Fed)", url: "https://fred.stlouisfed.org/" }, series: {} };
  for (const cfg of SERIES) {
    const obs = await fetchSeries(cfg.fredId);
    if (!obs.length) {
      console.warn(`[fred] ${cfg.fredId}: 관측치 없음 — 건너뜀`);
      continue;
    }
    out.series[cfg.key] = {
      fredId: cfg.fredId,
      label: cfg.label,
      unit: cfg.unit,
      latest: obs[obs.length - 1],
      recent: obs,
    };
  }
  if (Object.keys(out.series).length === 0) throw new Error("가져온 시계열이 하나도 없음 — 키/네트워크 확인");
  updateDataJs(out);
})().catch((err) => {
  console.error("[fred] 실패:", err.message);
  process.exit(1);
});
