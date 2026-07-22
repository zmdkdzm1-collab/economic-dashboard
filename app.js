// ============================================================================
// app.js — 화면 렌더링 / 카테고리 필터 / 지표 상세 모달 / 캘린더 월간 이동 / 시계열 차트
// ============================================================================

const indicatorById = new Map(indicators.map((ind) => [ind.id, ind]));
// 지표사전과 연결되지 않는 독립 캘린더 이벤트(raw) 조회용
const rawEventById = new Map(calendarEvents.filter((ev) => ev.raw).map((ev) => [ev.id, ev]));

// ----------------------------------------------------------------------------
// 블룸버그 월별 실측치로 지표사전(발표이력·차트)·캘린더(차기 발표) 실데이터화
// ----------------------------------------------------------------------------
const INDICATOR_BBG = {
  us_nfp: "nfp_tch_index", us_unemployment: "usurtot_index", us_cpi: "cpi_yoy_index",
  us_core_cpi: "cpi_xyoy_index", us_pce: "pce_defy_index", us_gdp: "gdp_cqoq_index",
  us_ism_mfg: "napmpmi_index", us_ism_svc: "napmnmi_index", us_retail_sales: "rstamom_index",
  us_cb_consumer: "concconf_index", us_umich_consumer: "conssent_index",
  us_durable_goods: "dgnochng_index", us_housing_starts: "nhspstot_index",
  eu_cpi: "eccpemuy_index", eu_gdp: "eugnemuq_index", de_ifo: "grifpbus_index",
  de_zew: "grzewi_index", eu_unemployment: "umrtemu_index", cn_gdp: "cngdpyoy_index",
  cn_pmi_official: "cpmindx_index", cn_retail_sales: "cnrscyoy_index", cn_trade: "cnfrbal_index",
  jp_gdp: "jgdpagdp_index", jp_trade: "jntbal_index", jp_cpi: "jncpiyoy_index",
  jp_unemployment: "jnue_index", kr_trade: "kotrbal_index", kr_cpi: "kocpiyoy_index",
  kr_gdp: "kogdpqoq_index", kr_ip: "koipimom_index", au_cpi: "rbcptriy_index",
  au_unemployment: "aulfunem_index", au_retail_sales: "aurstysa_index",
};
function bbgFmt(v, unit) {
  if (v == null) return null;
  return (unit || "").includes("%") ? `${v}%` : String(v);
}
function parseBbgDateTime(s) {
  if (!s) return null;
  const [datePart, timePart] = String(s).split(" ");
  const date = datePart.replace(/\//g, "-");
  const time = timePart ? timePart.slice(0, 5) : "";
  return { date, time };
}
function enrichIndicatorsFromBloomberg() {
  if (typeof bloombergData === "undefined") return;
  const todayYmd = formatYmd(new Date());
  for (const [indId, key] of Object.entries(INDICATOR_BBG)) {
    const ind = indicatorById.get(indId);
    const bs = bloombergData.monthly[key];
    if (!ind || !bs) continue;
    const relByDate = Object.fromEntries((bs.releases || []).map((r) => [r.date, r]));
    const pts = (bs.series || []).filter(([d]) => d >= "2020-01-01");
    ind.history = pts.map(([date, actual], i) => ({
      date,
      actual: bbgFmt(actual, bs.unit),
      consensus: relByDate[date] ? bbgFmt(relByDate[date].survey, bs.unit) : null,
      previous: i > 0 ? bbgFmt(pts[i - 1][1], bs.unit) : null,
    }));
    ind.hasConsensus = true;
    ind._bbgEnriched = true;
    ind._bbgTicker = bs.ticker;
    if (bs.survey_latest != null) ind.nextConsensus = bbgFmt(bs.survey_latest, bs.unit);
    // 캘린더에 차기 발표 추가(미래 것만)
    const nr = parseBbgDateTime(bs.nextRelease);
    if (nr && nr.date >= todayYmd && !calendarEvents.some((ev) => ev.date === nr.date && ev.indicatorId === indId)) {
      calendarEvents.push({ date: nr.date, time: nr.time ? `${nr.time} (현지)` : "", timeKST: nr.time || "", indicatorId: indId });
    }
  }
}
// 블룸버그에는 있지만 지표사전에 없던 지표들을 새로 생성(실측 이력·차트·캘린더 자동 연결)
const NEW_BBG_INDICATORS = [
  { key: "koextoty_index", id: "kr_exports", name: "한국 수출 증가율", nameEn: "Korea Exports YoY", country: "한국", category: "무역", institution: "산업통상자원부·관세청", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 1일 무렵", description: "한국의 월간 수출액 전년동월대비 증가율. 반도체 등 주력 품목 경기와 글로벌 수요를 가늠하는 핵심 지표입니다." },
  { key: "koimtoty_index", id: "kr_imports", name: "한국 수입 증가율", nameEn: "Korea Imports YoY", country: "한국", category: "무역", institution: "산업통상자원부·관세청", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 1일 무렵", description: "한국의 월간 수입액 전년동월대비 증가율. 내수·설비투자 수요와 에너지 가격을 반영합니다." },
  { key: "koeauers_index", id: "kr_unemployment", name: "한국 실업률", nameEn: "Korea Unemployment Rate", country: "한국", category: "고용", institution: "통계청", unit: "%", frequency: "매월", releasePattern: "매월 중순", description: "경제활동인구 중 실업자 비율. 한국 고용시장의 대표 지표입니다." },
  { key: "kobpcbsa_index", id: "kr_current_account", name: "한국 경상수지", nameEn: "Korea Current Account", country: "한국", category: "무역", institution: "한국은행", unit: "백만 달러", frequency: "매월", releasePattern: "매월 초", description: "상품·서비스·본원소득 등을 포함한 대외거래 수지. 원화 환율과 대외건전성에 영향을 줍니다." },
  { key: "kocccsi_index", id: "kr_ccsi", name: "한국 소비자심리지수(CCSI)", nameEn: "Korea Consumer Sentiment", country: "한국", category: "소비", institution: "한국은행", unit: "포인트", frequency: "매월", releasePattern: "매월 말", description: "소비자의 경기·생활형편에 대한 심리를 종합한 지수. 100 이상이면 낙관적입니다." },
  { key: "koppiyoy_index", id: "kr_ppi", name: "한국 생산자물가지수(PPI)", nameEn: "Korea PPI YoY", country: "한국", category: "물가", institution: "한국은행", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 하순", description: "생산자가 출하하는 상품·서비스의 가격 변동. 소비자물가(CPI)의 선행지표로 활용됩니다." },
  { key: "kobsmc_index", id: "kr_bsi", name: "한국 기업경기실사지수(BSI)", nameEn: "Korea Business Survey Index", country: "한국", category: "투자", institution: "한국은행", unit: "포인트", frequency: "매월", releasePattern: "매월 말", description: "기업이 느끼는 경기 체감을 조사한 지수. 100 이상이면 경기를 긍정적으로 봅니다." },
  { key: "koblthhd_index", id: "kr_household_credit", name: "한국 가계 은행대출 잔액", nameEn: "Korea Household Bank Loans", country: "한국", category: "소비", institution: "한국은행", unit: "십억 원", frequency: "매월", releasePattern: "매월 초·중순", description: "은행권 가계대출 잔액. 가계부채 흐름과 부동산·소비 여력을 보여줍니다." },
  { key: "kohptyoy_index", id: "kr_house_price", name: "한국 주택가격 동향", nameEn: "Korea House Price YoY", country: "한국", category: "투자", institution: "한국부동산원", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 중순", description: "전국 주택 매매가격 전년동월대비 변동률. 가계자산·건설경기와 밀접합니다." },
  { key: "fdiufdyo_index", id: "us_ppi", name: "미국 생산자물가지수(PPI)", nameEn: "US PPI YoY", country: "미국", category: "물가", institution: "미국 노동통계국(BLS)", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 중순", description: "미국 생산자 판매가격 변동. CPI에 앞서 물가 압력을 보여주는 선행지표입니다." },
  { key: "jolttotl_index", id: "us_jolts", name: "미국 JOLTS 구인건수", nameEn: "US JOLTS Job Openings", country: "미국", category: "고용", institution: "미국 노동통계국(BLS)", unit: "천 명", frequency: "매월", releasePattern: "매월 초", description: "기업의 미충원 구인 건수. 노동수요 강도를 보여주며 Fed가 주시하는 지표입니다." },
  { key: "adp_chng_index", id: "us_adp", name: "미국 ADP 민간고용", nameEn: "US ADP Employment", country: "미국", category: "고용", institution: "ADP Research", unit: "천 명", frequency: "매월", releasePattern: "고용보고서 이틀 전", description: "민간기업 급여 데이터 기반 고용 증감. 정부 고용보고서(NFP)의 선행 참고치로 쓰입니다." },
  { key: "ip_chng_index", id: "us_industrial", name: "미국 산업생산", nameEn: "US Industrial Production MoM", country: "미국", category: "성장", institution: "미국 연방준비제도(Fed)", unit: "% (전월대비)", frequency: "매월", releasePattern: "매월 중순", description: "제조·광업·유틸리티의 실질 생산량 변동. 실물경기 흐름을 보여줍니다." },
  { key: "cptichng_index", id: "us_capacity", name: "미국 설비가동률", nameEn: "US Capacity Utilization", country: "미국", category: "성장", institution: "미국 연방준비제도(Fed)", unit: "%", frequency: "매월", releasePattern: "매월 중순", description: "산업 생산능력 대비 실제 가동 비율. 인플레·투자 압력을 가늠하는 지표입니다." },
  { key: "euitemum_index", id: "eu_industrial", name: "유로존 산업생산", nameEn: "Euro Area Industrial Production MoM", country: "유럽", category: "성장", institution: "Eurostat", unit: "% (전월대비)", frequency: "매월", releasePattern: "매월 중순", description: "유로존 산업 생산량 변동. 유럽 제조업 경기의 실물 지표입니다." },
  { key: "cncpiyoy_index", id: "cn_cpi", name: "중국 소비자물가지수(CPI)", nameEn: "China CPI YoY", country: "중국", category: "물가", institution: "중국 국가통계국", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 초순", description: "중국 소비자물가 전년동월대비 변동. 디플레 우려와 정책 방향을 가늠하는 지표입니다." },
  { key: "cheftyoy_index", id: "cn_ppi", name: "중국 생산자물가지수(PPI)", nameEn: "China PPI YoY", country: "중국", category: "물가", institution: "중국 국가통계국", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 초순", description: "중국 생산자물가 변동. 글로벌 제조업 물가와 수출입 가격에 파급됩니다." },
  { key: "jntsmfg_index", id: "jp_tankan", name: "일본 단칸 대기업 제조업지수", nameEn: "Japan Tankan Large Mfg", country: "일본", category: "투자", institution: "일본은행(BOJ)", unit: "포인트", frequency: "분기별", releasePattern: "분기 초(4·7·10·12월)", description: "대기업 제조업의 업황 체감을 조사한 지수. 일본 기업심리의 대표 지표입니다." },
  { key: "jnlsuctl_index", id: "jp_wages", name: "일본 현금급여총액", nameEn: "Japan Labor Cash Earnings YoY", country: "일본", category: "고용", institution: "후생노동성", unit: "% (전년동월비)", frequency: "매월", releasePattern: "매월 초", description: "노동자 1인당 현금급여 증감. 임금-물가 선순환과 BOJ 정책의 핵심 변수입니다." },
  { key: "aunagdpc_index", id: "au_gdp", name: "호주 GDP 성장률", nameEn: "Australia GDP QoQ", country: "호주", category: "성장", institution: "호주 통계청(ABS)", unit: "% (전기대비)", frequency: "분기별", releasePattern: "분기 후 약 3개월", description: "호주 실질 국내총생산 전기대비 성장률. 자원경기와 내수를 종합적으로 보여줍니다." },
  { key: "auitgsb_index", id: "au_trade", name: "호주 무역수지", nameEn: "Australia Trade Balance", country: "호주", category: "무역", institution: "호주 통계청(ABS)", unit: "백만 호주달러", frequency: "매월", releasePattern: "매월 초", description: "상품·서비스 수출입 차액. 철광석 등 원자재 수출 의존도가 높은 호주 경제의 핵심 지표입니다." },
];
function createBbgIndicators() {
  if (typeof bloombergData === "undefined") return;
  for (const spec of NEW_BBG_INDICATORS) {
    if (indicatorById.has(spec.id) || !bloombergData.monthly[spec.key]) continue;
    const ind = {
      id: spec.id, name: spec.name, nameEn: spec.nameEn, country: spec.country, category: spec.category,
      institution: spec.institution, unit: spec.unit, importance: "중", frequency: spec.frequency,
      releasePattern: spec.releasePattern, description: spec.description, hasConsensus: true, history: [],
    };
    indicators.push(ind);
    indicatorById.set(ind.id, ind);
    INDICATOR_BBG[spec.id] = spec.key;
  }
}
createBbgIndicators();
enrichIndicatorsFromBloomberg();

const state = {
  view: "home", // "home" | "dictionary" | "calendar" | "monetary"
  category: "전체",
  calImportance: "전체", // 캘린더 중요도 필터: "전체" | "상" | "중" | "하"
  monthStart: getMonthStart(new Date()), // 현재 화면에 보이는 달의 1일
  compareA: "bond_kr_10y",
  compareB: "us_cpi",
  compareRange: "all", // "all" | "custom"
  compareStartDate: null, // "YYYY-MM-DD" (직접 날짜 선택 시)
  compareEndDate: null,
  homeWeekOffset: 0, // -1 지난주, 0 이번주, 1 다음주
  homeCategoryTabIndex: 0, // 홈 탭 "카테고리별 주요 지표"에서 선택된 탭
  assetPeriod: {}, // 지수·원자재 카드별로 선택된 차트 기간 { [assetId]: "1주"|"1개월"|"1년" }
};

const bondYieldById = new Map(bondYields.map((b) => [b.id, b]));
const marketAssetById = new Map(marketAssets.map((a) => [a.id, a]));
const policyRateById = new Map(policyRates.map((r) => [r.id, r]));

// ----------------------------------------------------------------------------
// rate-data.js(info_daily.xlsx에서 추출한 일별 시계열) 연동
// - 비교 도구 드롭다운에 210개 시리즈를 추가한다("rd:" 접두)
// - 홈의 한/미/일 10년 국채금리 카드를 일별 실데이터로 교체한다
// rate-data.js가 없어도 대시보드가 동작하도록 방어적으로 처리한다.
// ----------------------------------------------------------------------------
const hasRateData = typeof rateData !== "undefined" && rateData && Array.isArray(rateData.series);
const rateSeriesById = new Map(hasRateData ? rateData.series.map((s) => [s.id, s]) : []);
const _ratePointsCache = new Map();

// rateData 시리즈 id -> [{date, value}] (누락일 null은 제외). 결과는 캐시한다.
function rateSeriesPoints(id) {
  if (_ratePointsCache.has(id)) return _ratePointsCache.get(id);
  const s = rateSeriesById.get(id);
  if (!s) return [];
  const pts = [];
  for (let i = 0; i < rateData.dates.length; i++) {
    const v = s.values[i];
    if (v !== null && v !== undefined) pts.push({ date: rateData.dates[i], value: v });
  }
  _ratePointsCache.set(id, pts);
  return pts;
}

// 홈 국채금리 카드용: 기존 series의 rateData 시작일 이전 구간(장기 과거)을 살리고
// 그 뒤로 일별 실데이터를 이어붙여 촘촘한 추이를 만든다.
// 블룸버그 업로드 데이터(가장 신선, 2026-07-22)로 홈 채권·지수 카드 시계열을 덮어씀.
// 기준금리는 블룸버그도 월간 지연이라 큐레이션 값을 유지(덮지 않음).
const BBG_BOND_MAP = {
  bond_kr_10y: "gvsk10yr_index",
  bond_us_10y: "usgg10yr_index",
  bond_jp_10y: "gjgb10_index",
  bond_eu_10y: "gdbr10_index",
  bond_au_10y: "gacgb10_index",
};
const BBG_ASSET_MAP = { idx_kospi: "kospi_index", idx_sp500: "spx_index", idx_wti: "cl1_comdty" };
function refreshFromBloomberg() {
  if (typeof bloombergData === "undefined") return;
  const toPoints = (key) => (bloombergData.daily[key]?.series || []).map(([date, value]) => ({ date, value }));
  Object.entries(BBG_BOND_MAP).forEach(([bondId, key]) => {
    const bond = bondYieldById.get(bondId);
    const pts = toPoints(key);
    if (bond && pts.length) bond.series = pts;
  });
  Object.entries(BBG_ASSET_MAP).forEach(([assetId, key]) => {
    const asset = marketAssetById.get(assetId);
    const pts = toPoints(key);
    if (asset && pts.length) asset.series = pts;
  });
}

function refreshBondSeriesFromRateData() {
  if (!hasRateData) return;
  const mapping = { bond_kr_10y: "ktb10y", bond_us_10y: "ust0y", bond_jp_10y: "jpy10y", bond_au_10y: "aud10y" };
  Object.entries(mapping).forEach(([bondId, rateId]) => {
    const bond = bondYieldById.get(bondId);
    const daily = rateSeriesPoints(rateId);
    if (!bond || daily.length === 0) return;
    const firstDaily = daily[0].date;
    const legacyOld = bond.series.filter((p) => p.date < firstDaily);
    bond.series = [...legacyOld, ...daily];
  });
}

// ----------------------------------------------------------------------------
// 날짜 유틸 함수
// ----------------------------------------------------------------------------
function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getCalendarMatrixStart(monthStart) {
  const d = new Date(monthStart);
  d.setDate(d.getDate() - d.getDay()); // 그 달 1일이 포함된 주의 일요일까지 뒤로 이동
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameDate(a, b) {
  return formatYmd(a) === formatYmd(b);
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function flagIcon(country) {
  const svg = FLAG_SVGS[country];
  return svg ? `<span class="flag-icon" title="${country}">${svg}</span>` : "";
}

// 카테고리별 한눈에 구분되는 색상 (지표 사전 카드 테두리/배지, 카테고리 필터에 사용)
const CATEGORY_COLORS = {
  성장: "#2563eb",
  물가: "#dc2626",
  고용: "#16a34a",
  소비: "#9333ea",
  투자: "#0891b2",
  통화정책: "#ea580c",
  무역: "#ca8a04",
};
function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || "#6b7280";
}

// 지표 단위 문구를 보고 YoY(전년동월비)/MoM(전월비)/QoQ(전기비) 등을 자동으로 판별
function detectPeriodLabel(unit) {
  if (!unit) return "";
  if (unit.includes("전년동월비") || unit.includes("전년동기비") || unit.includes("YoY")) return "YoY";
  if (unit.includes("전월 대비") || unit.includes("전월비") || unit.includes("MoM")) return "MoM";
  if (unit.includes("전기 대비") || unit.includes("전기대비") || unit.includes("QoQ")) return "QoQ";
  return "";
}

// 중요도를 별로 표시 (상=★★★, 중=★★, 하=★)
const IMPORTANCE_STAR_COUNT = { 상: 3, 중: 2, 하: 1 };
function importanceStars(level) {
  return "★".repeat(IMPORTANCE_STAR_COUNT[level] || 1);
}

// 윈도우 일부 브라우저 환경에서는 국기 이모지(🇺🇸 등)가 "US" 같은 문자로 표시되는 경우가 있어,
// 폰트에 의존하지 않는 SVG 국기 아이콘을 직접 그려서 사용합니다.
const FLAG_SVGS = {
  미국: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#B22234"/>
    <g fill="#fff">
      <rect y="1.54" width="30" height="1.54"/><rect y="4.62" width="30" height="1.54"/>
      <rect y="7.69" width="30" height="1.54"/><rect y="10.77" width="30" height="1.54"/>
      <rect y="13.85" width="30" height="1.54"/><rect y="16.92" width="30" height="1.54"/>
    </g>
    <rect width="12" height="10.77" fill="#3C3B6E"/>
    <g fill="#fff">
      <circle cx="2" cy="1.8" r="0.7"/><circle cx="5" cy="1.8" r="0.7"/><circle cx="8" cy="1.8" r="0.7"/><circle cx="10.5" cy="1.8" r="0.7"/>
      <circle cx="3.5" cy="4" r="0.7"/><circle cx="6.5" cy="4" r="0.7"/><circle cx="9.5" cy="4" r="0.7"/>
      <circle cx="2" cy="6.2" r="0.7"/><circle cx="5" cy="6.2" r="0.7"/><circle cx="8" cy="6.2" r="0.7"/><circle cx="10.5" cy="6.2" r="0.7"/>
      <circle cx="3.5" cy="8.4" r="0.7"/><circle cx="6.5" cy="8.4" r="0.7"/><circle cx="9.5" cy="8.4" r="0.7"/>
    </g>
  </svg>`,
  유럽: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#003399"/>
    <g fill="#FFCC00">
      <circle cx="15" cy="3.5" r="1.1"/><circle cx="19.2" cy="5" r="1.1"/><circle cx="22" cy="8.7" r="1.1"/>
      <circle cx="22" cy="13.3" r="1.1"/><circle cx="19.2" cy="17" r="1.1"/><circle cx="15" cy="18.5" r="1.1"/>
      <circle cx="10.8" cy="17" r="1.1"/><circle cx="8" cy="13.3" r="1.1"/><circle cx="8" cy="8.7" r="1.1"/><circle cx="10.8" cy="5" r="1.1"/>
    </g>
  </svg>`,
  중국: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#DE2910"/>
    <g fill="#FFDE00">
      <polygon points="6,2 7.2,5.5 11,5.5 8,7.7 9.1,11.2 6,9 2.9,11.2 4,7.7 1,5.5 4.8,5.5"/>
      <circle cx="12.5" cy="2" r="0.9"/><circle cx="14.5" cy="4.8" r="0.9"/>
      <circle cx="14.3" cy="8" r="0.9"/><circle cx="12" cy="10.3" r="0.9"/>
    </g>
  </svg>`,
  일본: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#fff"/>
    <circle cx="15" cy="10" r="6" fill="#BC002D"/>
  </svg>`,
  한국: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#fff"/>
    <g transform="translate(15,10)">
      <circle r="5.2" fill="#C60C30"/>
      <path d="M0,-5.2 A2.6,2.6 0 1,1 0,0 A2.6,2.6 0 1,0 0,5.2 A5.2,5.2 0 0,1 0,-5.2 Z" fill="#003478"/>
    </g>
    <g stroke="#000" stroke-width="0.5">
      <line x1="1" y1="1.5" x2="4" y2="1.5"/><line x1="1" y1="2.5" x2="4" y2="2.5"/><line x1="1" y1="3.5" x2="4" y2="3.5"/>
      <line x1="26" y1="16.5" x2="29" y2="16.5"/><line x1="26" y1="17.5" x2="29" y2="17.5"/><line x1="26" y1="18.5" x2="29" y2="18.5"/>
    </g>
  </svg>`,
  호주: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#00247D"/>
    <g>
      <rect x="0" y="0" width="15" height="10" fill="#00247D"/>
      <path d="M0,0 L15,10 M15,0 L0,10" stroke="#fff" stroke-width="1.6"/>
      <path d="M0,0 L15,10 M15,0 L0,10" stroke="#C8102E" stroke-width="0.7"/>
      <path d="M7.5,0 V10 M0,5 H15" stroke="#fff" stroke-width="2.4"/>
      <path d="M7.5,0 V10 M0,5 H15" stroke="#C8102E" stroke-width="1"/>
    </g>
    <g fill="#fff">
      <circle cx="22" cy="4" r="0.8"/><circle cx="25.5" cy="7.5" r="1"/>
      <circle cx="24.5" cy="13" r="0.8"/><circle cx="20.5" cy="15.5" r="0.7"/><circle cx="18.5" cy="10.5" r="0.6"/>
    </g>
  </svg>`,
  영국: `<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
    <rect width="30" height="20" fill="#012169"/>
    <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" stroke-width="4"/>
    <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" stroke-width="2"/>
    <path d="M15,0 V20 M0,10 H30" stroke="#fff" stroke-width="6"/>
    <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" stroke-width="3.6"/>
  </svg>`,
};

// ----------------------------------------------------------------------------
// 카테고리 필터 렌더링
// ----------------------------------------------------------------------------
function renderCategoryFilter() {
  const container = document.getElementById("categoryFilter");
  const allCats = ["전체", ...CATEGORIES];
  container.innerHTML = allCats
    .map((cat) => {
      const color = cat === "전체" ? null : categoryColor(cat);
      const isActive = cat === state.category;
      const style = color
        ? isActive
          ? `background:${color};border-color:${color};color:#fff;`
          : `border-color:${color}66;color:${color};`
        : "";
      return `<button class="category-btn${isActive ? " active" : ""}" data-category="${cat}" style="${style}">${
        color ? `<span class="cat-dot" style="background:${color};box-shadow:0 0 0 1.5px ${isActive ? "#fff" : "transparent"}"></span>` : ""
      }${cat}</button>`;
    })
    .join("");

  container.querySelectorAll(".category-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.category;
      renderCategoryFilter();
      renderIndicatorGrid();
      renderCalendar();
    });
  });
}

// ----------------------------------------------------------------------------
// 탭 전환 (지표 사전 / 캘린더 / 통화정책)
// ----------------------------------------------------------------------------
// 홈 탭에는 카테고리 필터바가 필요 없음 (카테고리별 주요 지표 탭과 역할이 겹침)
function updateCategoryFilterVisibility() {
  const hidden = state.view === "home" || state.view === "ai";
  document.getElementById("categoryFilter").style.display = hidden ? "none" : "";
}

function setupViewTabs() {
  updateCategoryFilterVisibility();
  document.querySelectorAll(".view-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      document.querySelectorAll(".view-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("view-home").classList.toggle("active", state.view === "home");
      document.getElementById("view-dictionary").classList.toggle("active", state.view === "dictionary");
      document.getElementById("view-calendar").classList.toggle("active", state.view === "calendar");
      document.getElementById("view-monetary").classList.toggle("active", state.view === "monetary");
      document.getElementById("view-ai").classList.toggle("active", state.view === "ai");
      updateCategoryFilterVisibility();
      if (state.view === "monetary") renderMonetaryView();
    });
  });
}

// ----------------------------------------------------------------------------
// 지표 사전 카드 렌더링
// ----------------------------------------------------------------------------
// 지표 사전 목록 정렬 순서: 나라 → 카테고리 → 중요도(높은순) → 지표명(가나다)
const COUNTRY_ORDER = ["한국", "미국", "유럽", "중국", "일본", "호주"];
function sortedIndicators(list) {
  return [...list].sort((a, b) => {
    const countryDiff = COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country);
    if (countryDiff !== 0) return countryDiff;
    const categoryDiff = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    const importanceDiff = (IMPORTANCE_STAR_COUNT[b.importance] || 0) - (IMPORTANCE_STAR_COUNT[a.importance] || 0);
    if (importanceDiff !== 0) return importanceDiff;
    return a.name.localeCompare(b.name, "ko");
  });
}

function getFilteredIndicators() {
  const list = state.category === "전체" ? indicators : indicators.filter((ind) => ind.category === state.category);
  return sortedIndicators(list);
}

function renderIndicatorGrid() {
  const grid = document.getElementById("indicatorGrid");
  const list = getFilteredIndicators();

  if (list.length === 0) {
    grid.innerHTML = `<div class="no-result">해당 카테고리에 지표가 없습니다.</div>`;
    return;
  }

  grid.innerHTML = list
    .map((ind) => {
      const color = categoryColor(ind.category);
      return `
      <div class="indicator-row" data-id="${ind.id}">
        <div class="row-flag">${flagIcon(ind.country)}</div>
        <span class="badge badge-category" style="background:${color}26;color:${color}">${ind.category}</span>
        <span class="badge badge-importance-star" title="중요도 ${ind.importance}">${importanceStars(ind.importance)}</span>
        <div class="row-main">
          <span class="row-name">${ind.name}</span>
          <span class="row-sub">${ind.country} · ${ind.institution}</span>
        </div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".indicator-row").forEach((card) => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });
}

// ----------------------------------------------------------------------------
// 캘린더 렌더링 (월간 보기, 일요일 시작 6주 그리드)
// ----------------------------------------------------------------------------
function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const matrixStart = getCalendarMatrixStart(state.monthStart);
  const today = new Date();
  const targetMonth = state.monthStart.getMonth();

  document.getElementById("monthLabel").textContent =
    `${state.monthStart.getFullYear()}년 ${state.monthStart.getMonth() + 1}월`;

  const eventImportance = (ev) => (ev.raw ? ev.importance : indicatorById.get(ev.indicatorId)?.importance);
  const filteredEvents = calendarEvents.filter((ev) => {
    if (state.category !== "전체" && indicatorById.get(ev.indicatorId)?.category !== state.category) return false;
    if (state.calImportance !== "전체" && eventImportance(ev) !== state.calImportance) return false;
    return true;
  });

  const todayYmd = formatYmd(today);

  let html = WEEKDAY_LABELS.map((w) => `<div class="calendar-weekday-label">${w}</div>`).join("");

  for (let i = 0; i < 42; i++) {
    const day = new Date(matrixStart);
    day.setDate(day.getDate() + i);
    const ymd = formatYmd(day);
    const isOutside = day.getMonth() !== targetMonth;
    const dayEvents = filteredEvents.filter((ev) => ev.date === ymd);

    const eventsHtml = dayEvents
      .map((ev) => {
        const status = ev.date < todayYmd ? "past" : ev.date === todayYmd ? "today" : "upcoming";
        const statusLabel = status === "past" ? "완료" : status === "today" ? "오늘" : "예정";
        if (ev.raw) {
          return `
          <button class="calendar-event importance-${ev.importance} status-${status}" data-raw="${ev.id}" title="${ev.country} · ${ev.name}">
            <span class="event-status-badge status-${status}">${statusLabel}</span><span class="event-time">${ev.timeKST}</span>
            <span class="event-country">${flagIcon(ev.country)}${ev.country}</span> ${ev.name}
          </button>`;
        }
        const ind = indicatorById.get(ev.indicatorId);
        if (!ind) return "";
        return `
          <button class="calendar-event importance-${ind.importance} status-${status}" data-id="${ind.id}" title="${ind.country} · ${ind.name}">
            <span class="event-status-badge status-${status}">${statusLabel}</span><span class="event-time">${ev.timeKST}</span>
            <span class="event-country">${flagIcon(ind.country)}${ind.country}</span> ${ind.name}
          </button>`;
      })
      .join("");

    html += `
      <div class="calendar-day${isOutside ? " is-outside" : ""}${isSameDate(day, today) ? " is-today" : ""}">
        <div class="day-label">${day.getDate()}</div>
        ${eventsHtml}
      </div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".calendar-event").forEach((btn) => {
    btn.addEventListener("click", () =>
      btn.dataset.raw ? openRawEventModal(btn.dataset.raw) : openModal(btn.dataset.id)
    );
  });
}

function setupCalendarNav() {
  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    state.monthStart = new Date(state.monthStart.getFullYear(), state.monthStart.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    state.monthStart = new Date(state.monthStart.getFullYear(), state.monthStart.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("thisMonthBtn").addEventListener("click", () => {
    state.monthStart = getMonthStart(new Date());
    renderCalendar();
  });
  document.querySelectorAll("#importanceFilter .imp-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.calImportance = btn.dataset.imp;
      document.querySelectorAll("#importanceFilter .imp-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderCalendar();
    });
  });
}

// ----------------------------------------------------------------------------
// 통화정책 탭: 국가별 중앙은행 금리 추이 + 시장 전망을 한 화면에 정리
// ----------------------------------------------------------------------------
const MONETARY_IDS = [
  "kr_bok_meeting",
  "us_fomc_meeting",
  "eu_ecb_meeting",
  "jp_boj_meeting",
  "au_rba_meeting",
  "cn_pboc_lpr",
];
// 각 중앙은행의 의사록(요지) 공개 지표 id (있는 경우에만 카드에 링크로 표시)
const MONETARY_MINUTES_IDS = {
  us_fomc_meeting: "us_fomc_minutes",
  eu_ecb_meeting: "eu_ecb_minutes",
  jp_boj_meeting: "jp_boj_minutes",
  kr_bok_meeting: "kr_bok_minutes",
  au_rba_meeting: "au_rba_minutes",
};

// 금리선물 시장이 반영하는 다음 회의 확률(예: CME FedWatch류)을 막대로 표시
function renderCmeProbability(cme) {
  if (!cme) return "";
  const rows = cme.outcomes
    .map(
      (o) => `
      <div class="cme-row">
        <span class="cme-row-label">${o.label}</span>
        <div class="cme-row-track"><div class="cme-row-bar" style="width:${Math.max(o.pct, 1)}%"></div></div>
        <span class="cme-row-pct">${o.pct}%</span>
      </div>`
    )
    .join("");
  return `
    <div class="monetary-cme">
      <strong>다음 회의(${cme.meetingDate}) 금리선물 시장 확률</strong>
      ${rows}
      <div class="cme-meta">${cme.asOf} 기준 · <a href="${cme.source.url}" target="_blank" rel="noopener noreferrer">${cme.source.title}</a></div>
    </div>`;
}

// 연준 점도표(SEP) 중간값이 회차별로 어떻게 바뀌어 왔는지 표로 표시
function renderDotPlotHistory(dotPlotHistory, source) {
  if (!dotPlotHistory || !dotPlotHistory.length) return "";
  const rows = dotPlotHistory
    .map(
      (d) => `
      <tr>
        <td>${d.sepDate}</td>
        <td>${d.end2026 ?? "-"}</td>
        <td>${d.end2027 ?? "-"}</td>
        <td>${d.end2028 ?? "-"}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="monetary-dotplot">
      <strong>연준 점도표(SEP) 중간값 추이</strong>
      <table class="history-table">
        <thead><tr><th>SEP 발표일</th><th>2026년말</th><th>2027년말</th><th>2028년말</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${source ? `<div class="cme-meta">출처: <a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title}</a></div>` : ""}
    </div>`;
}

function renderMonetaryView() {
  const grid = document.getElementById("monetaryGrid");

  grid.innerHTML = MONETARY_IDS.map((id) => {
    const ind = indicatorById.get(id);
    if (!ind) return "";
    const latest = (ind.history || [])[0];
    const nextEvent = getNextUpcomingEvent(id);
    const minutesInd = MONETARY_MINUTES_IDS[id] ? indicatorById.get(MONETARY_MINUTES_IDS[id]) : null;

    return `
      <div class="monetary-card">
        <div class="monetary-card-head">
          <div class="monetary-card-title">
            ${flagIcon(ind.country)}
            <div>
              <h3>${ind.country}</h3>
              <div class="monetary-card-sub">${ind.institution}</div>
            </div>
          </div>
          <div class="monetary-current-rate">
            <div class="rate-label">현재</div>
            <div class="rate-value">${latest ? latest.actual : "확인 필요"}</div>
          </div>
        </div>

        <div class="monetary-chart" data-id="${id}"></div>

        ${
          ind.marketOutlook
            ? `<div class="monetary-outlook"><strong>시장 전망</strong><p>${ind.marketOutlook}</p></div>`
            : `<div class="monetary-outlook monetary-outlook-empty">아직 시장 전망 정보를 조사하지 못했습니다.</div>`
        }
        ${renderCmeProbability(ind.cmeProbability)}
        ${renderDotPlotHistory(ind.dotPlotHistory, ind.dotPlotSource)}

        <div class="monetary-card-footer">
          ${
            nextEvent
              ? `<span class="badge-mini">다음 회의 ${nextEvent.date}</span>`
              : ""
          }
          <button class="monetary-detail-btn" data-id="${id}">회의 상세 →</button>
          ${
            minutesInd
              ? `<button class="monetary-detail-btn" data-id="${minutesInd.id}">의사록 →</button>`
              : ""
          }
        </div>
      </div>`;
  }).join("");

  MONETARY_IDS.forEach((id) => {
    const ind = indicatorById.get(id);
    if (!ind) return;
    const container = grid.querySelector(`.monetary-chart[data-id="${id}"]`);
    if (container) renderHistoryChart(container, buildFullHistory(ind));
  });

  grid.querySelectorAll(".monetary-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.id));
  });
}

// ----------------------------------------------------------------------------
// 시드 기반 난수 (같은 지표는 새로고침해도 항상 같은 모양의 예시 그래프가 나오도록)
// ----------------------------------------------------------------------------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRandom(seedStr) {
  return mulberry32(xmur3(seedStr)());
}

// 문자열에서 대표 숫자 하나를 뽑아냄 ("2.7%" → 2.7, "4.25~4.50%" → 4.375, "20.6만 명" → 20.6)
function parseNumeric(str) {
  if (typeof str !== "string") return NaN;
  const matches = str.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return NaN;
  if (matches.length >= 2 && str.includes("~")) {
    return (Number(matches[0]) + Number(matches[1])) / 2;
  }
  return Number(matches[0]);
}

// ----------------------------------------------------------------------------
// 2020년~현재 시계열 생성: data.js에 직접 입력된 history(최근 실측치)는 그대로 쓰고,
// 그보다 과거 구간(2020-01 ~ 최초 입력일 이전)은 예시용 합성 데이터로 채워 넣음
// ----------------------------------------------------------------------------
function buildFullHistory(ind) {
  const authored = (ind.history || [])
    .map((h) => ({
      date: h.date,
      actual: parseNumeric(h.actual),
      consensus: ind.hasConsensus ? parseNumeric(h.consensus) : NaN,
      synthetic: false,
    }))
    .filter((h) => !isNaN(h.actual))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (authored.length === 0) return [];

  const stepDays = ind.frequency.includes("분기") ? 91 : ind.frequency.includes("연 8회") ? 45 : 30;
  const rand = seededRandom(ind.id);
  const volatility = Math.max(Math.abs(authored[0].actual) * 0.04, 0.08);
  const startLimit = new Date("2020-01-01");

  const series = [...authored];
  let cursorDate = new Date(authored[0].date);
  let cursorValue = authored[0].actual;

  while (true) {
    cursorDate = new Date(cursorDate);
    cursorDate.setDate(cursorDate.getDate() - stepDays);
    if (cursorDate < startLimit) break;
    const delta = (rand() - 0.5) * 2 * volatility;
    cursorValue = Math.round((cursorValue - delta) * 100) / 100;
    const consensusValue = ind.hasConsensus
      ? Math.round((cursorValue + (rand() - 0.5) * volatility * 0.6) * 100) / 100
      : NaN;
    series.unshift({
      date: formatYmd(cursorDate),
      actual: cursorValue,
      consensus: consensusValue,
      synthetic: true,
    });
  }

  return series;
}

// ----------------------------------------------------------------------------
// SVG 선 그래프 렌더링 (실제치 = 선, 컨센서스 = 점)
// ----------------------------------------------------------------------------
function renderHistoryChart(container, series) {
  if (!series.length) {
    container.innerHTML = `<p class="chart-empty">차트로 표시할 수치형 데이터가 없는 항목입니다 (예: 의사록 공개처럼 숫자로 표현되지 않는 이벤트).</p>`;
    return;
  }

  const width = 560;
  const height = 190;
  const padding = 26;

  const allValues = [];
  series.forEach((p) => {
    allValues.push(p.actual);
    if (!isNaN(p.consensus)) allValues.push(p.consensus);
  });
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const rangeV = maxV - minV || 1;

  const n = series.length;
  const xStep = (width - padding * 2) / Math.max(n - 1, 1);
  const xAt = (i) => padding + i * xStep;
  const yAt = (v) => height - padding - ((v - minV) / rangeV) * (height - padding * 2);

  const linePoints = series.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.actual).toFixed(1)}`).join(" ");

  const dots = series
    .map((p, i) =>
      !isNaN(p.consensus)
        ? `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.consensus).toFixed(1)}" r="2.6" class="consensus-dot"><title>${p.date} 컨센서스: ${p.consensus}</title></circle>`
        : ""
    )
    .join("");

  let lastYear = "";
  const yearLabels = series
    .map((p, i) => {
      const year = p.date.slice(0, 4);
      if (year !== lastYear) {
        lastYear = year;
        return `<text x="${xAt(i).toFixed(1)}" y="${height - 6}" class="chart-axis-label">${year}</text>`;
      }
      return "";
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="history-chart-svg" preserveAspectRatio="none">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-gridline" />
      <polyline points="${linePoints}" class="chart-line" />
      ${dots}
      ${yearLabels}
      <text x="${padding}" y="12" class="chart-axis-label">최고 ${maxV}</text>
      <text x="${padding}" y="${height - padding - 4}" class="chart-axis-label">최저 ${minV}</text>
    </svg>
    <div class="chart-legend">
      <span class="legend-line"></span> 실제치(선)
      <span class="legend-dot"></span> 컨센서스(점)
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 지표 상세 모달 (지표 사전 카드 / 캘린더 이벤트 공통 사용)
// ----------------------------------------------------------------------------
const STANCE_LABEL = { hawkish: "매파적", dovish: "비둘기적", neutral: "중립" };

function renderOutlookSources(sources) {
  if (!sources || !sources.length) return "";
  const links = sources
    .map((s) => `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a>`)
    .join(" · ");
  return `<div class="outlook-sources">출처: ${links}</div>`;
}

function renderAnalystViews(views) {
  if (!views || !views.length) return "";
  const rows = views
    .map(
      (v) => `
      <div class="analyst-view-row">
        <span class="stance-badge stance-${v.stance}">${STANCE_LABEL[v.stance] || v.stance}</span>
        <strong>${v.firm}</strong>
        <p>${v.view}</p>
      </div>`
    )
    .join("");
  return `<h4>기관별 시각 (매파·비둘기파)</h4><div class="analyst-views">${rows}</div>`;
}

function renderSpeechTimeline(statements) {
  if (!statements || !statements.length) return "";
  const rows = statements
    .map(
      (s) => `
      <div class="speech-row">
        <div class="speech-date">${s.date}</div>
        <div class="speech-body"><strong>${s.speaker}</strong><p>${s.summary}</p></div>
      </div>`
    )
    .join("");
  return `<h4>최근 주요 발언 (최신순)</h4><div class="speech-timeline">${rows}</div>`;
}

function getNextUpcomingEvent(indicatorId) {
  const todayYmd = formatYmd(new Date());
  return calendarEvents
    .filter((ev) => ev.indicatorId === indicatorId && ev.date >= todayYmd)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

function openModal(indicatorId) {
  const ind = indicatorById.get(indicatorId);
  if (!ind) return;

  const historyRows = [...(ind.history || [])]
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // 최근순
    .slice(0, 24)
    .map(
      (h) => `
      <tr>
        <td>${h.date}</td>
        <td>${h.consensus ?? "-"}</td>
        <td>${h.actual ?? "-"}</td>
      </tr>`
    )
    .join("");

  const nextEvent = getNextUpcomingEvent(ind.id);
  const upcomingRow = nextEvent
    ? `
      <tr class="upcoming-row">
        <td>${nextEvent.date} <span class="badge-mini">발표 예정</span></td>
        <td>${ind.hasConsensus ? ind.nextConsensus || "아직 컨센서스 미확인" : "-"}</td>
        <td>-</td>
      </tr>`
    : "";

  const periodLabel = detectPeriodLabel(ind.unit);

  document.getElementById("modalContent").innerHTML = `
    <h2>${ind.name}</h2>
    <div class="modal-name-en">${ind.nameEn}</div>
    <div class="modal-badges">
      <span class="badge badge-category" style="background:${categoryColor(ind.category)}26;color:${categoryColor(ind.category)}">${ind.category}</span>
      <span class="badge badge-importance-star" title="중요도 ${ind.importance}">${importanceStars(ind.importance)}</span>
    </div>
    <table class="info-table">
      <tr><td class="info-label">국가</td><td>${flagIcon(ind.country)} ${ind.country}</td></tr>
      <tr><td class="info-label">발표기관</td><td>${
        ind.officialUrl
          ? `<a href="${ind.officialUrl}" target="_blank" rel="noopener noreferrer">${ind.institution} ↗</a>`
          : ind.institution
      }</td></tr>
      <tr><td class="info-label">단위</td><td>${ind.unit}</td></tr>
      <tr><td class="info-label">발표주기</td><td>${ind.frequency}</td></tr>
      <tr><td class="info-label">발표시기</td><td>${ind.releasePattern}</td></tr>
    </table>
    <div class="description-box">${ind.description}</div>
    ${
      ind.marketOutlook
        ? `<h4>시장은 어떻게 보고 있나</h4><div class="outlook-box">${ind.marketOutlook}</div>${renderOutlookSources(ind.outlookSources)}`
        : ""
    }
    ${renderAnalystViews(ind.analystViews)}
    ${renderSpeechTimeline(ind.officialStatements)}

    <h4>2020년 ~ 현재 추이</h4>
    <p class="chart-disclaimer">${
      ind._bbgEnriched
        ? `✅ 블룸버그 실측 데이터입니다 (티커 ${ind._bbgTicker}, 2026-07-22 기준). 파란 선은 실제치, 주황 점은 시장 예상치입니다.`
        : "⚠️ 최근 일부 시점을 제외한 과거 구간은 화면 확인용으로 자동 생성된 예시(합성) 데이터입니다. 실제 통계가 아닙니다."
    }</p>
    <div id="historyChartContainer"></div>

    <h4>최근 발표 내역 상세 ${ind.hasConsensus ? "" : "(컨센서스 없음)"}${periodLabel ? ` — 값 기준: ${periodLabel}` : ""}</h4>
    <table class="history-table">
      <thead>
        <tr><th>날짜</th><th>컨센서스(예상치)${periodLabel ? ` (${periodLabel})` : ""}</th><th>실제치${periodLabel ? ` (${periodLabel})` : ""}</th></tr>
      </thead>
      <tbody>
        ${upcomingRow}
        ${historyRows || `<tr><td colspan="3">등록된 과거 내역이 없습니다.</td></tr>`}
      </tbody>
    </table>
  `;

  const fullSeries = buildFullHistory(ind);
  renderHistoryChart(document.getElementById("historyChartContainer"), fullSeries);

  document.getElementById("detailModal").classList.add("active");
}

// 지표사전과 연결되지 않는 독립 캘린더 이벤트용 간단 상세 모달
function openRawEventModal(id) {
  const ev = rawEventById.get(id);
  if (!ev) return;
  const todayYmd = formatYmd(new Date());
  const status = ev.date < todayYmd ? "past" : ev.date === todayYmd ? "today" : "upcoming";
  const statusLabel = status === "past" ? "발표 완료" : status === "today" ? "오늘 발표" : "발표 예정";
  const rows = [
    ["실제치", ev.actual],
    ["컨센서스(예상)", ev.consensus],
    ev.forecast ? ["Forecast", ev.forecast] : null,
    ["이전치", ev.previous],
  ]
    .filter(Boolean)
    .map(([label, val]) => `<tr><td class="info-label">${label}</td><td>${val ?? "-"}</td></tr>`)
    .join("");

  document.getElementById("modalContent").innerHTML = `
    <h2>${ev.name}</h2>
    <div class="modal-badges">
      <span class="badge badge-importance-star" title="중요도 ${ev.importance}">${importanceStars(ev.importance)}</span>
      <span class="event-status-badge status-${status}">${statusLabel}</span>
    </div>
    <table class="info-table">
      <tr><td class="info-label">국가</td><td>${flagIcon(ev.country)} ${ev.country}</td></tr>
      <tr><td class="info-label">발표일시</td><td>${ev.date} ${ev.timeKST} (KST)</td></tr>
      ${rows}
    </table>
    <div class="description-box">인베스팅닷컴 기준 2026년 7월 경제 캘린더 데이터입니다. 이 항목은 지표사전에 등록되지 않아 시계열 차트는 제공되지 않습니다.</div>
  `;
  document.getElementById("detailModal").classList.add("active");
}

function closeModal() {
  document.getElementById("detailModal").classList.remove("active");
}

function setupModal() {
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// ----------------------------------------------------------------------------
// 홈 탭: 국채금리 현황판 (1주/1개월/1년 전 대비 변화)
// ----------------------------------------------------------------------------
// 시계열(series, 최신 포인트 제외)에서 목표일에 가장 가까운 포인트를 찾되,
// 허용 오차(일)를 벗어나면 null 반환 — 국가별로 데이터 촘촘함이 달라서(한국은 일별, 미국/일본은 분기 근처 3개 점) 억지로 먼 시점과 비교하지 않도록 함
function findNearestPoint(series, targetYmd, toleranceDays) {
  const targetTime = new Date(targetYmd).getTime();
  let best = null;
  let bestDiff = Infinity;
  series.forEach((p) => {
    const diff = Math.abs(new Date(p.date).getTime() - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  });
  if (best && bestDiff <= toleranceDays * 86400000) return best;
  return null;
}

function computeBondChanges(series) {
  const latest = series[series.length - 1];
  const history = series.slice(0, -1);
  const latestDate = new Date(latest.date);

  const wDate = new Date(latestDate); wDate.setDate(wDate.getDate() - 7);
  const mDate = new Date(latestDate); mDate.setDate(mDate.getDate() - 30);
  const yDate = new Date(latestDate); yDate.setFullYear(yDate.getFullYear() - 1);

  const wPoint = findNearestPoint(history, formatYmd(wDate), 4);
  const mPoint = findNearestPoint(history, formatYmd(mDate), 10);
  const yPoint = findNearestPoint(history, formatYmd(yDate), 20);

  return {
    latest,
    w: wPoint ? latest.value - wPoint.value : null,
    m: mPoint ? latest.value - mPoint.value : null,
    y: yPoint ? latest.value - yPoint.value : null,
  };
}

// %p(퍼센트포인트) 대신 채권시장 관례인 bp(베이시스포인트, 1%p = 100bp)로 표시
function bondChangeBadge(label, diff) {
  if (diff === null) {
    return `<div class="bond-change-item"><span class="bc-label">${label}</span><span class="bc-value flat">데이터 없음</span></div>`;
  }
  const dir = diff > 0.005 ? "up" : diff < -0.005 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "-";
  const bp = Math.round(Math.abs(diff) * 100);
  return `<div class="bond-change-item"><span class="bc-label">${label}</span><span class="bc-value ${dir}">${arrow} ${bp}bp</span></div>`;
}

function getAllBondChanges() {
  return bondYields.map((b) => ({ id: b.id, country: b.country, ...computeBondChanges(b.series) }));
}

function renderBondCards() {
  const grid = document.getElementById("bondCardGrid");
  const changesList = getAllBondChanges();
  grid.innerHTML = bondYields
    .map((b, i) => {
      const { latest, w, m, y } = changesList[i];
      return `
      <div class="bond-card" data-id="${b.id}">
        <div class="bond-card-head">
          ${flagIcon(b.country)}
          <span class="bond-country">${b.country}</span>
        </div>
        <div class="bond-name">${b.name}</div>
        <div class="bond-value">${latest.value.toFixed(2)}%</div>
        <div class="bond-change-grid">
          ${bondChangeBadge("1주", w)}
          ${bondChangeBadge("1개월", m)}
          ${bondChangeBadge("1년", y)}
        </div>
        <div class="bond-asof">기준일: ${latest.date}</div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".bond-card").forEach((card) => {
    card.addEventListener("click", () => openBondModal(card.dataset.id));
  });
}

// 국채금리 카드 클릭 시 지표 상세 모달과 동일한 모달을 재사용해 설명 + 과거 추이 그래프를 보여줌
function openBondModal(bondId) {
  const b = bondYieldById.get(bondId);
  if (!b) return;

  const { latest, w, m, y } = computeBondChanges(b.series);
  const sparseNote =
    b.series.length <= 5
      ? `<p class="chart-disclaimer">⚠️ 이 국가는 무료 공식 API를 찾지 못해 참고용 시점 ${b.series.length}개만 확보되어 있습니다 (합성 데이터는 아니며, 실제 조회한 값입니다). 더 촘촘한 데이터를 원하시면 인포맥스/블룸버그에서 내보낸 엑셀을 <code>data-imports</code> 폴더에 넣어주세요.</p>`
      : "";

  const recentRows = [...b.series]
    .reverse()
    .slice(0, 20)
    .map((p) => `<tr><td>${p.date}</td><td>${p.value.toFixed(3)}%</td></tr>`)
    .join("");

  document.getElementById("modalContent").innerHTML = `
    <h2>${b.name}</h2>
    <div class="modal-name-en">${b.nameEn}</div>
    <table class="info-table">
      <tr><td class="info-label">국가</td><td>${flagIcon(b.country)} ${b.country}</td></tr>
      <tr><td class="info-label">발표기관</td><td>${
        b.officialUrl
          ? `<a href="${b.officialUrl}" target="_blank" rel="noopener noreferrer">${b.institution} ↗</a>`
          : b.institution
      }</td></tr>
      <tr><td class="info-label">단위</td><td>${b.unit}</td></tr>
      <tr><td class="info-label">기준일 현재값</td><td>${latest.value.toFixed(3)}%</td></tr>
    </table>
    <div class="description-box">${b.description || ""}</div>

    <div class="bond-change-grid" style="margin:12px 0 18px;">
      ${bondChangeBadge("1주", w)}
      ${bondChangeBadge("1개월", m)}
      ${bondChangeBadge("1년", y)}
    </div>

    <h4>과거 추이 (보유 실데이터 전체 기간)</h4>
    ${sparseNote}
    <div id="historyChartContainer"></div>

    <h4>최근 데이터 상세</h4>
    <table class="history-table">
      <thead><tr><th>날짜</th><th>값</th></tr></thead>
      <tbody>${recentRows || `<tr><td colspan="2">등록된 데이터가 없습니다.</td></tr>`}</tbody>
    </table>
  `;

  const chartSeries = b.series.map((p) => ({ date: p.date, actual: p.value, consensus: NaN }));
  renderHistoryChart(document.getElementById("historyChartContainer"), chartSeries);

  document.getElementById("detailModal").classList.add("active");
}

// ----------------------------------------------------------------------------
// 홈 탭: 글로벌 지수·원자재 카드 (코스피/S&P500/WTI)
// 국채금리와 계산 방식은 같지만(1주/1개월/1년 전 대비), 가격 자산이라 bp가 아니라 등락률(%)로 표시합니다.
// ----------------------------------------------------------------------------
function computeAssetChanges(series) {
  const latest = series[series.length - 1];
  const history = series.slice(0, -1);
  const latestDate = new Date(latest.date);

  const wDate = new Date(latestDate); wDate.setDate(wDate.getDate() - 7);
  const mDate = new Date(latestDate); mDate.setDate(mDate.getDate() - 30);
  const yDate = new Date(latestDate); yDate.setFullYear(yDate.getFullYear() - 1);

  const wPoint = findNearestPoint(history, formatYmd(wDate), 4);
  const mPoint = findNearestPoint(history, formatYmd(mDate), 10);
  const yPoint = findNearestPoint(history, formatYmd(yDate), 20);

  const pctChange = (point) => (point ? ((latest.value - point.value) / point.value) * 100 : null);

  return {
    latest,
    w: pctChange(wPoint),
    m: pctChange(mPoint),
    y: pctChange(yPoint),
  };
}

function assetChangeBadge(label, pct) {
  if (pct === null) {
    return `<div class="bond-change-item"><span class="bc-label">${label}</span><span class="bc-value flat">데이터 없음</span></div>`;
  }
  const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "-";
  return `<div class="bond-change-item"><span class="bc-label">${label}</span><span class="bc-value ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}%</span></div>`;
}

// 카드 클릭용 기간 배지: 1주/1개월/1년 등락률을 보여주면서 동시에 "이 기간의 그래프를 보여줘" 버튼 역할도 함
function assetPeriodBadge(assetId, label, pct, currentPeriod) {
  const isActive = label === currentPeriod;
  const valueHtml =
    pct === null
      ? `<span class="bc-value flat">데이터 없음</span>`
      : (() => {
          const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
          const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "-";
          return `<span class="bc-value ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
        })();
  return `<div class="bond-change-item asset-period-btn${isActive ? " active" : ""}" data-asset="${assetId}" data-period="${label}"><span class="bc-label">${label}</span>${valueHtml}</div>`;
}

// 선택된 기간(1주/1개월/1년)에 해당하는 최근 구간만 잘라냄
function filterSeriesByPeriod(series, period) {
  const latest = series[series.length - 1];
  const cutoff = new Date(latest.date);
  if (period === "1주") cutoff.setDate(cutoff.getDate() - 7);
  else if (period === "1개월") cutoff.setDate(cutoff.getDate() - 30);
  else cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffYmd = formatYmd(cutoff);
  return series.filter((p) => p.date >= cutoffYmd);
}

// 카드 안에 넣는 미니 차트: 실제 날짜 간격에 비례해 그리고, 최고/최저값(Y축)과 시작~끝 날짜(X축)를 함께 표시
function renderAssetCardChart(container, series) {
  if (!series || series.length < 2) {
    container.innerHTML = `<p class="asset-chart-empty">이 기간에는 표시할 데이터가 부족합니다.</p>`;
    return;
  }
  const width = 240, height = 70, padding = 4;
  const values = series.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1;
  const times = series.map((p) => new Date(p.date).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = maxT - minT || 1;
  const xAt = (t) => padding + ((t - minT) / rangeT) * (width - padding * 2);
  const yAt = (v) => height - padding - ((v - minV) / rangeV) * (height - padding * 2);
  const points = series
    .map((p) => `${xAt(new Date(p.date).getTime()).toFixed(1)},${yAt(p.value).toFixed(1)}`)
    .join(" ");
  const dir = values[values.length - 1] >= values[0] ? "up" : "down";
  const fmt = (v) => v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

  container.innerHTML = `
    <div class="asset-chart-yaxis"><span>${fmt(maxV)}</span><span>${fmt(minV)}</span></div>
    <svg viewBox="0 0 ${width} ${height}" class="asset-chart-svg" preserveAspectRatio="none">
      <polyline points="${points}" class="asset-chart-line ${dir}" />
    </svg>
    <div class="asset-chart-xaxis"><span>${series[0].date}</span><span>${series[series.length - 1].date}</span></div>
  `;
}

function renderMarketAssetCards() {
  const grid = document.getElementById("assetCardGrid");
  if (!grid) return;
  grid.innerHTML = marketAssets
    .map((a) => {
      const { latest, w, m, y } = computeAssetChanges(a.series);
      const valueLabel =
        a.unit === "달러/배럴" ? `$${latest.value.toFixed(2)}` : latest.value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
      const period = state.assetPeriod[a.id] || "1개월";
      return `
      <div class="bond-card asset-card" data-id="${a.id}">
        <div class="bond-card-head">
          ${flagIcon(a.country)}
          <span class="bond-country">${a.name}</span>
        </div>
        <div class="bond-value">${valueLabel}</div>
        <div class="asset-chart-container" data-chart-id="${a.id}"></div>
        <div class="bond-change-grid">
          ${assetPeriodBadge(a.id, "1주", w, period)}
          ${assetPeriodBadge(a.id, "1개월", m, period)}
          ${assetPeriodBadge(a.id, "1년", y, period)}
        </div>
        <div class="bond-asof">기준일: ${latest.date}</div>
      </div>`;
    })
    .join("");

  marketAssets.forEach((a) => {
    const period = state.assetPeriod[a.id] || "1개월";
    const container = grid.querySelector(`.asset-chart-container[data-chart-id="${a.id}"]`);
    if (container) renderAssetCardChart(container, filterSeriesByPeriod(a.series, period));
  });

  grid.querySelectorAll(".asset-period-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.assetPeriod[btn.dataset.asset] = btn.dataset.period;
      renderMarketAssetCards();
    });
  });

  grid.querySelectorAll(".asset-card").forEach((card) => {
    card.addEventListener("click", () => openMarketAssetModal(card.dataset.id));
  });
}

function openMarketAssetModal(assetId) {
  const a = marketAssetById.get(assetId);
  if (!a) return;

  const { latest, w, m, y } = computeAssetChanges(a.series);
  const sparseNote =
    a.series.length <= 8
      ? `<p class="chart-disclaimer">⚠️ 아직 참고용 시점 ${a.series.length}개만 확보되어 있습니다 (합성 데이터는 아니며, 실제 조회한 값입니다). 더 촘촘한 데이터를 원하시면 인포맥스/블룸버그에서 내보낸 엑셀을 <code>data-imports</code> 폴더에 넣어주세요.</p>`
      : "";

  const recentRows = [...a.series]
    .reverse()
    .slice(0, 20)
    .map((p) => `<tr><td>${p.date}</td><td>${p.value.toLocaleString("ko-KR")}</td></tr>`)
    .join("");

  document.getElementById("modalContent").innerHTML = `
    <h2>${a.name}</h2>
    <div class="modal-name-en">${a.nameEn}</div>
    <table class="info-table">
      <tr><td class="info-label">국가</td><td>${flagIcon(a.country)} ${a.country}</td></tr>
      <tr><td class="info-label">발표기관</td><td>${
        a.officialUrl
          ? `<a href="${a.officialUrl}" target="_blank" rel="noopener noreferrer">${a.institution} ↗</a>`
          : a.institution
      }</td></tr>
      <tr><td class="info-label">단위</td><td>${a.unit}</td></tr>
      <tr><td class="info-label">기준일 현재값</td><td>${latest.value.toLocaleString("ko-KR")}</td></tr>
    </table>
    <div class="description-box">${a.description || ""}</div>

    <div class="bond-change-grid" style="margin:12px 0 18px;">
      ${assetChangeBadge("1주", w)}
      ${assetChangeBadge("1개월", m)}
      ${assetChangeBadge("1년", y)}
    </div>

    <h4>과거 추이 (보유 실데이터 전체 기간)</h4>
    ${sparseNote}
    <div id="historyChartContainer"></div>

    <h4>최근 데이터 상세</h4>
    <table class="history-table">
      <thead><tr><th>날짜</th><th>값</th></tr></thead>
      <tbody>${recentRows || `<tr><td colspan="2">등록된 데이터가 없습니다.</td></tr>`}</tbody>
    </table>
  `;

  const chartSeries = a.series.map((p) => ({ date: p.date, actual: p.value, consensus: NaN }));
  renderHistoryChart(document.getElementById("historyChartContainer"), chartSeries);

  document.getElementById("detailModal").classList.add("active");
}

// ----------------------------------------------------------------------------
// 홈 탭: 주요국 기준금리(정책금리) 카드 — 국채금리 카드와 완전히 같은 계산/표시 방식(bp)을 그대로 재사용
// ----------------------------------------------------------------------------
function renderPolicyRateCards() {
  const grid = document.getElementById("policyRateCardGrid");
  if (!grid) return;
  grid.innerHTML = policyRates
    .map((r) => {
      const { latest } = computeBondChanges(r.series);
      return `
      <div class="bond-card" data-id="${r.id}">
        <div class="bond-card-head">
          ${flagIcon(r.country)}
          <span class="bond-country">${r.country}</span>
        </div>
        <div class="bond-name">${r.name}</div>
        <div class="bond-value">${latest.value.toFixed(2)}%</div>
        <div class="asset-chart-container" data-chart-id="${r.id}"></div>
        <div class="bond-asof">기준일: ${latest.date}</div>
      </div>`;
    })
    .join("");

  policyRates.forEach((r) => {
    const container = grid.querySelector(`.asset-chart-container[data-chart-id="${r.id}"]`);
    if (container) renderAssetCardChart(container, r.series);
  });

  grid.querySelectorAll(".bond-card").forEach((card) => {
    card.addEventListener("click", () => openPolicyRateModal(card.dataset.id));
  });
}

function openPolicyRateModal(rateId) {
  const r = policyRateById.get(rateId);
  if (!r) return;

  const { latest, w, m, y } = computeBondChanges(r.series);

  const recentRows = [...r.series]
    .reverse()
    .slice(0, 20)
    .map((p) => `<tr><td>${p.date}</td><td>${p.value.toFixed(2)}%</td></tr>`)
    .join("");

  document.getElementById("modalContent").innerHTML = `
    <h2>${r.name}</h2>
    <div class="modal-name-en">${r.nameEn}</div>
    <table class="info-table">
      <tr><td class="info-label">국가</td><td>${flagIcon(r.country)} ${r.country}</td></tr>
      <tr><td class="info-label">발표기관</td><td>${
        r.officialUrl
          ? `<a href="${r.officialUrl}" target="_blank" rel="noopener noreferrer">${r.institution} ↗</a>`
          : r.institution
      }</td></tr>
      <tr><td class="info-label">단위</td><td>${r.unit}</td></tr>
      <tr><td class="info-label">현재 수준</td><td>${latest.value.toFixed(2)}%</td></tr>
    </table>
    <div class="description-box">${r.description || ""}</div>

    <div class="bond-change-grid" style="margin:12px 0 18px;">
      ${bondChangeBadge("1주", w)}
      ${bondChangeBadge("1개월", m)}
      ${bondChangeBadge("1년", y)}
    </div>

    <h4>결정 변경 이력 (계단식 — 값이 바뀐 시점만 기록)</h4>
    <p class="chart-disclaimer">⚠️ 회의에서 동결이 나온 달은 별도로 기록하지 않고, 실제로 금리가 바뀐 시점만 이어서 표시합니다.</p>
    <div id="historyChartContainer"></div>

    <h4>최근 변경 내역</h4>
    <table class="history-table">
      <thead><tr><th>변경일</th><th>수준</th></tr></thead>
      <tbody>${recentRows || `<tr><td colspan="2">등록된 데이터가 없습니다.</td></tr>`}</tbody>
    </table>
  `;

  const chartSeries = r.series.map((p) => ({ date: p.date, actual: p.value, consensus: NaN }));
  renderHistoryChart(document.getElementById("historyChartContainer"), chartSeries);

  document.getElementById("detailModal").classList.add("active");
}

// ----------------------------------------------------------------------------
// 홈 탭: 기간별(1주/1개월/1년) 국가 간 금리 변동폭 비교 막대 차트
// ----------------------------------------------------------------------------
function renderBondCompareChart() {
  const container = document.getElementById("bondCompareChart");
  if (!container) return;
  const changesList = getAllBondChanges();
  const periods = [
    { key: "w", label: "1주" },
    { key: "m", label: "1개월" },
    { key: "y", label: "1년" },
  ];

  container.innerHTML = periods
    .map((period) => {
      const rows = changesList.map((c) => ({ country: c.country, value: c[period.key] }));
      const withData = rows.filter((r) => r.value !== null);
      if (withData.length === 0) {
        return `
          <div class="bond-compare-period">
            <div class="bond-compare-period-label">${period.label}</div>
            <p class="chart-empty">비교할 데이터가 없습니다.</p>
          </div>`;
      }
      const maxAbs = Math.max(...withData.map((r) => Math.abs(r.value)), 0.01);
      const rowsHtml = rows
        .map((r) => {
          if (r.value === null) {
            return `
              <div class="bond-compare-row">
                <span class="bcr-country">${r.country}</span>
                <div class="bcr-bar-track"><span class="bcr-nodata">데이터 없음</span></div>
              </div>`;
          }
          const dir = r.value > 0.005 ? "up" : r.value < -0.005 ? "down" : "flat";
          const pct = Math.max((Math.abs(r.value) / maxAbs) * 100, 2);
          const bp = Math.round(Math.abs(r.value) * 100);
          const sign = r.value > 0.005 ? "+" : r.value < -0.005 ? "-" : "";
          return `
            <div class="bond-compare-row">
              <span class="bcr-country">${r.country}</span>
              <div class="bcr-bar-track">
                <div class="bcr-bar ${dir}" style="width:${pct.toFixed(1)}%"></div>
              </div>
              <span class="bcr-value ${dir}">${sign}${bp}bp</span>
            </div>`;
        })
        .join("");
      return `
        <div class="bond-compare-period">
          <div class="bond-compare-period-label">${period.label}</div>
          ${rowsHtml}
        </div>`;
    })
    .join("");
}

// ----------------------------------------------------------------------------
// 홈 탭: 지표 비교 도구 — 데이터 소스 정규화
// ----------------------------------------------------------------------------
// 지표(indicator)의 실제 발표 이력만 뽑아 {date, value} 배열로 변환 (2020년 합성 백필 구간은 제외 — 통계 계산은 실데이터만 사용)
function getRealSeriesForIndicator(ind) {
  return (ind.history || [])
    .map((h) => ({ date: h.date, value: parseNumeric(h.actual) }))
    .filter((p) => !isNaN(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function getSeriesById(compId) {
  if (compId.startsWith("bond:")) {
    const b = bondYieldById.get(compId.slice(5));
    if (!b) return null;
    return { label: `${b.country} ${b.name}`, unit: b.unit, points: b.series };
  }
  if (compId.startsWith("idx:")) {
    const a = marketAssetById.get(compId.slice(4));
    if (!a) return null;
    return { label: `${a.country} ${a.name}`, unit: a.unit, points: a.series };
  }
  if (compId.startsWith("rate:")) {
    const r = policyRateById.get(compId.slice(5));
    if (!r) return null;
    return { label: `${r.country} ${r.name}`, unit: r.unit, points: r.series };
  }
  if (compId.startsWith("rd:")) {
    const s = rateSeriesById.get(compId.slice(3));
    if (!s) return null;
    const label = s.country ? `${s.country} ${s.name}` : s.name;
    return { label, unit: s.unit, points: rateSeriesPoints(s.id) };
  }
  if (compId.startsWith("fred:")) {
    const s = typeof fredReference !== "undefined" && fredReference.series[compId.slice(5)];
    if (!s) return null;
    return { label: `${s.label} (FRED)`, unit: s.unit, points: s.recent };
  }
  if (compId.startsWith("ecos:")) {
    const s = typeof ecosReference !== "undefined" && ecosReference.series[compId.slice(5)];
    if (!s) return null;
    return { label: `${s.label} (ECOS)`, unit: s.unit, points: s.recent };
  }
  if (compId.startsWith("estat:")) {
    const s = typeof estatReference !== "undefined" && estatReference.series[compId.slice(6)];
    if (!s) return null;
    return { label: `${s.label} (e-Stat)`, unit: s.unit, points: s.recent };
  }
  if (compId.startsWith("bbgd:") || compId.startsWith("bbgm:")) {
    const bucket = compId.startsWith("bbgd:") ? "daily" : "monthly";
    const s = typeof bloombergData !== "undefined" && bloombergData[bucket][compId.slice(5)];
    if (!s) return null;
    return { label: `${s.label} (BBG)`, unit: s.unit, points: s.series.map(([date, value]) => ({ date, value })) };
  }
  const ind = indicatorById.get(compId.slice(4));
  if (!ind) return null;
  return { label: `${ind.country} ${ind.name}`, unit: ind.unit, points: getRealSeriesForIndicator(ind) };
}

// 비교 도구 select에 넣을 옵션 목록: 국채금리 5개 + 기준금리 6개 + 지수·원자재 3개 + 실데이터가 2개 이상 있는 지표만
function getComparableOptions() {
  const bondOpts = bondYields.map((b) => ({ id: `bond:${b.id}`, group: "국채금리", label: `${b.country} ${b.name}` }));
  const rateOpts = policyRates.map((r) => ({ id: `rate:${r.id}`, group: "기준금리", label: `${r.country} ${r.name}` }));
  const assetOpts = marketAssets.map((a) => ({ id: `idx:${a.id}`, group: "지수·원자재", label: `${a.country} ${a.name}` }));
  const indOpts = indicators
    .filter((ind) => getRealSeriesForIndicator(ind).length >= 2)
    .map((ind) => ({ id: `ind:${ind.id}`, group: ind.category, label: `${ind.country} ${ind.name}` }));
  // rate-data.js 일별 시리즈(210개). 홈 카드로 이미 노출되는 한/미/일 10년물은 중복 제외.
  const shownAsBond = new Set(["ktb10y", "ust0y", "jpy10y", "aud10y"]);
  const rdOpts = hasRateData
    ? rateData.series
        .filter((s) => !shownAsBond.has(s.id))
        .map((s) => ({ id: `rd:${s.id}`, group: `📄 ${s.group}`, label: s.name }))
    : [];
  // 공식 통계기관 실데이터(자동 갱신) — 교차검증용
  const refOpts = [];
  const addRef = (ref, prefix, group) => {
    if (ref && ref.series)
      Object.entries(ref.series).forEach(([k, s]) => {
        if (s.recent && s.recent.length >= 2) refOpts.push({ id: `${prefix}:${k}`, group, label: s.label });
      });
  };
  addRef(typeof fredReference !== "undefined" && fredReference, "fred", "📊 FRED (미국)");
  addRef(typeof ecosReference !== "undefined" && ecosReference, "ecos", "📊 ECOS (한국)");
  addRef(typeof estatReference !== "undefined" && estatReference, "estat", "📊 e-Stat (일본)");
  // 블룸버그 업로드 데이터(일별 금융지표 + 월별 매크로) 전체
  const bbgOpts = [];
  if (typeof bloombergData !== "undefined") {
    Object.entries(bloombergData.daily).forEach(([k, s]) => {
      if (s.series && s.series.length >= 2) bbgOpts.push({ id: `bbgd:${k}`, group: "📈 Bloomberg 일별", label: s.label });
    });
    Object.entries(bloombergData.monthly).forEach(([k, s]) => {
      if (s.series && s.series.length >= 2) bbgOpts.push({ id: `bbgm:${k}`, group: "📈 Bloomberg 월별", label: s.label });
    });
  }
  return [...bondOpts, ...rateOpts, ...assetOpts, ...indOpts, ...rdOpts, ...refOpts, ...bbgOpts];
}

function populateCompareSelects() {
  const options = getComparableOptions();
  const groups = {};
  options.forEach((o) => {
    if (!groups[o.group]) groups[o.group] = [];
    groups[o.group].push(o);
  });
  const optionsHtml = Object.entries(groups)
    .map(
      ([group, opts]) =>
        `<optgroup label="${group}">${opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("")}</optgroup>`
    )
    .join("");

  const selA = document.getElementById("compareSeriesA");
  const selB = document.getElementById("compareSeriesB");
  selA.innerHTML = optionsHtml;
  selB.innerHTML = optionsHtml;
  selA.value = `bond:${state.compareA}`;
  selB.value = `ind:${state.compareB}`;
}

// ----------------------------------------------------------------------------
// 홈 탭: 통계 엔진 (피어슨 상관계수 / R² / p-value)
// ----------------------------------------------------------------------------
// 두 시계열을 "월" 단위로 맞춰서(같은 달의 마지막 값 기준) 짝지은 [x[], y[]] 배열로 변환
function alignSeriesByMonth(pointsA, pointsB) {
  const mapA = new Map();
  pointsA.forEach((p) => mapA.set(p.date.slice(0, 7), p.value));
  const mapB = new Map();
  pointsB.forEach((p) => mapB.set(p.date.slice(0, 7), p.value));
  const months = [...mapA.keys()].filter((m) => mapB.has(m)).sort();
  return {
    months,
    xs: months.map((m) => mapA.get(m)),
    ys: months.map((m) => mapB.get(m)),
  };
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((a, v) => a + v, 0) / n;
  const meanY = ys.reduce((a, v) => a + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// 감마함수(로그) — Lanczos 근사
function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// 불완전베타함수의 연분수 전개 (Numerical Recipes betacf)
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// 상관계수 r의 통계적 유의성(양측검정) p-value — 자유도 n-2인 t분포 기준
function correlationPValue(r, n) {
  if (n < 3) return NaN;
  const rClamped = Math.max(-0.999999, Math.min(0.999999, r));
  const df = n - 2;
  const t = rClamped * Math.sqrt(df / (1 - rClamped * rClamped));
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

// ----------------------------------------------------------------------------
// 홈 탭: 비교 차트 렌더링 (두 시리즈를 각자 min-max로 정규화해 겹쳐 그림)
// ----------------------------------------------------------------------------
function renderComparisonChart(container, months, xs, ys, labelA, labelB) {
  if (months.length < 2) {
    container.innerHTML = `<p class="chart-empty">겹치는 기간의 실데이터가 부족해 차트를 그릴 수 없습니다 (최소 2개월 필요).</p>`;
    return;
  }
  const width = 680, height = 220, padding = 30;
  const n = months.length;
  const xAt = (i) => padding + (i * (width - padding * 2)) / Math.max(n - 1, 1);

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const yAtX = (v) => height - padding - ((v - minX) / rangeX) * (height - padding * 2);
  const yAtY = (v) => height - padding - ((v - minY) / rangeY) * (height - padding * 2);

  const lineA = xs.map((v, i) => `${xAt(i).toFixed(1)},${yAtX(v).toFixed(1)}`).join(" ");
  const lineB = ys.map((v, i) => `${xAt(i).toFixed(1)},${yAtY(v).toFixed(1)}`).join(" ");

  let lastYear = "";
  const yearLabels = months
    .map((m, i) => {
      const year = m.slice(0, 4);
      if (year !== lastYear) {
        lastYear = year;
        return `<text x="${xAt(i).toFixed(1)}" y="${height - 6}" class="chart-axis-label">${year}</text>`;
      }
      return "";
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="history-chart-svg" preserveAspectRatio="none">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-gridline" />
      <polyline points="${lineA}" class="chart-line" style="stroke:#2563eb" />
      <polyline points="${lineB}" class="chart-line" style="stroke:#d97706" />
      ${yearLabels}
    </svg>
    <div class="compare-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#2563eb"></span>${labelA} (${minX.toFixed(2)} ~ ${maxX.toFixed(2)})</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#d97706"></span>${labelB} (${minY.toFixed(2)} ~ ${maxY.toFixed(2)})</span>
    </div>
    <p class="chart-disclaimer">⚠️ 두 시리즈는 단위·규모가 달라 각자의 최소~최대값 기준으로 정규화해 겹쳐 그린 그래프입니다 (같은 세로축이 아닙니다).</p>
  `;
}

function renderComparisonStats(container, r, n, labelA, labelB) {
  if (isNaN(r) || n < 3) {
    container.innerHTML = `<p class="stats-warning">⚠️ 겹치는 실데이터가 ${n}개월뿐이라 통계적으로 의미 있는 상관관계를 계산하기 어렵습니다. 최소 3개월 이상 겹치는 기간이 필요해요.</p>`;
    return;
  }
  const r2 = r * r;
  const p = correlationPValue(r, n);
  const strength =
    Math.abs(r) >= 0.7 ? "매우 강한" : Math.abs(r) >= 0.5 ? "강한" : Math.abs(r) >= 0.3 ? "보통 수준의" : Math.abs(r) >= 0.1 ? "약한" : "거의 없는";
  const direction = r > 0 ? "같은 방향으로(양의 상관)" : r < 0 ? "반대 방향으로(음의 상관)" : "뚜렷한 방향성 없이";
  const sig = p < 0.01 ? "매우 높습니다 (p<0.01)" : p < 0.05 ? "통계적으로 유의미한 수준입니다 (p<0.05)" : "통계적으로 유의미하다고 보기 어렵습니다 (p≥0.05)";

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-label">상관계수 (r)</div><div class="stat-value">${r.toFixed(3)}</div></div>
      <div class="stat-box"><div class="stat-label">결정계수 (R²)</div><div class="stat-value">${r2.toFixed(3)}</div></div>
      <div class="stat-box"><div class="stat-label">p-value</div><div class="stat-value">${p < 0.001 ? "<0.001" : p.toFixed(3)}</div></div>
      <div class="stat-box"><div class="stat-label">겹치는 개월 수</div><div class="stat-value">${n}</div></div>
    </div>
    <div class="stats-explain">
      <p><b>${labelA}</b>와(과) <b>${labelB}</b>는 지난 ${n}개월간 <b>${strength} ${direction}</b> 움직였습니다 (r = ${r.toFixed(3)}).</p>
      <p>R²(${r2.toFixed(3)})은 한 시리즈 변동의 약 <b>${(r2 * 100).toFixed(1)}%</b>가 다른 시리즈의 움직임으로 설명된다는 뜻입니다. 나머지는 다른 요인 때문입니다.</p>
      <p>이 상관관계가 우연이 아닐 가능성은 ${sig} (p-value는 "두 시리즈가 사실 아무 관계가 없는데 우연히 이 정도 상관관계가 나올 확률"을 뜻하며, 낮을수록 우연이 아니라는 근거가 강해집니다.)</p>
      <p style="color:var(--text-muted);font-size:0.8rem;">⚠️ 상관관계는 인과관계를 의미하지 않습니다. 두 지표가 함께 움직이는 것처럼 보여도, 실제로는 제3의 요인이 둘 다에 영향을 주고 있을 수 있습니다. 또한 표본이 적을수록(특히 20개월 미만) 결과가 불안정할 수 있습니다.</p>
    </div>
  `;
}

function updateComparison() {
  const idA = document.getElementById("compareSeriesA").value;
  const idB = document.getElementById("compareSeriesB").value;
  const seriesA = getSeriesById(idA);
  const seriesB = getSeriesById(idB);
  if (!seriesA || !seriesB) return;

  let pointsA = seriesA.points;
  let pointsB = seriesB.points;
  if (state.compareRange === "custom") {
    if (state.compareStartDate) {
      pointsA = pointsA.filter((p) => p.date >= state.compareStartDate);
      pointsB = pointsB.filter((p) => p.date >= state.compareStartDate);
    }
    if (state.compareEndDate) {
      pointsA = pointsA.filter((p) => p.date <= state.compareEndDate);
      pointsB = pointsB.filter((p) => p.date <= state.compareEndDate);
    }
  }
  // state.compareRange === "all"이면 필터 없이 보유한 실데이터 전체 기간 사용

  const { months, xs, ys } = alignSeriesByMonth(pointsA, pointsB);
  renderComparisonChart(document.getElementById("compareChartContainer"), months, xs, ys, seriesA.label, seriesB.label);
  const r = months.length >= 3 ? pearsonCorrelation(xs, ys) : NaN;
  renderComparisonStats(document.getElementById("compareStatsContainer"), r, months.length, seriesA.label, seriesB.label);
}

function setupCompareTool() {
  populateCompareSelects();
  document.getElementById("compareSeriesA").addEventListener("change", updateComparison);
  document.getElementById("compareSeriesB").addEventListener("change", updateComparison);
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compareRange = btn.dataset.range;
      document.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("compareStartDate").value = "";
      document.getElementById("compareEndDate").value = "";
      updateComparison();
    });
  });
  const onDateChange = () => {
    state.compareRange = "custom";
    state.compareStartDate = document.getElementById("compareStartDate").value || null;
    state.compareEndDate = document.getElementById("compareEndDate").value || null;
    document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
    updateComparison();
  };
  document.getElementById("compareStartDate").addEventListener("change", onDateChange);
  document.getElementById("compareEndDate").addEventListener("change", onDateChange);
  updateComparison();
}

// ----------------------------------------------------------------------------
// 홈 탭: 카테고리별 주요 지표 (탭으로 카테고리 전환 + 카드 클릭 시 지표 사전 상세)
// ----------------------------------------------------------------------------
// 카테고리 탭에 표시할 이름과, 그 아래 보여줄 대표 지표(국가 섞어서 소수 정예로 선정)
const HOME_CATEGORY_TABS = [
  { label: "성장/경제", category: "성장", ids: ["us_gdp", "kr_gdp", "kr_ip", "eu_gdp"] },
  { label: "물가", category: "물가", ids: ["us_cpi", "kr_cpi", "eu_cpi", "jp_cpi"] },
  { label: "고용", category: "고용", ids: ["us_nfp", "us_unemployment", "au_unemployment"] },
  { label: "소비", category: "소비", ids: ["us_retail_sales", "us_cb_consumer", "us_umich_consumer"] },
  { label: "투자/제조업", category: "투자", ids: ["us_durable_goods", "us_housing_starts", "us_ism_mfg"] },
];

function formatPeriodLabel(ind, dateStr) {
  if (!dateStr) return "-";
  const [y, m] = dateStr.split("-");
  if (ind.frequency && ind.frequency.includes("분기")) {
    const q = Math.ceil(parseInt(m, 10) / 3);
    return `${y}Q${q}`;
  }
  return `${y}-${m}`;
}

function renderKeyCategoryTabs() {
  const tabBar = document.getElementById("keyCategoryTabs");
  tabBar.innerHTML = HOME_CATEGORY_TABS.map(
    (tab, i) =>
      `<button class="key-category-tab${i === state.homeCategoryTabIndex ? " active" : ""}" data-index="${i}">${tab.label}</button>`
  ).join("");
  tabBar.querySelectorAll(".key-category-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.homeCategoryTabIndex = parseInt(btn.dataset.index, 10);
      renderKeyCategoryTabs();
      renderKeyIndicatorCards();
    });
  });
}

function renderKeyIndicatorCards() {
  const grid = document.getElementById("keyIndicatorGrid");
  const tab = HOME_CATEGORY_TABS[state.homeCategoryTabIndex];
  const cards = tab.ids
    .map((id) => {
      const ind = indicatorById.get(id);
      if (!ind) return "";
      const latest = (ind.history || [])[0];
      return `
        <button class="key-indicator-card" data-id="${ind.id}">
          <div class="ki-name">${flagIcon(ind.country)} ${ind.name}</div>
          <div class="ki-name-en">${ind.nameEn}</div>
          <div class="ki-value-row">
            <span class="ki-value">${latest ? latest.actual : "-"}</span>
            <span class="ki-period">${latest ? formatPeriodLabel(ind, latest.date) : ""}</span>
          </div>
        </button>`;
    })
    .join("");
  grid.innerHTML = cards || `<div class="key-indicator-empty">이 카테고리에는 아직 등록된 대표 지표가 없습니다.</div>`;
  grid.querySelectorAll(".key-indicator-card").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.id));
  });
}

function renderKeyIndicators() {
  renderKeyCategoryTabs();
  renderKeyIndicatorCards();
}

// ----------------------------------------------------------------------------
// 홈 탭: 주간 경제지표·이벤트 캘린더 (지난주/이번주/다음주 리스트)
// ----------------------------------------------------------------------------
function getSundayStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// 이벤트 하루치 실제치/컨센서스/이전치 값을 뽑아냄: 이미 발표됐으면 history에서, 예정이면 다음 컨센서스 안내
function formatEventValues(ind, ev) {
  const todayYmd = formatYmd(new Date());
  const hist = (ind.history || []).find((h) => h.date === ev.date);
  if (hist) {
    return { actual: hist.actual ?? "-", consensus: hist.consensus ?? "-", previous: hist.previous ?? "-" };
  }
  if (ev.date >= todayYmd) {
    return {
      actual: "예정",
      consensus: ind.hasConsensus ? ind.nextConsensus || "미확인" : "-",
      previous: "-",
    };
  }
  return { actual: "-", consensus: "-", previous: "-" };
}

function renderHomeWeekList() {
  const today = new Date();
  const base = getSundayStart(today);
  const weekStart = new Date(base);
  weekStart.setDate(weekStart.getDate() + state.homeWeekOffset * 7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  document.getElementById("homeWeekLabel").textContent = `${formatYmd(days[0])} ~ ${formatYmd(days[6])}`;

  const todayYmd = formatYmd(today);
  let anyEvent = false;
  const html = days
    .map((day) => {
      const ymd = formatYmd(day);
      const dayEvents = calendarEvents.filter((ev) => ev.date === ymd);
      if (dayEvents.length === 0) return "";
      anyEvent = true;
      const eventsHtml = dayEvents
        .map((ev) => {
          if (ev.raw) {
            const a = ev.actual ?? "-", c = ev.consensus ?? "-", p = ev.previous ?? "-";
            return `
            <button class="home-week-event importance-${ev.importance}" data-raw="${ev.id}">
              <span class="event-time">${ev.timeKST}</span>
              <span class="event-name">${flagIcon(ev.country)} ${ev.name}</span>
              <span class="event-values">
                <span class="ev-item" title="${a}"><span class="ev-label">실제</span>${a}</span>
                <span class="ev-item" title="${c}"><span class="ev-label">컨센</span>${c}</span>
                <span class="ev-item" title="${p}"><span class="ev-label">이전</span>${p}</span>
              </span>
            </button>`;
          }
          const ind = indicatorById.get(ev.indicatorId);
          if (!ind) return "";
          const vals = formatEventValues(ind, ev);
          return `
            <button class="home-week-event importance-${ind.importance}" data-id="${ind.id}">
              <span class="event-time">${ev.timeKST}</span>
              <span class="event-name">${flagIcon(ind.country)} ${ind.name}</span>
              <span class="event-values">
                <span class="ev-item" title="${vals.actual}"><span class="ev-label">실제</span>${vals.actual}</span>
                <span class="ev-item" title="${vals.consensus}"><span class="ev-label">컨센</span>${vals.consensus}</span>
                <span class="ev-item" title="${vals.previous}"><span class="ev-label">이전</span>${vals.previous}</span>
              </span>
            </button>`;
        })
        .join("");
      return `
        <div class="home-week-day${ymd === todayYmd ? " is-today" : ""}">
          <div class="home-week-day-label">${WEEKDAY_LABELS[day.getDay()]} · ${ymd}${ymd === todayYmd ? " (오늘)" : ""}</div>
          ${eventsHtml}
        </div>`;
    })
    .join("");

  const list = document.getElementById("homeWeekList");
  list.innerHTML = anyEvent ? html : `<div class="home-week-empty">이 주에는 등록된 발표 일정이 없습니다.</div>`;
  list.querySelectorAll(".home-week-event").forEach((btn) => {
    btn.addEventListener("click", () =>
      btn.dataset.raw ? openRawEventModal(btn.dataset.raw) : openModal(btn.dataset.id)
    );
  });
}

function setupHomeWeekNav() {
  document.querySelectorAll(".home-week-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.homeWeekOffset = parseInt(btn.dataset.offset, 10);
      document.querySelectorAll(".home-week-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderHomeWeekList();
    });
  });
  renderHomeWeekList();
}

function renderHomeView() {
  refreshBondSeriesFromRateData();
  refreshFromBloomberg();
  renderBondCards();
  renderPolicyRateCards();
  renderBondCompareChart();
  renderMarketAssetCards();
  renderKeyIndicators();
  setupHomeWeekNav();
  setupCompareTool();
}

// ----------------------------------------------------------------------------
// 초기화
// ----------------------------------------------------------------------------
// 한 섹션 초기화가 실패해도 나머지 탭(캘린더 등)은 정상 렌더링되도록 격리
function safeRun(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[초기화 오류] ${label}:`, err);
    const banner = document.createElement("div");
    banner.style.cssText = "background:#fee;color:#900;padding:8px 14px;font-size:0.8rem;border-bottom:1px solid #c00;white-space:pre-wrap;";
    banner.textContent = `⚠️ "${label}" 렌더링 중 오류: ${err.message}`;
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

// ----------------------------------------------------------------------------
// 라이트/다크 테마 토글 (기기 설정과 무관하게 직접 선택, localStorage에 기억)
// ----------------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("dashboardTheme", theme);
}

function setupThemeToggle() {
  const saved = localStorage.getItem("dashboardTheme");
  if (saved === "light" || saved === "dark") applyTheme(saved);

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

// ----------------------------------------------------------------------------
// AI 분석 탭: 사용자 API 키로 대시보드 데이터를 LLM에게 질의(브라우저 직접 호출, 서버 없음)
// ----------------------------------------------------------------------------
// 제공사별 선택 가능한 모델(첫 항목이 기본값). 목록에 없으면 "직접 입력" 사용.
const AI_MODELS = {
  claude: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
};
const AI_CUSTOM = "__custom__";

// 모든 시계열을 검색 가능한 단일 목록으로 수집(라벨/국가/단위/최신값/최근값)
function collectAllSeries() {
  const list = [];
  const push = (label, country, unit, points) => {
    const pts = (points || []).filter((p) => {
      if (!p || p.value == null) return false;
      const n = typeof p.value === "number" ? p.value : parseNumeric(p.value);
      return !isNaN(n);
    });
    if (pts.length) list.push({ label, country: country || "", unit: unit || "", points: pts });
  };
  indicators.forEach((ind) => push(`${ind.country} ${ind.name}`, ind.country, ind.unit, getRealSeriesForIndicator(ind)));
  bondYields.forEach((b) => push(`${b.country} ${b.name}`, b.country, b.unit, b.series));
  policyRates.forEach((r) => push(`${r.country} ${r.name}`, r.country, r.unit, r.series));
  marketAssets.forEach((a) => push(a.name, a.country, a.unit, a.series));
  if (typeof bloombergData !== "undefined") {
    Object.values(bloombergData.daily).forEach((s) =>
      push(s.label, "", s.unit, (s.series || []).map(([date, value]) => ({ date, value })))
    );
  }
  return list;
}

// 질문과 관련된 시리즈를 점수화해 상위 N개 + 핵심 스냅샷을 텍스트 컨텍스트로 구성
function collectDataContext(question) {
  const q = (question || "").toLowerCase();
  const all = collectAllSeries();
  const scored = all
    .map((s) => {
      const label = s.label.toLowerCase();
      let score = 0;
      if (s.country && q.includes(s.country.toLowerCase())) score += 2;
      label.split(/[\s()]+/).forEach((tok) => {
        if (tok.length >= 2 && q.includes(tok.toLowerCase())) score += 2;
      });
      ["금리", "국채", "환율", "물가", "cpi", "gdp", "고용", "실업", "무역", "수출", "주가", "코스피", "s&p", "유가", "pmi", "기준금리"].forEach(
        (kw) => {
          if (q.includes(kw) && label.includes(kw)) score += 1;
        }
      );
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);

  const fmtSeries = (s) => {
    const recent = s.points.slice(-8).map((p) => `${p.date}:${p.value}`).join(", ");
    const latest = s.points[s.points.length - 1];
    return `「${s.label}」 단위 ${s.unit} | 최신 ${latest.date}=${latest.value} | 최근: ${recent}`;
  };

  // 핵심 스냅샷(항상 포함): 기준금리·10년물·주요 물가
  const snap = [];
  policyRates.forEach((r) => {
    const l = r.series[r.series.length - 1];
    if (l) snap.push(`${r.country} 기준금리 ${l.value}%`);
  });
  bondYields.forEach((b) => {
    const l = b.series[b.series.length - 1];
    if (l) snap.push(`${b.country} 10Y ${l.value}%`);
  });

  let ctx = `[핵심 스냅샷] ${snap.join(" · ")}\n\n[질문 관련 데이터]\n`;
  if (scored.length === 0) {
    ctx += "(질문에서 특정 지표를 못 찾아 스냅샷 위주로 제공합니다. 필요하면 지표명을 구체적으로 물어보세요.)";
  } else {
    ctx += scored.map((x) => fmtSeries(x.s)).join("\n");
  }
  if (ctx.length > 9000) ctx = ctx.slice(0, 9000) + "\n…(이하 생략)";
  return ctx;
}

async function callClaude(key, model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `Claude ${res.status}`);
  return (j.content || []).map((c) => c.text || "").join("");
}
async function callOpenAI(key, model, system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `OpenAI ${res.status}`);
  return j.choices?.[0]?.message?.content || "";
}
async function callGemini(key, model, system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `Gemini ${res.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

function setupAiTab() {
  const providerSel = document.getElementById("aiProvider");
  const modelSel = document.getElementById("aiModelSelect");
  const modelInput = document.getElementById("aiModel");
  const keyInput = document.getElementById("aiKey");
  const keyToggle = document.getElementById("aiKeyToggle");
  const questionEl = document.getElementById("aiQuestion");
  const submitBtn = document.getElementById("aiSubmit");
  const statusEl = document.getElementById("aiStatus");
  const answerEl = document.getElementById("aiAnswer");
  const ctxWrap = document.getElementById("aiContextWrap");
  const ctxEl = document.getElementById("aiContext");
  if (!providerSel) return;

  const effectiveModel = () => (modelSel.value === AI_CUSTOM ? modelInput.value.trim() : modelSel.value);
  const syncCustomVisibility = () => {
    modelInput.hidden = modelSel.value !== AI_CUSTOM;
  };
  const loadForProvider = () => {
    const p = providerSel.value;
    keyInput.value = localStorage.getItem(`ai_key_${p}`) || "";
    // 모델 드롭다운 채우기
    const saved = localStorage.getItem(`ai_model_${p}`) || AI_MODELS[p][0];
    modelSel.innerHTML =
      AI_MODELS[p].map((m) => `<option value="${m}">${m}</option>`).join("") +
      `<option value="${AI_CUSTOM}">직접 입력…</option>`;
    if (AI_MODELS[p].includes(saved)) {
      modelSel.value = saved;
      modelInput.value = "";
    } else {
      modelSel.value = AI_CUSTOM;
      modelInput.value = saved;
    }
    syncCustomVisibility();
  };
  providerSel.value = localStorage.getItem("ai_provider") || "claude";
  loadForProvider();
  providerSel.addEventListener("change", () => {
    localStorage.setItem("ai_provider", providerSel.value);
    loadForProvider();
  });
  const saveModel = () => localStorage.setItem(`ai_model_${providerSel.value}`, effectiveModel());
  modelSel.addEventListener("change", () => {
    syncCustomVisibility();
    saveModel();
  });
  modelInput.addEventListener("change", saveModel);
  keyInput.addEventListener("change", () => localStorage.setItem(`ai_key_${providerSel.value}`, keyInput.value.trim()));
  keyToggle.addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  });

  submitBtn.addEventListener("click", async () => {
    const provider = providerSel.value;
    const model = effectiveModel() || AI_MODELS[provider][0];
    const key = keyInput.value.trim();
    const question = questionEl.value.trim();
    if (!key) return (statusEl.textContent = "⚠️ API 키를 입력하세요.");
    if (!model) return (statusEl.textContent = "⚠️ 모델명을 입력하세요.");
    if (!question) return (statusEl.textContent = "⚠️ 질문을 입력하세요.");
    localStorage.setItem(`ai_key_${provider}`, key);
    localStorage.setItem(`ai_model_${provider}`, model);

    const context = collectDataContext(question);
    ctxEl.textContent = context;
    ctxWrap.hidden = false;
    const system =
      "당신은 이 대시보드의 경제 데이터만 근거로 답하는 한국어 경제 애널리스트입니다. 아래 제공된 데이터에 근거해 간결하고 정확하게 분석하세요. 데이터에 없는 사실은 단정하지 말고 '데이터에 없음'이라고 밝히세요. 추정할 때는 추정임을 명시하세요.";
    const user = `다음은 대시보드 데이터입니다.\n\n${context}\n\n[질문]\n${question}`;

    submitBtn.disabled = true;
    statusEl.textContent = "🤔 분석 중…";
    answerEl.hidden = true;
    try {
      const fn = provider === "claude" ? callClaude : provider === "openai" ? callOpenAI : callGemini;
      const answer = await fn(key, model, system, user);
      answerEl.textContent = answer || "(빈 응답)";
      answerEl.hidden = false;
      statusEl.textContent = "✅ 완료";
    } catch (e) {
      answerEl.textContent = `❌ 오류: ${e.message}\n\n키·모델명을 확인하세요. (CORS 오류라면 브라우저 확장·네트워크 차단 여부도 확인)`;
      answerEl.hidden = false;
      statusEl.textContent = "❌ 실패";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function init() {
  safeRun("테마 토글", setupThemeToggle);
  safeRun("카테고리 필터", renderCategoryFilter);
  safeRun("탭 전환 설정", setupViewTabs);
  safeRun("홈 화면", renderHomeView);
  safeRun("지표 사전", renderIndicatorGrid);
  safeRun("캘린더", renderCalendar);
  safeRun("캘린더 내비게이션", setupCalendarNav);
  safeRun("상세 모달", setupModal);
  safeRun("AI 분석 탭", setupAiTab);
}

init();
