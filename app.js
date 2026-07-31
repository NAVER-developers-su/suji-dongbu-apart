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

// 2026-07-30 조합 안내문: 추가 이주비 1억당 이자 26,720,000원, 이자의 이자 570,000원
const NOTICE_ADD_INTEREST_RATE = 0.2672;
const NOTICE_ADD_IOI_RATE = 0.0057;

const DEFAULTS = {
  cd: 2.92,
  moveRate: 4.50,
  months: 55,
  monthsMove: 55,
  ltvAfter: 90,
  ltvBefore: 60,
  existing: 0,
  addBasis: 'notice',
  moveIoi: 'monthly',
  rounding: 'off',
};

const HELP = {
  jongjeon: {
    title: '종전평가액',
    body:
      '<p>리모델링 <b>전</b> 내 집의 감정평가 금액입니다. 삼창감정평가법인과 대화감정평가법인 두 곳이 각각 평가한 뒤 그 평균을 씁니다. 이주비 대출 한도가 이 금액을 기준으로 정해집니다.</p>' +
      '<div class="helpsheet__note">참고: 2026년 정기총회 책자 303~319쪽 기준입니다.</div>',
  },
  jonghu: {
    title: '종후평가액',
    body:
      '<p>리모델링 <b>후</b> 예상되는 감정평가 금액입니다. 역시 두 법인 평가의 평균입니다. 전체 대출 가능 총액이 이 금액의 90%로 정해집니다.</p>',
  },
  gwonri: {
    title: '권리가액',
    body:
      '<p>종전평가액에 비례율을 곱한 금액으로, <b>내가 사업에 기여한 자산의 가치</b>입니다.</p>' +
      '<code>권리가액 = 종전평가액 × 109.10%</code>' +
      '<p>비례율 109.10%는 사업이 끝났을 때 조합원 자산이 얼마나 늘어나는지를 나타내는 비율입니다.</p>',
  },
  bundam: {
    title: '분담금',
    body:
      '<p>리모델링 후 집을 받기 위해 <b>추가로 내야 하는 돈</b>입니다.</p>' +
      '<code>분담금 = 종후평가액 − 권리가액</code>' +
      '<p>새 집의 가치에서 내 몫으로 인정받은 가치를 뺀 차액입니다.</p>',
  },
  maesu: {
    title: '매수 시점',
    body:
      '<p>집을 <b>언제 샀는지</b>에 따라 이주비 대출 한도가 달라집니다. 정부 부동산 대책 시행일이 기준입니다.</p>' +
      '<p>2025년 6월 27일 이전에 사셨으면 종전평가액의 60%, 2025년 10월 15일 이후면 40%까지 빌릴 수 있습니다. 그 사이에 사셨다면 조합에 개별 상담을 받으셔야 합니다.</p>' +
      '<div class="helpsheet__note">참고: 2025년 6월 27일 이전 매수라면 다주택자도 60%로 동일합니다.</div>',
  },
  ijubi_rate: {
    title: '이주비 금리',
    body:
      '<p>신한은행 제안 기준 <b>Cofix(6개월물) + 가산금리 1.60%</b>입니다.</p>' +
      '<p>2026.06.25 대의원회 선정 당시에는 가산 1.50%로 당일 기준 4.4%였으나, 취급지점 철회 후 7.23 새 지점 제안에서 0.1%p 올라 약 4.5% 수준입니다. 그래서 기본값을 4.50%로 두었습니다.</p>' +
      '<div class="helpsheet__note">참고: 6개월 변동금리이며, 자서 시점이 아니라 실제 대출금이 실행되는 날의 금리로 확정됩니다. 지금은 어디까지나 가정치입니다.</div>',
  },
  jondae: {
    title: '기존 주담대 잔액',
    body:
      '<p>매수 시점에서 <b>이주비 대출 미신청</b>을 골랐을 때만 쓰입니다. 이주비 대신 기존 주택담보대출 잔액이 전체 대출 한도에서 차감됩니다.</p>' +
      '<p>이주비 대출을 받는 경우에는 기존 주담대를 <b>상환해야</b> 하므로 이 값은 계산에 들어가지 않습니다.</p>' +
      '<div class="helpsheet__note">참고: 근저당 설정액이 아니라 실제 잔액 기준입니다. 잔액보다 근저당이 크면 감액등기가 필요하다고 조합 시트에 안내되어 있습니다.</div>',
  },
  ijubi: {
    title: '이주비 대출',
    body:
      '<p>공사 기간에 <b>이사 나가 살 집을 구하는 비용</b>을 빌려주는 대출입니다. 취급은행은 신한은행이고 금리는 Cofix(6개월물)에 가산금리 1.60%를 더해 정해집니다.</p>' +
      '<p>원금은 입주할 때 한 번에 갚고, 이자도 입주할 때 갚습니다. 중도상환이 가능하며 수수료는 없습니다.</p>' +
      '<div class="helpsheet__note">참고: 금리는 자서 시점이 아니라 실제 대출금이 나가는 날 확정됩니다.</div>',
  },
  chuga: {
    title: '추가사업비 대출',
    body:
      '<p>법이 정한 이주비 한도만으로는 이주가 어려운 분들을 위한 <b>추가 대출</b>입니다. 이주비보다 금리가 높습니다. 키움증권이 취급하며 만기일시상환이고 <b>중도상환이 불가</b>합니다.</p>' +
      '<div class="helpsheet__note">참고: 신청할 때는 원금이 아니라 원금과 이자를 합한 금액을 적습니다.</div>',
  },
  hando_move: {
    title: '이주비 한도',
    body:
      '<code>이주비 한도 = 종전평가액 × LTV</code>' +
      '<p>매수 시점에 따라 LTV가 60% 또는 40%로 정해집니다. 위의 매수 시점을 선택하면 이 값이 자동으로 바뀌고, 직접 조절할 수도 있습니다.</p>',
  },
  hando_add: {
    title: '추가사업비 한도',
    body:
      '<p>전체 대출 가능 총액에서 분담금과 이주비 신청액을 뺀 나머지가 추가사업비 몫입니다. 그런데 그 몫 안에 <b>원금과 만기까지의 이자가 함께</b> 들어가야 하므로, 실제로 손에 쥐는 원금은 이자계수로 나눈 값이 됩니다.</p>' +
      '<code>잔여한도 = 종후평가액 × 90% − 분담금 − 이주비 신청액\n원금한도 = 잔여한도 ÷ (1 + 금리 ÷ 12 × 개월)</code>' +
      '<div class="helpsheet__note">참고: 이주비를 많이 받을수록 추가사업비 한도는 줄어듭니다.</div>',
  },
  sincheong: {
    title: '신청서 기재액',
    body:
      '<p>추가사업비 신청서에는 실제로 받을 원금이 아니라 <b>원금과 이자를 합한 금액</b>을 적습니다. 한도와 비교해야 하는 것도 이 금액입니다.</p>' +
      '<code>기재액 = 원금 + 만기까지의 이자</code>',
  },
  cd: {
    title: 'CD 91일물',
    body:
      '<p>은행끼리 91일 동안 돈을 빌릴 때 쓰는 <b>기준금리</b>입니다. 추가사업비 대출 금리가 여기에 연동됩니다.</p>' +
      '<code>추가사업비 금리 = CD 91일물 + 가산금리 2.22% + 취급수수료 0.14%</code>' +
      '<p>3개월마다 CD금리가 다시 정해지므로 대출 금리도 따라 바뀝니다.</p>' +
      '<div class="helpsheet__note">참고: 2026년 6월 14일 기준 2.92%였고, 이때 합계가 연 5.28%였습니다.</div>',
  },
  gigan: {
    title: '대출 기간',
    body:
      '<p><b>이주를 시작한 날부터 입주 기간이 끝나는 날까지</b>입니다. 조합 총회에서 55개월로 승인받았습니다.</p>' +
      '<p>늦게 이사 나가고 빨리 들어오면 개인 기간은 줄어들 수 있습니다. 공사가 지연되면 조합과 금융기관이 협의해 조정하고, 연장이 필요하면 총회 승인을 받습니다.</p>' +
      '<div class="helpsheet__note">참고: 신한은행 이주비 대출 제안서에는 대출실행일로부터 60개월 이내로 적혀 있어, 이주비 기간은 따로 조절할 수 있게 두었습니다.</div>',
  },
  bangsik: {
    title: '추가사업비 이자 계산',
    body:
      '<p>추가사업비 대출의 이자를 <b>어떤 방식으로 계산할지</b> 정합니다.</p>' +
      '<p><b>조합 시트(단리)</b>는 조합 공식 계산시트와 똑같이 원금 × 연이율 ÷ 12 × 개월수로 계산합니다.</p>' +
      '<p><b>조합 발표치</b>는 2026년 7월 30일 조합 안내문에 실린 실제 값입니다. 추가 이주비 1억원당 대출금 이자 26,720,000원, 이자의 이자 570,000원이 붙는다고 안내했습니다 — 즉 추가사업비도 단순 단리 계산보다 이자가 더 붙는다는 뜻입니다.</p>' +
      '<div class="helpsheet__note">참고: 조합은 이 값이 현재 금리로 일괄계산한 금액이며 단리 기준이라고 밝혔습니다. 조합도 아직 신한은행에서 정확한 이자 계산서를 받지 못한 상태입니다.</div>',
  },
  rounding: {
    title: '십만원 단위 절사·올림',
    body:
      '<p>조합 공식 계산시트의 자릿수 처리 방식입니다. 시트는 한도를 십만원 아래로 <b>버리고</b>(ROUNDDOWN), 이자는 십만원 위로 <b>올립니다</b>(ROUNDUP).</p>' +
      '<p>기본값은 <b>미적용(원 단위)</b>입니다 — 계산 결과를 그대로 보여줍니다. 조합 시트나 안내문의 숫자와 자릿수까지 정확히 맞춰보고 싶을 때만 켜세요.</p>',
  },
  ltv: {
    title: 'LTV',
    body:
      '<p>Loan To Value, 즉 <b>담보 가치 대비 대출 비율</b>입니다. 종후자산 LTV 90%는 리모델링 후 예상 가치의 90%까지만 전체 대출이 가능하다는 뜻입니다.</p>',
  },
  ioni: {
    title: '이자의 이자',
    body:
      '<p>만기까지 이자를 한 푼도 내지 않기 때문에, <b>그 사이 쌓인 이자에 다시 붙는 이자</b>입니다.</p>' +
      '<p><b>추가사업비</b> — 조합이 2026.07.30 안내문에서 <b>1억당 이자의 이자 약 570,000원</b>이라고 공표했습니다. 기본값(조합 발표치)이 이 비율을 그대로 적용합니다. 이 발표치는 5.28% 월복리 55개월 총이자와 0.1% 이내로 일치합니다 — 실제 계산은 월복리로 이루어진 것으로 보입니다.</p>' +
      '<p><b>이주비</b> — 조합 공표값은 아직 없습니다(신한은행 이자 계산서 대기 중). 발표치가 월복리 계산과 일치하므로 이주비도 <b>미납이자에 이주비 금리로 월복리가 붙는 것(월복리)을 기본값</b>으로 둡니다.</p>' +
      '<code>월복리 = 원금 × [(1+금리÷12)ⁿ − 1 − 금리÷12×n]</code>' +
      '<p>다른 선택지: <b>단리</b>(이자의 이자를 계산하지 않음), <b>조합 대납</b>(안내문의 대납 구조 — 조합이 사업비 대출로 이자를 대납하고 대납금에 사업비 금리가 붙는 추정).</p>' +
      '<div class="helpsheet__note">참고: 은행 이자 계산서가 나오면 기본값을 확정값으로 바꿉니다.</div>',
  },
  mingam: {
    title: '금리 민감도',
    body:
      '<p>금리가 오르면 총 이자가 얼마나 느는지 보여줍니다. 이주비 금리는 실행일에야 확정되고, 추가사업비 금리는 CD에 연동돼 3개월마다 바뀌므로 둘 다 지금은 가정입니다.</p>' +
      '<p>금리가 오르면 이자계수가 커져서 같은 한도 안에 담을 수 있는 원금이 줄어듭니다. 즉 <b>이자는 늘고 손에 쥐는 돈은 줄어듭니다.</b></p>' +
      '<div class="helpsheet__note">참고: 조합 발표치는 금리와 무관한 고정 비율(1억당 2,672만)이라, 이 표는 조합 시트(단리) 기준으로 계산합니다.</div>',
  },
};

const STEPPER_CONFIG = {
  setCd: { step: 0.1, min: 0, max: 20, decimals: 2, key: 'cd' },
  setMoveRate: { step: 0.1, min: 0, max: 20, decimals: 2, key: 'moveRate' },
  setMonthsMove: { step: 1, min: 1, max: 360, decimals: 0, key: 'monthsMove' },
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

function computeAll(unit, s) {
  const addRatePct = s.cd + GASAN + FEE;
  const rMove = s.moveRate / 100;
  const rAdd = addRatePct / 100;
  const nMove = s.monthsMove;
  const nAdd = s.months;

  // 추가사업비 이자계수: 조합 발표치(2026.07.30 안내문의 1억당 정률)를 쓰거나,
  // 조합 공식 계산시트 그대로 단리(원금 × 연이율 ÷ 12 × 개월)를 쓴다.
  // 이주비는 항상 단리다.
  const addFactor = (s.addBasis === 'notice') ? NOTICE_ADD_INTEREST_RATE : (rAdd / 12 * nAdd);
  const moveFactor = rMove / 12 * nMove;

  const totalCap = unit.종후평균 * s.ltvAfter / 100;
  const moveCap = (s.mode === 'none') ? 0 : Math.floor(unit.종전평균 * s.ltvBefore / 100);

  const moveAmount = (s.mode === 'none') ? 0 : s.amtMove;
  const deduct = (s.mode === 'none') ? s.existing : moveAmount;
  const bucket = Math.max(0, totalCap - deduct - unit.분담금);

  // 한도는 실제로 적용할 이자계수(addFactor)와 일관되게 계산한다.
  let addPrincipalCap = bucket / (1 + addFactor);
  addPrincipalCap = (s.rounding === 'on')
    ? Math.floor(addPrincipalCap / 100000) * 100000
    : Math.floor(addPrincipalCap); // 한도는 항상 정수 — 최대 버튼·클램프·배지가 같은 값을 보게 한다
  const addCapInterest = bucket - addPrincipalCap;

  const addPrincipal = s.amtAdd;

  const moveInterest = Math.round(moveAmount * moveFactor);

  // 이주비 이자의 이자.
  // monthly: 미납이자에 이주비 금리로 월복리가 붙는다고 본다 — 조합 발표치(추가
  //          사업비 1억당 2,672만+57만)가 월복리 계산과 일치해 기본값으로 둔다.
  // proxy:   조합이 사업비 대출로 이자를 대납하고 대납금에 사업비 금리가 붙는
  //          구조(2026.07.30 안내문). k개월차 대납금이 만기까지 (n−k)개월 이자를
  //          낳아 n(n−1)/2 항이 된다.
  const moveIoi =
    (s.moveIoi === 'monthly')
      ? Math.round(moveAmount * (Math.pow(1 + rMove / 12, nMove) - 1 - moveFactor))
      : (s.moveIoi === 'proxy')
        ? Math.round(moveAmount * (rMove / 12) * (rAdd / 12) * nMove * (nMove - 1) / 2)
        : 0;

  let addInterest = addPrincipal * addFactor;
  addInterest = (s.rounding === 'on')
    ? Math.ceil(addInterest / 100000) * 100000
    : Math.round(addInterest);

  // 추가사업비 이자의 이자: 조합 발표치 기준에서는 실제로 발생한다(1억당
  // 570,000원). 조합 시트(단리) 기준에서는 신청액에 이자가 이미 포함되어
  // 있다고 가정하므로 0이다.
  const addIoi = (s.addBasis === 'notice') ? Math.round(addPrincipal * NOTICE_ADD_IOI_RATE) : 0;

  const addApplied = addPrincipal + addInterest;

  const moveSubtotal = moveAmount + moveInterest + moveIoi;
  const addSubtotal = addPrincipal + addInterest + addIoi;

  const totalLoan = moveAmount + addPrincipal;
  const totalInterest = moveInterest + moveIoi + addInterest + addIoi;
  const maturityTotal = totalLoan + totalInterest;

  return {
    addRatePct, moveFactor, addFactor,
    totalCap, moveCap, moveAmount, deduct, bucket,
    addPrincipalCap, addCapInterest, addPrincipal,
    moveInterest, addInterest, addApplied,
    moveIoi, addIoi, moveSubtotal, addSubtotal,
    totalLoan, totalInterest, maturityTotal,
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
  monthsMove: DEFAULTS.monthsMove,
  ltvAfter: DEFAULTS.ltvAfter,
  ltvBefore: DEFAULTS.ltvBefore,
  existing: DEFAULTS.existing,
  addBasis: DEFAULTS.addBasis,
  moveIoi: DEFAULTS.moveIoi,
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
  document.getElementById('lineAddPrincipal').textContent = won(r.addPrincipal);
  document.getElementById('lineAddApplied').textContent = won(r.addApplied);
  document.getElementById('lineTotalLoan').textContent = won(r.totalLoan);
  document.getElementById('lineTotalInterest').textContent = won(r.totalInterest);

  // 이주비 대출 블록
  document.getElementById('headMoveRate').textContent =
    `연 ${state.moveRate.toFixed(2)}% · ${state.monthsMove}개월`;
  document.getElementById('lineMovePrincipal2').textContent = won(r.moveAmount);
  document.getElementById('lineMoveInterest').textContent = won(r.moveInterest);
  document.getElementById('lineMoveIoi').textContent =
    (state.moveIoi === 'none') ? '—' : won(r.moveIoi);
  document.getElementById('lineMoveSub').textContent = won(r.moveSubtotal);

  // 추가사업비 대출 블록
  document.getElementById('headAddRate').textContent = (state.addBasis === 'notice')
    ? '조합 발표치 · 1억당 이자 2,672만'
    : `연 ${r.addRatePct.toFixed(2)}% · ${state.months}개월`;
  document.getElementById('lineAddPrincipal2').textContent = won(r.addPrincipal);
  document.getElementById('lineAddInterest').textContent = won(r.addInterest);
  document.getElementById('lineAddIoi').textContent =
    (state.addBasis !== 'notice') ? '—' : won(r.addIoi);
  document.getElementById('lineAddSub').textContent = won(r.addSubtotal);

  document.getElementById('lineTotalLoan2').textContent = won(r.totalLoan);
  document.getElementById('lineTotalInterest2').textContent = won(r.totalInterest);
  document.getElementById('lineMaturity').textContent = won(r.maturityTotal);

  document.getElementById('barInterest').textContent = won(r.totalInterest);
  document.getElementById('barTotal').textContent = won(r.maturityTotal);
}

function updateSettingsPanel(r) {
  document.getElementById('settingsHint').textContent = (state.addBasis === 'notice')
    ? '조합 발표치'
    : '조합 시트 (단리)';

  document.getElementById('rateBreakdown').innerHTML =
    `추가사업비 금리 = CD ${state.cd.toFixed(2)}% + 가산 ${GASAN.toFixed(2)}% + ` +
    `취급수수료 ${FEE.toFixed(2)}% = 연 <b>${r.addRatePct.toFixed(2)}%</b>` +
    `<br>이자의 이자 = 이주비원금 × (이주비금리÷12) × (추가사업비금리÷12) × n(n−1)÷2`;
}

/* ── 경우별 비교 표 ──────────────────────────── */

function renderTableMove(unit) {
  const base = Math.round(state.moveRate * 100) / 100;
  const rates = buildRateSweep(base);
  let html = '';
  rates.forEach(rate => {
    const s2 = Object.assign({}, state, { moveRate: rate });
    const r = computeAll(unit, s2);
    const isCurrent = rate === base;
    html += `<tr${isCurrent ? ' data-current="1"' : ''}>` +
      `<th>${rate.toFixed(2)}%${isCurrent ? '<span class="pill">현재</span>' : ''}</th>` +
      `<td>${won(r.moveInterest)}</td>` +
      `<td>${state.moveIoi === 'none' ? '—' : won(r.moveIoi)}</td>` +
      `<td>${won(r.totalInterest)}</td>` +
      `</tr>`;
  });
  const tbMove = document.getElementById('tableMoveRate');
  if (tbMove) tbMove.innerHTML = html; // 캐시 어긋남으로 요소가 없어도 죽지 않게
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
  let html0 = '';
  if (state.addBasis === 'notice') {
    html0 = `<tr class="note-row"><td colspan="4">조합 발표치는 금리와 무관한 고정 비율이라, 이 표는 조합 시트(단리) 기준으로 금리 영향을 보여줍니다.</td></tr>`;
  }
  rates.forEach(rate => {
    // 발표치는 금리를 반영하지 않으므로 민감도는 항상 단리 기준으로 계산한다.
    const s2 = Object.assign({}, state, { cd: rate - GASAN - FEE, addBasis: 'sheet' });
    const r = computeAll(unit, s2);
    const isCurrent = rate === base;
    html += `<tr${isCurrent ? ' data-current="1"' : ''}>` +
      `<th>${rate.toFixed(2)}%${isCurrent ? '<span class="pill">현재</span>' : ''}</th>` +
      `<td>${won(r.addPrincipalCap)}</td>` +
      `<td>${won(r.addInterest)}</td>` +
      `<td>${won(r.totalInterest)}</td>` +
      `</tr>`;
  });
  const tb3 = document.getElementById('table3Body');
  if (tb3) tb3.innerHTML = html0 + html;
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

  renderTableMove(unit);
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

function bindHelp() {
  const sheet = document.getElementById('helpSheet');
  const title = document.getElementById('helpTitle');
  const body = document.getElementById('helpBody');

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.help[data-help]');
    if (!btn) return;
    const entry = HELP[btn.dataset.help];
    if (!entry) return;
    title.textContent = entry.title;
    body.innerHTML = entry.body;
    sheet.showModal();
  });

  document.getElementById('helpClose').addEventListener('click', () => {
    sheet.close();
  });

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });
}

function bindEvents() {
  bindChips();
  bindHelp();

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
        if (state.mode === 'none' || state.mode === 'consult') return; // 한도 미정
        state.amtMove = Math.floor(r.moveCap);
        document.getElementById('amtMove').value = won(state.amtMove);
      } else if (btn.dataset.max === 'add') {
        state.amtAdd = Math.floor(r.addPrincipalCap);
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

  document.querySelectorAll('input[name="addBasis"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.addBasis = radio.value;
      render();
    });
  });

  document.querySelectorAll('input[name="moveIoi"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.moveIoi = radio.value;
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
    state.monthsMove = DEFAULTS.monthsMove;
    state.ltvAfter = DEFAULTS.ltvAfter;
    // 이주비 LTV는 현재 선택된 매수 시점과 어긋나지 않게 재유도한다.
    state.ltvBefore = (state.mode === 'ltv40') ? 40 : DEFAULTS.ltvBefore;
    state.existing = DEFAULTS.existing;
    state.addBasis = DEFAULTS.addBasis;
    state.moveIoi = DEFAULTS.moveIoi;
    state.rounding = DEFAULTS.rounding;

    document.getElementById('setCd').textContent = DEFAULTS.cd.toFixed(2);
    document.getElementById('setMoveRate').textContent = DEFAULTS.moveRate.toFixed(2);
    document.getElementById('setMonths').textContent = String(DEFAULTS.months);
    document.getElementById('setMonthsMove').textContent = String(DEFAULTS.monthsMove);
    document.getElementById('setLtvAfter').textContent = String(DEFAULTS.ltvAfter);
    document.getElementById('setLtvBefore').textContent = String(state.ltvBefore);
    document.getElementById('setExisting').value = won(DEFAULTS.existing);
    document.querySelector('input[name="addBasis"][value="' + DEFAULTS.addBasis + '"]').checked = true;
    document.querySelector('input[name="moveIoi"][value="' + DEFAULTS.moveIoi + '"]').checked = true;
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
  state.amtMove = Math.floor(computeAll(unit, state).moveCap);
  state.amtAdd = Math.floor(computeAll(unit, state).addPrincipalCap);
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
