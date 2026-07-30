// 수지동부아파트 리모델링 대출 계산기
'use strict';

/* ── 데이터 로드 ─────────────────────────────── */

const dataPromise = window.__DATA__
  ? Promise.resolve(window.__DATA__)
  : fetch('분담금.json').then(r => r.json());

// 세대 원소가 어떤 모양이든(원본 중첩 구조 / 프리뷰용 평탄화 구조) 동일한 평탄 구조로 맞춘다.
function normalizeUnit(u) {
  const prevAvg = (u.종전평균 !== undefined)
    ? u.종전평균
    : (u.종전평가금액 && u.종전평가금액.종전평균);
  const afterAvg = (u.종후평균 !== undefined)
    ? u.종후평균
    : (u.종후평가금액 && u.종후평가금액.종후평균);
  return {
    타입: u.타입,
    동: String(u.동),
    호수: String(u.호수),
    전용면적_m2: u.전용면적_m2,
    공급면적_m2: u.공급면적_m2,
    종전평균: prevAvg,
    종후평균: afterAvg,
    권리가액: u.권리가액,
    분담금: u.분담금,
  };
}

/* ── 상수 ────────────────────────────────────── */

const GASAN = 2.22;
const FEE = 0.14;

const DEFAULTS = {
  cd: 2.92,
  moveRate: 4.50,
  months: 55,
  ltvAfter: 90,
  ltvBefore: 60,
  existing: 0,
  method: 'month',
  rounding: 'on',
};

const METHOD_LABEL = { simple: '단리', month: '월복리' };

const STEPPER_CONFIG = {
  setCd: { step: 0.1, min: 0, max: 20, decimals: 2, key: 'cd' },
  setMoveRate: { step: 0.1, min: 0, max: 20, decimals: 2, key: 'moveRate' },
  setMonths: { step: 1, min: 1, max: 360, decimals: 0, key: 'months' },
  setLtvAfter: { step: 5, min: 0, max: 100, decimals: 0, key: 'ltvAfter' },
  setLtvBefore: { step: 5, min: 0, max: 100, decimals: 0, key: 'ltvBefore' },
};

/* ── 포맷 헬퍼 ───────────────────────────────── */

function won(n) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n || 0));
}

function kor(n) {
  const manTotal = Math.floor(Math.max(0, n) / 10000);
  if (manTotal === 0) return '0원';
  const eok = Math.floor(manTotal / 10000);
  const man = manTotal % 10000;
  const parts = [];
  if (eok > 0) parts.push(eok + '억');
  if (man > 0) parts.push(won(man) + '만');
  return parts.join(' ');
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function parseAmount(str) {
  const digits = String(str).replace(/[^0-9]/g, '');
  return digits === '' ? 0 : parseInt(digits, 10);
}

/* ── 계산 로직 ───────────────────────────────── */

function factor(r, method, n) {
  if (method === 'month') return Math.pow(1 + r / 12, n) - 1;
  return r / 12 * n; // simple
}

function computeAll(unit, s) {
  const addRatePct = s.cd + GASAN + FEE;
  const rMove = s.moveRate / 100;
  const rAdd = addRatePct / 100;
  const n = s.months;

  const fMove = factor(rMove, s.method, n);
  const fAdd = factor(rAdd, s.method, n);
  const fMoveS = rMove / 12 * n;
  const fAddS = rAdd / 12 * n;

  const totalCap = unit.종후평균 * s.ltvAfter / 100;
  const moveCap = (s.mode === 'none') ? 0 : (unit.종전평균 * s.ltvBefore / 100);

  const moveAmount = (s.mode === 'none') ? 0 : s.amtMove;
  const deduct = (s.mode === 'none') ? s.existing : moveAmount;
  const bucket = Math.max(0, totalCap - deduct - unit.분담금);

  let addPrincipalCap = bucket / (1 + fAdd);
  addPrincipalCap = (s.rounding === 'on')
    ? Math.floor(addPrincipalCap / 100000) * 100000
    : addPrincipalCap;
  const addCapInterest = bucket - addPrincipalCap;

  const addPrincipal = s.amtAdd;

  const moveInterest = Math.round(moveAmount * fMove);
  let addInterest = addPrincipal * fAdd;
  addInterest = (s.rounding === 'on')
    ? Math.ceil(addInterest / 100000) * 100000
    : Math.round(addInterest);
  const addApplied = addPrincipal + addInterest;

  const iOnI = Math.round(
    moveAmount * (fMove - fMoveS) + addPrincipal * (fAdd - fAddS)
  );
  const totalLoan = moveAmount + addPrincipal;
  const totalInterest = moveInterest + addInterest;
  const maturityTotal = totalLoan + totalInterest;

  return {
    addRatePct, fMove, fAdd,
    totalCap, moveCap, moveAmount, deduct, bucket,
    addPrincipalCap, addCapInterest, addPrincipal,
    moveInterest, addInterest, addApplied,
    iOnI, totalLoan, totalInterest, maturityTotal,
  };
}

function meterInfo(amount, cap) {
  if (!(cap > 0)) return { ratio: 0, state: undefined };
  const ratio = amount / cap;
  let state;
  if (ratio > 0.9) state = 'near';
  return { ratio, state };
}

/* ── 상태 ────────────────────────────────────── */

let UNITS = [];
let UNIT_INDEX = new Map();

const state = {
  mode: 'ltv60',
  amtMove: 0,
  amtAdd: 0,
  cd: DEFAULTS.cd,
  moveRate: DEFAULTS.moveRate,
  months: DEFAULTS.months,
  ltvAfter: DEFAULTS.ltvAfter,
  ltvBefore: DEFAULTS.ltvBefore,
  existing: DEFAULTS.existing,
  method: DEFAULTS.method,
  rounding: DEFAULTS.rounding,
};

function findUnit(dong, floor, ho) {
  const hoKey = String(floor * 100 + ho);
  return UNIT_INDEX.get(dong + '_' + hoKey);
}

function currentUnit() {
  const dong = document.getElementById('selDong').value;
  const floor = parseInt(document.getElementById('selFloor').value, 10);
  const ho = parseInt(document.getElementById('selHo').value, 10);
  return findUnit(dong, floor, ho);
}

/* ── DOM 초기화 ──────────────────────────────── */

function buildSelects() {
  const dongSet = Array.from(new Set(UNITS.map(u => u.동))).sort();
  const selDong = document.getElementById('selDong');
  selDong.innerHTML = dongSet.map(d => `<option value="${d}">${d}동</option>`).join('');

  const selFloor = document.getElementById('selFloor');
  let floorHtml = '';
  for (let f = 1; f <= 17; f++) floorHtml += `<option value="${f}">${f}층</option>`;
  selFloor.innerHTML = floorHtml;

  const selHo = document.getElementById('selHo');
  let hoHtml = '';
  for (let h = 1; h <= 6; h++) hoHtml += `<option value="${h}">${h}호</option>`;
  selHo.innerHTML = hoHtml;

  selDong.value = '101';
  selFloor.value = '1';
  selHo.value = '1';
}

/* ── 렌더링 ──────────────────────────────────── */

function updatePicker(unit) {
  document.getElementById('pickerMeta').innerHTML =
    `<b>${unit.동}동 ${unit.호수}호</b> · ${unit.타입} · 전용 ${unit.전용면적_m2}㎡ · 공급 ${unit.공급면적_m2}㎡`;
}

function updateFacts(unit) {
  document.getElementById('factPrev').textContent = won(unit.종전평균);
  document.getElementById('factPrevSub').textContent = kor(unit.종전평균);
  document.getElementById('factAfter').textContent = won(unit.종후평균);
  document.getElementById('factAfterSub').textContent = kor(unit.종후평균);
  document.getElementById('factRight').textContent = won(unit.권리가액);
  document.getElementById('factRightSub').textContent = kor(unit.권리가액);
  document.getElementById('factDue').textContent = won(unit.분담금);
  document.getElementById('factDueSub').textContent = kor(unit.분담금);
}

function setFlag(el, state) {
  if (state === 'capped') {
    el.textContent = '한도까지만 입력됩니다';
    el.className = 'flag flag--over';
  } else if (state === 'max') {
    el.textContent = '한도 최대';
    el.className = 'flag flag--max';
  } else if (state === 'near') {
    el.textContent = '한도 근접';
    el.className = 'flag flag--near';
  } else {
    el.textContent = '';
    el.className = 'flag';
  }
}

// 이번 렌더에서 잘렸으면 'capped', 아니면 한도 도달/근접 여부로 배지 상태를 정한다.
function flagState(amount, cap, wasClamped) {
  if (wasClamped) return 'capped';
  if (cap > 0 && amount >= cap) return 'max';
  if (cap > 0 && amount / cap > 0.9) return 'near';
  return undefined;
}

const moveChipEls = document.querySelectorAll('.chip[data-add="move"], .chip[data-clear="move"]');

function updateLoans(unit, r, clamped) {
  const amtMoveEl = document.getElementById('amtMove');

  document.getElementById('rateMove').textContent = `연 ${state.moveRate.toFixed(2)}%`;
  document.getElementById('rateAdd').textContent = `연 ${r.addRatePct.toFixed(2)}%`;

  // 이주비
  const moveDisabled = state.mode === 'none';
  amtMoveEl.disabled = moveDisabled;
  moveChipEls.forEach(chip => { chip.disabled = moveDisabled; });
  if (moveDisabled) {
    document.getElementById('capMove').textContent = '—';
  } else if (state.mode === 'consult') {
    document.getElementById('capMove').textContent = '상담 필요';
  } else {
    document.getElementById('capMove').textContent = won(r.moveCap);
  }

  // 상담 케이스와 미신청 케이스는 한도가 정해지지 않았으므로 게이지와 경고를 띄우지 않는다.
  const moveCapKnown = !moveDisabled && state.mode !== 'consult';
  const mi = moveCapKnown ? meterInfo(r.moveAmount, r.moveCap) : { ratio: 0, state: undefined };
  const moveMeterEl = document.getElementById('meterMove');
  moveMeterEl.style.width = `${clamp(mi.ratio * 100, 0, 100)}%`;
  if (mi.state) moveMeterEl.setAttribute('data-state', mi.state);
  else moveMeterEl.removeAttribute('data-state');
  document.getElementById('moveFootInterest').textContent = won(r.moveInterest);
  const moveFlagState = moveCapKnown ? flagState(r.moveAmount, r.moveCap, clamped.move) : undefined;
  setFlag(document.getElementById('moveFlag'), moveFlagState);

  // 추가사업비
  document.getElementById('capAdd').textContent = won(r.addPrincipalCap);
  const addMi = meterInfo(r.addPrincipal, r.addPrincipalCap);
  const addMeterEl = document.getElementById('meterAdd');
  addMeterEl.style.width = `${clamp(addMi.ratio * 100, 0, 100)}%`;
  if (addMi.state) addMeterEl.setAttribute('data-state', addMi.state);
  else addMeterEl.removeAttribute('data-state');
  document.getElementById('addFootApplied').textContent = won(r.addApplied);
  const addFlagState = flagState(r.addPrincipal, r.addPrincipalCap, clamped.add);
  setFlag(document.getElementById('addFlag'), addFlagState);
}

function updateResults(r) {
  document.getElementById('totalValue').textContent = won(r.maturityTotal);
  document.getElementById('totalKor').textContent = kor(r.maturityTotal);
  document.getElementById('lineMovePrincipal').textContent = won(r.moveAmount);
  document.getElementById('lineMoveInterest').textContent = won(r.moveInterest);
  document.getElementById('lineAddPrincipal').textContent = won(r.addPrincipal);
  document.getElementById('lineAddApplied').textContent = won(r.addApplied);
  document.getElementById('lineAddInterest').textContent = won(r.addInterest);
  document.getElementById('lineTotalLoan').textContent = won(r.totalLoan);
  document.getElementById('lineTotalInterest').textContent = won(r.totalInterest);
  document.getElementById('lineTotalInterest2').textContent = won(r.totalInterest);
  document.getElementById('lineIoi').textContent =
    (state.method === 'simple') ? '—' : won(r.iOnI);

  document.getElementById('barInterest').textContent = won(r.totalInterest);
  document.getElementById('barTotal').textContent = won(r.maturityTotal);
}

function updateSettingsPanel(r) {
  document.getElementById('settingsHint').textContent =
    `${r.addRatePct.toFixed(2)}% · ${state.months}개월 · ${METHOD_LABEL[state.method]}`;

  document.getElementById('rateBreakdown').innerHTML =
    `추가사업비 금리 = CD ${state.cd.toFixed(2)}% + 가산 ${GASAN.toFixed(2)}% + ` +
    `취급수수료 ${FEE.toFixed(2)}% = 연 <b>${r.addRatePct.toFixed(2)}%</b>`;
}

/* ── 경우별 비교 표 ──────────────────────────── */

function scenarioMoveMode(unit, modeKey) {
  const s2 = Object.assign({}, state, { mode: modeKey });
  if (modeKey === 'ltv60') s2.ltvBefore = 60;
  if (modeKey === 'ltv40') s2.ltvBefore = 40;
  const moveCapPre = (modeKey === 'none') ? 0 : (unit.종전평균 * s2.ltvBefore / 100);
  s2.amtMove = moveCapPre;
  return computeAll(unit, s2);
}

function renderTable1(unit) {
  const rows = [
    { key: 'ltv60', label: 'LTV 60%' },
    { key: 'ltv40', label: 'LTV 40%' },
    { key: 'none', label: '이주비 미신청' },
  ];
  let html = '';
  rows.forEach(row => {
    const r = scenarioMoveMode(unit, row.key);
    const isCurrent = state.mode === row.key;
    const total = r.moveAmount + r.addPrincipalCap;
    html += `<tr${isCurrent ? ' data-current="1"' : ''}>` +
      `<th>${row.label}${isCurrent ? '<span class="pill">현재</span>' : ''}</th>` +
      `<td>${row.key === 'none' ? '—' : won(r.moveCap)}</td>` +
      `<td>${won(r.bucket)}</td>` +
      `<td>${won(r.addPrincipalCap)}</td>` +
      `<td>${won(total)}</td>` +
      `</tr>`;
  });
  html += `<tr class="note-row"><td colspan="5">2025.06.28~10.14 매수는 조합 별도 상담이 필요합니다.</td></tr>`;
  document.getElementById('table1Body').innerHTML = html;
}

function renderTable2(unit) {
  const methods = [
    { key: 'simple', label: '단리' },
    { key: 'month', label: '월복리' },
  ];
  let html = '';
  methods.forEach(m => {
    const s2 = Object.assign({}, state, { method: m.key });
    const r = computeAll(unit, s2);
    const isCurrent = state.method === m.key;
    html += `<tr${isCurrent ? ' data-current="1"' : ''}>` +
      `<th>${m.label}${isCurrent ? '<span class="pill">현재</span>' : ''}</th>` +
      `<td>${won(r.moveInterest)}</td>` +
      `<td>${won(r.addInterest)}</td>` +
      `<td>${m.key === 'simple' ? '—' : won(r.iOnI)}</td>` +
      `<td>${won(r.totalInterest)}</td>` +
      `</tr>`;
  });
  document.getElementById('table2Body').innerHTML = html;
}

function buildRateSweep(base) {
  const CAP_ROWS = 12;
  const TOP = 6.00;
  const rates = [];
  if (base < TOP) {
    let i = 0;
    while (true) {
      const v = Math.round((base + i * 0.1) * 100) / 100;
      if (v >= TOP || rates.length >= CAP_ROWS - 1) break;
      rates.push(v);
      i++;
    }
    rates.push(TOP);
  } else {
    for (let i = 0; i < 6; i++) {
      rates.push(Math.round((base + i * 0.1) * 100) / 100);
    }
  }
  return rates.slice(0, CAP_ROWS);
}

function renderTable3(unit) {
  const base = Math.round((state.cd + GASAN + FEE) * 100) / 100;
  const rates = buildRateSweep(base);
  let html = '';
  rates.forEach(rate => {
    const s2 = Object.assign({}, state, { cd: rate - GASAN - FEE });
    const r = computeAll(unit, s2);
    const isCurrent = rate === base;
    html += `<tr${isCurrent ? ' data-current="1"' : ''}>` +
      `<th>${rate.toFixed(2)}%${isCurrent ? '<span class="pill">현재</span>' : ''}</th>` +
      `<td>${won(r.addPrincipalCap)}</td>` +
      `<td>${won(r.addInterest)}</td>` +
      `<td>${won(r.totalInterest)}</td>` +
      `</tr>`;
  });
  document.getElementById('table3Body').innerHTML = html;
}

/* ── 한도 강제 제한 ──────────────────────────── */

// 이주비/추가사업비 입력값이 한도를 넘지 못하도록 state를 직접 잘라낸다.
// 이주비를 먼저 자른 뒤 추가사업비 한도를 계산해야 두 값이 서로 맞물려 정확하다.
function clampAmounts() {
  const unit = currentUnit();
  if (!unit) return { move: false, add: false };

  let move = false;
  let add = false;

  // 이주비: 한도가 확정된 모드에서만 제한한다. consult(상담)는 한도 미정, none(미신청)은 입력 자체가 비활성.
  if (state.mode === 'ltv60' || state.mode === 'ltv40') {
    const capMove = Math.floor(computeAll(unit, state).moveCap);
    if (state.amtMove > capMove) {
      state.amtMove = Math.max(0, capMove);
      move = true;
    }
  }

  // 추가사업비 한도는 이주비 신청액에 따라 달라지므로 반드시 이주비를 먼저 자른 뒤 계산한다.
  const capAdd = Math.floor(computeAll(unit, state).addPrincipalCap);
  if (state.amtAdd > capAdd) {
    state.amtAdd = Math.max(0, capAdd);
    add = true;
  }

  return { move, add };
}

function syncAmountInput(id, value) {
  const el = document.getElementById(id);
  const next = won(value);
  if (el.value !== next) el.value = next;
}

const capFlashTimers = new Map();

function flashCapped(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const box = el.closest('.amount__box');
  if (!box) return;

  box.classList.add('is-capped');

  const prevTimer = capFlashTimers.get(inputId);
  if (prevTimer) clearTimeout(prevTimer);

  const timer = setTimeout(() => {
    box.classList.remove('is-capped');
    capFlashTimers.delete(inputId);
  }, 1800);
  capFlashTimers.set(inputId, timer);
}

/* ── 메인 렌더 ───────────────────────────────── */

function render() {
  const unit = currentUnit();
  if (!unit) return;

  const clamped = clampAmounts();
  syncAmountInput('amtMove', state.amtMove);
  syncAmountInput('amtAdd', state.amtAdd);
  if (clamped.move) flashCapped('amtMove');
  if (clamped.add) flashCapped('amtAdd');

  updatePicker(unit);
  updateFacts(unit);

  const r = computeAll(unit, state);
  updateLoans(unit, r, clamped);
  updateResults(r);
  updateSettingsPanel(r);

  renderTable1(unit);
  renderTable2(unit);
  renderTable3(unit);
}

/* ── 이벤트 바인딩 ───────────────────────────── */

function bindAmountInput(el, key) {
  el.addEventListener('input', () => {
    const num = parseAmount(el.value);
    el.value = won(num);
    const len = el.value.length;
    el.setSelectionRange(len, len);
    state[key] = num;
    render();
  });
}

function bindChips() {
  document.querySelectorAll('.chip[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.add === 'move' ? 'amtMove' : 'amtAdd';
      state[key] = state[key] + Number(btn.dataset.amount);
      render();
    });
  });

  document.querySelectorAll('.chip[data-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.clear === 'move' ? 'amtMove' : 'amtAdd';
      state[key] = 0;
      render();
    });
  });
}

function bindEvents() {
  bindChips();

  document.getElementById('selDong').addEventListener('change', render);
  document.getElementById('selFloor').addEventListener('change', render);
  document.getElementById('selHo').addEventListener('change', render);

  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.mode = radio.value;
      if (radio.value === 'ltv60') {
        state.ltvBefore = 60;
        document.getElementById('setLtvBefore').textContent = '60';
      } else if (radio.value === 'ltv40') {
        state.ltvBefore = 40;
        document.getElementById('setLtvBefore').textContent = '40';
      }
      render();
    });
  });

  bindAmountInput(document.getElementById('amtMove'), 'amtMove');
  bindAmountInput(document.getElementById('amtAdd'), 'amtAdd');
  bindAmountInput(document.getElementById('setExisting'), 'existing');

  document.querySelectorAll('.amount__max').forEach(btn => {
    btn.addEventListener('click', () => {
      const unit = currentUnit();
      if (!unit) return;
      const r = computeAll(unit, state);
      if (btn.dataset.max === 'move') {
        if (state.mode === 'none') return;
        state.amtMove = Math.round(r.moveCap);
        document.getElementById('amtMove').value = won(state.amtMove);
      } else if (btn.dataset.max === 'add') {
        state.amtAdd = Math.round(r.addPrincipalCap);
        document.getElementById('amtAdd').value = won(state.amtAdd);
      }
      render();
    });
  });

  document.querySelectorAll('.stepper button').forEach(btn => {
    btn.addEventListener('click', () => {
      const valEl = btn.parentElement.querySelector('.stepper__val');
      const cfg = STEPPER_CONFIG[valEl.id];
      if (!cfg) return;
      let v = parseFloat(valEl.textContent) + cfg.step * parseInt(btn.dataset.step, 10);
      v = clamp(v, cfg.min, cfg.max);
      v = cfg.decimals > 0
        ? Math.round(v * Math.pow(10, cfg.decimals)) / Math.pow(10, cfg.decimals)
        : Math.round(v);
      valEl.textContent = cfg.decimals > 0 ? v.toFixed(cfg.decimals) : String(v);
      state[cfg.key] = v;
      render();
    });
  });

  document.querySelectorAll('input[name="method"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.method = radio.value;
      render();
    });
  });

  document.querySelectorAll('input[name="rounding"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.rounding = radio.value;
      render();
    });
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    state.cd = DEFAULTS.cd;
    state.moveRate = DEFAULTS.moveRate;
    state.months = DEFAULTS.months;
    state.ltvAfter = DEFAULTS.ltvAfter;
    state.ltvBefore = DEFAULTS.ltvBefore;
    state.existing = DEFAULTS.existing;
    state.method = DEFAULTS.method;
    state.rounding = DEFAULTS.rounding;

    document.getElementById('setCd').textContent = DEFAULTS.cd.toFixed(2);
    document.getElementById('setMoveRate').textContent = DEFAULTS.moveRate.toFixed(2);
    document.getElementById('setMonths').textContent = String(DEFAULTS.months);
    document.getElementById('setLtvAfter').textContent = String(DEFAULTS.ltvAfter);
    document.getElementById('setLtvBefore').textContent = String(DEFAULTS.ltvBefore);
    document.getElementById('setExisting').value = won(DEFAULTS.existing);
    document.querySelector('input[name="method"][value="' + DEFAULTS.method + '"]').checked = true;
    document.querySelector('input[name="rounding"][value="' + DEFAULTS.rounding + '"]').checked = true;

    render();
  });

  document.getElementById('barGo').addEventListener('click', () => {
    document.querySelector('.results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ── 초기화 ──────────────────────────────────── */

// 첫 화면이 0으로만 보이지 않도록 두 대출을 한도까지 채워 "최대로 받으면" 시나리오를 보여준다.
function prefillMaxAmounts() {
  const unit = currentUnit();
  if (!unit) return;
  state.amtMove = Math.round(computeAll(unit, state).moveCap);
  state.amtAdd = Math.round(computeAll(unit, state).addPrincipalCap);
  document.getElementById('amtMove').value = won(state.amtMove);
  document.getElementById('amtAdd').value = won(state.amtAdd);
}

dataPromise.then(data => {
  UNITS = data.세대.map(normalizeUnit);
  UNIT_INDEX = new Map(UNITS.map(u => [u.동 + '_' + u.호수, u]));

  buildSelects();
  bindEvents();
  prefillMaxAmounts();
  render();
}).catch(err => {
  console.error('데이터 로드 실패:', err);
});
