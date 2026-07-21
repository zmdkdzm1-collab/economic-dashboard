#!/usr/bin/env node
// ============================================================================
// update-fedwatch.mjs
// CME API에서 FedWatch(연방기금금리 선물 기반 회의별 확률)를 가져와
// data.js의 <<FEDWATCH_AUTO_START>> ~ <<FEDWATCH_AUTO_END>> 블록을 갱신합니다.
// GitHub Actions(주 1회)에서 실행되며, 로컬에서도 환경변수만 있으면 동작합니다.
//
// 필요한 환경변수 (GitHub Secrets 로 주입):
//   CME_API_URL     : FedWatch 확률을 반환하는 엔드포인트 URL   (필수)
//   CME_API_KEY     : API 키/토큰                              (필수)
//   CME_AUTH_HEADER : 인증 헤더 이름 (기본 "Authorization")
//   CME_AUTH_SCHEME : 스킴 접두어    (기본 "Bearer", 없으면 "" 로 설정)
//
// 설정 전(키/URL 미존재)에는 아무것도 하지 않고 정상 종료(exit 0)합니다.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(__dirname, "..", "data.js");
const START = "// <<FEDWATCH_AUTO_START>>";
const END = "// <<FEDWATCH_AUTO_END>>";

const { CME_API_URL, CME_API_KEY } = process.env;
const AUTH_HEADER = process.env.CME_AUTH_HEADER || "Authorization";
const AUTH_SCHEME = process.env.CME_AUTH_SCHEME ?? "Bearer";

if (!CME_API_URL || !CME_API_KEY) {
  console.log("[fedwatch] CME_API_URL/CME_API_KEY 미설정 — 갱신 건너뜀 (정상 종료).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1) CME API 호출
// ---------------------------------------------------------------------------
async function fetchCme() {
  const headers = { Accept: "application/json" };
  headers[AUTH_HEADER] = AUTH_SCHEME ? `${AUTH_SCHEME} ${CME_API_KEY}` : CME_API_KEY;
  const res = await fetch(CME_API_URL, { headers });
  if (!res.ok) throw new Error(`CME API ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 2) 응답 → 대시보드 형식 변환
//    ⚠️ 실제 CME 응답 필드명에 맞춰 이 함수만 조정하면 됩니다.
//    반환 형식: { meetingDate, asOf, outcomes:[{label,pct}], source:{title,url} }
// ---------------------------------------------------------------------------
function transformCmeResponse(json) {
  // TODO: 샘플 응답을 받으면 아래 매핑을 실제 필드명으로 확정합니다.
  // 아래는 흔한 형태를 가정한 예시 매핑입니다.
  const meeting = json.meeting || json.data?.[0] || json;
  const meetingDate = meeting.meetingDate || meeting.date || null;
  const asOf = meeting.asOf || json.asOf || new Date().toISOString();

  // 확률 배열: [{ target/label, probability/pct }]
  const rawOutcomes = meeting.probabilities || meeting.outcomes || [];
  const outcomes = rawOutcomes.map((o) => ({
    label: o.label ?? o.target ?? o.range ?? String(o.name ?? ""),
    pct: Number(o.pct ?? o.probability ?? o.value ?? 0),
  }));

  return {
    meetingDate,
    asOf,
    outcomes,
    source: { title: "CME FedWatch", url: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" },
  };
}

// 변환 결과 검증 — 이상하면 data.js 를 건드리지 않고 실패(exit 1)
function validate(p) {
  if (!p.meetingDate) throw new Error("meetingDate 없음");
  if (!Array.isArray(p.outcomes) || p.outcomes.length === 0) throw new Error("outcomes 비어있음");
  const sum = p.outcomes.reduce((s, o) => s + (Number.isFinite(o.pct) ? o.pct : 0), 0);
  if (sum < 90 || sum > 110) throw new Error(`확률 합계 이상 (${sum.toFixed(1)}%) — 매핑 확인 필요`);
  for (const o of p.outcomes) {
    if (!o.label) throw new Error("outcome label 비어있음");
    if (!Number.isFinite(o.pct)) throw new Error("outcome pct 숫자 아님");
  }
}

// ---------------------------------------------------------------------------
// 3) data.js 의 마커 블록 교체
// ---------------------------------------------------------------------------
function renderBlock(p) {
  const lines = p.outcomes
    .map((o) => `        { label: ${JSON.stringify(o.label)}, pct: ${Number(o.pct.toFixed(1))} },`)
    .join("\n");
  return (
    `${START} 이 블록은 .github/workflows/update-fedwatch.yml(주 1회)이 CME API로 자동 갱신합니다. 수동 편집 시 주석 마커를 지우지 마세요.\n` +
    `    cmeProbability: {\n` +
    `      meetingDate: ${JSON.stringify(p.meetingDate)},\n` +
    `      asOf: ${JSON.stringify(p.asOf)},\n` +
    `      outcomes: [\n${lines}\n      ],\n` +
    `      source: { title: ${JSON.stringify(p.source.title)}, url: ${JSON.stringify(p.source.url)} },\n` +
    `    },\n` +
    `    ${END}`
  );
}

function updateDataJs(p) {
  const src = readFileSync(DATA_JS, "utf8");
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s === -1 || e === -1) throw new Error("data.js 에서 FEDWATCH 마커를 찾지 못함");
  const before = src.slice(0, s);
  const after = src.slice(e + END.length);
  const next = before + renderBlock(p) + after;
  if (next === src) {
    console.log("[fedwatch] 변경 없음.");
    return false;
  }
  writeFileSync(DATA_JS, next);
  console.log("[fedwatch] data.js 갱신 완료.");
  return true;
}

(async () => {
  const json = await fetchCme();
  const parsed = transformCmeResponse(json);
  validate(parsed);
  updateDataJs(parsed);
})().catch((err) => {
  console.error("[fedwatch] 실패:", err.message);
  process.exit(1);
});
