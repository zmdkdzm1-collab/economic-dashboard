// ============================================================================
// bond-quant-internal.sample.js  —  내부 데이터 "템플릿(샘플)"
//
// ⚠️ 이 파일은 구조를 보여주기 위한 예시입니다. 아래 값들은 전부 가짜(합성)입니다.
//
// 실제 사용법:
//   1) 이 파일을 같은 폴더에 `bond-quant-internal.js` 라는 이름으로 "복사"합니다.
//   2) 복사본의 값을 실제 사내 데이터로 바꿉니다.
//   3) `bond-quant-internal.js` 는 .gitignore 에 등록되어 있어 절대 커밋되지 않습니다.
//      (이 .sample 파일만 저장소에 남고, 진짜 데이터는 로컬에만 존재합니다.)
//
// 경쟁사 데이터의 현실적 제약:
//   경쟁사의 보유내역(포트폴리오)은 알 수 없고, 공시되는 "기준가(NAV)"만 압니다.
//   그래서 peers 에는 각 펀드의 기준가 시계열만 넣으면 됩니다. 앱이 기준가
//   수익률을 커브/크레딧 팩터에 회귀해 듀레이션·크레딧 노출을 역추정합니다.
// ============================================================================

(function () {
  // --- 아래는 데모용 합성 시계열 생성기입니다. 실데이터를 넣을 땐 이 블록을 지우고
  //     nav 배열을 직접 [{date:"YYYY-MM-DD", value: 1234.56}, ...] 로 채우세요. -------
  var RD = (typeof rateData !== "undefined") ? rateData : (window.rateData || null);
  // 앱이 회귀에 쓰는 것과 "동일한" 팩터(국고10y 레벨 / 커브10-2 / 크레딧 회사AA3y-국고3y)로
  // 기준가를 생성합니다. 그래야 앱의 스타일분석이 dur/curveB/credB 를 거의 그대로 복원합니다.
  //   dailyRet% ≈ -dur·Δ10y − curveB·Δ(10-2) − credB·Δ(회사AA3y−국고3y) + 캐리 + 노이즈
  function synthNav(dur, curveB, credB, noiseBp, seed) {
    var out = [];
    if (!RD) return out;
    var dates = RD.dates;
    var find = function (id) { var s = RD.series.find(function (x) { return x.id === id; }); return s ? s.values : null; };
    var y10 = find("ktb10y"), y2 = find("ktb2y"), y3 = find("ktb3y"), corp = find("corp_aa_zero_3y");
    if (!y10) return out;
    var start = Math.max(0, dates.length - 500); // 최근 약 500영업일만
    var nav = 1000, rnd = seed || 1;
    var rand = function () { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff - 0.5; };
    for (var i = start; i < dates.length; i++) {
      if (i > start && y10[i] != null && y10[i - 1] != null) {
        var level = y10[i] - y10[i - 1];                                        // %p
        var slope = (y10[i] - y2[i]) - (y10[i - 1] - y2[i - 1]);                // %p
        var cred = (corp[i] != null && corp[i - 1] != null && y3[i] != null && y3[i - 1] != null)
          ? ((corp[i] - y3[i]) - (corp[i - 1] - y3[i - 1])) : 0;                // %p
        var carry = (y10[i - 1]) / 252;                                         // 일간 캐리(%)
        var retPct = -dur * level - curveB * slope - credB * cred + carry + rand() * (noiseBp / 100);
        nav = nav * (1 + retPct / 100);
      }
      out.push({ date: dates[i], value: Math.round(nav * 100) / 100 });
    }
    return out;
  }
  // --------------------------------------------------------------------------

  window.BQ_INTERNAL = {
    asOf: "2026-07-20",           // 데이터 기준일 (표시용)
    isSampleData: true,           // ⚠️ 실데이터로 교체하면 false 로 바꾸세요 (앱이 경고 배너 표시)

    // ── 내 펀드 ───────────────────────────────────────────────────────────
    fund: {
      name: "우리 채권형 펀드 (샘플)",
      nav: synthNav(4.8, 1.0, 1.5, 4, 11),   // (dur, 커브β, 크레딧β, 노이즈bp, seed) ← 실제로는 기준가 시계열을 직접 넣으세요
      // 보유내역: 시나리오/DV01 및 포트폴리오 듀레이션 계산에 사용
      // sector 예: 국채/통안/공사·특수채/은행채/여전채/회사채, rating: AAA/AA+/AA/A 등
      holdings: [
        { name: "국고 26-3",   sector: "국채",   rating: "AAA", tenor: 3,  weight: 0.18, duration: 2.8, ytm: 3.90 },
        { name: "국고 30-5",   sector: "국채",   rating: "AAA", tenor: 10, weight: 0.14, duration: 8.4, ytm: 4.34 },
        { name: "국고 45-2",   sector: "국채",   rating: "AAA", tenor: 20, weight: 0.06, duration: 14.0, ytm: 4.53 },
        { name: "산금채 5y",   sector: "특수채", rating: "AAA", tenor: 5,  weight: 0.12, duration: 4.5, ytm: 4.05 },
        { name: "은행채 2y",   sector: "은행채", rating: "AAA", tenor: 2,  weight: 0.15, duration: 1.9, ytm: 3.85 },
        { name: "회사채 AA 3y", sector: "회사채", rating: "AA",  tenor: 3,  weight: 0.13, duration: 2.8, ytm: 4.30 },
        { name: "카드채 AA 2y", sector: "여전채", rating: "AA",  tenor: 2,  weight: 0.10, duration: 1.9, ytm: 4.20 },
        { name: "현금성",       sector: "현금",   rating: "-",   tenor: 0,  weight: 0.12, duration: 0.1, ytm: 2.80 },
      ],
    },

    // ── 벤치마크 ─────────────────────────────────────────────────────────
    // 예: KIS 종합채권지수, KAP 채권지수 등. 기준가(지수레벨) 시계열 + (알면) 듀레이션.
    benchmark: {
      name: "종합채권지수 (샘플)",
      nav: synthNav(5.2, 0.8, 1.0, 2, 7),
      duration: 5.2,               // 모르면 null 로 두세요
    },

    // ── 경쟁사 펀드 (기준가만 관측 가능) ────────────────────────────────────
    // 여기엔 보유내역을 넣을 수 없습니다. 각 펀드의 공시 기준가만 넣으세요.
    peers: [
      { name: "경쟁사 A (장기·공격형, 샘플)", nav: synthNav(6.5, 1.2, 1.2, 4, 3) },
      { name: "경쟁사 B (중립형, 샘플)",     nav: synthNav(4.5, 0.7, 1.0, 3, 5) },
      { name: "경쟁사 C (단기·방어형, 샘플)", nav: synthNav(2.6, 0.4, 0.8, 3, 9) },
      { name: "경쟁사 D (크레딧 확대, 샘플)", nav: synthNav(4.0, 0.9, 3.0, 5, 13) },
    ],

    // ── (선택) 매크로 레짐 수동 오버라이드 ──────────────────────────────────
    // 시장 데이터로 자동 산출되지만, 사내 전망이 있으면 여기서 가중치나 코멘트를 덧붙일 수 있음.
    macroNote: "",
  };
})();
