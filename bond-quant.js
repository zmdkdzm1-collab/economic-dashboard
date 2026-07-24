// ============================================================================
// bond-quant.js — 채권형 펀드 퀀트+매크로 운용 보조 툴 (로컬 전용)
//
// 데이터 소스:
//   - window.rateData  : rate-data.js (공개 시장 데이터 — 국채커브/크레딧/스왑/FX, 일별)
//   - window.BQ_INTERNAL : bond-quant-internal.js (사내 데이터 — 내 펀드/벤치마크/경쟁사 기준가)
//
// 모듈(탭):
//   1) 커브 & RV       — 커브·기울기·국가간 스프레드·치프/리치(잔차)·나비
//   2) 캐리 & 롤다운   — 만기별 carry+roll, 크레딧 캐리, FX헤지 해외물 캐리
//   3) 매크로 레짐     — 성장/물가/정책/유동성 z스코어 → 듀레이션·크레딧 스탠스
//   4) 시나리오 & DV01 — 커브 시나리오별 포트폴리오 손익, DV01/듀레이션 테이블
//   5) 경쟁사 비교     — 기준가 수익률 비교 + 수익률기반 스타일분석(듀레이션 역추정)
//
// 이 파일에는 민감정보가 없습니다(순수 계산 로직). 민감 데이터는 BQ_INTERNAL 에만.
// ============================================================================

(function () {
  "use strict";

  // ── 전역 데이터 핸들 ──────────────────────────────────────────────────────
  var RD, IN;

  // ── 유틸: 시리즈 접근 ─────────────────────────────────────────────────────
  function seriesById(id) { return RD.series.find(function (s) { return s.id === id; }); }
  function seriesByName(name) { return RD.series.find(function (s) { return s.name === name; }); }
  function lastNonNull(arr) { for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }
  function valAtIdx(arr, i) { for (var j = i; j >= 0; j--) if (arr[j] != null) return arr[j]; return null; }
  function lastVal(id) { var s = seriesById(id); return s ? lastNonNull(s.values) : null; }
  // n영업일 전 값
  function valDaysAgo(id, n) { var s = seriesById(id); if (!s) return null; return valAtIdx(s.values, s.values.length - 1 - n); }

  function dateIdx(dateStr) {
    var d = RD.dates, i = d.indexOf(dateStr);
    if (i >= 0) return i;
    // 가장 가까운 이전 영업일
    for (var j = d.length - 1; j >= 0; j--) if (d[j] <= dateStr) return j;
    return -1;
  }

  // 만기 토큰 → 연 단위 (예: "3m"→0.25, "1.5y"→1.5, "1w"→0.019)
  function parseTenor(tok) {
    var m = /^([\d.]+)\s*([mwy])$/i.exec(tok.trim());
    if (!m) return null;
    var n = parseFloat(m[1]);
    var u = m[2].toLowerCase();
    if (u === "w") return n * 7 / 365;
    if (u === "m") return n / 12;
    return n;
  }

  // 그룹명으로 "순수 커브"(만기별 금리) 추출 — Index/BEI/ALL 등 파생 제외
  function buildCurve(groupName) {
    var out = [];
    RD.series.forEach(function (s) {
      if (s.group !== groupName) return;
      if (/index|bei|all|zero|plus|minus/i.test(s.name)) return;
      var toks = s.name.trim().split(/\s+/);
      var t = parseTenor(toks[toks.length - 1]);
      if (t == null) return;
      var v = lastNonNull(s.values);
      if (v == null) return;
      out.push({ tenor: t, id: s.id, name: s.name, values: s.values, last: v });
    });
    out.sort(function (a, b) { return a.tenor - b.tenor; });
    return out;
  }

  // ── 유틸: 통계 ────────────────────────────────────────────────────────────
  function mean(a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (a[i] != null) { s += a[i]; n++; } return n ? s / n : null; }
  function std(a) { var m = mean(a), s = 0, n = 0; for (var i = 0; i < a.length; i++) if (a[i] != null) { s += (a[i] - m) * (a[i] - m); n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : null; }
  function zscore(series, cur) { var m = mean(series), sd = std(series); if (sd == null || sd === 0) return 0; return (cur - m) / sd; }
  // 시리즈에서 파생 시계열(예: 두 시리즈 차) 생성
  function diffSeries(idA, idB) { var a = seriesById(idA), b = seriesById(idB); if (!a || !b) return []; var out = []; for (var i = 0; i < a.values.length; i++) out.push((a.values[i] != null && b.values[i] != null) ? a.values[i] - b.values[i] : null); return out; }

  // 다중선형회귀 (정규방정식 + 가우스소거). X: n×k (절편 포함), y: n. → beta[k]
  function ols(X, y) {
    var n = X.length, k = X[0].length;
    var XtX = [], Xty = [];
    for (var a = 0; a < k; a++) { XtX.push(new Array(k).fill(0)); Xty.push(0); }
    for (var i = 0; i < n; i++) {
      for (var p = 0; p < k; p++) {
        Xty[p] += X[i][p] * y[i];
        for (var q = 0; q < k; q++) XtX[p][q] += X[i][p] * X[i][q];
      }
    }
    // 가우스소거
    var M = XtX.map(function (r, idx) { return r.concat([Xty[idx]]); });
    for (var col = 0; col < k; col++) {
      var piv = col;
      for (var r2 = col + 1; r2 < k; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      if (Math.abs(M[col][col]) < 1e-12) return null;
      for (var r3 = 0; r3 < k; r3++) {
        if (r3 === col) continue;
        var f = M[r3][col] / M[col][col];
        for (var c2 = col; c2 <= k; c2++) M[r3][c2] -= f * M[col][c2];
      }
    }
    var beta = [];
    for (var r4 = 0; r4 < k; r4++) beta.push(M[r4][k] / M[r4][r4]);
    // R²
    var ybar = mean(y), ssTot = 0, ssRes = 0;
    for (var t = 0; t < n; t++) {
      var pred = 0; for (var pp = 0; pp < k; pp++) pred += beta[pp] * X[t][pp];
      ssRes += (y[t] - pred) * (y[t] - pred);
      ssTot += (y[t] - ybar) * (y[t] - ybar);
    }
    return { beta: beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, n: n };
  }

  // NAV 시계열 → {dates, ret(%)} 일간수익률
  function navReturns(nav) {
    var dates = [], ret = [];
    for (var i = 1; i < nav.length; i++) {
      if (nav[i].value != null && nav[i - 1].value != null && nav[i - 1].value !== 0) {
        dates.push(nav[i].date);
        ret.push((nav[i].value / nav[i - 1].value - 1) * 100);
      }
    }
    return { dates: dates, ret: ret };
  }

  // ── 유틸: 포맷/DOM ────────────────────────────────────────────────────────
  function fmt(v, d) { if (v == null || isNaN(v)) return "–"; return v.toFixed(d == null ? 2 : d); }
  function bp(v) { if (v == null || isNaN(v)) return "–"; return (v >= 0 ? "+" : "") + v.toFixed(1) + "bp"; }
  function pct(v, d) { if (v == null || isNaN(v)) return "–"; return (v >= 0 ? "+" : "") + v.toFixed(d == null ? 2 : d) + "%"; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function signClass(v) { return v > 0 ? "pos" : (v < 0 ? "neg" : ""); }

  // ── 미니 SVG 라인차트 ─────────────────────────────────────────────────────
  // series: [{name,color,pts:[y,...]}] (x는 인덱스 공유), opts:{height,ylabel,xlabels}
  function lineChart(seriesList, opts) {
    opts = opts || {};
    var W = 720, H = opts.height || 220, padL = 44, padR = 12, padT = 12, padB = 26;
    var allY = [];
    seriesList.forEach(function (s) { s.pts.forEach(function (v) { if (v != null) allY.push(v); }); });
    if (!allY.length) return el("div", "bq-muted", "데이터 없음");
    var ymin = Math.min.apply(null, allY), ymax = Math.max.apply(null, allY);
    if (opts.zeroLine && ymin > 0) ymin = 0;
    var pad = (ymax - ymin) * 0.08 || 1; ymin -= pad; ymax += pad;
    var n = Math.max.apply(null, seriesList.map(function (s) { return s.pts.length; }));
    var sx = function (i) { return padL + (W - padL - padR) * (n <= 1 ? 0 : i / (n - 1)); };
    var sy = function (v) { return padT + (H - padT - padB) * (1 - (v - ymin) / (ymax - ymin)); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bq-chart" preserveAspectRatio="xMidYMid meet">';
    // y축 그리드 (4구간)
    for (var g = 0; g <= 4; g++) {
      var yv = ymin + (ymax - ymin) * g / 4, yy = sy(yv);
      svg += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" class="bq-grid"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" class="bq-axis" text-anchor="end">' + yv.toFixed(2) + '</text>';
    }
    // x라벨
    if (opts.xlabels) {
      var step = Math.max(1, Math.floor(n / 6));
      for (var xi = 0; xi < n; xi += step) {
        if (!opts.xlabels[xi]) continue;
        svg += '<text x="' + sx(xi) + '" y="' + (H - 8) + '" class="bq-axis" text-anchor="middle">' + opts.xlabels[xi] + '</text>';
      }
    }
    // 라인
    seriesList.forEach(function (s) {
      var dpath = "", started = false;
      for (var i = 0; i < s.pts.length; i++) {
        if (s.pts[i] == null) { started = false; continue; }
        dpath += (started ? "L" : "M") + sx(i).toFixed(1) + " " + sy(s.pts[i]).toFixed(1) + " ";
        started = true;
      }
      svg += '<path d="' + dpath + '" fill="none" stroke="' + s.color + '" stroke-width="1.8"/>';
      if (s.markers) {
        for (var m = 0; m < s.pts.length; m++) if (s.pts[m] != null) svg += '<circle cx="' + sx(m) + '" cy="' + sy(s.pts[m]) + '" r="2.4" fill="' + s.color + '"/>';
      }
    });
    svg += "</svg>";
    var wrap = el("div", "bq-chartwrap");
    wrap.innerHTML = svg;
    if (seriesList.length > 1 || opts.legend) {
      var leg = el("div", "bq-legend");
      seriesList.forEach(function (s) { leg.innerHTML += '<span><i style="background:' + s.color + '"></i>' + s.name + '</span>'; });
      wrap.appendChild(leg);
    }
    return wrap;
  }

  var COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4b5563"];

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 1: 커브 & RV
  // ════════════════════════════════════════════════════════════════════════
  function renderCurveRV(root) {
    root.appendChild(sectionTitle("커브 & 상대가치(RV)", "국채 커브 · 기울기 · 국가간 스프레드 · 치프/리치(잔차) · 나비"));

    var ktb = buildCurve("국채금리 · 한국");
    var ust = buildCurve("국채금리 · 미국");

    // 커브 스냅샷 차트 (현재 vs 60영업일 전)
    var curPts = ktb.map(function (c) { return c.last; });
    var agoPts = ktb.map(function (c) { return valAtIdx(c.values, c.values.length - 1 - 60); });
    var uCur = ust.map(function (c) { return c.last; });
    var card1 = card("KTB · UST 커브 (현재 vs 60영업일 전)");
    card1.appendChild(lineChart([
      { name: "KTB 현재", color: COLORS[0], pts: curPts, markers: true },
      { name: "KTB 60d전", color: "#93c5fd", pts: agoPts },
      { name: "UST 현재", color: COLORS[1], pts: uCur, markers: true },
    ], { height: 230, xlabels: ktb.map(function (c) { return c.tenor + "y"; }), legend: true }));
    root.appendChild(card1);

    // 기울기 & 나비 테이블 (z스코어 포함)
    var slopes = [
      { label: "2s10s (10y-2y)", a: "ktb10y", b: "ktb2y" },
      { label: "3s10s (10y-3y)", a: "ktb10y", b: "ktb3y" },
      { label: "5s30s (30y-5y)", a: "ktb30y", b: "ktb5y" },
      { label: "10s30s (30y-10y)", a: "ktb30y", b: "ktb10y" },
    ];
    var st = table(["기울기", "현재(bp)", "1주전", "60일전", "1년 z", "해석"]);
    slopes.forEach(function (s) {
      var ds = diffSeries(s.a, s.b);
      var cur = lastNonNull(ds) * 100;
      var w1 = valAtIdx(ds, ds.length - 1 - 5) * 100;
      var d60 = valAtIdx(ds, ds.length - 1 - 60) * 100;
      var z = zscore(ds.slice(-252).map(function (x) { return x == null ? null : x * 100; }), cur);
      var interp = z > 1 ? "가팔라짐(스티프닝)" : (z < -1 ? "평탄(플래트닝)" : "중립");
      st.body.appendChild(row([s.label, cur.toFixed(1), w1.toFixed(1), d60.toFixed(1),
        { html: fmt(z), cls: signClass(z) }, interp]));
    });
    var c2 = card("커브 기울기 (bp) · z는 최근 1년 대비");
    c2.appendChild(st.table); root.appendChild(c2);

    // 나비(butterfly) — 표준 3개
    var flies = [
      { label: "2-5-10 나비", w: "ktb5y", l1: "ktb2y", l2: "ktb10y" },
      { label: "3-5-10 나비", w: "ktb5y", l1: "ktb3y", l2: "ktb10y" },
      { label: "5-10-20 나비", w: "ktb10y", l1: "ktb5y", l2: "ktb20y" },
    ];
    var ft = table(["나비(2×중앙 − 좌 − 우)", "현재(bp)", "1년 z", "신호"]);
    flies.forEach(function (f) {
      var w = seriesById(f.w).values, l1 = seriesById(f.l1).values, l2 = seriesById(f.l2).values;
      var ser = [];
      for (var i = 0; i < w.length; i++) ser.push((w[i] != null && l1[i] != null && l2[i] != null) ? (2 * w[i] - l1[i] - l2[i]) * 100 : null);
      var cur = lastNonNull(ser);
      var z = zscore(ser.slice(-252), cur);
      var sig = z > 1 ? "중앙 리치 → 중앙 매도/윙 매수" : (z < -1 ? "중앙 치프 → 중앙 매수/윙 매도" : "중립");
      ft.body.appendChild(row([f.label, cur.toFixed(1), { html: fmt(z), cls: signClass(z) }, sig]));
    });
    var c3 = card("나비 스프레드 · 곡률 트레이드 후보");
    c3.appendChild(ft.table); root.appendChild(c3);

    // 국가간 10년 스프레드
    var cross = [
      { label: "KTB − UST 10y", a: "ktb10y", b: "ust0y" },
      { label: "KTB − JGB 10y", a: "ktb10y", b: "jpy10y" },
      { label: "KTB − Bund 10y", a: "ktb10y", b: "ger10y" },
      { label: "KTB − 호주 10y", a: "ktb10y", b: "aud10y" },
    ];
    var ct = table(["국가간 10년", "현재(bp)", "60일전", "1년 z"]);
    cross.forEach(function (c) {
      if (!seriesById(c.b)) return;
      var ds = diffSeries(c.a, c.b);
      var cur = lastNonNull(ds) * 100, d60 = valAtIdx(ds, ds.length - 1 - 60) * 100;
      var z = zscore(ds.slice(-252).map(function (x) { return x == null ? null : x * 100; }), cur);
      ct.body.appendChild(row([c.label, cur.toFixed(1), d60.toFixed(1), { html: fmt(z), cls: signClass(z) }]));
    });
    var c4 = card("국가간 10년 스프레드 (bp)");
    c4.appendChild(ct.table); root.appendChild(c4);

    // 치프/리치 잔차 — KTB 커브에 3차 다항 적합 후 잔차(bp)
    var fit = fitPolyCurve(ktb, 3);
    var rt = table(["만기", "금리(%)", "적합치(%)", "잔차(bp)", "밸류"]);
    var resids = [];
    ktb.forEach(function (c, i) {
      var resid = (c.last - fit[i]) * 100;
      resids.push({ tenor: c.tenor, resid: resid });
      var val = resid > 3 ? "치프(매수)" : (resid < -3 ? "리치(매도)" : "중립");
      rt.body.appendChild(row([c.tenor + "y", fmt(c.last, 2), fmt(fit[i], 2),
        { html: bp(resid), cls: signClass(resid) }, val]));
    });
    var c5 = card("치프/리치 — 3차 다항 페어밸류 대비 잔차 (＋: 금리 높음=치프=매수후보)");
    c5.appendChild(lineChart([{ name: "잔차(bp)", color: COLORS[4], pts: resids.map(function (r) { return r.resid; }), markers: true }],
      { height: 160, xlabels: resids.map(function (r) { return r.tenor + "y"; }), zeroLine: false }));
    c5.appendChild(rt.table);
    c5.appendChild(el("p", "bq-note", "※ 페어밸류는 커브 전체에 3차 다항을 최소제곱 적합한 값입니다(투명한 근사치). 잔차가 클수록 커브 대비 저평가/고평가."));
    root.appendChild(c5);
  }

  // 다항 최소제곱 적합 (tenor→yield), 반환: 각 점의 적합치
  function fitPolyCurve(curve, deg) {
    var X = curve.map(function (c) { var r = []; for (var d = 0; d <= deg; d++) r.push(Math.pow(c.tenor, d)); return r; });
    var y = curve.map(function (c) { return c.last; });
    var res = ols(X, y);
    if (!res) return curve.map(function (c) { return c.last; });
    return curve.map(function (c) { var v = 0; for (var d = 0; d <= deg; d++) v += res.beta[d] * Math.pow(c.tenor, d); return v; });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 2: 캐리 & 롤다운
  // ════════════════════════════════════════════════════════════════════════
  function renderCarry(root) {
    root.appendChild(sectionTitle("캐리 & 롤다운", "만기별 carry+roll · 크레딧 캐리 · FX헤지 해외물 캐리(CIP 근사)"));

    var ktb = buildCurve("국채금리 · 한국");
    var fund = lastVal("ktb3m"); // 단기자금 프록시
    var horizons = [{ h: 0.25, lbl: "3M" }, { h: 0.5, lbl: "6M" }, { h: 1, lbl: "12M" }];

    // 만기별 캐리+롤 (12M 기준 정렬 테이블 + 총수익 막대)
    var ct = table(["만기", "금리%", "ModDur", "캐리%(12M)", "롤%(12M)", "총%(12M)", "3M", "6M"]);
    var totals12 = [];
    ktb.forEach(function (c) {
      if (c.tenor < 0.5) return;
      var D = modDur(c.last, c.tenor);
      var byH = horizons.map(function (hz) {
        var carry = (c.last - fund) * hz.h;                 // %
        var yRoll = yieldAtTenor(ktb, c.tenor - hz.h);      // 롤 후 금리
        var roll = (yRoll != null) ? D * (c.last - yRoll) : 0; // %
        return { carry: carry, roll: roll, total: carry + roll };
      });
      totals12.push({ tenor: c.tenor, total: byH[2].total });
      ct.body.appendChild(row([
        c.tenor + "y", fmt(c.last, 2), fmt(D, 1),
        { html: pct(byH[2].carry), cls: signClass(byH[2].carry) },
        { html: pct(byH[2].roll), cls: signClass(byH[2].roll) },
        { html: "<b>" + pct(byH[2].total) + "</b>", cls: signClass(byH[2].total) },
        pct(byH[0].total), pct(byH[1].total),
      ]));
    });
    var c1 = card("KTB 만기별 캐리 + 롤다운 (단기자금 " + fmt(fund, 2) + "% 대비, 총수익 근사)");
    c1.appendChild(lineChart([{ name: "총수익 12M(%)", color: COLORS[2], pts: totals12.map(function (t) { return t.total; }), markers: true }],
      { height: 160, xlabels: totals12.map(function (t) { return t.tenor + "y"; }), zeroLine: true }));
    c1.appendChild(ct.table);
    c1.appendChild(el("p", "bq-note", "※ 캐리=(금리−단기자금)×기간, 롤=ModDur×(현재금리−롤후금리). 총수익=캐리+롤(자본손익·컨벡시티 제외 근사)."));
    root.appendChild(c1);

    // 크레딧 캐리 — 등급·만기별 스프레드(대 국고) + 캐리
    var creditDefs = [
      { name: "공사채 AAA 3y", id: "public_aaa_3y", ktb: 3 },
      { name: "산금채 AAA 3y", id: "kdb_aaa_3y", ktb: 3 },
      { name: "은행채 AAA 2y", id: "bank_aaa_2y", ktb: 2 },
      { name: "회사채 AAA 3y", id: "corp_aaa_3y", ktb: 3 },
      { name: "회사채 AA 3y", id: "corp_aa_zero_3y", ktb: 3 },
      { name: "회사채 AA 5y", id: "corp_aa_zero_5y", ktb: 5 },
      { name: "회사채 A 3y", id: "corp_a_zero_3y", ktb: 3 },
      { name: "카드채 AA 3y", id: "card_aa_3y", ktb: 3 },
    ];
    var kt = table(["섹터/등급", "YTM%", "국고대비 스프레드(bp)", "60일전", "1년 z", "캐리(연,%)"]);
    creditDefs.forEach(function (d) {
      var s = seriesById(d.id); if (!s) return;
      var ktbId = tenorToKtbId(d.ktb);
      var ds = []; var ktbS = seriesById(ktbId).values;
      for (var i = 0; i < s.values.length; i++) ds.push((s.values[i] != null && ktbS[i] != null) ? (s.values[i] - ktbS[i]) * 100 : null);
      var cur = lastNonNull(ds), d60 = valAtIdx(ds, ds.length - 1 - 60);
      var z = zscore(ds.slice(-252), cur);
      var ytm = lastNonNull(s.values);
      kt.body.appendChild(row([d.name, fmt(ytm, 2), cur.toFixed(1), d60.toFixed(1),
        { html: fmt(z), cls: signClass(z) }, pct(ytm - fund)]));
    });
    var c2 = card("크레딧 스프레드 & 캐리 (국고 매칭만기 대비)");
    c2.appendChild(kt.table);
    c2.appendChild(el("p", "bq-note", "※ z>1이면 스프레드가 역사적으로 넓음(캐리 매력↑/약세우려), z<−1이면 타이트(밸류 부담)."));
    root.appendChild(c2);

    // FX헤지 해외물 캐리 — CIP 근사: 헤지금리 ≈ 해외10y − (해외3m − KTB3m)
    var ktb3m = lastVal("ktb3m"), ktb10 = lastVal("ktb10y");
    var foreign = [
      { name: "UST 10y", y10: "ust0y", y3m: "ust3m" },
      { name: "JGB 10y", y10: "jpy10y", y3m: null, short: "boj_pr" },
      { name: "Bund 10y", y10: "ger10y", y3m: null, short: "ecb_mro" },
      { name: "호주 10y", y10: "aud10y", y3m: null, short: "aud_pr" },
    ];
    var ht = table(["해외물", "현지YTM%", "단기금리%", "헤지후 KRW환산%", "KTB10y대비 픽업(bp)"]);
    foreign.forEach(function (f) {
      var y10 = lastVal(f.y10); if (y10 == null) return;
      var yShort = f.y3m ? lastVal(f.y3m) : lastVal(f.short);
      var hedged = y10 - (yShort - ktb3m);
      var pickup = (hedged - ktb10) * 100;
      ht.body.appendChild(row([f.name, fmt(y10, 2), fmt(yShort, 2), fmt(hedged, 2),
        { html: bp(pickup), cls: signClass(pickup) }]));
    });
    var c3 = card("FX헤지 해외국채 캐리 (원화 환산, CIP 근사)");
    c3.appendChild(ht.table);
    c3.appendChild(el("p", "bq-note", "※ 헤지후금리 ≈ 해외10y − (해외단기 − KTB3m). 단기금리차만큼 헤지비용으로 차감하는 표준 근사. 실제 베이시스(통화스왑)와는 차이 있을 수 있음."));
    root.appendChild(c3);
  }

  // 근사 수정듀레이션 (par bond): D ≈ (1 − (1+y)^-T) / y
  function modDur(yPct, T) { var y = yPct / 100; if (y <= 0) return T; return (1 - Math.pow(1 + y, -T)) / y; }
  // 커브에서 임의 만기 금리 (선형보간)
  function yieldAtTenor(curve, T) {
    if (T <= curve[0].tenor) return curve[0].last;
    for (var i = 1; i < curve.length; i++) {
      if (curve[i].tenor >= T) {
        var a = curve[i - 1], b = curve[i];
        return a.last + (b.last - a.last) * (T - a.tenor) / (b.tenor - a.tenor);
      }
    }
    return curve[curve.length - 1].last;
  }
  function tenorToKtbId(t) {
    var map = { 2: "ktb2y", 3: "ktb3y", 5: "ktb5y", 10: "ktb10y" };
    return map[t] || "ktb3y";
  }

  // 키레이트 듀레이션: 각 보유물 듀레이션을 인접 키레이트 버킷에 만기기준 선형 배분
  var KEY_RATES = [2, 5, 10, 20];
  function keyRateDuration(holdings) {
    var krd = {}; KEY_RATES.forEach(function (k) { krd[k] = 0; });
    holdings.forEach(function (h) {
      var contrib = h.weight * h.duration;
      var T = h.tenor;
      if (T <= KEY_RATES[0]) { krd[KEY_RATES[0]] += contrib; return; }
      if (T >= KEY_RATES[KEY_RATES.length - 1]) { krd[KEY_RATES[KEY_RATES.length - 1]] += contrib; return; }
      for (var i = 1; i < KEY_RATES.length; i++) {
        if (KEY_RATES[i] >= T) {
          var lo = KEY_RATES[i - 1], hi = KEY_RATES[i];
          var wHi = (T - lo) / (hi - lo);
          krd[hi] += contrib * wHi; krd[lo] += contrib * (1 - wHi);
          return;
        }
      }
    });
    return krd;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 3: 매크로 레짐
  // ════════════════════════════════════════════════════════════════════════
  function renderRegime(root) {
    root.appendChild(sectionTitle("매크로 레짐 스코어", "시장내재 팩터(성장/물가/정책/유동성)로 듀레이션·크레딧 스탠스 판별"));

    // 팩터 시계열 구성 (모두 rateData 기반, 신뢰도 높음)
    var slope = diffSeries("ktb10y", "ktb2y");             // 성장 기대 ↑ = 스티프
    var creditSpr = []; var corp = seriesById("corp_aa_zero_3y"), k3 = seriesById("ktb3y");
    for (var i = 0; i < corp.values.length; i++) creditSpr.push((corp.values[i] != null && k3.values[i] != null) ? (corp.values[i] - k3.values[i]) * 100 : null);
    var bei = seriesById("ktb_bei10y").values;             // 기대인플레
    var y2 = seriesById("ktb2y").values;                   // 정책기대(시장내재)
    var hy = seriesById("us_hy_sp") ? seriesById("us_hy_sp").values : null; // 글로벌 위험선호

    function curZ(arr, win) { return zscore(arr.slice(-(win || 252)), lastNonNull(arr)); }
    function chgZ(arr, lag, win) {
      var ch = []; for (var i = lag; i < arr.length; i++) ch.push((arr[i] != null && arr[i - lag] != null) ? arr[i] - arr[i - lag] : null);
      return zscore(ch.slice(-(win || 252)), lastNonNull(ch));
    }

    // 4개 팩터 (양수 = 해당 방향 강함)
    var fGrowth = 0.6 * curZ(slope.map(function (x) { return x == null ? null : x * 100; })) - 0.4 * curZ(creditSpr);
    var fInfl = 0.7 * curZ(bei) + 0.3 * chgZ(bei, 20);
    var fPolicy = chgZ(y2, 60);                  // +면 금리 상승(긴축기대), −면 완화기대
    var fLiquidity = -0.6 * curZ(creditSpr) + (hy ? -0.4 * curZ(hy) : 0); // +면 유동성 풍부/위험선호

    // 듀레이션 스탠스: 성장↓·물가↓·정책완화 → 롱 (금리하락 베팅)
    var durSignal = -0.35 * fGrowth - 0.35 * fInfl - 0.30 * fPolicy;   // + = 듀레이션 롱
    // 크레딧 스탠스: 유동성 풍부 + 성장 양호 → 크레딧 확대
    var creditSignal = 0.6 * fLiquidity + 0.4 * fGrowth;

    // 레짐 사분면 (성장 × 물가)
    var regime;
    if (fGrowth >= 0 && fInfl >= 0) regime = { name: "리플레이션", desc: "성장·물가 동반 상승 → 단기 언더웨이트, 커브 스티프너, 크레딧 우호", color: "#dc2626" };
    else if (fGrowth >= 0 && fInfl < 0) regime = { name: "골디락스", desc: "성장 양호·물가 안정 → 캐리 극대화, 크레딧·중기물 선호", color: "#059669" };
    else if (fGrowth < 0 && fInfl >= 0) regime = { name: "스태그플레이션", desc: "성장 둔화·물가 상승 → 방어적, 듀레이션 중립·크레딧 축소", color: "#d97706" };
    else regime = { name: "디플레이션/침체", desc: "성장·물가 동반 둔화 → 듀레이션 롱, 국채 오버웨이트, 크레딧 축소", color: "#2563eb" };

    // 레짐 배너
    var banner = card("현재 레짐 판정");
    var bwrap = el("div", "bq-regime");
    bwrap.innerHTML =
      '<div class="bq-regime-badge" style="background:' + regime.color + '">' + regime.name + '</div>' +
      '<div class="bq-regime-desc">' + regime.desc + '</div>';
    banner.appendChild(bwrap);
    root.appendChild(banner);

    // 팩터 게이지
    var gt = table(["팩터", "z스코어", "국면", "채권 함의"]);
    [
      { n: "성장(Growth)", v: fGrowth, up: "확장", dn: "둔화", imp: "확장 시 커브 스티프·크레딧 우호" },
      { n: "물가(Inflation)", v: fInfl, up: "상승", dn: "안정", imp: "상승 시 듀레이션 부담" },
      { n: "정책(Policy)", v: fPolicy, up: "긴축기대", dn: "완화기대", imp: "완화기대 시 단기물 강세" },
      { n: "유동성(Liquidity)", v: fLiquidity, up: "풍부/위험선호", dn: "경색/회피", imp: "풍부 시 크레딧 캐리 유리" },
    ].forEach(function (f) {
      gt.body.appendChild(row([f.n, { html: gauge(f.v), cls: "" }, f.v >= 0 ? f.up : f.dn, f.imp]));
    });
    var c1 = card("매크로 팩터 (z스코어, 최근 1년 대비)");
    c1.appendChild(gt.table); root.appendChild(c1);

    // 스탠스 결론
    var stanceDur = durSignal > 0.3 ? "듀레이션 롱(비중확대)" : (durSignal < -0.3 ? "듀레이션 숏(비중축소)" : "듀레이션 중립");
    var stanceCr = creditSignal > 0.3 ? "크레딧 확대(스프레드 축소 베팅)" : (creditSignal < -0.3 ? "크레딧 축소(퀄리티 상향)" : "크레딧 중립");
    var sc = card("운용 스탠스 시그널");
    var st = table(["축", "시그널", "점수"]);
    st.body.appendChild(row([{ html: "<b>듀레이션</b>" }, stanceDur, { html: fmt(durSignal), cls: signClass(durSignal) }]));
    st.body.appendChild(row([{ html: "<b>크레딧</b>" }, stanceCr, { html: fmt(creditSignal), cls: signClass(creditSignal) }]));
    sc.appendChild(st.table);
    sc.appendChild(el("p", "bq-note", "※ 시장내재 신호(커브·BEI·스프레드·2년물)로 산출한 정량 참고치입니다. 사내 매크로 전망과 교차검증해 최종 판단하세요."));
    if (IN.macroNote) sc.appendChild(el("p", "bq-note", "사내 메모: " + IN.macroNote));
    root.appendChild(sc);
  }

  function gauge(z) {
    var clamped = Math.max(-2.5, Math.min(2.5, z));
    var pctPos = (clamped + 2.5) / 5 * 100;
    var col = z > 0.3 ? "#dc2626" : (z < -0.3 ? "#2563eb" : "#9ca3af");
    return '<span class="bq-gauge"><span class="bq-gauge-fill" style="left:' + pctPos + '%;background:' + col + '"></span></span>' +
      '<span class="' + signClass(z) + '" style="margin-left:6px">' + fmt(z) + '</span>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 4: 시나리오 & DV01
  // ════════════════════════════════════════════════════════════════════════
  var SCENARIOS = [
    { key: "bull_para", name: "강세 평행이동 −50bp", short: -0.50, long: -0.50, credit: 0 },
    { key: "bear_para", name: "약세 평행이동 +50bp", short: 0.50, long: 0.50, credit: 0 },
    { key: "bull_steep", name: "불 스티프너 (단기−50/장기−10)", short: -0.50, long: -0.10, credit: 0 },
    { key: "bear_steep", name: "베어 스티프너 (단기+10/장기+50)", short: 0.10, long: 0.50, credit: 0 },
    { key: "bull_flat", name: "불 플래트너 (단기−10/장기−50)", short: -0.10, long: -0.50, credit: 0 },
    { key: "bear_flat", name: "베어 플래트너 (단기+50/장기+10)", short: 0.50, long: 0.10, credit: 0 },
    { key: "credit_wide", name: "크레딧 확대 +30bp", short: 0, long: 0, credit: 0.30 },
    { key: "risk_off", name: "리스크오프 (금리−30/크레딧+50)", short: -0.30, long: -0.30, credit: 0.50 },
  ];

  function renderScenario(root) {
    root.appendChild(sectionTitle("시나리오 & DV01", "커브 시나리오별 포트폴리오/벤치마크/액티브 손익 · DV01 테이블"));

    var holdings = IN.fund.holdings || [];
    if (!holdings.length) { root.appendChild(card("보유내역(holdings)이 없습니다. bond-quant-internal.js 의 fund.holdings 를 채우세요.")); return; }

    // 포트폴리오 요약
    var totW = holdings.reduce(function (a, h) { return a + h.weight; }, 0);
    var portDur = holdings.reduce(function (a, h) { return a + h.weight * h.duration; }, 0);
    var portYtm = holdings.reduce(function (a, h) { return a + h.weight * h.ytm; }, 0);
    var bmDur = (IN.benchmark && IN.benchmark.duration != null) ? IN.benchmark.duration : null;

    var sm = card("포트폴리오 요약");
    var smt = table(["항목", "값"]);
    smt.body.appendChild(row(["보유 비중 합", pct(totW * 100, 1).replace("+", "")]));
    smt.body.appendChild(row(["가중 듀레이션", fmt(portDur, 2) + "년"]));
    smt.body.appendChild(row(["가중 YTM", fmt(portYtm, 2) + "%"]));
    smt.body.appendChild(row(["DV01 (100억 기준, 1bp)", fmt(portDur * 100 * 0.0001 * 100, 2) + "백만원 근사"]));
    if (bmDur != null) {
      smt.body.appendChild(row([{ html: "<b>액티브 듀레이션 (내펀드 − BM)</b>" },
        { html: "<b>" + fmt(portDur - bmDur, 2) + "년</b>", cls: signClass(portDur - bmDur) }]));
    }
    sm.appendChild(smt.table); root.appendChild(sm);

    // 섹터별 듀레이션 기여
    var bySector = {};
    holdings.forEach(function (h) { bySector[h.sector] = (bySector[h.sector] || 0) + h.weight * h.duration; });
    var secT = table(["섹터", "듀레이션 기여(년)", "비중가중 기여도"]);
    Object.keys(bySector).forEach(function (s) {
      secT.body.appendChild(row([s, fmt(bySector[s], 2), pct(bySector[s] / portDur * 100, 1).replace("+", "")]));
    });
    var sc = card("섹터별 듀레이션 기여");
    sc.appendChild(secT.table); root.appendChild(sc);

    // 키레이트 듀레이션(KRD) — 각 보유물 듀레이션을 인접 키레이트에 선형 배분
    var krd = keyRateDuration(holdings);
    var krT = table(["키레이트", "KRD(년)", "듀레이션 비중", "+25bp 충격시 손익%"]);
    KEY_RATES.forEach(function (k) {
      krT.body.appendChild(row([k + "y", fmt(krd[k], 2),
        pct(krd[k] / portDur * 100, 1).replace("+", ""),
        { html: pct(-krd[k] * 0.25), cls: signClass(-krd[k] * 0.25) }]));
    });
    var kc = card("키레이트 듀레이션(KRD) — 커브 구간별 금리민감도");
    kc.appendChild(lineChart([{ name: "KRD(년)", color: COLORS[3], pts: KEY_RATES.map(function (k) { return krd[k]; }), markers: true }],
      { height: 150, xlabels: KEY_RATES.map(function (k) { return k + "y"; }), zeroLine: true }));
    kc.appendChild(krT.table);
    kc.appendChild(el("p", "bq-note", "※ 각 보유물의 듀레이션을 인접한 두 키레이트에 만기 기준 선형 배분(합계=총듀레이션). 특정 구간만 움직일 때(커브 트위스트)의 손익을 봅니다. 예: 10y KRD가 크면 장기물 금리 상승에 취약."));
    root.appendChild(kc);

    // 시나리오 손익 — 각 보유물의 만기로 short/long 충격 배분
    // 만기<=2y: short충격, >=10y: long충격, 사이: 선형보간. 크레딧 섹터는 credit충격 추가.
    function shockYield(tenor, sc) {
      var w = tenor <= 2 ? 0 : (tenor >= 10 ? 1 : (tenor - 2) / 8);
      return sc.short * (1 - w) + sc.long * w;
    }
    function isCredit(sector) { return ["회사채", "여전채", "은행채", "특수채"].indexOf(sector) >= 0; }

    var scT = table(["시나리오", "내 펀드 손익%", "벤치마크 손익%", "액티브(초과)%"]);
    var portReturns = [];
    SCENARIOS.forEach(function (s) {
      var portPnl = 0;
      holdings.forEach(function (h) {
        var dy = shockYield(h.tenor, s) + (isCredit(h.sector) ? s.credit : 0);
        portPnl += h.weight * (-h.duration * dy);   // %
      });
      // 벤치마크: 듀레이션만 아는 경우 평행이동 근사(크레딧 충격은 BM 크레딧비중 미상 → 국채가정)
      var bmPnl = null;
      if (bmDur != null) {
        var bmDy = (s.short + s.long) / 2;
        bmPnl = -bmDur * bmDy;
      }
      portReturns.push(portPnl);
      scT.body.appendChild(row([
        s.name,
        { html: "<b>" + pct(portPnl) + "</b>", cls: signClass(portPnl) },
        bmPnl == null ? "–" : { html: pct(bmPnl), cls: signClass(bmPnl) },
        bmPnl == null ? "–" : { html: pct(portPnl - bmPnl), cls: signClass(portPnl - bmPnl) },
      ]));
    });
    var c1 = card("시나리오별 손익 (자본손익 근사, 캐리 제외)");
    c1.appendChild(lineChart([{ name: "내 펀드 손익%", color: COLORS[0], pts: portReturns, markers: true }],
      { height: 160, xlabels: SCENARIOS.map(function (s, i) { return "S" + (i + 1); }), zeroLine: true }));
    c1.appendChild(scT.table);
    c1.appendChild(el("p", "bq-note", "※ 손익 = Σ 비중×(−듀레이션×금리충격). 만기 2y↓=단기충격, 10y↑=장기충격, 사이는 선형보간. 크레딧섹터는 스프레드 충격 추가."));
    root.appendChild(c1);

    // 보유물별 DV01
    var dvT = table(["종목", "섹터", "비중%", "듀레이션", "DV01기여(bp당,%)"]);
    holdings.forEach(function (h) {
      dvT.body.appendChild(row([h.name, h.sector, fmt(h.weight * 100, 1), fmt(h.duration, 1),
        fmt(h.weight * h.duration * 0.0001 * 100, 4)]));
    });
    var c2 = card("보유물별 듀레이션/DV01 기여");
    c2.appendChild(dvT.table); root.appendChild(c2);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 5: 경쟁사 비교 (핵심)
  // ════════════════════════════════════════════════════════════════════════
  function renderPeers(root) {
    root.appendChild(sectionTitle("경쟁사 비교 (기준가 기반)", "누적수익·위험지표 + 수익률기반 스타일분석으로 듀레이션·크레딧 노출 역추정"));

    // 비교 대상: 내펀드 + 벤치마크 + 경쟁사들
    var funds = [];
    if (IN.fund && IN.fund.nav && IN.fund.nav.length) funds.push({ name: IN.fund.name, nav: IN.fund.nav, isMine: true });
    if (IN.benchmark && IN.benchmark.nav && IN.benchmark.nav.length) funds.push({ name: IN.benchmark.name, nav: IN.benchmark.nav, isBm: true });
    (IN.peers || []).forEach(function (p) { if (p.nav && p.nav.length) funds.push({ name: p.name, nav: p.nav }); });
    if (funds.length < 2) { root.appendChild(card("비교할 기준가(NAV) 데이터가 부족합니다. bond-quant-internal.js 의 fund/benchmark/peers.nav 를 채우세요.")); return; }

    // 누적수익 차트 (공통 시작=100)
    var series = funds.map(function (f, i) {
      var base = f.nav[0].value;
      return { name: f.name, color: f.isMine ? "#111827" : (f.isBm ? "#9ca3af" : COLORS[i % COLORS.length]),
        pts: f.nav.map(function (p) { return p.value != null ? p.value / base * 100 : null; }) };
    });
    var c1 = card("누적 기준가 추이 (시작=100)");
    c1.appendChild(lineChart(series, { height: 250, legend: true,
      xlabels: funds[0].nav.map(function (p) { return p.date.slice(2, 7); }) }));
    root.appendChild(c1);

    // 성과/위험 지표 테이블
    var pt = table(["펀드", "누적%", "연율%", "변동성%", "샤프근사", "MDD%"]);
    funds.forEach(function (f) {
      var r = navReturns(f.nav);
      var cum = (f.nav[f.nav.length - 1].value / f.nav[0].value - 1) * 100;
      var yrs = r.ret.length / 252;
      var ann = (Math.pow(f.nav[f.nav.length - 1].value / f.nav[0].value, 1 / Math.max(yrs, 0.1)) - 1) * 100;
      var vol = std(r.ret) * Math.sqrt(252);
      var sharpe = vol ? ann / vol : null;
      var mdd = maxDrawdown(f.nav);
      pt.body.appendChild(row([
        { html: (f.isMine ? "★ " : "") + f.name, cls: f.isMine ? "bq-mine" : "" },
        { html: pct(cum), cls: signClass(cum) }, pct(ann), fmt(vol, 2), fmt(sharpe, 2),
        { html: fmt(mdd, 2), cls: "neg" }]));
    });
    var c2 = card("성과 · 위험 지표");
    c2.appendChild(pt.table);
    c2.appendChild(el("p", "bq-note", "※ 무위험이자율 0 가정 샤프 근사. 기간은 각 펀드 기준가 데이터 구간."));
    root.appendChild(c2);

    // ── 수익률기반 스타일분석: 듀레이션/크레딧 노출 역추정 ────────────────────
    // 팩터 일간수익률(%) 구성: 국고10년 변화, 커브(10y-2y) 변화, 크레딧(회사AA3y-국고3y) 변화
    var d10 = seriesById("ktb10y").values, d2 = seriesById("ktb2y").values;
    var corp = seriesById("corp_aa_zero_3y").values, k3 = seriesById("ktb3y").values;
    var factorByDate = {};
    for (var i = 1; i < RD.dates.length; i++) {
      var dt = RD.dates[i];
      if (d10[i] == null || d10[i - 1] == null) continue;
      var dLevel = (d10[i] - d10[i - 1]);                          // %p
      var dSlope = ((d10[i] - d2[i]) - (d10[i - 1] - d2[i - 1]));  // %p
      var dCred = (corp[i] != null && corp[i - 1] != null && k3[i] != null && k3[i - 1] != null)
        ? ((corp[i] - k3[i]) - (corp[i - 1] - k3[i - 1])) : 0;      // %p
      factorByDate[dt] = { level: dLevel, slope: dSlope, cred: dCred };
    }

    var styT = table(["펀드", "내재 듀레이션(년)", "내재 커브β", "내재 크레딧β", "R²", "표본일수"]);
    var mineDur = null;
    var implied = [];
    funds.forEach(function (f) {
      var r = navReturns(f.nav);
      var X = [], y = [];
      for (var j = 0; j < r.dates.length; j++) {
        var fac = factorByDate[r.dates[j]];
        if (!fac) continue;
        // 회귀: ret% ≈ b0 + bL*Δlevel + bS*Δslope + bC*Δcred
        X.push([1, fac.level, fac.slope, fac.cred]);
        y.push(r.ret[j]);
      }
      if (X.length < 30) { styT.body.appendChild(row([f.name, "표본부족", "", "", "", X.length])); return; }
      var res = ols(X, y);
      if (!res) { styT.body.appendChild(row([f.name, "추정실패", "", "", "", X.length])); return; }
      // ret% ≈ −Dur×Δy(%p) ⇒ 내재듀레이션 = −bL
      var impDur = -res.beta[1];
      var curveB = -res.beta[2];
      var credB = -res.beta[3];
      if (f.isMine) mineDur = impDur;
      implied.push({ name: f.name, dur: impDur, isMine: f.isMine, isBm: f.isBm });
      styT.body.appendChild(row([
        { html: (f.isMine ? "★ " : "") + f.name, cls: f.isMine ? "bq-mine" : "" },
        { html: "<b>" + fmt(impDur, 1) + "</b>" }, fmt(curveB, 1), fmt(credB, 1),
        fmt(res.r2, 2), res.n]));
    });
    var c3 = card("수익률기반 스타일분석 — 기준가만으로 노출 역추정");
    c3.appendChild(styT.table);
    c3.appendChild(el("p", "bq-note", "핵심: 경쟁사 보유내역을 몰라도 기준가 일간수익률을 커브/크레딧 팩터에 회귀하면 <b>내재 듀레이션</b>(=금리민감도)과 크레딧 노출을 추정할 수 있습니다. 내재듀레이션↑ = 더 공격적(장기·금리베팅), 크레딧β↑ = 스프레드 확대 베팅. R²가 낮으면 추정 신뢰도 주의(비국내채권·파생·타이밍 요인)."));
    root.appendChild(c3);

    // 내재 듀레이션 랭킹 바
    if (implied.length) {
      implied.sort(function (a, b) { return b.dur - a.dur; });
      var rankT = table(["순위", "펀드", "내재 듀레이션", "내 펀드 대비"]);
      implied.forEach(function (x, idx) {
        rankT.body.appendChild(row([
          (idx + 1) + "", { html: (x.isMine ? "★ " : "") + x.name, cls: x.isMine ? "bq-mine" : "" },
          fmt(x.dur, 1) + "년",
          mineDur == null ? "–" : { html: (x.isMine ? "—" : (x.dur - mineDur >= 0 ? "+" : "") + fmt(x.dur - mineDur, 1) + "년"), cls: x.isMine ? "" : signClass(x.dur - mineDur) }]));
      });
      var c4 = card("내재 듀레이션 랭킹 — 누가 더 공격적인가");
      c4.appendChild(rankT.table);
      if (mineDur != null) {
        var moreAgg = implied.filter(function (x) { return !x.isMine && !x.isBm && x.dur > mineDur; }).length;
        c4.appendChild(el("p", "bq-note", "내 펀드보다 듀레이션이 긴(더 공격적) 경쟁사: " + moreAgg + "곳. 금리 하락 국면이면 이들이 앞서고, 상승 국면이면 내가 방어우위."));
      }
      root.appendChild(c4);
    }

    // ── 롤링 스타일분석: 내재 듀레이션의 "시간에 따른 변화" 추적 ────────────────
    // 경쟁사가 언제 듀레이션을 늘렸는지/줄였는지(포지션 변화)를 봅니다.
    var W = 60, step = 5;
    function rollingDur(fund) {
      var r = navReturns(fund.nav);
      var byDate = {};
      for (var e = W; e <= r.dates.length; e += step) {
        var X = [], y = [];
        for (var j = e - W; j < e; j++) {
          var fac = factorByDate[r.dates[j]];
          if (!fac) continue;
          X.push([1, fac.level, fac.slope, fac.cred]); y.push(r.ret[j]);
        }
        if (X.length < W * 0.6) continue;
        var res = ols(X, y);
        if (res) byDate[r.dates[e - 1]] = -res.beta[1];
      }
      return byDate;
    }
    var rollMaps = funds.filter(function (f) { return !f.isBm; }).map(function (f) { return { f: f, m: rollingDur(f) }; });
    var allDates = {};
    rollMaps.forEach(function (rm) { Object.keys(rm.m).forEach(function (d) { allDates[d] = 1; }); });
    var masterDates = Object.keys(allDates).sort();
    if (masterDates.length > 2) {
      var rollSeries = rollMaps.map(function (rm, i) {
        return { name: (rm.f.isMine ? "★ " : "") + rm.f.name,
          color: rm.f.isMine ? "#111827" : COLORS[i % COLORS.length],
          pts: masterDates.map(function (d) { return rm.m[d] != null ? rm.m[d] : null; }) };
      });
      var c5 = card("롤링 내재 듀레이션 (60영업일 창) — 경쟁사 포지션 변화 추적");
      c5.appendChild(lineChart(rollSeries, { height: 240, legend: true,
        xlabels: masterDates.map(function (d) { return d.slice(2, 7); }) }));
      c5.appendChild(el("p", "bq-note", "선이 위로 = 듀레이션 확대(공격적으로 전환), 아래로 = 축소(방어적 전환). 경쟁사가 금리 방향에 언제 베팅을 키웠는지 시점을 읽을 수 있습니다. 창이 60일이라 최근 급변은 지연 반영됨."));
      root.appendChild(c5);
    }
  }

  function maxDrawdown(nav) {
    var peak = -Infinity, mdd = 0;
    for (var i = 0; i < nav.length; i++) {
      if (nav[i].value == null) continue;
      if (nav[i].value > peak) peak = nav[i].value;
      var dd = (nav[i].value / peak - 1) * 100;
      if (dd < mdd) mdd = dd;
    }
    return mdd;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 모듈 6: 백테스트 (커브/크레딧 트레이드의 과거 성과)
  // ════════════════════════════════════════════════════════════════════════
  // 상수만기(CM) 총수익: 일간 ret% ≈ 캐리(y/252) − ModDur×Δy. (롤다운 제외 근사)
  function cmTotalReturn(seriesId, tenor) {
    var s = seriesById(seriesId); if (!s) return null;
    var v = s.values, out = new Array(v.length).fill(null);
    for (var i = 1; i < v.length; i++) {
      if (v[i] != null && v[i - 1] != null) {
        out[i] = v[i - 1] / 252 - modDur(v[i - 1], tenor) * (v[i] - v[i - 1]);
      }
    }
    return out;
  }
  // DV01중립 가중치용 현재 ModDur
  function curModDur(id, tenor) { var y = lastVal(id); return y == null ? tenor : modDur(y, tenor); }

  function buildTrades() {
    var d2 = curModDur("ktb2y", 2), d5 = curModDur("ktb5y", 5), d10 = curModDur("ktb10y", 10), d30 = curModDur("ktb30y", 30);
    return [
      { name: "KTB 3y 롱 (아웃라이트)", legs: [{ id: "ktb3y", t: 3, w: 1 }] },
      { name: "KTB 10y 롱 (아웃라이트)", legs: [{ id: "ktb10y", t: 10, w: 1 }] },
      { name: "KTB 30y 롱 (아웃라이트)", legs: [{ id: "ktb30y", t: 30, w: 1 }] },
      { name: "2s10s 스티프너 (2y롱/10y숏, DV01중립)", legs: [{ id: "ktb2y", t: 2, w: 1 }, { id: "ktb10y", t: 10, w: -d2 / d10 }] },
      { name: "5s30s 스티프너 (5y롱/30y숏, DV01중립)", legs: [{ id: "ktb5y", t: 5, w: 1 }, { id: "ktb30y", t: 30, w: -d5 / d30 }] },
      { name: "2-5-10 나비 (5y롱/윙숏, DV01중립)", legs: [{ id: "ktb5y", t: 5, w: 1 }, { id: "ktb2y", t: 2, w: -0.5 * d5 / d2 }, { id: "ktb10y", t: 10, w: -0.5 * d5 / d10 }] },
      { name: "회사채AA 3y 롱 vs 국고3y (크레딧)", legs: [{ id: "corp_aa_zero_3y", t: 3, w: 1 }, { id: "ktb3y", t: 3, w: -1 }] },
    ];
  }
  function tradeReturns(trade) {
    var legRets = trade.legs.map(function (lg) { return { w: lg.w, r: cmTotalReturn(lg.id, lg.t) }; });
    var n = RD.dates.length, out = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      var sum = 0, ok = true;
      for (var j = 0; j < legRets.length; j++) { var rv = legRets[j].r; if (!rv || rv[i] == null) { ok = false; break; } sum += legRets[j].w * rv[i]; }
      if (ok) out[i] = sum;
    }
    return out;
  }
  function btStats(rets, lookback) {
    var start = lookback ? Math.max(0, rets.length - lookback) : 0;
    var eq = 100, series = [], daily = [], pos = 0, cnt = 0;
    for (var i = start; i < rets.length; i++) {
      if (rets[i] == null) { series.push(eq); continue; }
      eq = eq * (1 + rets[i] / 100); series.push(eq); daily.push(rets[i]);
      if (rets[i] > 0) pos++; cnt++;
    }
    var cum = eq / 100 - 1;
    var yrs = daily.length / 252;
    var ann = yrs > 0.1 ? (Math.pow(eq / 100, 1 / yrs) - 1) : cum;
    var vol = std(daily) * Math.sqrt(252);
    var peak = -Infinity, mdd = 0;
    series.forEach(function (v) { if (v > peak) peak = v; var dd = v / peak - 1; if (dd < mdd) mdd = dd; });
    return { cum: cum * 100, ann: ann * 100, vol: vol, sharpe: vol ? ann * 100 / vol : null, mdd: mdd * 100, hit: cnt ? pos / cnt * 100 : null, eq: series };
  }

  function renderBacktest(root) {
    root.appendChild(sectionTitle("백테스트", "커브/크레딧 트레이드의 과거 성과 (상수만기 총수익, 캐리+가격 근사·롤다운 제외)"));
    var trades = buildTrades();

    // 성과 요약 테이블 (전체 & 최근 1년)
    var t = table(["트레이드", "전체 누적%", "연율%", "변동성%", "샤프", "MDD%", "적중률%", "1Y 누적%", "1Y 샤프"]);
    var eqSeries = [];
    trades.forEach(function (tr, i) {
      var rets = tradeReturns(tr);
      var all = btStats(rets, null), y1 = btStats(rets, 252);
      eqSeries.push({ name: tr.name.split(" (")[0], color: COLORS[i % COLORS.length], pts: all.eq });
      t.body.appendChild(row([
        tr.name,
        { html: pct(all.cum), cls: signClass(all.cum) }, pct(all.ann), fmt(all.vol, 2), fmt(all.sharpe, 2),
        { html: fmt(all.mdd, 1), cls: "neg" }, fmt(all.hit, 0),
        { html: pct(y1.cum), cls: signClass(y1.cum) }, fmt(y1.sharpe, 2),
      ]));
    });
    var c1 = card("트레이드 성과 요약 (" + RD.dates[0] + " ~ " + RD.dates[RD.dates.length - 1] + ")");
    c1.appendChild(t.table);
    c1.appendChild(el("p", "bq-note", "※ 각 트레이드를 상수만기로 매일 리밸런싱했다고 가정한 총수익(캐리+가격). 스티프너/나비는 현재 ModDur 기준 DV01중립. 실제 매매비용·롤·컨벡시티 제외 — 상대비교/방향성 참고용."));
    root.appendChild(c1);

    // 누적 P&L 차트
    var c2 = card("누적 성과 (시작=100)");
    c2.appendChild(lineChart(eqSeries, { height: 280, legend: true,
      xlabels: RD.dates.map(function (d) { return d.slice(2, 7); }) }));
    root.appendChild(c2);
  }

  // ── DOM 헬퍼: 카드/테이블/섹션 ────────────────────────────────────────────
  function sectionTitle(t, sub) {
    var d = el("div", "bq-sectiontitle");
    d.innerHTML = "<h2>" + t + "</h2>" + (sub ? "<p>" + sub + "</p>" : "");
    return d;
  }
  function card(title) {
    var c = el("div", "bq-card");
    if (title) c.appendChild(el("h3", "bq-cardtitle", title));
    return c;
  }
  function table(headers) {
    var t = el("table", "bq-table");
    var thead = el("thead"), tr = el("tr");
    headers.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    thead.appendChild(tr); t.appendChild(thead);
    var tbody = el("tbody"); t.appendChild(tbody);
    return { table: t, body: tbody };
  }
  function row(cells) {
    var tr = el("tr");
    cells.forEach(function (c) {
      var td = el("td");
      if (c && typeof c === "object") { td.innerHTML = c.html; if (c.cls) td.className = c.cls; }
      else td.textContent = c;
      tr.appendChild(td);
    });
    return tr;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 앱 셸: 탭 네비 + 렌더
  // ════════════════════════════════════════════════════════════════════════
  var TABS = [
    { id: "curve", name: "커브 & RV", render: renderCurveRV },
    { id: "carry", name: "캐리 & 롤다운", render: renderCarry },
    { id: "regime", name: "매크로 레짐", render: renderRegime },
    { id: "scenario", name: "시나리오 & DV01", render: renderScenario },
    { id: "peers", name: "경쟁사 비교", render: renderPeers },
    { id: "backtest", name: "백테스트", render: renderBacktest },
  ];

  function render(tabId) {
    var main = document.getElementById("bq-main");
    main.innerHTML = "";
    var tab = TABS.find(function (t) { return t.id === tabId; }) || TABS[0];
    try { tab.render(main); }
    catch (e) { main.appendChild(card("렌더 오류: " + e.message)); console.error(e); }
    Array.prototype.forEach.call(document.querySelectorAll(".bq-tab"), function (b) {
      b.classList.toggle("active", b.dataset.tab === tab.id);
    });
  }

  function buildShell() {
    var app = document.getElementById("bq-app");
    app.innerHTML = "";
    // 헤더
    var header = el("header", "bq-header");
    var asOf = IN.asOf || "";
    header.innerHTML = '<div class="bq-brand"><b>채권 퀀트·매크로 데스크</b><span>' + (IN.fund ? IN.fund.name : "") + ' · 기준일 ' + asOf + '</span></div>';
    var actions = el("div", "bq-actions");
    var expBtn = el("button", "bq-btn", "🔒 공유용 암호화 export");
    expBtn.onclick = exportEncrypted;
    actions.appendChild(expBtn);
    header.appendChild(actions);
    app.appendChild(header);

    // 샘플데이터 경고
    if (IN.isSampleData) {
      var warn = el("div", "bq-warn", "⚠️ 지금은 <b>샘플(가짜) 데이터</b>로 동작 중입니다. <code>bond-quant-internal.js</code> 에 실제 기준가/보유내역을 넣고 <code>isSampleData: false</code> 로 바꾸세요.");
      app.appendChild(warn);
    }

    // 탭
    var nav = el("nav", "bq-nav");
    TABS.forEach(function (t) {
      var b = el("button", "bq-tab", t.name);
      b.dataset.tab = t.id;
      b.onclick = function () { render(t.id); location.hash = t.id; };
      nav.appendChild(b);
    });
    app.appendChild(nav);
    app.appendChild(el("main", null)).id = "bq-main";
    var main = app.querySelector("main"); main.id = "bq-main";

    var initial = (location.hash || "").replace("#", "") || "curve";
    render(initial);
  }

  // ── 공유용 암호화 export (AES-GCM, PBKDF2) ─────────────────────────────────
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  async function deriveKey(pw, salt) {
    var enc = new TextEncoder();
    var km = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 250000, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function exportEncrypted() {
    var pw = prompt("공유용 파일에 걸 비밀번호를 입력하세요.\n(받는 사람이 이 비밀번호를 입력해야 사내 데이터가 열립니다. 강한 비번을 쓰고 별도 경로로 전달하세요.)");
    if (!pw) return;
    if (pw.length < 8 && !confirm("비밀번호가 8자 미만입니다. 그래도 진행할까요?")) return;
    try {
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var key = await deriveKey(pw, salt);
      var enc = new TextEncoder();
      var internalJson = JSON.stringify(IN);
      var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(internalJson));
      var appJs = await (await fetch("bond-quant.js")).text();
      var css = document.getElementById("bq-style") ? document.getElementById("bq-style").textContent : "";
      var macroJson = JSON.stringify(RD);   // 공개 데이터(평문 OK)
      var payload = { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
      var html = buildStandaloneHtml(css, appJs, macroJson, payload);
      var blob = new Blob([html], { type: "text/html" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "bond-quant-shared-" + (IN.asOf || "export") + ".html";
      a.click();
      alert("암호화된 공유 파일을 다운로드했습니다.\n이 파일은 비밀번호를 아는 사람만 열 수 있습니다. 공개 웹에 올리지 마세요.");
    } catch (e) { alert("export 실패: " + e.message); console.error(e); }
  }

  function buildStandaloneHtml(css, appJs, macroJson, payload) {
    // 자기완결형 HTML: 공개 매크로데이터는 평문, 내부데이터는 암호문. 비번 입력 시 복호화 후 앱 실행.
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>채권 퀀트·매크로 데스크 (공유본)</title>' +
      '<style id="bq-style">' + css + '</style></head><body>' +
      '<div id="bq-lock" style="max-width:420px;margin:15vh auto;font-family:system-ui;text-align:center">' +
      '<h2>🔒 사내 자료</h2><p style="color:#6b7280">이 자료는 비밀번호로 보호됩니다.</p>' +
      '<input id="bq-pw" type="password" placeholder="비밀번호" style="padding:10px;width:100%;box-sizing:border-box;font-size:16px;border:1px solid #d1d5db;border-radius:8px">' +
      '<button id="bq-unlock" style="margin-top:10px;padding:10px 20px;font-size:15px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;width:100%">열기</button>' +
      '<p id="bq-err" style="color:#dc2626;height:20px;margin-top:8px"></p></div>' +
      '<div id="bq-app" style="display:none"></div>' +
      '<script>window.rateData=' + macroJson + ';</scr' + 'ipt>' +
      '<script id="bq-enc" type="application/json">' + JSON.stringify(payload) + '</scr' + 'ipt>' +
      '<script id="bq-appsrc" type="text/plain">' + appJs.replace(/<\/script>/g, "<\\/script>") + '</scr' + 'ipt>' +
      '<script>' + unlockRuntime() + '</scr' + 'ipt>' +
      '</body></html>';
  }

  // 공유본에서 비번 입력→복호화→앱 부팅 하는 런타임 (문자열로 삽입)
  function unlockRuntime() {
    return '(' + function () {
      function fromB64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
      async function unlock() {
        var pw = document.getElementById("bq-pw").value;
        var errEl = document.getElementById("bq-err"); errEl.textContent = "";
        try {
          var p = JSON.parse(document.getElementById("bq-enc").textContent);
          var enc = new TextEncoder();
          var km = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
          var key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(p.salt), iterations: 250000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
          var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(p.iv) }, key, fromB64(p.ct));
          window.BQ_INTERNAL = JSON.parse(new TextDecoder().decode(pt));
          document.getElementById("bq-lock").style.display = "none";
          document.getElementById("bq-app").style.display = "";
          var src = document.getElementById("bq-appsrc").textContent;
          var s = document.createElement("script"); s.textContent = src; document.body.appendChild(s);
          window.BQ.init();
        } catch (e) { errEl.textContent = "비밀번호가 틀렸거나 파일이 손상되었습니다."; }
      }
      document.getElementById("bq-unlock").onclick = unlock;
      document.getElementById("bq-pw").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
    }.toString() + ')()';
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────
  function init() {
    RD = (typeof rateData !== "undefined") ? rateData : window.rateData;
    IN = window.BQ_INTERNAL;
    if (!RD) { document.getElementById("bq-app").innerHTML = "<p style='padding:2rem'>rate-data.js 를 불러오지 못했습니다.</p>"; return; }
    if (!IN) { document.getElementById("bq-app").innerHTML = "<p style='padding:2rem'>bond-quant-internal.js 가 없습니다. bond-quant-internal.sample.js 를 복사해 만드세요.</p>"; return; }
    buildShell();
  }

  window.BQ = { init: init };
})();
