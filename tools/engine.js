/* AI 링케어 시제품 - 핵심 로직 (합성 데이터 · 개인 기준선 · 교차검증 판단 · 자동 검증)
 * 모든 데이터는 가상 인물의 합성 데이터입니다. 실제 개인정보를 사용하지 않습니다.
 */
(function (root) {
  'use strict';

  // ───── 재현 가능한 난수 ─────
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function median(a) {
    const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mad(a) { const m = median(a); return median(a.map(x => Math.abs(x - m))); }

  // ───── 가상 어르신 (가명) ─────
  const PERSONAS = [
    { id: 'kim', name: '김순자', age: 84, sex: '여', note: '고혈압 · 자녀는 서울 거주', sleep: [22, 6], hrSleep: 58, hrAwake: 72, steps: 260, temp: 33.4, charge: 19 },
    { id: 'park', name: '박만수', age: 79, sex: '남', note: '당뇨 · 배우자 사별 2년', sleep: [23, 6], hrSleep: 61, hrAwake: 76, steps: 340, temp: 33.1, charge: 20 },
    { id: 'lee', name: '이옥분', age: 87, sex: '여', note: '무릎 관절염 · 외국인 요양보호사 주 3회 방문', sleep: [21, 6], hrSleep: 56, hrAwake: 70, steps: 150, temp: 33.6, charge: 18 },
    { id: 'choi', name: '최영식', age: 91, sex: '남', note: '심방세동 병력(심박 변동 큼) · 보청기 사용', sleep: [22, 6], hrSleep: 64, hrAwake: 78, hrSd: 6, steps: 200, temp: 33.2, charge: 21 },
    { id: 'han', name: '한정자', age: 76, sex: '여', note: '활동적 · 늦게 잠듦 · 경로당 매일 이용', sleep: [0, 7], hrSleep: 60, hrAwake: 74, steps: 520, temp: 33.3, charge: 20 },
    { id: 'yoon', name: '윤말순', age: 82, sex: '여', note: '보행보조기 사용 · 활동 적음 · 일찍 잠듦', sleep: [20, 5], hrSleep: 57, hrAwake: 69, steps: 90, temp: 33.5, charge: 18 },
    { id: 'jung', setting: 'bed', name: '정복순', age: 88, sex: '여', note: '요양병원 입원 · 뇌졸중 후 와상 · 외국인 간병인 담당', sleep: [21, 6], hrSleep: 62, hrAwake: 74, steps: 60, stepsSleep: 12, turn: 95, temp: 33.8, charge: 19 },
    { id: 'song', setting: 'bed', name: '송기철', age: 84, sex: '남', note: '요양병원 입원 · 파킨슨병(손 떨림으로 움직임 변동 큼)', sleep: [21, 6], hrSleep: 63, hrAwake: 75, steps: 110, stepsSleep: 30, mvSd: 0.45, turn: 95, temp: 33.5, charge: 19 },
    { id: 'kang', setting: 'bed', nonverbal: true, name: '강영애', age: 92, sex: '여', note: '요양병원 입원 · 중증 치매 · 언어 소통 어려움', sleep: [20, 6], hrSleep: 60, hrAwake: 70, steps: 45, stepsSleep: 10, turn: 95, temp: 33.9, charge: 19 },
    { id: 'oh', setting: 'bed', name: '오순덕', age: 86, sex: '여', note: '요양병원 입원 · 고관절 골절 수술 후 와상 · 밤잠 짧음', sleep: [22, 5], hrSleep: 66, hrAwake: 79, steps: 70, stepsSleep: 15, turn: 95, temp: 33.6, charge: 19 },
  ];
  const settingOf = p => p.setting || 'home';

  // ───── 시나리오 (정답 라벨 포함) ─────
  // truth: 0=안정(담당자 확인 불필요) 1=주의(당일 확인) 2=위기(즉시 방문)
  const SCENARIOS = [
    // ── 재가 독거 어르신 ──
    { id: 'normal', name: '평범한 하루', truth: 0, call: { answered: true, text: '네 아침 잘 먹었어요. 잠도 괜찮게 잤어요.' } },
    { id: 'nap', name: '오후 낮잠 (3~4시간 정지)', truth: 0, inactive: [11, 15], call: { answered: true, text: '아이고 낮잠 좀 잤어요. 괜찮아요.' } },
    { id: 'fall', name: '낙상 의심 (정지 + 심박 상승 + 무응답)', truth: 2, inactive: [11, 15], hrUp: [11, 15, 26], call: { answered: false } },
    { id: 'charge_ok', name: '링 충전 잊음 (미착용 + 정상 응답)', truth: 0, off: [9, 15], call: { answered: true, text: '반지를 깜빡하고 안 꼈네요. 별일 없어요.' } },
    { id: 'off_noans', name: '링 미착용 장기화 + 무응답', truth: 2, off: [9, 15], call: { answered: false } },
    { id: 'pain', name: '링 정상 + 통증 호소', truth: 1, call: { answered: true, text: '허리가 너무 아프고 아침부터 좀 어지러워요.' } },
    { id: 'night', name: '새벽 배회 (밤 활동 증가)', truth: 1, nightWalk: [1, 4], call: { answered: true, text: '밤에 잠이 안 와서 왔다 갔다 했어요.' } },
    { id: 'outing', name: '외출 (첫 통화 부재 → 재통화 응답)', truth: 0, active: [9, 13], call: { answered: true, retry: true, text: '시장 다녀왔어요. 전화를 못 들었네.' } },
    { id: 'mood', name: '정서 저하 (외로움·식욕 저하 + 활동 감소)', truth: 1, lowActive: true, call: { answered: true, text: '입맛도 없고 그냥 외로워요. 아무것도 하기 싫어요.' } },
    { id: 'fever', name: '발열 의심 (피부온도 상승)', truth: 1, tempUp: [8, 15, 1.6], call: { answered: true, text: '몸이 좀 으슬으슬해요.' } },
    { id: 'memo', name: '케어브릿지 메모 위험 (링·통화 정상)', truth: 1, memo: 'Hôm nay bà không ăn sáng, từ chối ăn trưa. Đầu gối bị bầm, có thể đã ngã.', call: { answered: true, text: '괜찮아요 괜찮아.' } },
    { id: 'tachy', name: '심박 이상 지속 + 무응답', truth: 2, hrUp: [12, 15, 34], call: { answered: false } },
    // ── 요양병원 와상 환자 (침상 옆 스피커 대화 · 외국인 간병인 메모) ──
    { id: 'bed_normal', setting: 'bed', name: '병상 평범한 하루', truth: 0, call: { answered: true, text: '네… 괜찮아요.' } },
    { id: 'bed_turn', setting: 'bed', name: '체위 변경 지연 (5시간 움직임 없음)', truth: 1, noTurn: [10, 15], call: { answered: true, text: '그냥 그래요.' } },
    { id: 'bed_mismatch', setting: 'bed', name: '간병기록-센서 불일치 (체위 변경 기록 vs 움직임 없음)', truth: 1, noTurn: [10, 15], memo: 'Đã trở mình cho bà lúc 10 giờ, 12 giờ và 14 giờ. Bà ăn được nửa suất.', call: { answered: true, text: '네.' } },
    { id: 'bed_sepsis', setting: 'bed', name: '발열 + 빈맥 + 반응 저하', truth: 2, tempUp: [10, 15, 1.7], hrUp: [11, 15, 24], memo: 'Bà ho nhiều, có đờm, ngủ li bì.', call: { answered: false } },
    { id: 'bed_fever', setting: 'bed', name: '미열 (피부온도 상승만)', truth: 1, tempUp: [9, 15, 1.5], call: { answered: true, text: '좀 더워요.' } },
    { id: 'bed_agit', setting: 'bed', name: '야간 초조 (새벽 움직임·심박 증가)', truth: 1, nightAgit: [1, 4], call: { answered: true, text: '밤에 무서웠어요.' } },
    { id: 'bed_exit', setting: 'bed', name: '침상 이탈 시도 의심 (새벽 급격한 움직임)', truth: 2, bedExit: 3, call: { na: true } },
    { id: 'bed_skin', setting: 'bed', name: '피부 발적 메모 (센서 정상)', truth: 1, memo: 'Vùng xương cụt bị đỏ, ấn không mất màu.', call: { answered: true, text: '엉덩이가 좀 아파요.' } },
    { id: 'bed_visit', setting: 'bed', name: '가족 면회 (낮 움직임·심박 소폭 증가)', truth: 0, active: [13, 15], hrUp: [13, 15, 6], call: { answered: true, text: '딸이 와서 좋았어요.' } },
  ];
  const scenariosFor = p => SCENARIOS.filter(s => (s.setting || 'home') === settingOf(p));

  const NOW = 15; // 시연 기준 시각 15시 (오늘 0~15시 데이터)

  function isSleepHour(p, h) { const [s, e] = p.sleep; return s > e ? (h >= s || h < e) : (h >= s && h < e); }

  function hourSample(p, h, r, day) {
    const sleep = isSleepHour(p, h);
    if (settingOf(p) === 'bed') {
      // 와상 환자: 손 움직임 횟수/시간. 간병인이 2시간마다 체위 변경(짝수 시) → 움직임 급증
      let mv = Math.max(0, (sleep ? p.stepsSleep : p.steps) * (1 + (p.mvSd || 0.3) * gauss(r)));
      if (h % 2 === 0) mv += p.turn * (0.8 + 0.4 * r());
      const hr0 = (sleep ? p.hrSleep : p.hrAwake) + gauss(r) * (p.hrSd || 3);
      const tp = p.temp + (sleep ? 0.2 : 0) + gauss(r) * 0.2;
      return { day, h, steps: Math.round(mv), hr: Math.round(hr0), temp: +tp.toFixed(1), worn: h === p.charge ? 0 : 1 };
    }
    const meal = (h === 8 || h === 12 || h === 18) ? 1.5 : 1;
    let steps = sleep ? Math.max(0, gauss(r) * 4) : Math.max(0, p.steps * meal * (1 + 0.25 * gauss(r)));
    let hr = (sleep ? p.hrSleep : p.hrAwake) + gauss(r) * (p.hrSd || 3);
    let temp = p.temp + (sleep ? 0.3 : 0) + gauss(r) * 0.25;
    let worn = (h === p.charge) ? 0 : 1;
    return { day, h, steps: Math.round(steps), hr: Math.round(hr), temp: +temp.toFixed(1), worn };
  }

  // 14일 기준선 + 오늘(0~NOW시) 데이터
  function generate(p, scenario, seed) {
    const r = rng(seed);
    const hist = [];
    for (let d = 0; d < 14; d++) for (let h = 0; h < 24; h++) hist.push(hourSample(p, h, r, d));
    const today = [];
    for (let h = 0; h <= NOW; h++) {
      const s = hourSample(p, h, r, 14);
      const inRange = (rg) => rg && h >= rg[0] && h <= rg[1];
      if (inRange(scenario.inactive)) s.steps = Math.round(Math.max(0, gauss(r) * 3));
      if (inRange(scenario.hrUp)) s.hr = Math.round(p.hrAwake + scenario.hrUp[2] + gauss(r) * (p.hrSd || 3));
      if (inRange(scenario.noTurn)) s.steps = Math.round(Math.max(0, 5 + gauss(r) * 3));
      if (inRange(scenario.nightAgit)) { s.steps = Math.round(110 + gauss(r) * 20); s.hr = Math.round(p.hrSleep + 12 + gauss(r) * 3); }
      if (scenario.bedExit === h) { s.steps = Math.round(600 + gauss(r) * 60); s.hr = Math.round(p.hrSleep + 22 + gauss(r) * 3); }
      if (inRange(scenario.off)) { s.worn = 0; }
      if (inRange(scenario.nightWalk)) s.steps = Math.round(p.steps * (0.8 + 0.3 * r()));
      if (inRange(scenario.active)) s.steps = Math.round(p.steps * (2.4 + 0.5 * r()));
      if (scenario.lowActive && !isSleepHour(p, h)) s.steps = Math.round(s.steps * 0.35);
      if (inRange(scenario.tempUp)) s.temp = +(s.temp + scenario.tempUp[2]).toFixed(1);
      if (!s.worn) { s.steps = null; s.hr = null; s.temp = null; }
      today.push(s);
    }
    return { hist, today };
  }

  // ───── 개인 기준선 (시간대별 중앙값 · MAD) ─────
  function baseline(hist) {
    const b = [];
    for (let h = 0; h < 24; h++) {
      const rows = hist.filter(x => x.h === h && x.worn);
      const st = rows.map(x => x.steps), hr = rows.map(x => x.hr), tp = rows.map(x => x.temp);
      b.push({
        h, n: rows.length,
        steps: median(st), stepsMad: mad(st) || 5,
        hr: median(hr), hrMad: mad(hr) || 2,
        temp: median(tp), tempMad: mad(tp) || 0.2,
        wornRate: hist.filter(x => x.h === h).filter(x => x.worn).length / 14,
      });
    }
    return b;
  }

  // ───── 링 이상 탐지 ─────
  function ringFlags(p, data) {
    const b = baseline(data.hist), T = data.today, flags = [];
    // 1) 착용 중단 (평소 착용하는 시간대에 연속 미착용)
    let off = 0; for (let i = T.length - 1; i >= 0 && !T[i].worn; i--) if (b[T[i].h].wornRate > 0.5) off++;
    if (off >= 3) flags.push({ code: 'wear_off', label: `링 미착용 ${off}시간 지속 (평소 착용 시간대)` });
    if (settingOf(p) === 'bed') return bedFlags(p, T, b, flags);
    // 2) 장시간 활동 정지 (깨어 있는 시간, 착용 중)
    let run = 0, best = 0;
    for (const s of T) {
      if (isSleepHour(p, s.h) || !s.worn) { run = 0; continue; }
      const thr = Math.max(8, b[s.h].steps * 0.15);
      run = s.steps < thr ? run + 1 : 0; best = Math.max(best, run);
    }
    if (best >= 3) flags.push({ code: 'inactive', label: `낮 시간 활동 정지 ${best}시간 (평소의 15% 미만)` });
    // 3) 심박 이탈 (최근 3시간 중 2시간 이상 z>3)
    const recent = T.slice(-3).filter(s => s.worn);
    const hz = recent.map(s => (s.hr - b[s.h].hr) / (1.4826 * b[s.h].hrMad));
    if (hz.filter(z => z > 3).length >= 2) flags.push({ code: 'hr', label: `심박이 평소보다 분당 ${Math.max(...recent.map(s => s.hr - b[s.h].hr))}회 높음 (3시간 중 2시간 이상)` });
    // 4) 야간 활동
    const night = T.filter(s => s.worn && isSleepHour(p, s.h)).filter(s => s.steps > b[s.h].steps + 6 * 1.4826 * b[s.h].stepsMad + 40);
    if (night.length >= 2) flags.push({ code: 'night', label: `수면 시간대 활동 ${night.length}시간 (평소에 없던 움직임)` });
    // 5) 피부온도 상승
    const tz = T.slice(-4).filter(s => s.worn).map(s => s.temp - b[s.h].temp);
    if (tz.filter(d => d > 1.0).length >= 3) flags.push({ code: 'fever', label: `피부온도 평소보다 +${Math.max(...tz).toFixed(1)}℃` });
    // 6) 하루 활동량 급감
    const awake = T.filter(s => s.worn && !isSleepHour(p, s.h));
    const sumT = awake.reduce((a, s) => a + s.steps, 0), sumB = awake.reduce((a, s) => a + b[s.h].steps, 0);
    if (awake.length >= 5 && sumT < sumB * 0.5) flags.push({ code: 'low', label: `오늘 활동량 평소의 ${Math.round(sumT / sumB * 100)}%` });
    return { flags, baseline: b, setting: 'home' };
  }

  // ───── 와상 환자용 탐지 (활동 정지는 정상이므로 '체위 변경 지연' 등으로 바꿔 봄) ─────
  function bedFlags(p, T, b, flags) {
    // 1) 체위 변경 지연: 평소 움직임의 35% 미만이 연속 3시간 이상
    let run = 0, best = 0;
    for (const s of T) {
      if (!s.worn) { run = 0; continue; }
      const thr = Math.max(20, b[s.h].steps * 0.35);
      run = s.steps < thr ? run + 1 : 0; best = Math.max(best, run);
    }
    if (best >= 3) flags.push({ code: 'noturn', label: `움직임 없음 ${best}시간 지속 (체위 변경 2시간 기준 초과 의심)` });
    // 2) 심박 이탈
    const recent = T.slice(-3).filter(s => s.worn);
    const hz = recent.map(s => (s.hr - b[s.h].hr) / (1.4826 * b[s.h].hrMad));
    if (hz.filter(z => z > 3).length >= 2) flags.push({ code: 'hr', label: `심박이 평소보다 분당 ${Math.max(...recent.map(s => s.hr - b[s.h].hr))}회 높음 (3시간 중 2시간 이상)` });
    // 3) 야간 침상 이탈 시도: 수면 시간대 1시간 움직임이 평소 최대치의 3배 초과
    const peak = Math.max(...b.map(x => x.steps).filter(Number.isFinite));
    // 움직임이 평소 최대의 3배를 넘거나, 2배를 넘으면서 심박이 12회 이상 함께 오르면 이탈 시도 의심
    const exit = T.filter(s => s.worn && isSleepHour(p, s.h) && (s.steps > peak * 3 || (s.steps > peak * 2 && s.hr > b[s.h].hr + 12)));
    if (exit.length) flags.push({ code: 'bedexit', label: `새벽 ${exit[0].h}시 급격한 움직임 (평소 최대의 ${Math.round(exit[0].steps / peak)}배)` });
    // 4) 야간 초조: 체위 변경이 없는 홀수 시간대에 움직임·심박 동반 상승 2시간 이상
    // 움직임 증가 기준은 심박 상승이 함께 있을 때만 낮춰 적용 (손 떨림 등 평소 움직임이 많은 환자 대응)
    const exitH = new Set(exit.map(s => s.h));
    const agit = T.filter(s => s.worn && isSleepHour(p, s.h) && !exitH.has(s.h) && s.steps > b[s.h].steps + 3 * 1.4826 * b[s.h].stepsMad + 30 && s.hr > b[s.h].hr + 6);
    if (agit.length >= 2) flags.push({ code: 'agit', label: `수면 시간대 움직임·심박 증가 ${agit.length}시간` });
    // 5) 피부온도 상승
    const tz = T.slice(-4).filter(s => s.worn).map(s => s.temp - b[s.h].temp);
    if (tz.filter(d => d > 1.0).length >= 3) flags.push({ code: 'fever', label: `피부온도 평소보다 +${Math.max(...tz).toFixed(1)}℃` });
    return { flags, baseline: b, setting: 'bed' };
  }

  // ───── 대화 · 메모 분석 (기본 분석 모드: 다국어 키워드) ─────
  const TALK_RULES = [
    { code: 'urgent', label: '자해·죽음 관련 발화', re: /죽고\s*싶|살기\s*싫|죽어\s*버리|사라지고\s*싶/ },
    { code: 'physical', label: '통증·어지러움·낙상 호소', re: /아프|아파|통증|쑤시|쑤셔|결리|어지러|핑\s*돌|넘어졌|넘어져|미끄러|숨이\s*차|가슴이\s*답답|못\s*일어나|쓰러/ },
    { code: 'mood', label: '외로움·우울·식욕 저하 표현', re: /외로|우울|입맛.*없|밥맛.*없|밥.*안\s*먹|하기\s*싫|귀찮|기운.*없|기력.*없|슬퍼|눈물/ },
    { code: 'fever', label: '발열·오한 표현', re: /으슬|열이|춥|오한|몸살/ },
    { code: 'sleep', label: '수면 문제 표현', re: /잠이\s*안|못\s*잤|잠을\s*못|밤에.*왔다\s*갔다/ },
  ];
  function analyzeTalk(text) {
    if (!text) return [];
    return TALK_RULES.filter(r => r.re.test(text)).map(r => ({ code: r.code, label: r.label }));
  }

  const MEMO_RULES = [
    { cat: '식사', risk: true, label: '식사 거부·결식', re: /không ăn(?! được)|không chịu ăn|bỏ (bữa|ăn)|từ chối ăn|ăn rất ít|did ?n[o']t eat|would ?n[o']t eat|refused (food|to eat|meal|breakfast|lunch|dinner)|skipped (a )?meal|ate (very )?little|못\s*드시|거의\s*안\s*드|拒绝吃|不肯吃|식사\s*거부|안\s*드심|결식|不吃|没吃饭/i },
    { cat: '낙상', risk: true, label: '낙상·멍·상처 흔적', re: /ngã|té|trượt|bầm|vết thương|fell|fall(en)?|slipped|bruise|injur|넘어|미끄러|멍|상처|摔倒|跌倒|滑倒|淤青/i },
    { cat: '인지', risk: true, label: '혼란·기억 저하', re: /lẫn|quên|nhầm|confus|forgot|disorient|헷갈|기억\s*못|糊涂|忘记/i },
    { cat: '통증', risk: true, label: '통증·불편감 표현', re: /đau|khó chịu|pain|ache|hurt|uncomfortable|discomfort|아프|아파|통증|쑤시|불편|疼|痛|不舒服/i },
    { cat: '기분', risk: true, label: '우울·눈물·위축', re: /buồn|khóc|cô đơn|sad|cried|lonely|depress|우울|눈물|외로|难过|哭/i },
    { cat: '피부', risk: true, label: '피부 발적·욕창 의심', re: /đỏ|loét|phồng rộp|redness|red (area|patch|spot)|pressure (sore|ulcer|injury)|blister|발적|욕창|빨갛|붉어|붉은|压疮|发红/i },
    { cat: '호흡', risk: true, label: '기침·가래·호흡 변화', re: /\bho\b|đờm|khó thở|cough|phlegm|sputum|short(ness)? of breath|기침|가래|숨이|咳嗽|痰/i },
    { cat: '의식', risk: true, label: '처짐·기면(반응 저하)', re: /li bì|lơ mơ|lethargic|drowsy|unresponsive|처짐|기면|축\s*처|嗜睡/i },
    { cat: '체위', risk: false, label: '체위 변경 기록', re: /trở mình|xoay người|turned|repositioned|체위\s*변경|돌려\s*눕|翻身/i },
    { cat: '수면', risk: false, label: '수면 관련 언급', re: /ngủ|sleep|insomnia|잠|睡/i },
    { cat: '투약', risk: false, label: '투약 관련 언급', re: /thuốc|medic|pill|약|药/i },
  ];
  function detectLang(t) {
    if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return '베트남어';
    if (/[一-鿿]/.test(t) && !/[가-힣]/.test(t)) return '중국어';
    if (/[가-힣]/.test(t)) return '한국어';
    return '영어';
  }
  // 케어브릿지 원칙: 메모에 없는 내용은 추정하지 않고 담당자 확인 항목으로 남긴다
  const MEAL = /ăn|bữa|eat|ate|breakfast|lunch|dinner|meal|식사|드시|드심|드셨|밥|吃|饭/i;
  const QTY = /\d|nửa|một ít|hết|half|all|most|%|절반|반\s*공기|그릇|공기|전부|다\s*드|一半|全部/i;
  const TIME = /\d+\s*(giờ|h\b|시|点)|sáng|trưa|chiều|tối|đêm|morning|noon|afternoon|evening|night|breakfast|lunch|dinner|supper|a\.?m|p\.?m|아침|점심|저녁|오전|오후|새벽|밤|早|中午|下午|晚/i;
  function memoChecks(text, items) {
    const c = [], cats = new Set(items.map(i => i.cat));
    if (MEAL.test(text) && !QTY.test(text)) c.push('식사 섭취량이 적혀 있지 않음 → 섭취량 확인');
    if (!TIME.test(text)) c.push('관찰 시각이 적혀 있지 않음 → 시점 확인');
    if (cats.has('낙상')) c.push('낙상 시각·부위·보고 여부 확인');
    if (cats.has('피부')) c.push('발적 부위·크기와 체위 변경 기록 확인');
    if (cats.has('통증')) c.push('통증 부위·정도 확인');
    return c;
  }
  function analyzeMemo(text) {
    if (!text || !text.trim()) return { lang: '-', items: [], risks: [] };
    const items = MEMO_RULES.filter(r => r.re.test(text)).map(r => ({ cat: r.cat, label: r.label, risk: r.risk }));
    return { lang: detectLang(text), items, risks: items.filter(i => i.risk), checks: memoChecks(text, items) };
  }


  // ───── 자동 기록 초안 (케어브릿지 8개 항목 + 링케어 확장) ─────
  // 원칙: 원문에 있는 표현만 옮기고, 없는 사실은 채우지 않으며 "미기재"로 보류한다.
  const sentences = t => String(t || '').split(/(?<=[.!?。！？;])\s*|\n+/).map(x => x.trim()).filter(Boolean);
  const pick = (t, re) => sentences(t).filter(x => re.test(x));
  const R_ = {
    time: TIME,
    support: [
      ['체위 변경', /trở mình|xoay người|turned|repositioned|체위\s*변경|돌려\s*눕|翻身/i],
      ['식사 보조', /đút ăn|cho (bà|ông|cụ) ăn|giúp ăn|fed|helped (her|him|them) (to )?eat|식사\s*보조|떠\s*드렸|喂饭|帮.*吃饭/i],
      ['목욕·위생', /tắm|vệ sinh|thay tã|bath|washed|shower|diaper|목욕|씻겨|기저귀|洗澡|擦身|换尿布/i],
      ['투약 보조', /cho (bà|ông|cụ) uống thuốc|gave (her |him )?(the )?(medication|medicine|pills)|투약\s*보조|약을?\s*드렸|喂药|给.*药/i],
      ['이동·산책', /đi dạo|dìu|walk(ed)? with|helped (her|him) walk|산책|부축|이동\s*보조|散步|扶/i],
    ],
    mealNone: /không ăn(?! được)|không chịu ăn|bỏ (bữa|ăn)|từ chối ăn|did ?n[o']t eat|would ?n[o']t eat|refused (food|to eat|meal|breakfast|lunch|dinner)|skipped|안\s*드셨|드시지\s*않|거부|拒绝吃|不肯吃|没吃/i,
    mealHalf: /nửa|half|절반|반\s*공기|一半/i,
    mealAll: /ăn hết|finished|ate (all|everything)|다\s*드셨|전부\s*드|全部吃|吃完/i,
    mealLittle: /ăn (rất )?ít|ate (very )?little|a few bites|조금|몇\s*숟가락|거의\s*못|못\s*드시|吃得很少|吃了一点/i,
    sleepBad: /không ngủ|khó ngủ|thức (dậy )?nhiều|couldn't sleep|could not sleep|poor sleep|woke up (often|several)|잠을?\s*못|잠이\s*안|자주\s*깨|没睡好|睡不好|失眠/i,
    sleepGood: /ngủ ngon|ngủ tốt|slept well|잘\s*주무|푹\s*주무|睡得好|睡得很好/i,
    sleepDrowsy: /li bì|lơ mơ|drowsy|lethargic|처지|기면|축\s*처|嗜睡/i,
    sleepAny: /ngủ|sleep|slept|nap|잠|주무|睡/i,
    med: /thuốc|medic|pill|약|药/i,
    medUnsure: /quên|chưa uống|chưa rõ|không rõ|forgot|missed|not sure|unclear|did ?n[o']t take|확인하지\s*못|확인\s*못|모르|누락|안\s*드셨|忘|没吃药|不确定/i,
  };
  function draftRecord(memoText, opts) {
    opts = opts || {};
    const t = String(memoText || '');
    const has = t.trim().length > 0;
    const f = [];
    const add = (key, value, src, pending, quote) => f.push({ key, value, src, pending: !!pending, quote: quote || '' });
    // 1. 방문·관찰 시점
    const tq = has ? pick(t, R_.time) : [];
    add('방문·관찰 시점', tq.length ? '원문에 시점 표현 있음' : '미기재', '메모', !tq.length, tq.join(' / '));
    // 2. 제공한 지원
    const sup = has ? R_.support.filter(([, re]) => re.test(t)) : [];
    add('제공한 지원', sup.length ? sup.map(x => x[0]).join(', ') : '미기재', '메모', !sup.length, sup.length ? sup.map(([, re]) => pick(t, re)[0]).filter(Boolean).join(' / ') : '');
    // 3. 식사
    const mealQ = has ? pick(t, MEAL) : [];
    let meal = '언급 없음', mealPend = false;
    if (mealQ.length) {
      if (R_.mealNone.test(t)) meal = '드시지 않음(원문 표현)';
      else if (R_.mealHalf.test(t)) meal = '절반';
      else if (R_.mealAll.test(t)) meal = '전량';
      else if (R_.mealLittle.test(t)) { meal = '적게 드심(정량 미기재)'; mealPend = true; }
      else { meal = '식사 언급 있음 · 섭취량 미기재'; mealPend = true; }
    }
    add('식사', meal, '메모', mealPend, mealQ.join(' / '));
    // 4. 수면
    const slQ = has ? pick(t, R_.sleepAny) : [];
    let sl = '언급 없음';
    if (R_.sleepDrowsy.test(t)) sl = '처짐·기면 표현';
    else if (R_.sleepBad.test(t)) sl = '수면 어려움 표현';
    else if (R_.sleepGood.test(t)) sl = '잘 주무심(원문 표현)';
    else if (slQ.length) sl = '수면 언급 있음(원문 참조)';
    add('수면', sl, '메모', false, slQ.join(' / '));
    // 5. 불편감 표현 (해석하지 않고 원문·본인 표현 인용)
    const painRe = MEMO_RULES.find(r => r.cat === '통증').re;
    const pq = has ? pick(t, painRe) : [];
    const selfQ = (opts.talkText && TALK_RULES.find(r => r.code === 'physical').re.test(opts.talkText)) ? opts.talkText : '';
    add('불편감 표현', pq.length || selfQ ? '불편감 언급 있음(정도·부위는 원문 그대로)' : '언급 없음', selfQ && !pq.length ? '본인 대화' : '메모', false, [pq.join(' / '), selfQ ? `본인: "${selfQ}"` : ''].filter(Boolean).join(' · '));
    // 6. 복약 관련 관찰 (복약 여부를 추정하지 않음)
    const mq = has ? pick(t, R_.med) : [];
    let med = '언급 없음', medPend = false;
    if (mq.length) { if (R_.medUnsure.test(mq.join(' '))) { med = '복약 여부 미확인'; medPend = true; } else med = '복약 관련 언급 있음(원문 참조)'; }
    add('복약 관련 관찰', med, '메모', medPend, mq.join(' / '));
    // 7. 특이사항
    const res = analyzeMemo(t);
    const spec = res.items.filter(i => ['낙상', '피부', '호흡', '의식', '인지', '기분'].includes(i.cat));
    add('특이사항', spec.length ? spec.map(i => i.label).join(', ') : '없음', '메모', false, spec.map(i => pick(t, MEMO_RULES.find(r => r.cat === i.cat).re)[0]).filter(Boolean).join(' / '));
    // 8. 다음 확인사항
    const next = (res.checks || []).slice();
    if (medPend) next.push('복약 여부 확인');
    if (!sup.length && has) next.push('제공한 지원 내용 확인');
    add('다음 확인사항', next.length ? next.join(' · ') : '없음', '자동 점검', false, '');
    // 링케어 확장: 센서·대화 (메모와 출처를 구분)
    if (opts.ringFlags) add('센서 관찰 (링케어)', opts.ringFlags.length ? opts.ringFlags.map(x => x.label).join(' · ') : '평소 범위', '스마트링 자동', false, '');
    if (opts.call) add('AI 대화 (링케어)', opts.call.na ? '대화 생략(야간·의사소통 어려움)' : opts.call.answered === false ? '무응답' : '응답', 'AI 대화 자동', false, opts.call.text ? `본인: "${opts.call.text}"` : '');
    return { fields: f, lang: has ? detectLang(t) : '-', original: t, status: 'draft' };
  }

  // ───── 기록 초안 평가 세트 (합성 메모 · 정답 라벨) ─────
  // meal: 절반|전량|적게|안드심|미기재|없음  med: 미확인|언급|없음  time: 시점 표현 유무
  const MEMO_EVAL = [
    { lang: 'ko', t: '점심을 절반 드셨고 무릎이 불편하다고 말씀하셨습니다. 복약 여부는 확인하지 못했습니다.', g: { meal: '절반', pain: 1, fall: 0, skin: 0, med: '미확인', time: 1 } },
    { lang: 'ko', t: '오전 10시 체위 변경함. 아침 식사는 조금 드심. 기침은 없음.', g: { meal: '적게', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'ko', t: '저녁 다 드셨고 산책 20분 부축해 드림. 약 드렸음.', g: { meal: '전량', pain: 0, fall: 0, skin: 0, med: '언급', time: 1 } },
    { lang: 'ko', t: '식사 거부하심. 엉덩이 쪽이 붉어짐.', g: { meal: '안드심', pain: 0, fall: 0, skin: 1, med: '없음', time: 0 } },
    { lang: 'ko', t: '밤에 자주 깨셨다고 함. 화장실 앞에서 넘어지셨다고 하심, 다친 곳은 못 봄.', g: { meal: '없음', pain: 0, fall: 1, skin: 0, med: '없음', time: 1 } },
    { lang: 'ko', t: '식사하셨음. 기분 좋아 보이심.', g: { meal: '미기재', pain: 0, fall: 0, skin: 0, med: '없음', time: 0 } },
    { lang: 'vi', t: 'Bà ăn được nửa suất trưa. Bà nói đầu gối hơi đau. Chưa rõ bà đã uống thuốc chưa.', g: { meal: '절반', pain: 1, fall: 0, skin: 0, med: '미확인', time: 1 } },
    { lang: 'vi', t: 'Đã trở mình cho bà lúc 10 giờ. Bà không chịu ăn sáng.', g: { meal: '안드심', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'vi', t: 'Bà ăn hết bữa tối, ngủ ngon.', g: { meal: '전량', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'vi', t: 'Vùng xương cụt bị đỏ. Bà ho có đờm.', g: { meal: '없음', pain: 0, fall: 0, skin: 1, med: '없음', time: 0 } },
    { lang: 'vi', t: 'Bà bị té trong nhà tắm, kêu đau hông.', g: { meal: '없음', pain: 1, fall: 1, skin: 0, med: '없음', time: 0 } },
    { lang: 'vi', t: 'Bà ăn ít, tôi đã cho bà uống thuốc lúc 8 giờ sáng.', g: { meal: '적게', pain: 0, fall: 0, skin: 0, med: '언급', time: 1 } },
    { lang: 'en', t: 'She ate half of her lunch and said her knee felt uncomfortable. Not sure if she took her pills.', g: { meal: '절반', pain: 1, fall: 0, skin: 0, med: '미확인', time: 1 } },
    { lang: 'en', t: 'Repositioned at 2 pm. Refused dinner.', g: { meal: '안드심', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'en', t: 'Finished breakfast. Slept well last night.', g: { meal: '전량', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'en', t: 'Slipped in the bathroom, no visible injury. Complained of hip pain.', g: { meal: '없음', pain: 1, fall: 1, skin: 0, med: '없음', time: 0 } },
    { lang: 'en', t: 'Red patch on the left heel. Seemed drowsy.', g: { meal: '없음', pain: 0, fall: 0, skin: 1, med: '없음', time: 0 } },
    { lang: 'en', t: 'Had some lunch. Gave her the medication.', g: { meal: '미기재', pain: 0, fall: 0, skin: 0, med: '언급', time: 1 } },
    { lang: 'zh', t: '奶奶中午吃了一半，说膝盖不舒服。不确定她有没有吃药。', g: { meal: '절반', pain: 1, fall: 0, skin: 0, med: '미확인', time: 1 } },
    { lang: 'zh', t: '早上帮她翻身。她拒绝吃早饭。', g: { meal: '안드심', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'zh', t: '晚饭全部吃完，睡得很好。', g: { meal: '전량', pain: 0, fall: 0, skin: 0, med: '없음', time: 1 } },
    { lang: 'zh', t: '昨晚在浴室滑倒，髋部疼痛。', g: { meal: '없음', pain: 1, fall: 1, skin: 0, med: '없음', time: 1 } },
    { lang: 'zh', t: '尾骨部位发红，咳嗽有痰。', g: { meal: '없음', pain: 0, fall: 0, skin: 1, med: '없음', time: 0 } },
    { lang: 'zh', t: '吃了一点饭，已经给她药。', g: { meal: '적게', pain: 0, fall: 0, skin: 0, med: '언급', time: 0 } },
  ];
  function evalDrafts() {
    const rows = MEMO_EVAL.map(e => {
      const d = draftRecord(e.t), v = k => d.fields.find(x => x.key === k);
      const mv = v('식사').value;
      const meal = mv.startsWith('절반') ? '절반' : mv.startsWith('전량') ? '전량' : mv.startsWith('적게') ? '적게' : mv.startsWith('드시지') ? '안드심' : mv.startsWith('식사 언급') ? '미기재' : '없음';
      const spec = v('특이사항').value;
      const out = { meal, pain: v('불편감 표현').value.startsWith('불편감') ? 1 : 0, fall: /낙상/.test(spec) ? 1 : 0, skin: /피부/.test(spec) ? 1 : 0,
        med: v('복약 관련 관찰').value.startsWith('복약 여부 미확인') ? '미확인' : v('복약 관련 관찰').value.startsWith('복약 관련') ? '언급' : '없음', time: v('방문·관찰 시점').pending ? 0 : 1 };
      const keys = ['meal', 'pain', 'fall', 'skin', 'med', 'time'];
      const miss = keys.filter(k => out[k] !== e.g[k]);
      // 원문에 없는 사실 추가: 정답이 없음/0인데 초안이 무언가를 채운 경우
      const added = keys.filter(k => (e.g[k] === 0 || e.g[k] === '없음') && out[k] !== e.g[k]).length + (e.g.meal === '미기재' && ['절반', '전량'].includes(out.meal) ? 1 : 0);
      // 잘못된 보류 해제: 정답이 미기재/미확인인데 초안이 확정값을 채운 경우
      const unhold = (e.g.meal === '미기재' && !['미기재'].includes(out.meal) && out.meal !== '적게' ? 1 : 0) + (e.g.med === '미확인' && out.med !== '미확인' ? 1 : 0) + (e.g.time === 0 && out.time === 1 ? 1 : 0);
      return { lang: e.lang, text: e.t, gold: e.g, out, miss, added, unhold };
    });
    const nField = rows.length * 6, wrong = rows.reduce((a, r) => a + r.miss.length, 0);
    const byLang = {};
    rows.forEach(r => { byLang[r.lang] = byLang[r.lang] || { n: 0, ok: 0 }; byLang[r.lang].n += 6; byLang[r.lang].ok += 6 - r.miss.length; });
    return { n: rows.length, fieldAcc: (nField - wrong) / nField, added: rows.reduce((a, r) => a + r.added, 0), unhold: rows.reduce((a, r) => a + r.unhold, 0), byLang, rows };
  }

  // ───── 교차검증 판단 (AI 링케어) ─────
  function decide(ring, call, memo) {
    const f = new Set(ring.flags.map(x => x.code));
    const talk = call.answered ? analyzeTalk(call.text) : [];
    const t = new Set(talk.map(x => x.code));
    const m = new Set((memo && memo.risks || []).map(x => x.cat));
    const bed = ring.setting === 'bed';
    const noAns = call.answered === false;
    const reasons = [], actions = [];
    let level = 0;
    const up = (lv, why) => { if (lv > level) level = lv; reasons.push(why); };

    ring.flags.forEach(x => reasons.push('링: ' + x.label));
    if (call.na) reasons.push('AI 대화: 야간·의사소통 어려움으로 생략 → 센서·간병 메모 중심 판단');
    else if (noAns) reasons.push(bed ? 'AI 병상 대화: 2회 무반응' : 'AI 안부대화: 2회 무응답');
    else if (call.retry) reasons.push('AI 안부대화: 1차 부재 → 재시도 응답');
    else reasons.push(bed ? 'AI 병상 대화: 응답' : 'AI 안부대화: 정상 응답');
    talk.forEach(x => reasons.push('대화: ' + x.label));
    (memo && memo.risks || []).forEach(x => reasons.push('돌봄메모(담당자 확인): ' + x.label));

    const ringCritical = f.has('inactive') || f.has('hr') || f.has('wear_off') || f.has('bedexit');
    if (t.has('urgent')) up(2, '판단: 위험 발화 → 즉시 연결');
    if (ringCritical && noAns) up(2, bed ? '판단: 링 이상 + 무반응 → 위기 의심' : '판단: 링 이상 + 무응답 → 위기 의심');
    if (f.has('bedexit')) up(2, '판단: 야간 침상 이탈 시도 의심 → 낙상 위험 즉시 확인');
    if (f.has('fever') && f.has('hr')) up(2, '판단: 발열 + 심박 상승 → 감염 악화 가능성, 즉시 확인');
    if (f.has('noturn')) {
      up(1, '판단: 체위 변경 지연 의심 → 피부 관찰 필요');
      if (memo && memo.items && memo.items.some(i => i.cat === '체위')) reasons.push('판단: 간병기록에는 체위 변경이 있으나 센서 움직임 없음 → 기록 확인 필요');
    }
    if (f.has('agit')) up(1, '판단: 야간 초조 → 섬망 여부 관찰 (진단 아님)');
    if (f.has('hr') && t.has('physical')) up(2, '판단: 심박 이상 + 신체 증상 호소');
    if (m.has('낙상') && (f.has('inactive') || f.has('hr'))) up(2, '판단: 낙상 메모 + 링 이상');
    if (t.has('physical') || t.has('mood') || t.has('fever')) up(1, '판단: 대화에서 위험 신호');
    if (m.size) up(1, '판단: 돌봄메모에 담당자 확인 사항 있음');
    if (f.has('night') || f.has('fever') || f.has('low')) up(1, '판단: 생활 리듬·체온 변화');
    if (noAns && !ringCritical) up(1, '판단: 무응답이나 링 정상 → 당일 확인');
    if (ringCritical && call.answered && level === 0) reasons.push('판단: 링 이상이나 본인 정상 응답 → 경보 해제(오경보 걸러냄)');
    if (level === 0 && reasons.length <= 1) reasons.push('판단: 평소와 같음');

    if (f.has('wear_off') && call.answered) actions.push('AI 대화로 링 충전·착용 안내');
    if (bed) {
      if (level === 2) actions.push('담당 간호사 즉시 병상 확인', '활력징후 측정 후 당직의 보고 여부 판단');
      if (level === 1) actions.push('담당 간병인·간호사 당일 확인');
      if (f.has('noturn') || m.has('피부')) actions.push('체위 변경 및 천골·발뒤꿈치 피부 관찰');
      if (f.has('bedexit')) actions.push('침상 난간·낙상 위험 확인');
      if (f.has('agit') || f.has('bedexit')) actions.push('야간 관찰 강화 (신체보호대는 의료법 기준에 따른 최후 수단)');
    } else {
      if (level === 2) actions.push('관제 2차 확인 전화', '담당 생활지원사 즉시 방문', '필요 시 119 연계');
      if (level === 1) actions.push('담당자 당일 전화·방문 확인');
    }
    if (t.has('urgent')) actions.push('자살예방상담전화 109 등 전문기관 즉시 연계');
    if (f.has('night') || m.has('인지')) actions.push('인지 변화 관찰 지속 (필요 시 치매안심센터 안내)');
    if (level === 0) actions.push(bed ? '간호기록 요약 반영 · 가족 주간요약' : '일일 리포트 기록 · 가족 주간요약 반영');
    return { level, reasons, actions, talk };
  }

  // ───── 비교 대상: 링 단독 판단 (교차검증 없음) ─────
  function decideRingOnly(ring) {
    const f = new Set(ring.flags.map(x => x.code));
    if (f.has('inactive') || f.has('hr') || f.has('wear_off') || f.has('bedexit')) return 2;
    if (ring.flags.length) return 1;
    return 0;
  }

  function callFor(p, sc) { return p.nonverbal && !sc.call.na ? { na: true } : sc.call; }
  function evaluateCase(p, sc, seed) {
    const data = generate(p, sc, seed);
    const ring = ringFlags(p, data);
    const memo = sc.memo ? analyzeMemo(sc.memo) : null;
    const res = decide(ring, callFor(p, sc), memo);
    return { data, ring, memo, res, ringOnly: decideRingOnly(ring) };
  }

  // ───── 자동 검증: 3명 × 12시나리오 × 반복 ─────
  function runValidation(reps) {
    reps = reps || 10;
    const rows = [];
    let k = 0;
    for (const p of PERSONAS) for (const sc of scenariosFor(p)) for (let i = 0; i < reps; i++) {
      const seed = 1000 + (k++) * 7919;
      const c = evaluateCase(p, sc, seed);
      rows.push({ setting: settingOf(p), persona: p.name, scenario: sc.name, truth: sc.truth, cross: c.res.level, ringOnly: c.ringOnly });
    }
    function metrics(key, subset) {
      const rows0 = rows;
      return metricsOf(key, subset ? rows0.filter(r => r.setting === subset) : rows0);
    }
    function metricsOf(key, rows) {
      const alerts = rows.filter(r => r[key] >= 1).length;
      const urgent = rows.filter(r => r[key] === 2).length;
      const falseUrgent = rows.filter(r => r[key] === 2 && r.truth < 2).length;
      const falseAlert = rows.filter(r => r[key] >= 1 && r.truth === 0).length;
      const crises = rows.filter(r => r.truth === 2).length;
      const caught = rows.filter(r => r.truth === 2 && r[key] === 2).length;
      const needCheck = rows.filter(r => r.truth >= 1).length;
      const checked = rows.filter(r => r.truth >= 1 && r[key] >= 1).length;
      const exact = rows.filter(r => r.truth === r[key]).length;
      return { alerts, urgent, falseUrgent, falseAlert, crises, caught, missed: crises - caught,
               recallCrisis: caught / crises, recallCheck: checked / needCheck, accuracy: exact / rows.length };
    }
    const byScenario = SCENARIOS.map(sc => {
      const rs = rows.filter(r => r.scenario === sc.name);
      const pct = (key, lv) => rs.filter(r => r[key] === lv).length / rs.length;
      return { setting: sc.setting || 'home', scenario: sc.name, truth: sc.truth, n: rs.length,
               crossMatch: rs.filter(r => r.cross === sc.truth).length / rs.length,
               ringOnlyMatch: rs.filter(r => r.ringOnly === sc.truth).length / rs.length,
               crossUrgent: pct('cross', 2), ringOnlyUrgent: pct('ringOnly', 2) };
    });
    const bySetting = {};
    ['home', 'bed'].forEach(k => { bySetting[k] = { n: rows.filter(r => r.setting === k).length, cross: metrics('cross', k), ringOnly: metrics('ringOnly', k) }; });
    return { n: rows.length, reps, cross: metrics('cross'), ringOnly: metrics('ringOnly'), bySetting, byScenario, rows };
  }

  // ───── 인지 추세 (주 단위 발화 특징, 합성) ─────
  function cognitionSeries(p, seed) {
    let hs = 77; for (const ch of p.id) hs = (hs * 31 + ch.charCodeAt(0)) >>> 0;
    const r = rng(seed || hs);
    const decline = p.id === 'lee';
    const out = [];
    for (let w = 1; w <= 16; w++) {
      const drift = decline && w > 8 ? (w - 8) : 0;
      out.push({
        week: w,
        rate: +(3.4 - drift * 0.09 + gauss(r) * 0.12).toFixed(2),   // 초당 음절
        pause: +(0.22 + drift * 0.018 + gauss(r) * 0.015).toFixed(3), // 멈춤 비율
      });
    }
    const base = out.slice(0, 6), bm = median(base.map(x => x.rate)), bs = (mad(base.map(x => x.rate)) * 1.4826) || 0.1;
    let streak = 0, flagWeek = null;
    out.forEach((x, i) => {
      const win = out.slice(Math.max(0, i - 3), i + 1).map(y => y.rate);
      x.avg4 = +(win.reduce((a, b) => a + b, 0) / win.length).toFixed(2);
      if (i >= 6 && x.avg4 < bm - 1.5 * bs) { streak++; if (streak >= 3 && !flagWeek) flagWeek = x.week; } else streak = 0;
    });
    return { series: out, baseMedian: bm, baseSd: bs, flagWeek };
  }

  const api = { draftRecord, evalDrafts, MEMO_EVAL, callFor, settingOf, scenariosFor, PERSONAS, SCENARIOS, NOW, generate, baseline, ringFlags, analyzeTalk, analyzeMemo, detectLang, decide, decideRingOnly, evaluateCase, runValidation, cognitionSeries, isSleepHour };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RingCare = api;
})(this);
