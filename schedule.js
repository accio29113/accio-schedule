/* schedule.js
   Accio（アクシオ）空き状況
   - localStorageキー: ACCIO_SCHEDULE_V1
   - 役割: viewer(閲覧のみ) / staff(操作可能) を呼び出し側HTMLが指定
*/

const STORAGE_KEY = 'ACCIO_SCHEDULE_V1';

// 営業設定
const HOURS = {
  weekday: { start: '15:00', end: '21:00' },  // 月水金
  weekend: { start: '09:30', end: '21:00' },  // 土日（祝同様運用）
};

const DAYS = [
  { key:'mon', label:'月' },
  { key:'tue', label:'火' },
  { key:'wed', label:'水' },
  { key:'thu', label:'木' },
  { key:'fri', label:'金' },
  { key:'sat', label:'土' },
  { key:'sun', label:'日' },
];

const STATUS = {
  OK: 'ok',          // 空き
  NG: 'ng',          // 予約不可
  INFO: 'info',      // 情報（授業中など）
  CLOSED: 'closed',  // 定休日等
};

// 文字列 "HH:MM" -> 分
function toMin(hm){
  const [h,m] = hm.split(':').map(Number);
  return h*60 + m;
}
// 分 -> "HH:MM"
function toHM(min){
  const h = Math.floor(min/60).toString().padStart(2,'0');
  const m = (min%60).toString().padStart(2,'0');
  return `${h}:${m}`;
}

// デフォルトの週テンプレ
function defaultWeekTemplate(){
  const tpl = {};
  DAYS.forEach(d=>{
    tpl[d.key] = {
      dayNote: '',       // その日のメモ
      slots: []          // {time: "15:00", status:"ok"|"ng"|"info"|"closed", note?:string}
    };
  });

  // 営業時間に応じて30分刻み生成
  function genSlots(start, end){
    const out = [];
    for(let t = toMin(start); t < toMin(end); t += 30){
      out.push({ time: toHM(t), status: STATUS.OK, note: '' });
    }
    return out;
  }

  // 月・水・金（weekday）
  ['mon','wed','fri'].forEach(k=>{
    tpl[k].slots = genSlots(HOURS.weekday.start, HOURS.weekday.end);
  });

  // 土・日（weekend）
  ['sat','sun'].forEach(k=>{
    tpl[k].slots = genSlots(HOURS.weekend.start, HOURS.weekend.end);
  });

  // 火：基本は営業時間なし（個別対応の想定）→ ここでは weekend相当で表示したい場合は切替OK
  // とりあえず、平日短縮で見やすくするため、15:00～21:00を表示しておく
  tpl['tue'].slots = genSlots(HOURS.weekday.start, HOURS.weekday.end);

  // 木：定休日
  tpl['thu'].slots = genSlots(HOURS.weekday.start, HOURS.weekday.end).map(s => ({...s, status: STATUS.CLOSED}));
  tpl['thu'].dayNote = '定休日';

  // 火：17:00〜19:00「東新町教室で授業中」
  tpl['tue'].slots = tpl['tue'].slots.map(s=>{
    const m = toMin(s.time);
    if(m >= toMin('17:00') && m < toMin('19:00')){
      return { ...s, status: STATUS.INFO, note: '東新町教室で授業中' };
    }
    return s;
  });
  return tpl;
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return defaultWeekTemplate();
  try{
    const parsed = JSON.parse(raw);
    // バージョン違いや欠損に強く
    const base = defaultWeekTemplate();
    for(const k of Object.keys(base)){
      if(!parsed[k]) parsed[k] = base[k];
      if(!Array.isArray(parsed[k].slots)) parsed[k].slots = base[k].slots;
      if(typeof parsed[k].dayNote !== 'string') parsed[k].dayNote = '';
    }
    return parsed;
  }catch(e){
    console.warn('loadState parse error', e);
    return defaultWeekTemplate();
  }
}

function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearState(){
  localStorage.removeItem(STORAGE_KEY);
}

function exportJSON(state){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `accio_schedule_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function importJSON(file, cb){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      saveState(obj);
      cb(null, obj);
    }catch(e){
      cb(e);
    }
  };
  reader.onerror = () => cb(reader.error);
  reader.readAsText(file);
}

// UI描画
function render(container, mode='viewer'){
  const state = loadState();
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'grid';

  DAYS.forEach(d=>{
    const day = document.createElement('section');
    day.className = 'day';
    const head = document.createElement('div');
    head.className = 'day-header';

    const title = document.createElement('div');
    title.className = 'day-title';
    title.textContent = `${d.label}曜日`;

    const note = document.createElement('div');
    note.className = 'day-note';
    note.textContent = state[d.key].dayNote || '';

    head.appendChild(title);
    head.appendChild(note);

    const slots = document.createElement('div');
    slots.className = 'slots';

    state[d.key].slots.forEach((slot, idx)=>{
      const el = document.createElement('div');
      el.className = `slot ${slot.status} ${mode==='viewer' ? 'readonly':''}`;
      el.dataset.day = d.key;
      el.dataset.index = idx;

      const t = document.createElement('div');
      t.className = 'time';
      t.textContent = slot.time;

      const st = document.createElement('div');
      st.className = 'status';
      st.textContent = labelFromStatus(slot);

      el.appendChild(t);
      el.appendChild(st);

      if(slot.note){
        const n = document.createElement('div');
        n.className = 'status';
        n.textContent = `※ ${slot.note}`;
        el.appendChild(n);
      }

      if(mode==='staff'){
        el.addEventListener('click', ()=>{
          const cur = state[d.key].slots[idx];
          const next = nextStatus(cur.status, d.key);
          state[d.key].slots[idx] = { ...cur, status: next };
          saveState(state);
          render(container, mode);
        });
      }
      slots.appendChild(el);
    });

    day.appendChild(head);
    day.appendChild(slots);
    grid.appendChild(day);
  });

  container.appendChild(grid);
}

function labelFromStatus(slot){
  switch(slot.status){
    case STATUS.OK: return '空き';
    case STATUS.NG: return '予約不可';
    case STATUS.INFO: return 'お知らせ';
    case STATUS.CLOSED: return '休業';
    default: return '';
  }
}

function nextStatus(current, dayKey){
  // 木曜は基本 CLOSED を維持（スタッフは必要なら切替可能にしておく）
  const order = [STATUS.OK, STATUS.NG, STATUS.INFO, STATUS.CLOSED];
  const i = order.indexOf(current);
  return order[(i+1) % order.length];
}

// ========== viewer 用 初期化（GitHub上のJSONを読み込む版） ==========
async function initViewer() {
  const container = document.getElementById('schedule');

  try {
    const res = await fetch('./accio_schedule.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      saveState(data);
    } else {
      console.warn('JSONが見つからんけん、localStorageを使うで。');
    }
  } catch (e) {
    console.warn('JSONの読み込みに失敗。localStorageを使うで。', e);
  }

  render(container, 'viewer');
}


// ========== staff 用 初期化 ==========
function initStaff(){
  const container = document.getElementById('schedule');
  render(container, 'staff');

  // コントロール群
  const selectDay = document.getElementById('selectDay');
  const bulkAction = document.getElementById('bulkAction');
  const applyBtn = document.getElementById('applyBulk');
  const noteInput = document.getElementById('dayNote');
  const saveNoteBtn = document.getElementById('saveNote');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const resetBtn = document.getElementById('resetBtn');

  // 初期値
  noteInput.value = loadState()[selectDay.value].dayNote || '';

  selectDay.addEventListener('change', ()=>{
    const state = loadState();
    noteInput.value = state[selectDay.value].dayNote || '';
  });

  saveNoteBtn.addEventListener('click', ()=>{
    const state = loadState();
    state[selectDay.value].dayNote = noteInput.value.trim();
    saveState(state);
    render(container, 'staff');
  });

  applyBtn.addEventListener('click', ()=>{
    const state = loadState();
    const dayKey = selectDay.value;
    const action = bulkAction.value;

    state[dayKey].slots = state[dayKey].slots.map(s=>{
      if(action === 'ok')   return { ...s, status: STATUS.OK };
      if(action === 'ng')   return { ...s, status: STATUS.NG };
      if(action === 'info') return { ...s, status: STATUS.INFO, note: s.note || '' };
      if(action === 'closed') return { ...s, status: STATUS.CLOSED };
      return s;
    });

    // 木曜を一括休業にしたい時もOK
    if(action === 'closed'){
      state[dayKey].dayNote ||= '休業';
    }

    saveState(state);
    render(container, 'staff');
  });

  exportBtn.addEventListener('click', ()=>{
    exportJSON(loadState());
  });

  importInput.addEventListener('change', (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    importJSON(file, (err)=>{
      if(err){ alert('読込エラー：JSONファイルを確認してな'); return; }
      render(container, 'staff');
      alert('読込できたで！');
      importInput.value = '';
    });
  });

  resetBtn.addEventListener('click', ()=>{
    if(confirm('すべて初期化するで？（localStorageを削除）')){
      clearState();
      render(container, 'staff');
    }
  });
}

window.AccioSchedule = {
  initViewer, initStaff
};
