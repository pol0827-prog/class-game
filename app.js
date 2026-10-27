// =============================================================
//  수업이 재밌어지는 5분 — 교사 화면
// =============================================================
import { CONFIG } from './config.js';
import { cloud } from './cloud.js';
import { GAMES, CATS, FORMATS, WEATHER, TRAFFIC, parseLines, itemsToLines } from './data.js';
import { chosung, emojify, localKeywordHints, maskWord, readPairs } from './maker.js';
import { $, $$, esc, LS, TEAM_COLORS, VOTE_COLORS, shuffle, toast, modal, confetti, flash, sfx, ask, askText } from './ui.js';


// ---------------- 상태 ----------------
const S = {
  tab: 'all',
  topic: LS.get('co-topic', ''),
  teams: LS.get('co-teams', null) || defaultTeams(6),
  rosters: [],
  rosterId: LS.get('co-roster-id', null),
  room: null,              // { code, sendRoster }
  members: [],
  unsubMembers: null,
  game: null,
  clean: [],
  wide: false,
  oxOut: new Set(),
  oxSeen: new Set(),
  oxSession: 's' + Date.now(),
  tileImg: null,
  pickedNames: [],
};
function defaultTeams(n) { return Array.from({ length: n }, (_, i) => ({ name: `${i + 1}모둠`, score: 0 })); }
function saveTeams() { LS.set('co-teams', S.teams); }
function addClean(fn) { S.clean.push(fn); }
function runClean() { S.clean.splice(0).forEach(f => { try { f(); } catch (e) { console.warn(e); } }); }
function every(ms, fn) { const t = setInterval(fn, ms); addClean(() => clearInterval(t)); return t; }
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const roster = () => S.rosters.find(r => r.id === S.rosterId) || null;
const curPack = (g) => g.packs ? (g.packs.find(p => p.id === LS.get('co-pack-' + g.id, '')) || g.packs[0]) : null;
const lineKey = (g) => 'co-lines-' + g.id + (g.packs ? '-' + curPack(g).id : '');
const setId = (g) => g.id + (g.packs ? '-' + curPack(g).id : '');
const defLines = (g) => g.packs ? curPack(g).lines : (g.lines || '');
const gameLines = (g) => LS.get(lineKey(g), null) ?? defLines(g);
const saveLines = (g, text) => LS.set(lineKey(g), text);
const gameItems = (g) => g.format ? parseLines(g.format, gameLines(g)) : [];

// ---------------- 실시간(교사) ----------------
const Live = {
  get on() { return !!S.room; },
  async set(patch) { if (!S.room) return; try { await cloud.updateRoom(S.room.code, patch); } catch (e) { console.warn('room update', e); } },
  round() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); },
  watch(sub, round, cb) { if (!S.room) return () => {}; return cloud.watchSub(S.room.code, sub, round, cb); },
  idle() { this.set({ mode: 'idle', game: S.game?.title || '', round: null, prompt: '', options: [], buzzTop: [] }); },
};
function pushScores() { Live.set({ teams: S.teams.map(t => t.name), scores: S.teams.map(t => t.score) }); }

// =============================================================
//  시작
// =============================================================
async function startTeacher() {
  renderShell();
  renderHome();
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  cloud.onAuth(() => { renderAuth(); loadRosters(); });
  await cloud.init();
}

function renderShell() {
  $('#app').innerHTML = `
  <header class="top">
    <div class="logo"><div class="mark">⏱️</div><div><h1>수업이 재밌어지는 5분</h1><small>CLASS OPENER · 고1–고3 교실 게임</small></div></div>
    <div class="tools">
      <button class="btn" id="b-room">📱 학생 참여</button>
      <button class="btn" id="b-pick">👤 이름 뽑기</button>
      <button class="btn" id="b-score">🏆 점수판</button>
      <button class="btn" id="b-sound" title="효과음">${sfx.muted ? '🔇' : '🔊'}</button>
      <button class="btn" id="b-full" title="전체 화면">⛶</button>
      <span id="auth"></span>
    </div>
  </header>
  <main class="wrap" id="home"></main>
  <div id="play-root"></div>`;
  $('#b-room').onclick = openRoomModal;
  $('#b-pick').onclick = openPicker;
  $('#b-score').onclick = openScoreModal;
  $('#b-sound').onclick = (e) => { sfx.muted = !sfx.muted; e.currentTarget.textContent = sfx.muted ? '🔇' : '🔊'; };
  $('#b-full').onclick = toggleFull;
}
function toggleFull() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }

function renderAuth() {
  const el = $('#auth'); if (!el) return;
  const u = cloud.user;
  if (cloud.mode !== 'firebase') {
    el.innerHTML = `<button class="btn" id="b-auth" title="config.js에 파이어베이스 설정을 넣으면 학생 휴대폰과 연결됩니다">🧪 체험 모드</button>`;
    $('#b-auth').onclick = () => modal(`<h3>🧪 체험 모드 <button class="x btn ghost" data-close>✕</button></h3>
      <p>지금은 파이어베이스가 연결되지 않아 <b>이 컴퓨터 안에서만</b> 동작해요.</p>
      <ul class="steps"><li>게임·타이머·점수판·이름 뽑기·문제 편집은 모두 그대로 쓸 수 있어요.</li>
      <li>학생 참여는 같은 브라우저의 다른 탭에서만 연결돼요(미리 보기용).</li>
      <li>실제 학생 휴대폰 연결과 구글 로그인 저장은 <b>config.js</b>에 파이어베이스 설정을 넣으면 켜져요. (README 참고)</li></ul>`);
    return;
  }
  if (u?.google) {
    el.innerHTML = `<button class="btn" id="b-auth">👤 ${esc(u.name || u.email)}</button>`;
    $('#b-auth').onclick = async () => { if (await ask('로그아웃할까요?')) { await cloud.signOut(); toast('로그아웃했어요'); } };
  } else {
    el.innerHTML = `<button class="btn primary" id="b-auth">G 구글 로그인</button>`;
    $('#b-auth').onclick = async () => { try { await cloud.signInGoogle(); toast('로그인했어요. 문제 세트·명렬이 계정에 저장돼요.'); } catch (e) { toast('로그인 실패: ' + e.message); } };
  }
}
async function loadRosters() {
  try { S.rosters = await cloud.listRosters(); } catch (e) { console.warn(e); S.rosters = []; }
  if (S.rosterId && !roster()) S.rosterId = null;
}

// =============================================================
//  홈
// =============================================================
function renderHome() {
  const home = $('#home');
  const tabs = [['all', '전체', '✨'], ...Object.entries(CATS).map(([k, c]) => [k, c.name, c.emoji]), ['live', '휴대폰 참여', '📱']];
  const list = GAMES.filter(g => S.tab === 'all' || (S.tab === 'live' ? !!g.live : g.cat === S.tab));
  home.innerHTML = `
  <section class="hero">
    <div>
      <h2>오늘 수업, 5분이면 분위기가 바뀝니다</h2>
      <p>카드를 누르면 진행 방법·타이머·점수판이 한 화면에. 휴대폰이 없어도, 있으면 더 신나게!</p>
      <div class="topic"><span class="chip">📚 오늘 수업 주제</span>
        <input id="topic" placeholder="예: 설득하는 글쓰기 — 주장과 근거" value="${esc(S.topic)}">
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn big primary" id="b-draw">🎲 오늘의 게임 뽑기</button>
    </div>
  </section>
  <nav class="tabs">${tabs.map(([k, n, e]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${e} ${n}</button>`).join('')}</nav>
  <section class="grid">${list.map(cardHTML).join('')}</section>
  <p class="foot">카드를 눌러 진행 방법과 타이머를 확인하세요 · 📱 표시가 있는 게임은 학생 휴대폰으로도 참여할 수 있어요</p>`;
  $('#topic').oninput = (e) => { S.topic = e.target.value; LS.set('co-topic', S.topic); };
  $('#b-draw').onclick = openDraw;
  $$('.tab', home).forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderHome(); });
  $$('.card', home).forEach(c => c.onclick = () => openGame(c.dataset.id));
}
function cardHTML(g) {
  const c = CATS[g.cat];
  return `<button class="card" data-id="${g.id}" style="--cc:${c.color}">
    <div class="badges">${g.isNew ? '<span class="pill badge-new">NEW</span>' : ''}${g.live ? `<span class="pill badge-live">📱 ${({ buzzer: '버저', vote: '투표', ticket: '제출', mafia: '직업 카드', liar: '제시어' })[g.live]}</span>` : ''}</div>
    <span class="cat">${c.emoji} ${c.name}</span>
    <h3>${esc(g.title)}</h3>
    <p>${esc(g.summary)}</p>
    <div class="meta"><span class="chip">⏱ ${g.time}</span><span class="chip">👥 ${g.people}</span></div>
  </button>`;
}

// ---------------- 오늘의 게임 뽑기 ----------------
function openDraw() {
  let filter = 'all';
  const m = modal(`<h3>🎲 오늘의 게임 뽑기 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="tabs" id="df">
      <button class="tab on" data-f="all">전체</button><button class="tab" data-f="intro">수업 도입용</button><button class="tab" data-f="close">수업 마무리용</button><button class="tab" data-f="live">📱 휴대폰 참여</button>
    </div>
    <div class="slot" id="slot">?</div>
    <div class="ctrl"><button class="btn big" id="d-roll">🎲 뽑기</button><button class="btn big primary hidden" id="d-go">이 게임 시작 ▶</button></div>`);
  let picked = null;
  $$('#df .tab', m.el).forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#df .tab', m.el).forEach(x => x.classList.toggle('on', x === b)); });
  const pool = () => GAMES.filter(g => filter === 'all' || (filter === 'intro' ? g.cat !== 'close' : filter === 'close' ? g.cat === 'close' : !!g.live));
  const roll = () => {
    const p = pool(); const slot = $('#slot', m.el); $('#d-go', m.el).classList.add('hidden');
    slot.classList.add('rolling'); let n = 0; const total = 22 + Math.floor(Math.random() * 8);
    const step = () => {
      picked = p[Math.floor(Math.random() * p.length)]; slot.textContent = picked.title; sfx.roll(); n++;
      if (n < total) setTimeout(step, 40 + n * n * .35);
      else { slot.classList.remove('rolling'); slot.innerHTML = `${CATS[picked.cat].emoji} ${esc(picked.title)}<div class="sub">${esc(picked.summary)}</div>`; sfx.win(); $('#d-go', m.el).classList.remove('hidden'); }
    };
    step();
  };
  $('#d-roll', m.el).onclick = roll;
  $('#d-go', m.el).onclick = () => { m.close(); openGame(picked.id); };
  roll();
}

// =============================================================
//  게임 화면
// =============================================================
function openGame(id) {
  const g = GAMES.find(x => x.id === id); if (!g) return;
  runClean();
  S.game = g;
  const c = CATS[g.cat];
  $('#play-root').innerHTML = `
  <div class="play ${S.wide ? 'wide' : ''}" id="play">
    <div class="play-top">
      <button class="btn" id="p-back">← 목록</button>
      <span class="pill" style="background:${c.color}">${c.emoji} ${c.name}</span>
      <h2>${esc(g.title)}</h2>
      ${g.format ? `<button class="btn" id="p-edit">✏️ 내용 편집</button><button class="btn" id="p-ai">✨ 문제 만들기</button>` : ''}
      <button class="btn" id="p-pick">👤 이름 뽑기</button>
      <button class="btn ${S.room ? 'room-chip' : ''}" id="p-room">${S.room ? `📱 <b>${S.room.code}</b> · ${S.members.length}명` : '📱 학생 참여'}</button>
      <button class="btn" id="p-wide" title="옆 패널 숨기기/보이기">${S.wide ? '◧' : '◨'}</button>
      <button class="btn" id="p-full" title="전체 화면">⛶</button>
    </div>
    <div class="play-body">
      <main class="stage" id="stage"></main>
      <aside class="side" id="side"></aside>
    </div>
  </div>`;
  document.body.style.overflow = 'hidden';
  $('#p-back').onclick = closeGame;
  $('#p-pick').onclick = openPicker;
  $('#p-room').onclick = openRoomModal;
  $('#p-full').onclick = toggleFull;
  $('#p-wide').onclick = (e) => { S.wide = !S.wide; $('#play').classList.toggle('wide', S.wide); e.currentTarget.textContent = S.wide ? '◧' : '◨'; };
  if (g.format) { $('#p-edit').onclick = () => openEditor(g); $('#p-ai').onclick = () => openMaker(g); }
  renderSide(g);
  renderModule();
}
function closeGame() {
  runClean();
  S.sideStop?.(); S.sideStop = null;
  S.game = null;
  $('#play-root').innerHTML = '';
  document.body.style.overflow = '';
  Live.idle();
}
function renderModule() {
  const g = S.game; if (!g) return;
  runClean();
  const stage = $('#stage'); stage.classList.remove('night'); stage.innerHTML = '';
  const fn = MOD[g.module];
  if (fn) fn(stage, g, gameItems(g));
  if (Live.on && !g.live) Live.idle();
  if (Live.on && g.live) Live.set({ game: g.title });
}
function refreshRoomButton() {
  const b = $('#p-room'); if (!b) return;
  b.className = 'btn ' + (S.room ? 'room-chip' : '');
  b.innerHTML = S.room ? `📱 <b>${S.room.code}</b> · ${S.members.length}명` : '📱 학생 참여';
  const hb = $('#b-room'); if (hb) { hb.className = 'btn ' + (S.room ? 'room-chip' : ''); hb.innerHTML = S.room ? `📱 <b>${S.room.code}</b> · ${S.members.length}명` : '📱 학생 참여'; }
}

// ---------------- 옆 패널: 진행 방법 · 타이머 · 점수 ----------------
function renderSide(g) {
  S.sideStop?.(); S.sideStop = null;
  const side = $('#side');
  side.innerHTML = `
    <details class="box" open><summary class="t" style="font-size:1.15rem;cursor:pointer">📋 진행 방법</summary>
      <ol class="steps" style="margin-top:10px">${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${(g.tips || []).map(t => `<div class="tips">💡 ${esc(t)}</div>`).join('')}
      ${g.live ? `<div class="tips" style="background:#EEF4FF">📱 휴대폰이 없어도 OK! ${({ vote: '손을 든 학생 수를 ✋+1로 세면 돼요.', buzzer: '손을 먼저 든 모둠을 눌러 점수를 주세요.', ticket: '포스트잇이나 쪽지에 적어 내면 돼요.', mafia: '방을 닫으면 진행자 모드로 바뀌어요. 직업 쪽지를 나눠 주고 화면 안내대로 진행해요.', liar: '라이어는 고개를 숙이고, 나머지만 화면의 제시어를 봐요.' })[g.live]}</div>` : ''}
    </details>
    ${g.timers?.length ? `<div class="box timer" id="timer"></div>` : ''}
    <div class="box scorebox"></div>`;
  if (g.timers?.length) timerBox($('#timer'), g.timers);
  renderScores();
}

function timerBox(host, presets) {
  let total = presets[Math.min(1, presets.length - 1)], left = total, running = false, endAt = 0, t = null;
  const draw = () => {
    host.innerHTML = `<h4>⏱ 타이머</h4>
      <div class="bar-time"><i style="width:${total ? (left / total) * 100 : 0}%"></i></div>
      <div class="time ${left <= 5 && running ? 'low' : ''}">${fmt(left)}</div>
      <div class="row">${presets.map(p => `<button class="btn sm" data-p="${p}">${p < 60 ? p + '초' : (p / 60) + '분'}</button>`).join('')}
        <button class="btn sm" data-add="30">+30초</button></div>
      <div class="row" style="margin-top:8px"><button class="btn ${running ? '' : 'primary'}" data-go>${running ? '⏸ 멈춤' : '▶ 시작'}</button><button class="btn" data-reset>↺</button></div>`;
  };
  const tickFn = () => {
    left = Math.max(0, (endAt - Date.now()) / 1000);
    if (left <= 5 && left > 0 && Math.abs(left - Math.round(left)) < .06) sfx.tick();
    if (left <= 0) { stop(); sfx.end(); flash(); toast('⏰ 시간 끝!'); }
    draw();
  };
  const start = () => { if (left <= 0) left = total; running = true; endAt = Date.now() + left * 1000; t = setInterval(tickFn, 100); draw(); };
  const stop = () => { running = false; clearInterval(t); draw(); };
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) { stop(); total = left = +b.dataset.p; draw(); }
    else if (b.dataset.add) { left += 30; total = Math.max(total, left); if (running) endAt += 30000; draw(); }
    else if ('go' in b.dataset) running ? stop() : start();
    else if ('reset' in b.dataset) { stop(); left = total; draw(); }
  });
  // 옆 패널 타이머는 게임 화면을 닫을 때만 정리 (문제 편집·방 만들기로 화면이 바뀌어도 계속 흐름)
  S.sideStop = () => clearInterval(t);
  draw();
}

function renderScores() { $$('.scorebox').forEach(drawScoreBox); }
function drawScoreBox(box) {
  const max = Math.max(...S.teams.map(t => t.score));
  box.innerHTML = `<h4>🏆 모둠 점수판</h4>
    <div class="teams">${S.teams.map((t, i) => `
      <div class="team ${t.score === max && max > 0 ? 'lead' : ''}">
        <span class="nm" data-rn="${i}" title="눌러서 이름 바꾸기" style="color:${TEAM_COLORS[i % 8]}">● ${esc(t.name)}</span>
        <button class="btn sm" data-s="${i}" data-d="-1">−</button>
        <span class="sc">${t.score}</span>
        <button class="btn sm" data-s="${i}" data-d="1">＋</button>
      </div>`).join('')}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm" data-tn="-1">모둠 −</button><button class="btn sm" data-tn="1">모둠 ＋</button>
      <button class="btn sm" data-reset style="margin-left:auto">점수 0으로</button>
    </div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-s],[data-tn],[data-reset],[data-rn]'); if (!b) return;
    if (b.dataset.s != null) { const t = S.teams[+b.dataset.s]; t.score += +b.dataset.d; if (+b.dataset.d > 0) sfx.ok(); }
    else if (b.dataset.tn) { const n = Math.max(2, Math.min(8, S.teams.length + +b.dataset.tn)); while (S.teams.length < n) S.teams.push({ name: `${S.teams.length + 1}모둠`, score: 0 }); S.teams.length = n; }
    else if ('reset' in b.dataset) { if (!(await ask('모든 모둠 점수를 0으로 할까요?', { ok: '0으로', danger: true }))) return; S.teams.forEach(t => t.score = 0); }
    else if (b.dataset.rn != null) { const t = S.teams[+b.dataset.rn]; const v = await askText('모둠 이름 바꾸기', t.name); if (!v) return; t.name = v.trim().slice(0, 12); }
    saveTeams(); renderScores(); pushScores(); refreshTeamChips();
  };
}
function award(i, pts) {
  const t = S.teams[i]; if (!t) return;
  t.score += pts; saveTeams(); renderScores(); pushScores();
  sfx.ok(); toast(`🎉 ${t.name} +${pts}점!`);
}
function teamChipsHTML(pts, label = '') {
  return S.teams.map((t, i) => `<button class="tc" data-award="${i}" style="--tcol:${TEAM_COLORS[i % 8]}">${esc(t.name)} ${label || '+' + pts}</button>`).join('');
}
const chipHosts = new Set();
function refreshTeamChips() { chipHosts.forEach(f => f()); }

function openScoreModal() {
  modal(`<h3>🏆 모둠 점수판 <button class="x btn ghost" data-close>✕</button></h3><div class="scorebox" style="font-size:1.2rem"></div>`);
  renderScores();
}

// =============================================================
//  공용 패널: 투표(휴대폰+손들기) / 버저
// =============================================================
function votePanel(host, { prompt = '', options, answer = -1, colors, kind = 'vote', hide = false, onReveal } = {}) {
  const st = { manual: options.map(() => 0), phone: [], revealed: false, hide, round: null };
  let unsub = () => {};
  host.innerHTML = `<div class="vote"></div>`;
  const box = host.firstElementChild;
  const counts = () => { const c = st.manual.slice(); st.phone.forEach(r => { if (r.choice >= 0 && r.choice < c.length) c[r.choice]++; }); return c; };
  function draw() {
    const c = counts(); const tot = c.reduce((a, b) => a + b, 0); const max = Math.max(1, ...c);
    const hidden = st.hide && !st.revealed;
    box.innerHTML = options.map((o, i) => {
      const pct = tot ? Math.round(c[i] / tot * 100) : 0;
      const cls = st.revealed && answer >= 0 ? (i === answer ? 'correct' : 'dim') : '';
      return `<div class="vrow ${cls}">
        <div class="lb">${o.e ? `<span class="e">${o.e}</span>` : ''}<span>${esc(o.t)}</span></div>
        <div class="vbar" style="--vc:${(colors || VOTE_COLORS)[i % 6]}"><i style="width:${hidden ? 0 : (c[i] / max) * 100}%"></i><span>${hidden ? '?' : `${c[i]}명 · ${pct}%`}</span></div>
        <div class="hand"><button class="btn sm" data-m="${i}" data-d="-1" title="손들기 −1">−</button><button class="btn sm" data-m="${i}" data-d="1" title="손든 학생 +1">✋+1</button></div>
      </div>`;
    }).join('') + `
      <div class="vfoot">
        <span class="sp">${Live.on ? `📱 휴대폰 ${st.phone.length}명 · ` : '✋ 손들기로 세기 · '}총 ${tot}표</span>
        <button class="btn sm" data-act="hide">${st.hide ? '🙈 결과 가리는 중' : '👀 실시간 보이기'}</button>
        ${Live.on ? '<button class="btn sm" data-act="who">응답자 보기</button>' : ''}
        <button class="btn sm primary" data-act="reveal" ${st.revealed ? 'disabled' : ''}>${st.revealed ? '공개됨' : (answer >= 0 ? '정답 공개' : '결과 공개')}</button>
      </div>`;
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m != null) { const i = +b.dataset.m; st.manual[i] = Math.max(0, st.manual[i] + +b.dataset.d); draw(); return; }
    if (b.dataset.act === 'hide') { st.hide = !st.hide; draw(); }
    if (b.dataset.act === 'reveal') api.reveal();
    if (b.dataset.act === 'who') showWho();
  });
  function showWho() {
    const groups = options.map((o, i) => ({ o, names: st.phone.filter(r => r.choice === i).map(r => (r.name || '익명') + (r.team != null && S.teams[r.team] ? `(${S.teams[r.team].name})` : '')) }));
    modal(`<h3>📱 응답자 <button class="x btn ghost" data-close>✕</button></h3>
      ${groups.map(g => `<div class="box" style="margin-bottom:8px"><b>${g.o.e || ''} ${esc(g.o.t)}</b> — ${g.names.length}명<div style="margin-top:6px;color:var(--ink2)">${g.names.map(esc).join(', ') || '없음'}</div></div>`).join('')}
      <p class="help">이 목록은 선생님 화면에서만 보여요. 화면을 띄운 상태라면 학생들도 볼 수 있으니 주의하세요.</p>`);
  }
  const api = {
    st,
    reveal() {
      if (st.revealed) return; st.revealed = true; draw();
      if (answer >= 0) sfx.win(); else sfx.ding();
      Live.set({ revealed: true, answer, tally: counts() });
      onReveal && onReveal(st.phone, counts());
    },
  };
  if (Live.on) {
    st.round = Live.round();
    Live.set({ mode: 'vote', kind, round: st.round, prompt, options, answer: -1, revealed: false, tally: null, game: S.game?.title || '' });
    unsub = Live.watch('responses', st.round, (list) => { const before = st.phone.length; st.phone = list; if (list.length > before) sfx.tick(); draw(); });
  }
  addVoteClean(() => unsub());
  draw();
  return api;
}

function buzzPanel(host, { points = () => 1, prompt = () => '', onWin = null, chipLabel = '' } = {}) {
  const win = (i) => onWin ? onWin(i) : award(i, points());
  let round = null, list = [], unsub = () => {}, wrong = new Set();
  host.innerHTML = `<div class="buzz"></div>`;
  const box = host.firstElementChild;
  function open() {
    unsub(); list = []; wrong = new Set();
    if (Live.on) {
      round = Live.round();
      Live.set({ mode: 'buzzer', round, prompt: prompt(), buzzTop: [], revealed: false, game: S.game?.title || '' });
      unsub = Live.watch('buzz', round, (l) => {
        const before = list.length;
        list = l.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
        if (list.length > before) sfx.buzz();
        Live.set({ buzzTop: list.slice(0, 5).map(x => ({ id: x.id, name: x.name || '', team: x.team ?? null })) });
        draw();
      });
    }
    draw();
  }
  function draw() {
    const p = points();
    box.innerHTML = `
      <div class="row"><b class="t" style="font-size:1.3rem">🔔 ${Live.on ? '휴대폰 버저' : '손 먼저 든 모둠'}</b><span class="pts">지금 맞히면 +${p}점</span>
        ${Live.on ? `<button class="btn sm" data-reopen style="margin-left:auto">🔄 버저 다시 열기</button>` : ''}</div>
      ${Live.on ? `<div class="buzz-list">${list.length ? list.slice(0, 6).map((x, i) => `
        <div class="buzz-item" style="${wrong.has(x.id) ? 'opacity:.4;text-decoration:line-through' : ''}">
          <span class="rk">${i + 1}</span>
          <span><span style="color:${TEAM_COLORS[(x.team ?? 0) % 8]}">●</span> ${esc(S.teams[x.team]?.name || '')} ${esc(x.name || '')}</span>
          <button class="btn sm ok" data-ok="${x.id}">${chipLabel || '정답 +' + p}</button>
          <button class="btn sm" data-no="${x.id}">✗</button>
        </div>`).join('') : '<div class="empty">아직 아무도 누르지 않았어요… 🤫</div>'}</div>` : ''}
      <div class="help" style="margin:6px 0">${Live.on ? '휴대폰이 없는 모둠은 아래 버튼으로 바로 점수를 줄 수 있어요.' : '휴대폰 없이 진행 중 — 손을 먼저 든 모둠이 정답을 말하면 눌러 주세요.'}</div>
      <div class="team-chips">${teamChipsHTML(p, chipLabel)}</div>`;
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('reopen' in b.dataset) { open(); toast('버저를 다시 열었어요'); }
    if (b.dataset.ok) { const x = list.find(v => v.id === b.dataset.ok); if (x?.team != null) win(x.team); else { sfx.ok(); toast(`🎉 ${x?.name || '정답'}!`); } }
    if (b.dataset.no) { wrong.add(b.dataset.no); sfx.bad(); draw(); }
    if (b.dataset.award != null) win(+b.dataset.award);
  });
  chipHosts.add(draw);
  addClean(() => { unsub(); chipHosts.delete(draw); });
  open();
  return { open, draw };
}

// 원형 카운트다운
function ringHTML(id, label = '') { return `<div class="ring" id="${id}"><div><div><div class="bignum" data-n>0</div><div class="sub" data-l>${esc(label)}</div></div></div></div>`; }
function setRing(el, left, total, label, color) {
  if (!el) return; el.style.setProperty('--p', total ? Math.max(0, left / total) : 0);
  if (color) el.style.setProperty('--rc', color);
  el.querySelector('[data-n]').textContent = left >= 60 ? fmt(left) : Math.ceil(left);
  if (label != null) el.querySelector('[data-l]').textContent = label;
}

// =============================================================
//  게임 모듈
// =============================================================
const MOD = {};

// ---------- 카드 넘기기형 (이모지·초성·질문 공·페르미) ----------
MOD.deck = (stage, g, items) => {
  const f = g.format;
  const order = items.map((_, i) => i); if (f === 'question') shuffle(order);
  let idx = 0, showA = false, showH = false, bz = null;
  stage.innerHTML = `<div class="qcard" id="qc"></div><div class="ctrl" id="ctl"></div><div id="bz"></div>`;
  const qc = $('#qc', stage), ctl = $('#ctl', stage);
  const cur = () => items[order[idx]];
  function draw() {
    const it = cur();
    if (!it) { qc.innerHTML = `<div class="empty">문제가 없어요. [✏️ 내용 편집]이나 [✨ AI로 만들기]로 추가해 주세요.</div>`; ctl.innerHTML = ''; return; }
    const qcls = f === 'emoji' ? 'emoji' : f === 'chosung' ? 'chosung' : '';
    qc.innerHTML = `<div class="counter">${f === 'question' ? '🏐 질문' : f === 'fermi' ? '🧮 페르미 추정' : g.packs ? curPack(g).emoji + ' ' + esc(curPack(g).name) : ''} ${idx + 1} / ${items.length}</div>
      <div class="q ${qcls}">${esc(it.q)}</div>
      ${showH && it.hint ? `<div class="hint">💡 ${esc(it.hint)}</div>` : ''}
      ${showA && it.a ? `<div class="a">${f === 'fermi' ? '🧭 ' : ''}${esc(it.a)}</div>` : ''}`;
    const ansLabel = f === 'fermi' ? '🧭 접근 힌트' : '정답 공개';
    ctl.innerHTML = `
      <button class="btn big" data-go="-1">◀ 이전</button>
      ${it.hint ? `<button class="btn big" data-h ${showH ? 'disabled' : ''}>💡 힌트</button>` : ''}
      ${f !== 'question' ? `<button class="btn big primary" data-a ${showA ? 'disabled' : ''}>${ansLabel}</button>` : ''}
      ${f === 'question' ? `<button class="btn big primary" data-rand>🎲 질문 뽑기</button>` : `<button class="btn big" data-go="1">다음 ▶</button>`}
      <button class="btn big" data-sh title="순서 섞기">🔀</button>`;
  }
  ctl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) { idx = (idx + +b.dataset.go + items.length) % items.length; showA = showH = false; sfx.whoosh(); draw(); bz?.open(); }
    if ('h' in b.dataset) { showH = true; draw(); bz?.draw(); }
    if ('a' in b.dataset) { showA = true; sfx.ding(); draw(); if (Live.on) Live.set({ revealed: true, note: cur().a }); }
    if ('rand' in b.dataset) { let n; do { n = Math.floor(Math.random() * items.length); } while (items.length > 1 && n === idx); idx = n; sfx.whoosh(); draw(); }
    if ('sh' in b.dataset) { shuffle(order); idx = 0; showA = showH = false; draw(); bz?.open(); toast('순서를 섞었어요'); }
  });
  draw();
  if (g.live === 'buzzer' && items.length) bz = buzzPanel($('#bz', stage), { points: () => (showH ? 1 : 2), prompt: () => (cur()?.q || '') });
};

// ---------- 이모지 퀴즈 (묶음: 속담 / 노래 / 우리 반) ----------
MOD.emoji = (stage, g, items) => {
  const pack = curPack(g);
  const makerLabel = { proverb: '✨ 속담 문제 만들기', song: '🎵 가사로 이모지 만들기', class: '🧑‍🎓 우리 반 이모지 만들기' }[pack.id];
  stage.innerHTML = `<div class="row" style="justify-content:center">
      ${g.packs.map(p => `<button class="tab ${p.id === pack.id ? 'on' : ''}" data-pack="${p.id}">${p.emoji} ${esc(p.name)}</button>`).join('')}
      <button class="btn primary" id="pk-make">${makerLabel}</button>
    </div><div id="deck" style="display:flex;flex-direction:column;gap:16px"></div>`;
  stage.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => { LS.set('co-pack-' + g.id, b.dataset.pack); sfx.whoosh(); renderModule(); });
  $('#pk-make', stage).onclick = () => openMaker(g);
  if (!items.length) {
    $('#deck', stage).innerHTML = `<div class="qcard"><div class="q" style="font-size:2rem">${pack.id === 'class' ? '🧑‍🤝‍🧑 우리 반 친구 이모지가 아직 없어요' : '문제가 없어요'}</div>
      <p class="sub">${pack.id === 'class' ? '이름과 특징(예: 축구, 라면, 웃음 많음)을 적으면 이모지로 바꿔 드려요.' : '[✏️ 내용 편집]에서 추가할 수 있어요.'}</p>
      <button class="btn big primary" id="pk-make2">${makerLabel}</button></div>`;
    $('#pk-make2', stage).onclick = () => openMaker(g);
    return;
  }
  MOD.deck($('#deck', stage), g, items);
};

// ---------- 미스터리 키워드 ----------
MOD.keyword = (stage, g, items) => {
  let idx = 0, open = 1, showA = false, bz = null;
  stage.innerHTML = `<div id="kw"></div><div class="ctrl" id="ctl"></div><div id="bz"></div>`;
  const kw = $('#kw', stage), ctl = $('#ctl', stage);
  function draw() {
    const it = items[idx];
    if (!it) { kw.innerHTML = '<div class="empty">키워드가 없어요. [내용 편집]에서 추가하세요.</div>'; return; }
    kw.innerHTML = `<p class="stage-title">🔍 미스터리 키워드 ${idx + 1} / ${items.length} · <span class="pts">지금 맞히면 ${Math.max(1, 6 - open)}점</span></p>
      <div class="hints">${[0, 1, 2, 3, 4].map(i => `<div class="hintrow ${i < open ? '' : 'locked'}"><div class="n">힌트${i + 1}</div><div class="tx">${i < open ? esc(it.hints[i] || '—') : '·'}</div></div>`).join('')}</div>
      ${showA ? `<div class="qcard" style="min-height:0;padding:18px"><div class="a">정답: ${esc(it.a)}</div></div>` : ''}`;
    ctl.innerHTML = `<button class="btn big" data-prev>◀ 이전 키워드</button>
      <button class="btn big primary" data-more ${open >= 5 ? 'disabled' : ''}>다음 힌트 열기 ▼</button>
      <button class="btn big" data-ans ${showA ? 'disabled' : ''}>정답 공개</button>
      <button class="btn big" data-next>다음 키워드 ▶</button>`;
  }
  ctl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('more' in b.dataset) { open = Math.min(5, open + 1); sfx.whoosh(); draw(); bz?.draw(); }
    if ('ans' in b.dataset) { showA = true; open = 5; sfx.ding(); draw(); }
    if ('next' in b.dataset || 'prev' in b.dataset) { idx = (idx + ('next' in b.dataset ? 1 : -1) + items.length) % items.length; open = 1; showA = false; draw(); bz?.open(); }
  });
  draw();
  if (items.length) bz = buzzPanel($('#bz', stage), { points: () => Math.max(1, 6 - open), prompt: () => `힌트 ${open}개 공개 중` });
};

// ---------- 한 소절 듣고 제목 맞히기 ----------
// 유튜브 주소 → 영상 ID / 시작 초
function ytInfo(url) {
  const u = String(url || '').trim(); if (!u) return null;
  const m = u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/) || (/^[A-Za-z0-9_-]{11}$/.test(u) ? [0, u] : null);
  if (!m) return null;
  const t = u.match(/[?&]t=(\d+)/);
  return { id: m[1], t: t ? +t[1] : 0 };
}
function parseSec(v) { const s = String(v || '').trim(); if (!s) return null; if (s.includes(':')) { const [m, x] = s.split(':'); return (+m || 0) * 60 + (+x || 0); } return +s || 0; }
let ytReady = null;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytReady) return ytReady;
  ytReady = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => res();
    const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.onerror = () => { ytReady = null; rej(new Error('유튜브를 불러오지 못했어요')); };
    document.head.appendChild(sc);
  });
  return ytReady;
}
S.songFiles = S.songFiles || {};

MOD.song = (stage, g, items) => {
  let idx = 0, part = 1, showA = false, bz = null, player = null, playerId = '', stopT = null, audio = null;
  let clip = LS.get('co-song-clip', 5);
  stage.innerHTML = `<div class="qcard" id="qc"></div>
    <div class="songbox"><div class="ytwrap" id="ytw"><div id="yt"></div><div class="ytcover" id="ytc">🎵</div></div>
      <div class="songctl" id="sc"></div></div>
    <div class="ctrl" id="ctl"></div><div id="bz"></div>`;
  const qc = $('#qc', stage), ctl = $('#ctl', stage), sc = $('#sc', stage);
  const cur = () => items[idx];
  const start = (it) => parseSec(it.start) ?? ytInfo(it.src)?.t ?? 0;
  function stop() { clearTimeout(stopT); try { player?.pauseVideo(); } catch {} audio?.pause(); }
  addClean(() => { stop(); try { player?.destroy(); } catch {} });
  async function play(sec) {
    const it = cur(); if (!it) return; stop();
    const st = start(it);
    const file = S.songFiles[it.a];
    if (file) {
      audio = audio || new Audio(); if (audio.src !== file) audio.src = file;
      audio.currentTime = st; await audio.play().catch(() => toast('재생이 막혔어요. 화면을 한 번 누른 뒤 다시 눌러 주세요'));
      stopT = setTimeout(() => audio.pause(), sec * 1000); return;
    }
    const yi = ytInfo(it.src);
    if (!yi) { toast('이 노래에는 음원이 없어요. 유튜브 주소를 넣거나 음원 파일을 올려 주세요'); return; }
    try { await loadYT(); } catch (e) { toast(e.message); return; }
    if (!player || playerId !== yi.id) {
      try { player?.destroy(); } catch {}
      $('#ytw', stage).innerHTML = `<div id="yt"></div><div class="ytcover ${showA ? 'off' : ''}" id="ytc">🎵</div>`;
      playerId = yi.id;
      await new Promise((res) => {
        player = new YT.Player($('#yt', stage), { videoId: yi.id, width: '100%', height: '100%', playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: st },
          events: { onReady: () => res(), onError: () => { toast('이 영상은 다른 사이트에서 재생할 수 없게 막혀 있어요. 다른 영상 주소를 넣어 주세요'); res(); } } });
      });
    }
    try { player.seekTo(st, true); player.playVideo(); } catch {}
    stopT = setTimeout(() => { try { player.pauseVideo(); } catch {} }, sec * 1000 + 600);
  }
  function draw() {
    const it = cur();
    if (!it) { qc.innerHTML = '<div class="empty">노래 목록이 비어 있어요. [✏️ 내용 편집]에서 추가하세요.</div>'; return; }
    const has = !!(S.songFiles[it.a] || ytInfo(it.src));
    qc.innerHTML = `<div class="counter">🎵 노래 ${idx + 1} / ${items.length}</div>
      <div class="q">${showA ? esc(it.a) : (part === 1 ? '🎧 첫 소절 듣고 맞히기' : '🎧🎧 두 소절 듣고 맞히기')}</div>
      ${showA && it.hint ? `<div class="hint">${esc(it.hint)}</div>` : `<div class="sub">${part === 1 ? '지금 맞히면 3점!' : '지금 맞히면 1점'}</div>`}`;
    sc.innerHTML = `
      <div class="row" style="justify-content:center">
        <button class="btn huge primary" data-play="1" ${has ? '' : 'disabled'}>▶ 1소절 (${clip}초)</button>
        <button class="btn big" data-play="2" ${has ? '' : 'disabled'}>▶▶ 2소절 (${clip * 2}초)</button>
        <button class="btn big" data-stop>⏹</button>
      </div>
      <div class="row" style="justify-content:center"><span class="chip">한 소절 길이</span>${[3, 5, 8, 10].map(n => `<button class="btn sm ${n === clip ? 'primary' : ''}" data-clip="${n}">${n}초</button>`).join('')}
        <span class="chip">시작 ${start(it)}초</span></div>
      ${has ? '' : `<div class="help" style="text-align:center">🔇 이 노래에는 음원이 아직 없어요.<br>
        ① <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(it.a + ' ' + (it.hint || ''))}" target="_blank" rel="noopener">유튜브에서 찾기</a> → 주소 복사 → [✏️ 내용 편집]에서 <b>제목 | 가수 | 유튜브 주소 | 시작 초</b>로 넣기
        &nbsp;또는 ② <label class="btn sm">🎵 음원 파일 올리기<input type="file" accept="audio/*" data-file hidden></label></div>`}
      ${has && !S.songFiles[it.a] ? `<div class="row" style="justify-content:center"><label class="btn sm">🎵 음원 파일로 바꾸기<input type="file" accept="audio/*" data-file hidden></label></div>` : ''}`;
    const cover = $('#ytc', stage); if (cover) cover.classList.toggle('off', showA);
    ctl.innerHTML = `<button class="btn big" data-go="-1">◀</button>
      <button class="btn big ${part === 1 ? 'primary' : ''}" data-part="1">1소절 (3점)</button>
      <button class="btn big ${part === 2 ? 'primary' : ''}" data-part="2">2소절 (1점)</button>
      <button class="btn big" data-a ${showA ? 'disabled' : ''}>정답 공개</button>
      <button class="btn big" data-go="1">▶</button>`;
  }
  sc.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.play) { part = Math.max(part, +b.dataset.play); play(clip * +b.dataset.play); draw(); bz?.draw(); }
    if ('stop' in b.dataset) stop();
    if (b.dataset.clip) { clip = +b.dataset.clip; LS.set('co-song-clip', clip); draw(); }
  });
  sc.addEventListener('change', (e) => {
    const f = e.target.closest('[data-file]')?.files?.[0]; if (!f) return;
    S.songFiles[cur().a] = URL.createObjectURL(f); toast(`🎵 '${cur().a}' 음원을 연결했어요 (이 화면을 닫기 전까지 유지)`); draw();
  });
  ctl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.part) { part = +b.dataset.part; draw(); bz?.draw(); }
    if ('a' in b.dataset) { showA = true; sfx.ding(); draw(); }
    if (b.dataset.go) { stop(); idx = (idx + +b.dataset.go + items.length) % items.length; part = 1; showA = false; draw(); bz?.open(); }
  });
  draw();
  if (items.length) bz = buzzPanel($('#bz', stage), { points: () => (part === 1 ? 3 : 1), prompt: () => `노래 ${idx + 1}` });
};

// ---------- 사진 조각 열기 ----------
MOD.tiles = (stage, g) => {
  let n = LS.get('co-tiles-n', 4), word = LS.get('co-tiles-word', '세종대왕'), opened = new Set(), bz = null;
  const colors = ['#6C4CF5', '#2F86FF', '#FF7A2F', '#EE4F86', '#15A773'];
  stage.innerHTML = `
    <div class="row" style="justify-content:center">
      <label class="btn">🖼️ 사진 올리기<input type="file" accept="image/*" id="t-file" hidden></label>
      <span class="chip">또는</span>
      <input id="t-word" class="btn" style="text-align:left;min-width:180px" placeholder="단어 입력" value="${esc(word)}">
      <button class="btn" id="t-make">글자로 만들기</button>
      <select id="t-n" class="btn">${[3, 4, 5, 6].map(k => `<option value="${k}" ${k === n ? 'selected' : ''}>${k}×${k} 조각</option>`).join('')}</select>
    </div>
    <div class="tiles-wrap" id="tw"><div class="tiles-grid" id="tg"></div></div>
    <div class="ctrl"><button class="btn big" id="t-all">모두 열기</button><button class="btn big" id="t-cover">다시 덮기</button></div>
    <div id="bz"></div>`;
  const tw = $('#tw', stage), tg = $('#tg', stage);
  function setPicture() {
    tw.querySelectorAll('img,canvas').forEach(x => x.remove());
    if (S.tileImg) { const im = new Image(); im.src = S.tileImg; tw.prepend(im); return; }
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 900; const c = cv.getContext('2d');
    c.fillStyle = '#FFF7EC'; c.fillRect(0, 0, 1200, 900);
    c.fillStyle = '#2A2238'; c.textAlign = 'center'; c.textBaseline = 'middle';
    let size = 260; c.font = `${size}px Jua, sans-serif`; while (c.measureText(word).width > 1080 && size > 40) { size -= 10; c.font = `${size}px Jua, sans-serif`; }
    c.fillText(word, 600, 450); tw.prepend(cv);
  }
  function drawTiles() {
    tg.style.gridTemplateColumns = `repeat(${n},1fr)`;
    tg.innerHTML = Array.from({ length: n * n }, (_, i) => `<button class="tile ${opened.has(i) ? 'open' : ''}" data-i="${i}" style="--tc:${colors[(i + Math.floor(i / n)) % colors.length]}">${i + 1}</button>`).join('');
  }
  const points = () => { const hidden = n * n - opened.size; return Math.max(1, Math.ceil((hidden / (n * n)) * 5)); };
  tg.addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (!b) return; opened.add(+b.dataset.i); b.classList.add('open'); sfx.whoosh(); bz?.draw(); });
  $('#t-all', stage).onclick = () => { for (let i = 0; i < n * n; i++) opened.add(i); drawTiles(); sfx.win(); bz?.draw(); };
  $('#t-cover', stage).onclick = () => { opened.clear(); drawTiles(); bz?.open(); };
  $('#t-n', stage).onchange = (e) => { n = +e.target.value; LS.set('co-tiles-n', n); opened.clear(); drawTiles(); bz?.draw(); };
  $('#t-make', stage).onclick = () => { word = $('#t-word', stage).value.trim() || '?'; LS.set('co-tiles-word', word); S.tileImg = null; opened.clear(); setPicture(); drawTiles(); bz?.open(); };
  $('#t-file', stage).onchange = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { S.tileImg = r.result; opened.clear(); setPicture(); drawTiles(); bz?.open(); }; r.readAsDataURL(f);
  };
  (document.fonts?.ready || Promise.resolve()).then(setPicture);
  drawTiles();
  bz = buzzPanel($('#bz', stage), { points, prompt: () => '사진 조각 열기' });
};

// ---------- 퀴즈 폭탄 돌리기 ----------
MOD.bomb = (stage, g, items) => {
  const order = shuffle(items.map((_, i) => i));
  let idx = 0, showA = false, running = false, endAt = 0, startAt = 0, t = null, lastTick = 0, passes = 0;
  const missions = ['오늘 배운 내용 한 문장으로 말하기', '선생님 질문 하나에 답하기', '오늘의 핵심 단어 3개 말하기', '친구 한 명 칭찬하기', '다음 시간 첫 발표자 되기'];
  stage.innerHTML = `<div class="bomb" id="bm">💣</div><div class="sub" id="bs">폭탄을 시작하면 20~60초 사이 아무 때나 터져요!</div>
    <div class="qcard" id="qc" style="min-height:200px"></div><div class="ctrl" id="ctl"></div>`;
  const bm = $('#bm', stage), bs = $('#bs', stage), qc = $('#qc', stage), ctl = $('#ctl', stage);
  function draw() {
    const it = items[order[idx]];
    qc.innerHTML = it ? `<div class="counter">문제 ${passes + 1}</div><div class="q">${esc(it.q)}</div>${showA ? `<div class="a">${esc(it.a)}</div>` : ''}` : '<div class="empty">문제가 없어요.</div>';
    ctl.innerHTML = running
      ? `<button class="btn huge ok" data-pass>✅ 정답! 넘겨!</button><button class="btn big" data-a ${showA ? 'disabled' : ''}>정답 보기</button><button class="btn big" data-skip>다른 문제</button><button class="btn big" data-stop>⏹</button>`
      : `<button class="btn huge primary" data-start>💣 폭탄 시작</button><button class="btn big" data-a ${showA ? 'disabled' : ''}>정답 보기</button><button class="btn big" data-skip>다른 문제</button>`;
  }
  function next() { idx = (idx + 1) % Math.max(1, items.length); showA = false; draw(); }
  function loop() {
    const now = Date.now(); const prog = (now - startAt) / (endAt - startAt);
    const gap = prog < .5 ? 700 : prog < .8 ? 400 : 180;
    if (now - lastTick > gap) { sfx.tick(); lastTick = now; }
    if (now >= endAt) explode();
  }
  function explode() {
    running = false; clearInterval(t); sfx.boom(); flash();
    bm.textContent = '💥'; bm.className = 'bomb boom';
    bs.innerHTML = `<b style="font-size:1.6rem;color:var(--bad)">펑!</b> 폭탄을 든 사람의 미션 → <b>${esc(missions[Math.floor(Math.random() * missions.length)])}</b>`;
    draw();
  }
  ctl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('start' in b.dataset) {
      running = true; passes = 0; startAt = Date.now(); endAt = startAt + (20 + Math.random() * 40) * 1000;
      bm.textContent = '💣'; bm.className = 'bomb shake'; bs.textContent = '째깍째깍… 정답을 맞히면 빨리 넘겨요!';
      clearInterval(t); t = setInterval(loop, 50); draw();
    }
    if ('pass' in b.dataset) { passes++; sfx.ok(); next(); }
    if ('a' in b.dataset) { showA = true; draw(); }
    if ('skip' in b.dataset) next();
    if ('stop' in b.dataset) { running = false; clearInterval(t); bm.className = 'bomb'; bs.textContent = '멈췄어요.'; draw(); }
  });
  addClean(() => clearInterval(t));
  draw();
};

// ---------- 밸런스 게임 ----------
MOD.balance = (stage, g, items) => {
  let idx = 0;
  stage.innerHTML = `<div class="ab" id="ab"></div><div id="vp"></div><div class="ctrl" id="ctl"></div>`;
  function draw() {
    const it = items[idx]; if (!it) { $('#ab', stage).innerHTML = '<div class="empty">질문이 없어요.</div>'; return; }
    $('#ab', stage).innerHTML = `<div class="side-a">🅰️<br>${esc(it.a)}</div><div class="vs">VS</div><div class="side-b">🅱️<br>${esc(it.b)}</div>`;
    runVoteClean();
    votePanel($('#vp', stage), { prompt: '둘 중 하나만 고른다면?', options: [{ e: '🅰️', t: it.a }, { e: '🅱️', t: it.b }], colors: ['#F2603F', '#4B6CF7'], kind: 'balance' });
    $('#ctl', stage).innerHTML = `<button class="btn big" data-go="-1">◀ 이전</button><span class="chip">${idx + 1} / ${items.length}</span><button class="btn big primary" data-go="1">다음 질문 ▶</button>`;
  }
  $('#ctl', stage).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; idx = (idx + +b.dataset.go + items.length) % items.length; sfx.whoosh(); draw(); });
  draw();
};
// 투표 패널을 새 문제로 바꿀 때: 이전 투표 구독(태그 __vote)만 정리
function addVoteClean(fn) { fn.__vote = true; S.clean.push(fn); }
function runVoteClean() {
  const keep = [];
  S.clean.splice(0).forEach(f => { if (f.__vote) { try { f(); } catch {} } else keep.push(f); });
  S.clean.push(...keep);
}

// ---------- 예측 투표 ----------
MOD.poll = (stage, g, items) => {
  let idx = 0;
  stage.innerHTML = `<div class="qcard" id="qc" style="min-height:160px"></div><div id="vp"></div><div class="ctrl" id="ctl"></div>`;
  function draw() {
    const it = items[idx]; if (!it) { $('#qc', stage).innerHTML = '<div class="empty">질문이 없어요.</div>'; return; }
    $('#qc', stage).innerHTML = `<div class="counter">🔮 예측 투표 ${idx + 1} / ${items.length}</div><div class="q" style="font-size:clamp(1.8rem,3.6vw,3.2rem)">${esc(it.q)}</div><div id="pn"></div>`;
    runVoteClean();
    votePanel($('#vp', stage), {
      prompt: it.q, options: it.options.map((t, i) => ({ e: String.fromCharCode(9312 + i), t })), answer: it.answer, kind: 'poll',
      onReveal: () => { $('#pn', stage).innerHTML = it.answer >= 0 ? `<div class="a">정답: ${esc(it.options[it.answer])}</div>` : `<div class="hint">🤫 정답은 오늘 수업에서!</div>`; },
    });
    $('#ctl', stage).innerHTML = `<button class="btn big" data-go="-1">◀ 이전</button><button class="btn big primary" data-go="1">다음 질문 ▶</button>`;
  }
  $('#ctl', stage).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; idx = (idx + +b.dataset.go + items.length) % items.length; draw(); });
  draw();
};

// ---------- 마음 날씨 / 이해도 신호등 ----------
MOD.weather = (stage) => {
  stage.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🌤️ 지금 내 마음의 날씨는?</p><div id="vp"></div><div class="qcard" id="sum" style="min-height:0;padding:18px"></div>
    <div class="ctrl"><button class="btn big" id="again">🔄 다시 받기</button></div>`;
  const go = () => {
    runVoteClean();
    const vp = votePanel($('#vp', stage), { prompt: '지금 내 마음의 날씨는?', options: WEATHER, kind: 'weather', colors: ['#FFB703', '#8ECAE6', '#9AA5B1', '#4B6CF7', '#5B4B8A', '#EE4F86'] });
    const sum = $('#sum', stage);
    const upd = () => { const c = vp.st.manual.map((m, i) => m + vp.st.phone.filter(r => r.choice === i).length); const tot = c.reduce((a, b) => a + b, 0); if (!tot) { sum.innerHTML = '<div class="sub">📡 마음 일기예보를 기다리는 중…</div>'; return; } const top = c.indexOf(Math.max(...c)); sum.innerHTML = `<div class="sub">오늘 우리 반 마음 일기예보</div><div class="q" style="font-size:3rem">${WEATHER[top].e} ${WEATHER[top].t}</div>`; };
    const t = setInterval(upd, 700); addVoteClean(() => clearInterval(t)); upd();
  };
  $('#again', stage).onclick = go; go();
};
MOD.traffic = (stage, g, items) => {
  if (!items.length) items = [{ q: '오늘 수업, 얼마나 이해했나요?' }];
  let idx = 0;
  stage.innerHTML = `<div class="qcard" id="qc" style="min-height:150px;padding:24px"></div><div id="vp"></div>
    <div class="ctrl" id="ctl"></div>
    <p class="help" style="text-align:center">학생 휴대폰에는 다른 친구의 선택이 보이지 않아요. 이름은 [응답자 보기]로 선생님만 확인할 수 있어요.</p>`;
  const go = () => {
    const it = items[idx];
    $('#qc', stage).innerHTML = `<div class="counter">🚦 이해도 확인 ${idx + 1} / ${items.length}${S.topic ? ` · 📚 ${esc(S.topic)}` : ''}</div>
      <div class="q" style="font-size:clamp(1.8rem,3.8vw,3.2rem)">${esc(it.q)}</div>
      <div class="row" style="justify-content:center"><input id="tq" class="btn" style="text-align:left;min-width:min(420px,70vw)" placeholder="발문 바로 입력하고 Enter"><button class="btn" id="tq-go">띄우기</button></div>`;
    const quick = () => { const v = $('#tq', stage).value.trim(); if (!v) return; items.splice(idx + 1, 0, { q: v }); idx++; go(); };
    $('#tq', stage).onkeydown = (e) => { if (e.key === 'Enter') quick(); };
    $('#tq-go', stage).onclick = quick;
    runVoteClean();
    votePanel($('#vp', stage), { prompt: it.q, options: TRAFFIC, colors: ['#15A773', '#E0B000', '#E5484D'], kind: 'traffic', hide: false });
    $('#ctl', stage).innerHTML = `<button class="btn big" data-go="-1">◀ 이전 발문</button><button class="btn big" data-again>🔄 다시 받기</button><button class="btn big primary" data-go="1">다음 발문 ▶</button>`;
  };
  $('#ctl', stage).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) idx = (idx + +b.dataset.go + items.length) % items.length;
    go();
  });
  go();
};

// ---------- 두 개의 진실, 하나의 거짓 ----------
MOD.truths = (stage, g, items) => {
  let idx = 0;
  stage.innerHTML = `<p class="stage-title">🕵️ 셋 중 거짓은 몇 번?</p><div class="truths" id="tr"></div><div id="vp"></div><div class="ctrl" id="ctl"></div>`;
  function draw(revealed = false) {
    const it = items[idx]; if (!it) { $('#tr', stage).innerHTML = '<div class="empty">문장이 없어요. [내용 편집]에서 선생님 이야기를 넣어 주세요.</div>'; return; }
    $('#tr', stage).innerHTML = it.s.map((s, i) => `<div class="truth ${revealed ? (i === it.lie ? 'lie' : 'true') : ''}"><span class="no">${i + 1}</span>${esc(s)}</div>`).join('');
  }
  function round() {
    draw(false); const it = items[idx]; if (!it) return;
    runVoteClean();
    votePanel($('#vp', stage), { prompt: '셋 중 거짓은 몇 번?', options: it.s.map((s, i) => ({ e: `${i + 1}번`, t: s.length > 18 ? s.slice(0, 18) + '…' : s })), answer: it.lie, kind: 'truths', onReveal: () => draw(true) });
    $('#ctl', stage).innerHTML = items.length > 1 ? `<button class="btn big" data-go="-1">◀</button><span class="chip">${idx + 1} / ${items.length}</span><button class="btn big" data-go="1">다음 ▶</button>` : '';
  }
  $('#ctl', stage).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; idx = (idx + +b.dataset.go + items.length) % items.length; round(); });
  round();
};

// ---------- OX 서바이벌 ----------
MOD.ox = (stage, g, items) => {
  let idx = 0;
  stage.innerHTML = `<div class="oxstat" id="os"></div><div class="qcard" id="qc" style="min-height:180px"></div><div id="vp"></div><div class="ctrl" id="ctl"></div>`;
  const stat = () => {
    const alive = [...S.oxSeen].filter(id => !S.oxOut.has(id)).length;
    $('#os', stage).innerHTML = Live.on
      ? `<span class="chip" style="background:#E8FBF3;color:#0b7a53">🙂 생존 ${alive}명</span><span class="chip" style="background:#FFE9EB;color:#b3262b">💀 탈락 ${S.oxOut.size}명</span><button class="btn sm" id="ox-reset">🔁 서바이벌 새로 시작</button>`
      : `<span class="chip">✋ 휴대폰 없이: O는 손 머리 위로 동그라미, X는 팔로 엑스! 틀린 학생은 앉기</span>`;
    $('#ox-reset', stage)?.addEventListener('click', () => { S.oxOut.clear(); S.oxSeen.clear(); S.oxSession = 's' + Date.now(); Live.set({ oxSession: S.oxSession }); stat(); toast('모두 부활! 새로 시작해요'); });
  };
  function round() {
    const it = items[idx]; if (!it) { $('#qc', stage).innerHTML = '<div class="empty">문장이 없어요.</div>'; return; }
    $('#qc', stage).innerHTML = `<div class="counter">⭕❌ ${idx + 1} / ${items.length}</div><div class="q" style="font-size:clamp(1.8rem,3.6vw,3.2rem)">${esc(it.q)}</div><div id="note"></div>`;
    runVoteClean();
    const ans = it.a === 'O' ? 0 : 1;
    Live.set({ oxSession: S.oxSession });
    votePanel($('#vp', stage), {
      prompt: it.q, options: [{ e: '⭕', t: 'O' }, { e: '❌', t: 'X' }], answer: ans, colors: ['#2F86FF', '#E5484D'], kind: 'ox', hide: true,
      onReveal: (phone) => {
        phone.forEach(r => { S.oxSeen.add(r.id); if (r.choice !== ans) S.oxOut.add(r.id); });
        $('#note', stage).innerHTML = `<div class="a">정답: ${it.a}</div>${it.note ? `<div class="hint">${esc(it.note)}</div>` : ''}`;
        stat();
      },
    });
    $('#ctl', stage).innerHTML = `<button class="btn big" data-go="-1">◀</button><span class="chip">${idx + 1} / ${items.length}</span><button class="btn big primary" data-go="1">다음 문제 ▶</button>`;
    stat();
  }
  $('#ctl', stage).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; idx = (idx + +b.dataset.go + items.length) % items.length; round(); });
  round();
};

// ---------- 끝말잇기 / 한 단어 릴레이 ----------
MOD.chain = (stage, g) => {
  const key = 'co-chain-' + g.id;
  let sec = LS.get(key + '-sec', 5), best = LS.get(key + '-best', 0), count = 0, running = false, endAt = 0, t = null, over = false;
  const isShiri = g.id === 'shiritori';
  stage.innerHTML = `
    <div class="row" style="justify-content:center">
      ${isShiri ? `<span class="chip">📚 오늘의 주제</span><input id="c-topic" class="btn" style="text-align:left;min-width:240px" value="${esc(LS.get(key + '-topic', S.topic || '국어 개념어'))}">` : `<span class="chip">📚 ${esc(S.topic || '오늘 수업')}을(를) 한 단어로!</span>`}
      <span class="chip">한 사람당</span>${[3, 5, 7, 10].map(s => `<button class="btn sm ${s === sec ? 'primary' : ''}" data-sec="${s}">${s}초</button>`).join('')}
    </div>
    ${ringHTML('rg', '')}
    <div class="sub" id="cs"></div>
    <div class="ctrl" id="ctl"></div>`;
  const rg = $('#rg', stage);
  function draw() {
    const left = running ? Math.max(0, (endAt - Date.now()) / 1000) : sec;
    rg.querySelector('[data-n]').textContent = count;
    rg.querySelector('[data-l]').textContent = over ? '땡! 💥' : running ? `${Math.ceil(left)}초` : '이어진 단어';
    rg.style.setProperty('--p', running ? left / sec : (over ? 0 : 1));
    rg.style.setProperty('--rc', left <= 2 && running ? '#E5484D' : '#6C4CF5');
    $('#cs', stage).innerHTML = `🏅 최고 기록 <b>${best}</b>개 ${isShiri ? '' : '· 앞사람과 같은 단어는 금지!'}`;
  }
  function ctl() {
    $('#ctl', stage).innerHTML = running
      ? `<button class="btn huge ok" data-ok>✅ 성공! (스페이스)</button><button class="btn big bad" data-fail>❌ 땡</button>`
      : `<button class="btn huge primary" data-start>${over ? '🔁 다시 시작' : '▶ 시작'}</button>`;
  }
  function success() { if (!running) return; count++; endAt = Date.now() + sec * 1000; sfx.ok(); draw(); }
  function fail() {
    running = false; over = true; clearInterval(t); sfx.boom(); flash();
    if (count > best) { best = count; LS.set(key + '-best', best); confetti(40); toast(`🏅 새 기록! ${best}개`); }
    draw(); ctl();
  }
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sec) { sec = +b.dataset.sec; LS.set(key + '-sec', sec); $$('[data-sec]', stage).forEach(x => x.classList.toggle('primary', x === b)); draw(); }
    if ('start' in b.dataset) { count = 0; over = false; running = true; endAt = Date.now() + sec * 1000; clearInterval(t); t = setInterval(() => { draw(); if (Date.now() >= endAt) fail(); }, 100); ctl(); draw(); }
    if ('ok' in b.dataset) success();
    if ('fail' in b.dataset) fail();
  });
  $('#c-topic', stage)?.addEventListener('input', (e) => LS.set(key + '-topic', e.target.value));
  const onKey = (e) => { if (e.code === 'Space' && running && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); success(); } };
  document.addEventListener('keydown', onKey);
  addClean(() => { clearInterval(t); document.removeEventListener('keydown', onKey); });
  draw(); ctl();
};

// ---------- 가위바위보 응원단 ----------
MOD.rps = (stage) => {
  let total = roster()?.names.length || LS.get('co-rps-total', 28), left = total, round = 0;
  stage.innerHTML = `<div class="row" style="justify-content:center"><span class="chip">참가 인원</span>
      <button class="btn sm" data-t="-1">−</button><b class="t" id="rt" style="font-size:1.6rem"></b><button class="btn sm" data-t="1">＋</button></div>
    <div class="bignum" id="rl"></div><div class="sub" id="rs"></div>
    <div class="ctrl"><button class="btn huge primary" data-r>✊✌️✋ 한 판 끝!</button><button class="btn big" data-reset>처음부터</button></div>`;
  function draw() {
    $('#rt', stage).textContent = total + '명';
    $('#rl', stage).textContent = left <= 1 ? '🏆' : left + '명';
    const cheer = Math.round(total / Math.max(1, left));
    $('#rs', stage).innerHTML = left <= 1 ? '<b style="font-size:2rem">우승자 탄생! 모두 박수 👏👏👏</b>'
      : `${round}라운드 · 남은 선수 ${left}명 · 선수 1명당 응원단 약 ${cheer - 1}명 📣 ${'🙌'.repeat(Math.min(12, cheer - 1))}${left === 2 ? '<br><b style="font-size:1.8rem">🔥 결승전! 모두 일어나서 응원!</b>' : ''}`;
  }
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { total = Math.max(2, total + +b.dataset.t); LS.set('co-rps-total', total); left = total; round = 0; }
    if ('r' in b.dataset && left > 1) { left = Math.ceil(left / 2); round++; if (left <= 1) { sfx.win(); confetti(); } else sfx.ok(); }
    if ('reset' in b.dataset) { left = total; round = 0; }
    draw();
  });
  draw();
};

// ---------- 교실 마피아: 특수 직업 + 사건 카드 ----------
const MAFIA_ROLES = {
  mafia:      { e: '🕶️', n: '마피아', side: 'mafia', act: 'kill', d: '밤마다 한 명을 골라 탈락시켜요. 다른 마피아가 누군지 알아요.' },
  police:     { e: '🕵️', n: '경찰', side: 'citizen', act: 'inv', d: '밤마다 한 명을 조사해 마피아인지 알아내요.' },
  doctor:     { e: '🩺', n: '의사', side: 'citizen', act: 'save', d: '밤마다 한 명을 지켜요. 마피아가 그 사람을 고르면 살아나요. (자기 자신도 가능)' },
  reporter:   { e: '🎤', n: '기자', side: 'citizen', act: null, d: '둘째 날부터 낮에 딱 한 번, 한 사람의 직업을 모두에게 공개해요.' },
  politician: { e: '🎩', n: '정치인', side: 'citizen', act: null, d: '투표로 쫓겨나게 되면 딱 한 번 살아남아요.' },
  joker:      { e: '🃏', n: '조커', side: 'joker', act: null, d: '투표로 쫓겨나면 혼자 승리! 일부러 수상하게 굴어 보세요.' },
  citizen:    { e: '🙂', n: '시민', side: 'citizen', act: null, d: '토론과 투표로 마피아를 찾아요.' },
};
const MAFIA_EVENTS = [
  { e: '🌧️', t: '폭우', d: '비 때문에 모두 지쳤어요. 오늘 토론은 1분만!', discuss: 60 },
  { e: '📢', t: '공개 수사', d: '모두 돌아가며 "나는 ○○이다. 왜냐하면 ~"을 한 문장씩 말해요.' },
  { e: '🤐', t: '침묵의 아침', d: '처음 30초는 말없이 표정과 몸짓으로만 의심을 표현해요.' },
  { e: '🔦', t: '정전', d: '오늘 밤 경찰은 조사할 수 없어요.', blackout: true },
  { e: '🙈', t: '비밀 투표', d: '오늘 투표 결과는 모두 끝난 뒤 한꺼번에 공개해요.', secret: true },
  { e: '⏩', t: '빠른 재판', d: '최후 변론 없이 바로 투표해요!', noDefense: true },
  { e: '🎁', t: '익명 제보', d: '확실히 마피아가 아닌 사람 1명을 알려 줄게요.', tip: true },
  { e: '⚖️', t: '변론의 기술', d: '최후 변론은 "주장 + 근거 2개 + 마무리" 구조로 말해야 해요.' },
  { e: '☀️', t: '평화로운 날', d: '특별한 일은 없어요. 마음껏 추리해요!' },
];
function mafiaPlan(n) {
  return {
    mafia: n <= 5 ? 1 : n <= 11 ? 2 : n <= 19 ? 3 : 4,
    police: 1, doctor: n >= 5 ? 1 : 0, reporter: n >= 10 ? 1 : 0, politician: n >= 12 ? 1 : 0, joker: n >= 8 ? 1 : 0,
  };
}

MOD.mafia = (stage, g) => {
  if (Live.on) return mafiaLive(stage, g);
  return mafiaHost(stage, g);
};

// ── 휴대폰 없이: 진행자(선생님) 안내 모드 ──
function mafiaHost(stage) {
  let n = roster()?.names.length || LS.get('co-maf-n', 28);
  let plan = LS.get('co-maf-plan', null) || mafiaPlan(n);
  let step = -1, endAt = 0, t = null, event = null, day = 1;
  const seq = () => {
    const s = [{ k: 'night', e: '🌙', t: '밤이 되었습니다', d: '모두 고개를 숙이고 눈을 감아요.', s: 10, night: true },
      { k: 'night', e: '🕶️', t: '마피아는 눈을 뜨세요', d: '마피아끼리 눈빛을 주고받고, 탈락시킬 사람을 선생님에게 손가락으로 가리켜요.', s: 20, night: true }];
    if (plan.doctor) s.push({ k: 'night', e: '🩺', t: '의사는 눈을 뜨세요', d: '지켜 줄 사람을 손가락으로 가리켜요.', s: 15, night: true });
    if (plan.police && !event?.blackout) s.push({ k: 'night', e: '🕵️', t: '경찰은 눈을 뜨세요', d: '조사할 사람을 가리키면 선생님이 엄지 👍(마피아) / 👎(아님)로 알려 줘요.', s: 15, night: true });
    s.push({ k: 'morning', e: '☀️', t: `${day}일째 아침이 밝았습니다`, d: '모두 눈을 떠요. 선생님이 지난밤 일을 발표해요. 탈락한 사람은 말없이 관전!', s: 0 });
    s.push({ k: 'event', e: '🎴', t: '오늘의 사건 카드', d: '', s: 0 });
    s.push({ k: 'day', e: '🗣️', t: '토론', d: '누가 마피아일까? 근거를 들어 의심하고 해명해요.', s: event?.discuss || 120 });
    if (!event?.noDefense) s.push({ k: 'day', e: '🎤', t: '최후 변론', d: '가장 의심받는 2명이 30초씩 변론해요.', s: 60 });
    s.push({ k: 'day', e: '🗳️', t: '투표', d: '"하나, 둘, 셋!" 하면 마피아라고 생각하는 사람을 가리켜요. 가장 많이 지목된 사람은 직업을 밝히고 탈락!', s: 20 });
    return s;
  };
  stage.innerHTML = `<div id="mf"></div>`;
  const root = $('#mf', stage);
  function setup() {
    $('#stage').classList.remove('night');
    const total = Object.values(plan).reduce((a, b) => a + b, 0);
    root.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🕶️ 교실 마피아 — 직업 정하기</p>
      <div class="row" style="justify-content:center"><span class="chip">참가 인원</span><button class="btn sm" data-n="-1">−</button><b class="t" style="font-size:1.6rem">${n}명</b><button class="btn sm" data-n="1">＋</button><button class="btn sm" data-auto>추천 구성</button></div>
      <div class="roles">${Object.entries(MAFIA_ROLES).filter(([k]) => k !== 'citizen').map(([k, r]) => `
        <div class="role"><div class="re">${r.e}</div><b>${r.n}</b><p>${r.d}</p><div class="row" style="justify-content:center"><button class="btn sm" data-r="${k}" data-d="-1">−</button><b class="t" style="font-size:1.4rem">${plan[k] || 0}</b><button class="btn sm" data-r="${k}" data-d="1">＋</button></div></div>`).join('')}
        <div class="role"><div class="re">🙂</div><b>시민</b><p>나머지 모두</p><b class="t" style="font-size:1.4rem">${Math.max(0, n - total)}</b></div></div>
      <div class="help" style="text-align:center">📝 휴대폰 없이 할 때: 직업 이름을 쓴 쪽지를 접어 나눠 주세요. (마피아 ${plan.mafia}장, 경찰 ${plan.police}장${plan.doctor ? ', 의사 1장' : ''}${plan.reporter ? ', 기자 1장' : ''}${plan.politician ? ', 정치인 1장' : ''}${plan.joker ? ', 조커 1장' : ''}, 나머지 '시민')<br>📱 [학생 참여]로 방을 만들면 직업이 휴대폰으로 몰래 배달되고, 밤 행동·투표도 휴대폰으로 해요.</div>
      <div class="ctrl"><button class="btn huge primary" data-start>🌙 게임 시작</button></div>`;
  }
  function play() {
    const s = seq(); const cur = s[step];
    $('#stage').classList.toggle('night', !!cur.night);
    let body = esc(cur.d);
    if (cur.k === 'event') {
      if (!event) event = MAFIA_EVENTS[Math.floor(Math.random() * MAFIA_EVENTS.length)];
      body = `<div class="eventcard"><div class="re">${event.e}</div><b>${esc(event.t)}</b><p>${esc(event.d)}</p></div>`;
    }
    root.innerHTML = `<div class="phases">${s.map((x, i) => `<span class="phase ${i === step ? 'on' : ''}">${x.e}</span>`).join('')}</div>
      <p class="stage-title" style="font-size:2.6rem">${cur.e} ${esc(cur.t)}</p><div class="sub">${body}</div>
      ${cur.s ? ringHTML('rg') : ''}
      <div class="ctrl">${cur.s ? '<button class="btn big" data-go>▶ 타이머</button>' : ''}<button class="btn huge primary" data-next>다음 ▶</button><button class="btn big" data-setup>처음으로</button></div>
      ${cur.k === 'day' ? `<div class="help" style="text-align:center">승리 조건: 마피아를 모두 찾으면 시민 승리 · 마피아 수가 나머지와 같아지면 마피아 승리 · 조커가 투표로 쫓겨나면 조커 승리</div>` : ''}`;
    if (cur.s) setRing($('#rg', root), cur.s, cur.s, '', cur.night ? '#8B7CF6' : '#FF7A2F');
    if (cur.k === 'morning') sfx.ding();
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.n) { n = Math.max(4, n + +b.dataset.n); LS.set('co-maf-n', n); setup(); }
    if ('auto' in b.dataset) { plan = mafiaPlan(n); LS.set('co-maf-plan', plan); setup(); }
    if (b.dataset.r) { plan[b.dataset.r] = Math.max(b.dataset.r === 'mafia' ? 1 : 0, Math.min(b.dataset.r === 'mafia' ? 6 : 1, (plan[b.dataset.r] || 0) + +b.dataset.d)); LS.set('co-maf-plan', plan); setup(); }
    if ('start' in b.dataset) { step = 0; day = 1; event = null; sfx.whoosh(); play(); }
    if ('setup' in b.dataset) { clearInterval(t); step = -1; setup(); }
    if ('next' in b.dataset) {
      clearInterval(t); step++;
      const s = seq();
      if (step >= s.length) { step = 0; day++; event = null; }
      play();
    }
    if ('go' in b.dataset) {
      const cur = seq()[step]; endAt = Date.now() + cur.s * 1000; clearInterval(t);
      t = setInterval(() => { const left = (endAt - Date.now()) / 1000; setRing($('#rg', root), left, cur.s, ''); if (left <= 0) { clearInterval(t); sfx.end(); } }, 200);
    }
  });
  addClean(() => { clearInterval(t); $('#stage')?.classList.remove('night'); });
  setup();
}

// ── 휴대폰 모드: 직업 배달 · 밤 행동 · 투표 자동 ──
function mafiaLive(stage, g) {
  const M = S.mafia || (S.mafia = { phase: 'setup', plan: null, players: [], day: 0, log: [], event: null, gid: 'g' + Date.now() });
  let unsub = () => {}, nightActs = [], vp = null, timerT = null;
  const P = (id) => M.players.find(p => p.id === id);
  const nm = (p) => p ? p.name : '?';
  const alive = () => M.players.filter(p => p.alive);
  const R = (p) => MAFIA_ROLES[p.role];
  stage.innerHTML = `<div id="mf"></div>`;
  const root = $('#mf', stage);
  addClean(() => { unsub(); clearInterval(timerT); $('#stage')?.classList.remove('night'); });

  const push = (extra = {}) => Live.set({
    mode: 'mafia', game: g.title,
    mafia: { phase: M.phase, day: M.day, gid: M.gid, round: M.round || null, msg: M.msg || '', event: M.event || null,
      alive: alive().map(p => p.id), names: Object.fromEntries(M.players.map(p => [p.id, p.name])), winner: M.winner || null,
      reveal: M.phase === 'end' ? Object.fromEntries(M.players.map(p => [p.id, p.role])) : (M.revealed || {}), ...extra },
  });
  const secret = (p) => cloud.put(S.room.code, 'secret', p.id, {
    gid: M.gid, game: 'mafia', role: p.role, mates: p.role === 'mafia' ? M.players.filter(x => x.role === 'mafia' && x.id !== p.id).map(x => x.name) : [],
    inv: p.inv || [], picks: p.role === 'mafia' ? (M.picks || {}) : {}, used: !!p.used, blackout: !!M.event?.blackout,
  });

  function members() {
    return S.members.map((m, i) => ({ id: m.id, name: m.name || `${S.teams[m.team]?.name || ''} 익명${i + 1}` }));
  }
  function setup() {
    $('#stage').classList.remove('night');
    const list = members(); const n = list.length;
    M.plan = M.plan || mafiaPlan(Math.max(4, n));
    const total = Object.values(M.plan).reduce((a, b) => a + b, 0);
    root.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🕶️ 교실 마피아 — 휴대폰 모드</p>
      <p class="sub">참여한 학생 <b>${n}명</b>에게 직업이 몰래 배달돼요. ${n < 4 ? '<b style="color:var(--bad)">4명 이상 들어와야 시작할 수 있어요.</b>' : ''}</p>
      <div class="roles">${Object.entries(MAFIA_ROLES).filter(([k]) => k !== 'citizen').map(([k, r]) => `
        <div class="role"><div class="re">${r.e}</div><b>${r.n}</b><p>${r.d}</p><div class="row" style="justify-content:center"><button class="btn sm" data-r="${k}" data-d="-1">−</button><b class="t" style="font-size:1.4rem">${M.plan[k] || 0}</b><button class="btn sm" data-r="${k}" data-d="1">＋</button></div></div>`).join('')}
        <div class="role"><div class="re">🙂</div><b>시민</b><p>나머지 모두</p><b class="t" style="font-size:1.4rem">${Math.max(0, n - total)}</b></div></div>
      <div class="ctrl"><button class="btn big" data-auto>추천 구성</button><button class="btn huge primary" data-deal ${n < 4 || total > n ? 'disabled' : ''}>🃏 직업 나눠 주기</button></div>
      <p class="help" style="text-align:center">밤에는 모든 학생이 휴대폰으로 누군가를 고르게 해서, 누가 특수 직업인지 티가 나지 않아요. 휴대폰이 없는 학생이 있으면 [학생 참여]를 닫고 진행자 모드로 하세요.</p>`;
  }
  function deal() {
    const list = shuffle(members());
    const roles = [];
    Object.entries(M.plan).forEach(([k, c]) => { for (let i = 0; i < c; i++) roles.push(k); });
    while (roles.length < list.length) roles.push('citizen');
    M.players = list.map((p, i) => ({ ...p, role: roles[i], alive: true, inv: [], used: false, shield: roles[i] === 'politician' }));
    M.gid = 'g' + Date.now(); M.day = 0; M.log = []; M.winner = null; M.revealed = {}; M.picks = {};
    M.phase = 'roles'; M.msg = '휴대폰에서 내 직업을 몰래 확인하세요!';
    M.players.forEach(secret); push(); sfx.whoosh(); render();
  }
  function startNight() {
    M.phase = 'night'; M.day++; M.round = Live.round(); M.picks = {}; nightActs = [];
    M.msg = '모두 고개를 숙이고 휴대폰으로 한 명을 골라요. 🤫';
    M.players.forEach(p => { if (p.role === 'mafia' || p.role === 'police') secret(p); });
    push(); render();
    unsub(); unsub = Live.watch('responses', M.round, (l) => {
      nightActs = l.filter(x => x.act && P(x.id)?.alive);
      // 경찰 조사 결과 즉시 배달
      nightActs.filter(x => P(x.id)?.role === 'police' && x.act === 'inv' && !M.event?.blackout).forEach(x => {
        const pol = P(x.id); if (pol.inv.some(v => v.day === M.day)) return;
        const tg = P(x.target); if (!tg) return;
        pol.inv.push({ day: M.day, n: tg.name, m: tg.role === 'mafia' }); secret(pol);
      });
      // 마피아끼리 지목 공유
      const picks = {}; nightActs.filter(x => P(x.id)?.role === 'mafia').forEach(x => { const tg = P(x.target); if (tg) picks[tg.name] = (picks[tg.name] || 0) + 1; });
      if (JSON.stringify(picks) !== JSON.stringify(M.picks)) { M.picks = picks; M.players.filter(p => p.role === 'mafia').forEach(secret); }
      drawNightCount();
    });
  }
  function drawNightCount() { const el = $('#nc', root); if (el) el.textContent = `${nightActs.length} / ${alive().length}명 선택 완료`; }
  function morning() {
    unsub();
    const votes = {}; nightActs.filter(x => P(x.id)?.role === 'mafia').forEach(x => { votes[x.target] = (votes[x.target] || 0) + 1; });
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
    const saved = nightActs.filter(x => P(x.id)?.role === 'doctor').map(x => x.target);
    let msg;
    if (!top) msg = '조용한 밤이었어요. 아무 일도 일어나지 않았어요.';
    else if (saved.includes(top)) { msg = `마피아가 ${nm(P(top))}님을 노렸지만… 🩺 의사가 지켜 냈어요!`; sfx.win(); }
    else { const v = P(top); v.alive = false; msg = `😱 ${nm(v)}님이 마피아에게 당했어요. 이제 말없이 관전해요.`; sfx.boom(); }
    M.event = MAFIA_EVENTS[Math.floor(Math.random() * MAFIA_EVENTS.length)];
    if (M.event.tip) { const c = alive().filter(p => p.role !== 'mafia'); const pick = c[Math.floor(Math.random() * c.length)]; if (pick) M.tipMsg = `🎁 제보: ${pick.name}님은 마피아가 아니에요.`; } else M.tipMsg = '';
    M.log.push(`${M.day}일째 밤: ${msg}`);
    M.msg = msg; M.phase = 'day'; M.round = null;
    if (checkWin()) return;
    push(); render();
  }
  function startVote() {
    M.phase = 'vote'; M.round = Live.round(); M.msg = '휴대폰으로 마피아라고 생각하는 사람을 골라요.'; push(); render();
  }
  function execute(id) {
    const v = P(id); if (!v) return;
    let msg;
    if (v.role === 'politician' && v.shield) { v.shield = false; msg = `🎩 ${v.name}님은 정치인! 이번 한 번은 살아남았어요.`; M.revealed = { ...M.revealed, [v.id]: v.role }; sfx.ding(); }
    else if (v.role === 'joker') { v.alive = false; M.winner = 'joker'; M.msg = `🃏 ${v.name}님은 조커였어요! 조커 혼자 승리!`; M.phase = 'end'; push(); render(); confetti(); sfx.win(); return; }
    else { v.alive = false; M.revealed = { ...M.revealed, [v.id]: v.role }; msg = `${v.name}님이 쫓겨났어요. 직업은 ${R(v).e} ${R(v).n}!`; v.role === 'mafia' ? sfx.win() : sfx.bad(); }
    M.log.push(`${M.day}일째 투표: ${msg}`); M.msg = msg; M.phase = 'after';
    if (checkWin()) return;
    push(); render();
  }
  function checkWin() {
    const maf = alive().filter(p => p.role === 'mafia').length, rest = alive().length - maf;
    if (maf === 0) M.winner = 'citizen'; else if (maf >= rest) M.winner = 'mafia'; else return false;
    M.phase = 'end'; M.msg = M.winner === 'citizen' ? '🎉 마피아를 모두 찾았어요! 시민 승리!' : '🕶️ 마피아가 마을을 차지했어요! 마피아 승리!';
    push(); render(); confetti(); sfx.win(); return true;
  }
  function timer(sec) {
    clearInterval(timerT); const end = Date.now() + sec * 1000;
    timerT = setInterval(() => { const left = (end - Date.now()) / 1000; setRing($('#rg', root), left, sec, ''); if (left <= 0) { clearInterval(timerT); sfx.end(); } }, 200);
  }
  function render() {
    $('#stage').classList.toggle('night', M.phase === 'night');
    const head = `<div class="row" style="justify-content:center"><span class="chip">${M.day ? `${M.day}일째` : '준비'}</span><span class="chip">생존 ${alive().length}명</span>${M.event && M.phase !== 'night' ? `<span class="chip">${M.event.e} ${esc(M.event.t)}</span>` : ''}<button class="btn sm" data-host>🔒 진행자 메모</button></div>`;
    if (M.phase === 'setup') return setup();
    if (M.phase === 'roles') {
      root.innerHTML = head + `<p class="stage-title" style="font-size:2.6rem">🃏 직업이 배달됐어요</p><p class="sub">휴대폰에서 <b>내 직업 보기</b>를 눌러 몰래 확인하세요. 옆 사람에게 보여 주면 안 돼요!</p>
        <div class="ctrl"><button class="btn huge primary" data-night>🌙 첫날 밤 시작</button><button class="btn big" data-reset>다시 나누기</button></div>`;
    } else if (M.phase === 'night') {
      root.innerHTML = head + `<p class="stage-title" style="font-size:3rem">🌙 ${M.day}일째 밤</p><p class="sub">${esc(M.msg)}</p>
        <div class="bignum" style="font-size:4rem" id="nc"></div>
        <div class="ctrl"><button class="btn huge primary" data-morning>☀️ 아침이 밝았습니다</button></div>`;
      drawNightCount();
    } else if (M.phase === 'day' || M.phase === 'after') {
      root.innerHTML = head + `<p class="stage-title" style="font-size:2.4rem">${M.phase === 'day' ? `☀️ ${M.day}일째 아침` : '⚖️ 투표 결과'}</p>
        <div class="qcard" style="min-height:0;padding:20px"><div class="q" style="font-size:clamp(1.5rem,3vw,2.4rem)">${esc(M.msg)}</div>${M.tipMsg && M.phase === 'day' ? `<div class="hint">${esc(M.tipMsg)}</div>` : ''}</div>
        ${M.phase === 'day' && M.event ? `<div class="eventcard"><div class="re">${M.event.e}</div><b>사건 카드: ${esc(M.event.t)}</b><p>${esc(M.event.d)}</p></div>` : ''}
        ${M.phase === 'day' ? ringHTML('rg', '토론') : ''}
        <div class="ctrl">${M.phase === 'day' ? `<button class="btn big" data-t="${M.event?.discuss || 120}">🗣️ 토론 ${(M.event?.discuss || 120) / 60}분</button>${M.event?.noDefense ? '' : '<button class="btn big" data-t="60">🎤 최후 변론 1분</button>'}<button class="btn huge primary" data-vote>🗳️ 투표 시작</button>` : '<button class="btn huge primary" data-night>🌙 밤으로</button>'}</div>
        <p class="help" style="text-align:center">승리 조건: 마피아를 모두 찾으면 시민 승리 · 마피아 수가 나머지와 같아지면 마피아 승리 · 조커가 쫓겨나면 조커 승리</p>`;
      if (M.phase === 'day') setRing($('#rg', root), M.event?.discuss || 120, M.event?.discuss || 120, '토론', '#FF7A2F');
    } else if (M.phase === 'vote') {
      root.innerHTML = head + `<p class="stage-title" style="font-size:2.4rem">🗳️ 마피아는 누구?</p><div id="vp"></div>
        <div class="ctrl" id="vc"></div>`;
      runVoteClean();
      const cands = alive();
      vp = votePanel($('#vp', root), { prompt: '마피아라고 생각하는 사람은?', options: cands.map(p => ({ e: '', t: p.name })), kind: 'mafia', hide: !!M.event?.secret });
      // 투표 패널이 정한 round를 마피아 상태에 반영
      M.round = vp.st.round; push({ round: M.round });
      $('#vc', root).innerHTML = `<button class="btn huge primary" data-exec>⚖️ 최다 득표자 결정</button><button class="btn big" data-skip>이번엔 아무도 안 쫓기</button>`;
    } else if (M.phase === 'end') {
      root.innerHTML = head + `<p class="stage-title" style="font-size:2.8rem">${esc(M.msg)}</p>
        <div class="roles">${M.players.map(p => `<div class="role ${p.alive ? '' : 'dead'}"><div class="re">${R(p).e}</div><b>${esc(p.name)}</b><p>${R(p).n}${p.alive ? '' : ' · 👻'}</p></div>`).join('')}</div>
        <div class="box"><h4>📜 사건 기록</h4><ol class="steps">${M.log.map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>
        <div class="ctrl"><button class="btn huge primary" data-reset>🔁 새 게임</button></div>`;
    }
  }
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) { M.plan[b.dataset.r] = Math.max(b.dataset.r === 'mafia' ? 1 : 0, Math.min(b.dataset.r === 'mafia' ? 6 : 1, (M.plan[b.dataset.r] || 0) + +b.dataset.d)); setup(); }
    if ('auto' in b.dataset) { M.plan = mafiaPlan(Math.max(4, members().length)); setup(); }
    if ('deal' in b.dataset) deal();
    if ('night' in b.dataset) startNight();
    if ('morning' in b.dataset) morning();
    if (b.dataset.t) timer(+b.dataset.t);
    if ('vote' in b.dataset) { clearInterval(timerT); startVote(); }
    if ('exec' in b.dataset) {
      const c = vp.st.manual.map((m, i) => m + vp.st.phone.filter(r => r.choice === i).length);
      const max = Math.max(...c); if (max <= 0) { toast('아직 표가 없어요'); return; }
      const tops = c.map((v, i) => v === max ? i : -1).filter(i => i >= 0);
      if (tops.length > 1) { toast('동점이에요! 동점자끼리 30초 변론 후 손들기(✋)로 다시 정하거나, 아무도 안 쫓기를 고르세요.'); return; }
      vp.reveal();
      execute(alive()[tops[0]].id);
    }
    if ('skip' in b.dataset) { M.msg = '아무도 쫓겨나지 않았어요.'; M.phase = 'after'; M.log.push(`${M.day}일째 투표: 아무도 안 쫓김`); push(); render(); }
    if ('reset' in b.dataset) { M.phase = 'setup'; M.players = []; M.event = null; M.day = 0; push(); render(); }
    if ('host' in b.dataset) {
      if (!(await ask('진행자 메모에는 모든 직업이 보여요. TV 화면 공유를 잠시 끄셨나요?', { ok: '열기' }))) return;
      modal(`<h3>🔒 진행자 메모 <button class="x btn ghost" data-close>✕</button></h3>
        <div class="roles">${M.players.map(p => `<div class="role ${p.alive ? '' : 'dead'}"><div class="re">${R(p).e}</div><b>${esc(p.name)}</b><p>${R(p).n}</p></div>`).join('') || '<div class="empty">아직 직업을 나누지 않았어요.</div>'}</div>
        <div class="box" style="margin-top:10px"><h4>📜 기록</h4><ol class="steps">${M.log.map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>`, { wide: true });
    }
  });
  // 기자 능력: 학생이 보낸 공개 요청 처리
  const unsubR = Live.watch('responses', 'reporter', (l) => {
    l.forEach(x => { if (x.gid !== M.gid) return; const rep = P(x.id); const tg = P(x.target); if (!rep || rep.role !== 'reporter' || rep.used || !rep.alive || !tg) return;
      rep.used = true; secret(rep); M.revealed = { ...M.revealed, [tg.id]: tg.role }; M.msg = `🎤 특종! 기자가 공개했어요: ${tg.name}님의 직업은 ${R(tg).e} ${R(tg).n}!`; M.log.push(`${M.day}일째 낮: ${M.msg}`); sfx.ding(); push(); render(); });
  });
  addClean(() => unsubR());
  // 준비 단계에서는 참여 인원이 바뀌면 화면 갱신
  let lastN = S.members.length;
  const poll = setInterval(() => { if (M.phase === 'setup' && S.members.length !== lastN) { lastN = S.members.length; setup(); } }, 1000);
  addClean(() => clearInterval(poll));
  render();
  if (M.phase === 'setup') push();
}

// ---------- 🤥 라이어 게임 ----------
MOD.liar = (stage, g, items) => {
  if (!items.length) { stage.innerHTML = '<div class="empty">제시어 묶음이 없어요. [✏️ 내용 편집]에서 추가하세요.</div>'; return; }
  const L = S.liarState || (S.liarState = { phase: 'setup', cat: 0, liars: 1, fool: false, word: '', fake: '', liarIds: [], gid: '' });
  if (L.cat >= items.length) L.cat = 0;
  stage.innerHTML = `<div id="lr"></div>`;
  const root = $('#lr', stage);
  let t = null; addClean(() => clearInterval(t));
  const push = () => Live.set({ mode: 'liar', game: g.title, liar: { gid: L.gid, phase: L.phase, msg: L.msg || '', result: L.result || '' } });
  const members = () => S.members.map((m, i) => ({ id: m.id, name: m.name || `${S.teams[m.team]?.name || ''} 익명${i + 1}` }));
  function deal() {
    const it = items[L.cat]; const words = shuffle(it.words.slice());
    L.word = words[0]; L.fake = words[1] || words[0]; L.gid = 'l' + Date.now(); L.result = '';
    if (Live.on) {
      const ms = shuffle(members()); L.liarIds = ms.slice(0, L.liars).map(m => m.id); L.liarNames = ms.slice(0, L.liars).map(m => m.name);
      ms.forEach(m => cloud.put(S.room.code, 'secret', m.id, { game: 'liar', gid: L.gid, category: it.cat, word: L.liarIds.includes(m.id) ? (L.fool ? L.fake : null) : L.word }));
      L.phase = 'play'; L.msg = '휴대폰에서 제시어를 몰래 확인하고, 한 명씩 돌아가며 한 마디로 설명해요.';
      push();
    } else L.phase = 'show';
    sfx.whoosh(); render();
  }
  function render() {
    const it = items[L.cat];
    if (L.phase === 'setup') {
      root.innerHTML = `<p class="stage-title" style="font-size:2.6rem">🤥 라이어 게임</p>
        <p class="sub">모두 같은 제시어를 받지만, 라이어만 몰라요! 한 마디씩 설명하며 라이어를 찾아요.</p>
        <div class="row" style="justify-content:center">${items.map((x, i) => `<button class="tab ${i === L.cat ? 'on' : ''}" data-cat="${i}">${esc(x.cat)}</button>`).join('')}</div>
        <div class="row" style="justify-content:center"><span class="chip">라이어 수</span>${[1, 2, 3].map(n => `<button class="btn sm ${L.liars === n ? 'primary' : ''}" data-l="${n}">${n}명</button>`).join('')}
          ${Live.on ? `<label class="chip"><input type="checkbox" id="fool" ${L.fool ? 'checked' : ''}> 🤡 바보 라이어 (라이어에게 비슷한 다른 제시어를 줘요. 본인도 라이어인 줄 몰라요!)</label>` : ''}</div>
        <div class="ctrl"><button class="btn huge primary" data-deal>🎲 제시어 ${Live.on ? '나눠 주기' : '뽑기'}</button></div>
        <p class="help" style="text-align:center">${Live.on ? `📱 참여한 학생 ${S.members.length}명의 휴대폰에 제시어가 몰래 배달돼요.` : '📱 [학생 참여]로 방을 만들면 제시어가 휴대폰으로 배달돼요. 지금은 휴대폰 없이 하는 방법으로 진행해요.'} 30명이 넘으면 모둠(6~8명)별로 따로 해도 좋아요.</p>`;
    } else if (L.phase === 'show') {
      root.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🙇 모두 고개를 숙여요</p>
        <ol class="steps" style="font-size:1.3rem;max-width:720px;margin:0 auto"><li>선생님이 라이어 ${L.liars}명의 어깨를 톡 쳐요.</li><li>어깨를 맞은 라이어는 계속 고개를 숙이고 있어요.</li><li>나머지는 고개를 들고 5초 동안 제시어를 봐요.</li></ol>
        <div class="qcard" id="wcard"><div class="sub">카테고리: ${esc(it.cat)}</div><div class="q" id="w">❓</div></div>
        <div class="ctrl"><button class="btn huge primary" data-peek>👀 제시어 5초 보여 주기</button><button class="btn big" data-play>설명 시작 ▶</button></div>`;
    } else if (L.phase === 'play') {
      root.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🗣️ 한 마디씩 설명하기</p>
        <div class="qcard" style="min-height:0;padding:18px"><div class="sub">카테고리</div><div class="q">${esc(it.cat)}</div></div>
        <p class="sub">제시어를 직접 말하면 안 돼요! 라이어가 눈치채지 못하게, 하지만 같은 편은 알아듣게.</p>
        ${ringHTML('rg', '한 사람 10초')}
        <div class="ctrl"><button class="btn big" data-turn>▶ 다음 사람 (10초)</button><button class="btn huge primary" data-vote>🗳️ 라이어 투표</button></div>`;
      setRing($('#rg', root), 10, 10, '한 사람 10초', '#EE4F86');
    } else if (L.phase === 'vote') {
      root.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🗳️ 라이어는 누구?</p><div id="vp"></div><div class="ctrl"><button class="btn huge primary" data-reveal>🤥 라이어 공개</button></div>`;
      runVoteClean();
      if (Live.on) {
        const ms = members();
        const vp = votePanel($('#vp', root), { prompt: '라이어라고 생각하는 사람은?', options: ms.map(m => ({ e: '', t: m.name })), kind: 'liar' });
        L.vp = vp;
      } else $('#vp', root).innerHTML = `<div class="qcard" style="min-height:0"><div class="q" style="font-size:2rem">하나, 둘, 셋! 하면 라이어를 가리켜요 👉</div></div>`;
    } else if (L.phase === 'reveal') {
      root.innerHTML = `<p class="stage-title" style="font-size:2.6rem">🤥 라이어는…</p>
        <div class="qcard"><div class="q">${Live.on ? esc((L.liarNames || []).join(', ')) : '라이어는 손을 들어 주세요! ✋'}</div>
        ${L.fool && Live.on ? `<div class="hint">🤡 바보 라이어가 받은 제시어: ${esc(L.fake)}</div>` : ''}</div>
        <p class="sub">🎯 마지막 기회! 라이어가 제시어를 맞히면 라이어 승리, 못 맞히면 시민 승리!</p>
        <div class="ctrl"><button class="btn huge primary" data-word>🔑 제시어 공개</button></div><div id="wd"></div>
        <div class="ctrl"><button class="btn big" data-again>🔁 한 판 더</button></div>`;
    }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cat) { L.cat = +b.dataset.cat; render(); }
    if (b.dataset.l) { L.liars = +b.dataset.l; render(); }
    if ('deal' in b.dataset) { L.fool = !!$('#fool', root)?.checked; deal(); }
    if ('peek' in b.dataset) { $('#w', root).textContent = L.word; sfx.ding(); setTimeout(() => { const w = $('#w', root); if (w) w.textContent = '🙈'; }, 5000); }
    if ('play' in b.dataset) { L.phase = 'play'; render(); }
    if ('turn' in b.dataset) { clearInterval(t); const end = Date.now() + 10000; sfx.tick(); t = setInterval(() => { const left = (end - Date.now()) / 1000; setRing($('#rg', root), left, 10, ''); if (left <= 0) { clearInterval(t); sfx.end(); } }, 100); }
    if ('vote' in b.dataset) { clearInterval(t); L.phase = 'vote'; render(); }
    if ('reveal' in b.dataset) { L.vp?.reveal(); L.phase = 'reveal'; L.msg = '라이어 공개!'; L.result = `라이어: ${(L.liarNames || []).join(', ')}`; if (Live.on) push(); sfx.boom(); render(); }
    if ('word' in b.dataset) { $('#wd', root).innerHTML = `<div class="qcard" style="min-height:0"><div class="a" style="font-size:3rem">${esc(L.word)}</div></div>`; sfx.win(); L.result += ` · 제시어: ${L.word}`; if (Live.on) { L.phase = 'end'; push(); L.phase = 'reveal'; } }
    if ('again' in b.dataset) { L.phase = 'setup'; L.gid = ''; if (Live.on) push(); render(); }
  });
  render();
  if (Live.on && L.phase === 'setup') push();
};

// ---------- ⚔️ 배틀로얄 퀴즈 ----------
MOD.royale = (stage, g, items) => {
  const R = S.royale || (S.royale = { hp: [], shield: [], q: 0, order: [], storm: 5 });
  if (R.hp.length !== S.teams.length) { R.hp = S.teams.map(() => 100); R.shield = S.teams.map(() => false); R.q = 0; R.order = shuffle(items.map((_, i) => i)); }
  let showA = false, attacker = null, bz = null;
  stage.innerHTML = `<div class="arena" id="ar"></div><div class="qcard" id="qc" style="min-height:150px;padding:20px"></div><div class="ctrl" id="ctl"></div><div id="bz"></div>`;
  const alive = () => R.hp.map((h, i) => h > 0 ? i : -1).filter(i => i >= 0);
  function drawArena() {
    $('#ar', stage).innerHTML = S.teams.map((t, i) => `<div class="fighter ${R.hp[i] <= 0 ? 'ko' : ''} ${attacker === i ? 'att' : ''}" data-tg="${i}" style="--tc:${TEAM_COLORS[i % 8]}">
      <div class="fn">${R.shield[i] ? '🛡️ ' : ''}${esc(t.name)}</div><div class="hp"><i style="width:${Math.max(0, R.hp[i])}%"></i></div><div class="hpn">${R.hp[i] <= 0 ? '💀 탈락' : `HP ${R.hp[i]}`}</div></div>`).join('');
  }
  function drawQ() {
    const it = items[R.order[R.q % Math.max(1, items.length)]];
    const stormIn = R.storm - (R.q % R.storm);
    $('#qc', stage).innerHTML = attacker != null
      ? `<div class="q" style="font-size:clamp(1.6rem,3vw,2.6rem)">⚔️ ${esc(S.teams[attacker].name)} 공격권 획득!</div><div class="sub">위에서 공격할 모둠을 눌러요 · 또는 아이템 선택</div>
         <div class="ctrl"><button class="btn big" data-heal>💊 회복 +20</button><button class="btn big" data-shield>🛡️ 방어막</button></div>`
      : it ? `<div class="counter">문제 ${R.q + 1} · 🌀 자기장까지 ${stormIn}문제</div><div class="q" style="font-size:clamp(1.6rem,3.2vw,2.8rem)">${esc(it.q)}</div>${showA ? `<div class="a">${esc(it.a)}</div>` : ''}` : '<div class="empty">문제가 없어요.</div>';
    $('#ctl', stage).innerHTML = attacker != null ? '' : `<button class="btn big" data-a ${showA ? 'disabled' : ''}>정답 보기</button><button class="btn big primary" data-next>다음 문제 ▶</button><button class="btn big" data-reset>새 경기</button>`;
  }
  function nextQ() {
    R.q++; showA = false;
    if (R.q % R.storm === 0) { // 자기장: 살아 있는 모든 모둠 -10
      alive().forEach(i => { R.hp[i] = Math.max(0, R.hp[i] - 10); }); flash(); sfx.boom(); toast('🌀 자기장이 좁혀졌어요! 모든 모둠 HP -10');
    }
    checkEnd(); drawArena(); drawQ(); bz?.open();
  }
  function checkEnd() {
    const a = alive();
    if (a.length === 1) { toast(`🏆 ${S.teams[a[0]].name} 최후의 1팀! 승리!`, 4000); award(a[0], 5); confetti(); sfx.win(); }
  }
  function hit(target) {
    if (attacker == null || R.hp[target] <= 0 || target === attacker) return;
    const el = $(`[data-tg="${target}"]`, stage);
    if (R.shield[target]) { R.shield[target] = false; toast(`🛡️ ${S.teams[target].name}의 방어막이 공격을 막았어요!`); sfx.ding(); }
    else {
      const crit = Math.random() < .15; const dmg = crit ? 40 : 20;
      R.hp[target] = Math.max(0, R.hp[target] - dmg); sfx.boom();
      toast(crit ? `💥 치명타! ${S.teams[target].name} -${dmg}` : `⚔️ ${S.teams[target].name} -${dmg}`);
      if (R.hp[target] <= 0) toast(`💀 ${S.teams[target].name} 탈락!`, 3000);
    }
    el?.classList.add('shake'); attacker = null; drawArena(); checkEnd(); setTimeout(nextQ, 700);
  }
  $('#ar', stage).addEventListener('click', (e) => { const f = e.target.closest('[data-tg]'); if (f) hit(+f.dataset.tg); });
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !stage.contains(b)) return;
    if ('a' in b.dataset) { showA = true; sfx.ding(); drawQ(); }
    if ('next' in b.dataset) nextQ();
    if ('reset' in b.dataset) { R.hp = S.teams.map(() => 100); R.shield = S.teams.map(() => false); R.q = 0; R.order = shuffle(items.map((_, i) => i)); attacker = null; drawArena(); drawQ(); bz?.open(); }
    if ('heal' in b.dataset && attacker != null) { R.hp[attacker] = Math.min(100, R.hp[attacker] + 20); toast('💊 HP +20'); sfx.ok(); attacker = null; drawArena(); setTimeout(nextQ, 500); }
    if ('shield' in b.dataset && attacker != null) { R.shield[attacker] = true; toast('🛡️ 방어막 장착! 다음 공격 1번을 막아요'); sfx.ok(); attacker = null; drawArena(); setTimeout(nextQ, 500); }
  });
  drawArena(); drawQ();
  bz = buzzPanel($('#bz', stage), { points: () => 1, prompt: () => items[R.order[R.q % Math.max(1, items.length)]]?.q || '', chipLabel: '⚔️ 정답', onWin: (i) => {
    if (R.hp[i] <= 0) { toast('탈락한 모둠은 공격할 수 없어요'); return; }
    attacker = i; showA = true; sfx.win(); drawArena(); drawQ();
  } });
};

// ---------- 🎰 가챠 퀴즈 ----------
const C = (r, e, n, d) => ({ r, e, n, d, p: { SSR: 5, SR: 3, R: 2, N: 1 }[r] });
const GACHA_THEMES = {
  snack: { name: '간식·음식', emoji: '🍩', cards: [
    C('SSR', '🍫', '두바이 초콜릿', '바삭한 피스타치오 속이 꽉!'), C('SSR', '🍣', '초밥 무한리필', '배 터질 때까지 연어 초밥'),
    C('SR', '🍡', '탕후루', '와그작! 설탕 코팅 과일 꼬치'), C('SR', '🌶️', '마라탕', '맵기 2단계, 꿔바로우 추가'), C('SR', '🍦', '요거트 아이스크림', '토핑 산처럼 쌓기'), C('SR', '🍗', '치킨 한 마리', '반반 무 많이'),
    C('R', '🧋', '버블티', '타피오카 펄 듬뿍'), C('R', '🍜', '컵라면 + 삼각김밥', '편의점 황금 조합'), C('R', '🍕', '피자 한 조각', '치즈가 쭈욱'), C('R', '🧇', '와플', '생크림 가득'), C('R', '🍩', '도넛', '오리지널 글레이즈드'),
    C('N', '🍬', '젤리', '말랑말랑 한 봉지'), C('N', '🍫', '초코바', '공부할 때 당 충전'), C('N', '🥤', '탄산음료', '시원하게 한 캔'), C('N', '🍪', '쿠키', '쉬는 시간 간식'), C('N', '🥛', '바나나우유', '목욕탕 다녀온 기분'),
  ] },
  items: { name: '소지품·악세서리', emoji: '🎒', cards: [
    C('SSR', '🎧', '무선 헤드폰', '노이즈 캔슬링으로 나만의 세계'), C('SSR', '🎮', '최신 게임기', '주말이 순삭되는 마법'),
    C('SR', '⌚', '스마트워치', '걸음 수까지 척척'), C('SR', '👟', '한정판 운동화', '줄 서서 산 그 신발'), C('SR', '📷', '즉석카메라', '찍자마자 나오는 사진'), C('SR', '🎒', '새 백팩', '수납 공간 넉넉'),
    C('R', '🧸', '키링 인형', '가방에 달랑달랑'), C('R', '🔋', '보조배터리', '배터리 1%의 구세주'), C('R', '💍', '실버 반지', '은은하게 반짝'), C('R', '🧢', '볼캡', '머리 안 감은 날의 친구'), C('R', '📱', '폰케이스', '취향 저격 디자인'),
    C('N', '🖊️', '삼색 볼펜', '필기 꾸미기 필수템'), C('N', '📒', '다이어리', '스티커로 꾸미기'), C('N', '🧦', '캐릭터 양말', '귀여움은 발끝부터'), C('N', '🎀', '머리끈', '하나쯤 손목에'), C('N', '🪥', '휴대용 칫솔', '점심 먹고 양치!'),
  ] },
  classic: { name: '고전 인물', emoji: '📜', cards: [
    C('SSR', '👑', '세종대왕', '훈민정음을 만든 임금'), C('SSR', '🥷', '홍길동', '동에 번쩍 서에 번쩍'),
    C('SR', '🌸', '성춘향', '일편단심 춘향전의 주인공'), C('SR', '🌊', '심청', '인당수에 몸을 던진 효녀'), C('SR', '💰', '허생', '책 읽다 장사로 큰돈을 번 선비'), C('SR', '🗡️', '박씨 부인', '신통력으로 나라를 구한 영웅'),
    C('R', '📜', '이몽룡', '암행어사 출두요!'), C('R', '🎃', '흥부', '제비 다리 고쳐 준 착한 동생'), C('R', '🐢', '별주부', '토끼 간을 구하러 간 자라'), C('R', '🐰', '토끼', '간을 두고 왔다는 꾀돌이'),
    C('N', '😤', '놀부', '심술 가득 형님'), C('N', '🏃', '방자', '이몽룡의 재치 있는 하인'), C('N', '🧺', '향단', '춘향이의 든든한 몸종'), C('N', '🐦', '제비', '박씨를 물어 온 새'), C('N', '🐯', '호랑이', '옛이야기 단골 손님'),
  ] },
};
const RARITY = { SSR: { w: 4, c: '#F59E0B', t: 'SSR ✨✨✨' }, SR: { w: 14, c: '#A855F7', t: 'SR ✨✨' }, R: { w: 30, c: '#3B82F6', t: 'R ✨' }, N: { w: 52, c: '#9CA3AF', t: 'N' } };
const gachaTheme = () => GACHA_THEMES[LS.get('co-gacha-theme', 'snack')] ? LS.get('co-gacha-theme', 'snack') : 'snack';
function gachaPull(theme) {
  let x = Math.random() * 100, r = 'N';
  for (const k of ['SSR', 'SR', 'R', 'N']) { if (x < RARITY[k].w) { r = k; break; } x -= RARITY[k].w; }
  const pool = GACHA_THEMES[theme].cards.filter(c => c.r === r); return pool[Math.floor(Math.random() * pool.length)];
}
MOD.gacha = (stage, g, items) => {
  const G = S.gacha || (S.gacha = { col: {}, q: 0, order: [] });
  if (!G.order.length || G.order.length !== items.length) G.order = shuffle(items.map((_, i) => i));
  const theme = gachaTheme(); const TH = GACHA_THEMES[theme];
  const col = G.col[theme] || (G.col[theme] = {});
  let showA = false, bz = null;
  stage.innerHTML = `<div class="row" style="justify-content:center"><span class="chip">뽑기 테마</span>${Object.entries(GACHA_THEMES).map(([k, t]) => `<button class="tab ${k === theme ? 'on' : ''}" data-theme="${k}">${t.emoji} ${t.name}</button>`).join('')}</div>
    <div class="qcard" id="qc" style="min-height:160px;padding:20px"></div><div class="ctrl" id="ctl"></div><div id="pull"></div><div id="bz"></div><div class="box"><h4>${TH.emoji} 모둠 ${TH.name} 도감</h4><div id="col"></div></div>`;
  function drawQ() {
    const it = items[G.order[G.q % Math.max(1, items.length)]];
    $('#qc', stage).innerHTML = it ? `<div class="counter">🎰 문제 ${G.q + 1} · 맞히면 ${TH.name} 뽑기 1회!</div><div class="q" style="font-size:clamp(1.6rem,3.2vw,2.8rem)">${esc(it.q)}</div>${showA ? `<div class="a">${esc(it.a)}</div>` : ''}` : '<div class="empty">문제가 없어요.</div>';
    $('#ctl', stage).innerHTML = `<button class="btn big" data-a ${showA ? 'disabled' : ''}>정답 보기</button><button class="btn big primary" data-next>다음 문제 ▶</button>`;
  }
  function drawCol() {
    $('#col', stage).innerHTML = S.teams.map((t, i) => { const c = col[i] || []; return `<div class="colrow"><b style="color:${TEAM_COLORS[i % 8]}">${esc(t.name)}</b><span>${c.map(x => `<span class="mini r-${x.r}" title="${esc(x.n)}">${x.e}</span>`).join('') || '<small>아직 없음</small>'}</span><small>${c.length}/${TH.cards.length}</small></div>`; }).join('')
      + `<p class="help">확률: SSR 4% · SR 14% · R 30% · N 52% — 같은 카드를 또 뽑아도 점수는 받아요. 💡 SSR이 나오면 진짜 작은 간식·스티커로 보상해 주면 반응이 폭발해요!</p>`;
  }
  function pull(team) {
    const card = gachaPull(theme); const box = $('#pull', stage); const rr = RARITY[card.r];
    box.innerHTML = `<div class="capsule shake">${TH.emoji === '📜' ? '🥚' : '🎁'}</div><p class="sub">${esc(S.teams[team].name)} 뽑는 중…</p>`;
    let n = 0; const spin = setInterval(() => { sfx.roll(); if (++n > 14) { clearInterval(spin);
      box.innerHTML = `<div class="gcard" style="--rc:${rr.c}"><div class="rar">${rr.t}</div><div class="ge">${card.e}</div><b>${esc(card.n)}</b><p>${esc(card.d)}</p><div class="chip">+${card.p}점</div></div>`;
      (col[team] = col[team] || []).some(x => x.n === card.n) || col[team].push(card);
      award(team, card.p); if (card.r === 'SSR') { confetti(80); sfx.win(); } else if (card.r === 'SR') { confetti(30); sfx.win(); } else sfx.ding();
      drawCol(); } }, 90);
    addClean(() => clearInterval(spin));
  }
  stage.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme]'); if (t) { LS.set('co-gacha-theme', t.dataset.theme); sfx.whoosh(); renderModule(); return; }
    const b = e.target.closest('[data-a],[data-next]'); if (!b) return;
    if ('a' in b.dataset) { showA = true; sfx.ding(); drawQ(); }
    if ('next' in b.dataset) { G.q++; showA = false; $('#pull', stage).innerHTML = ''; drawQ(); bz?.open(); }
  });
  drawQ(); drawCol();
  bz = buzzPanel($('#bz', stage), { points: () => 1, prompt: () => items[G.order[G.q % Math.max(1, items.length)]]?.q || '', chipLabel: '🎰 뽑기', onWin: (i) => { showA = true; drawQ(); pull(i); } });
};

// ---------- 🟩 꼬들 (한글 자모 맞히기) ----------
const K_CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const K_JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const K_JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function jamo(word) {
  const out = [];
  for (const ch of String(word).replace(/\s/g, '')) {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) { out.push(ch); continue; }
    out.push(K_CHO[Math.floor(c / 588)], ...K_JUNG[Math.floor((c % 588) / 28)], ...K_JONG[c % 28]);
  }
  return out;
}
function kordleScore(guess, ans) {
  const res = guess.map(() => 'x'); const left = {};
  ans.forEach((a, i) => { if (guess[i] === a) res[i] = 'g'; else left[a] = (left[a] || 0) + 1; });
  guess.forEach((gch, i) => { if (res[i] !== 'g' && left[gch]) { res[i] = 'y'; left[gch]--; } });
  return res;
}
MOD.kordle = (stage, g, items) => {
  const order = shuffle(items.map((_, i) => i)); let idx = 0, rows = [], done = false, showH = false, bz = null;
  stage.innerHTML = `<div class="row" style="justify-content:center"><input id="kg" class="btn" style="text-align:left;font-size:1.3rem;min-width:min(260px,60vw)" placeholder="학생이 말한 낱말 입력" autocomplete="off"><button class="btn primary big" id="kgo">확인</button><button class="btn" id="kh">💡 힌트</button><button class="btn" id="kgive">정답 공개</button><button class="btn" id="knext">다음 낱말 ▶</button></div>
    <div id="kb"></div><div id="kmsg" class="sub"></div><div id="kkeys"></div><div id="bz"></div>`;
  const ans = () => jamo(items[order[idx]]?.a || '');
  function draw() {
    const A = ans(); const n = A.length;
    const all = [...rows]; while (all.length < 6) all.push(null);
    $('#kb', stage).innerHTML = `<div class="kgrid" style="--n:${n}">${all.map(r => r ? r.g.map((c, i) => `<div class="kc k-${r.s[i]}">${c}</div>`).join('') : Array.from({ length: n }, () => '<div class="kc"></div>').join('')).join('')}</div>`;
    const st = {}; rows.forEach(r => r.g.forEach((c, i) => { const v = r.s[i]; if (st[c] !== 'g') st[c] = v === 'g' ? 'g' : (st[c] === 'y' ? 'y' : v); }));
    const keys = ['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ', 'ㅋㅌㅊㅍㅠㅜㅡ', 'ㄲㄸㅃㅆㅉㅒㅖ'];
    $('#kkeys', stage).innerHTML = `<div class="kkeys">${keys.map(r => `<div>${[...r].map(k => `<span class="kk ${st[k] ? 'k-' + st[k] : ''}">${k}</span>`).join('')}</div>`).join('')}</div>`;
    $('#kmsg', stage).innerHTML = `${n}칸 · 겹모음(ㅘ→ㅗ+ㅏ)·겹받침(ㄺ→ㄹ+ㄱ)은 나눠서 세요 · 기회 ${6 - rows.length}번${showH && items[order[idx]]?.hint ? `<div class="hint" style="margin-top:6px">💡 ${esc(items[order[idx]].hint)}</div>` : ''}`;
  }
  function guess() {
    if (done) return; const inp = $('#kg', stage); const w = inp.value.trim(); if (!w) return;
    const G = jamo(w), A = ans();
    if (G.length !== A.length) { toast(`'${w}'은(는) ${G.length}칸이에요. ${A.length}칸 낱말을 말해 주세요`); sfx.bad(); return; }
    const s = kordleScore(G, A); rows.push({ g: G, s }); inp.value = '';
    if (s.every(x => x === 'g')) { done = true; sfx.win(); confetti(); toast(`🎉 정답! ${items[order[idx]].a}`, 3000); }
    else if (rows.length >= 6) { done = true; sfx.bad(); toast(`정답은 '${items[order[idx]].a}'`, 3000); } else sfx.tick();
    draw(); bz?.draw();
  }
  $('#kgo', stage).onclick = guess;
  $('#kg', stage).onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) guess(); };
  $('#kh', stage).onclick = () => { showH = true; draw(); };
  $('#kgive', stage).onclick = () => { done = true; rows.push({ g: ans(), s: ans().map(() => 'g') }); draw(); };
  $('#knext', stage).onclick = () => { idx = (idx + 1) % items.length; rows = []; done = false; showH = false; draw(); bz?.open(); };
  draw();
  bz = buzzPanel($('#bz', stage), { points: () => Math.max(1, 6 - rows.length + (done ? 1 : 0)), prompt: () => '꼬들' });
};

// ---------- 칭찬 빗발 ----------
MOD.rotate = (stage, g) => {
  let iv = LS.get('co-rot-iv', 45), rounds = LS.get('co-rot-n', 5), r = 0, endAt = 0, t = null, running = false;
  stage.innerHTML = `<div class="row" style="justify-content:center"><span class="chip">한 사람에게</span>${[30, 45, 60, 90].map(s => `<button class="btn sm ${s === iv ? 'primary' : ''}" data-iv="${s}">${s}초</button>`).join('')}
      <span class="chip">돌리는 횟수</span>${[4, 5, 6, 8].map(n => `<button class="btn sm ${n === rounds ? 'primary' : ''}" data-n="${n}">${n}번</button>`).join('')}</div>
    ${ringHTML('rg')}<div class="sub" id="rs"></div>
    <div class="ctrl" id="ctl"></div>
    <div class="box"><h4>💌 이렇게 써 봐요</h4><div class="team-chips">${g.praise.map(p => `<span class="chip" style="font-size:1rem">${esc(p)}</span>`).join('')}</div></div>`;
  const rg = $('#rg', stage);
  function draw() {
    const left = running ? Math.max(0, (endAt - Date.now()) / 1000) : iv;
    setRing(rg, left, iv, r >= rounds ? '끝!' : `${r + 1} / ${rounds}번째 친구`, '#EE4F86');
    $('#rs', stage).textContent = r >= rounds ? '이제 자기 종이를 돌려받아 읽어 봐요 💌' : (running ? '구체적으로 칭찬을 적어 주세요 ✍️' : '시작을 누르면 신호에 맞춰 옆으로 넘겨요');
    $('#ctl', stage).innerHTML = running ? `<button class="btn big" data-stop>⏸ 멈춤</button>` : `<button class="btn huge primary" data-go>${r > 0 && r < rounds ? '▶ 계속' : '▶ 시작'}</button>`;
  }
  function tickFn() {
    const left = (endAt - Date.now()) / 1000;
    setRing(rg, left, iv);
    if (left <= 0) {
      r++; flash();
      if (r >= rounds) { running = false; clearInterval(t); sfx.win(); confetti(); draw(); return; }
      sfx.ding(); toast('➡️ 옆 사람에게 넘기세요!', 1800); endAt = Date.now() + iv * 1000; draw();
    }
  }
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.iv) { iv = +b.dataset.iv; LS.set('co-rot-iv', iv); $$('[data-iv]', stage).forEach(x => x.classList.toggle('primary', x === b)); draw(); }
    if (b.dataset.n) { rounds = +b.dataset.n; LS.set('co-rot-n', rounds); $$('[data-n]', stage).forEach(x => x.classList.toggle('primary', x === b)); draw(); }
    if ('go' in b.dataset) { if (r >= rounds) r = 0; running = true; endAt = Date.now() + iv * 1000; clearInterval(t); t = setInterval(tickFn, 200); draw(); }
    if ('stop' in b.dataset) { running = false; clearInterval(t); draw(); }
  });
  addClean(() => clearInterval(t));
  draw();
};

// ---------- 3-2-1 출구 티켓 ----------
MOD.exit = (stage, g) => {
  let list = [], hideNames = true, onlyQ = false;
  stage.innerHTML = `<p class="stage-title" style="font-size:2.4rem">🎫 3-2-1 출구 티켓</p>${S.topic ? `<p class="sub">📚 ${esc(S.topic)}</p>` : ''}
    <div class="exit">
      <div style="background:linear-gradient(135deg,#6C4CF5,#2F86FF)"><b>3</b><span>오늘 배운 것</span><p>새로 알게 된 내용 3가지</p></div>
      <div style="background:linear-gradient(135deg,#FF7A2F,#EE4F86)"><b>2</b><span>흥미로웠던 것</span><p>재미있거나 놀라웠던 점 2가지</p></div>
      <div style="background:linear-gradient(135deg,#15A773,#00A3B4)"><b>1</b><span>궁금한 것</span><p>아직 궁금한 질문 1가지</p></div>
    </div>
    <div class="box" id="ex-live"></div>`;
  const box = $('#ex-live', stage);
  if (!Live.on) {
    box.innerHTML = `<div class="row"><div class="grow"><b class="t" style="font-size:1.3rem">📱 휴대폰으로 제출받기</b><p class="help" style="margin:6px 0 0">버튼을 누르면 QR이 나와요. 학생은 QR을 찍고 3-2-1을 휴대폰에 적어 제출해요. 종이로 해도 괜찮아요.</p></div>
      <button class="btn big primary" id="ex-room">QR 만들기</button></div>`;
    $('#ex-room', stage).onclick = async (e) => { e.currentTarget.disabled = true; try { await createRoomNow(!!roster()); } catch (err) { toast('⚠️ ' + err.message); e.currentTarget.disabled = false; } };
    return;
  }
  const url = joinUrl(S.room.code);
  const who = (x) => hideNames ? '' : `<b>${esc(x.name || '익명')}</b> <small style="color:var(--ink2)">${esc(S.teams[x.team]?.name || '')}</small>`;
  const li = (arr) => (arr || []).filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('');
  function draw() {
    box.innerHTML = `<div class="qr-wrap" style="grid-template-columns:auto 1fr">
        <div class="qr" id="ex-qr" style="width:196px;height:196px"></div>
        <div><div class="sub" style="text-align:left">QR을 찍고 휴대폰으로 제출해요 · 방 번호</div><div class="code-big" style="font-size:3rem">${S.room.code}</div>
          <p style="margin:6px 0"><b style="font-size:1.4rem">제출 ${list.length}명</b> / 참여 <span class="rm-count">${S.members.length}</span>명</p>
          <div class="row"><button class="btn sm" data-x="names">${hideNames ? '🙈 이름 가림' : '👀 이름 보임'}</button><button class="btn sm" data-x="q">${onlyQ ? '❓ 궁금한 것만' : '📄 전체 보기'}</button><button class="btn sm" data-x="copy">📋 전체 복사 (이름 포함)</button></div></div></div>
      <div class="tickets">${list.length ? list.map(x => onlyQ
        ? `<div class="ticket"><div>${who(x)}</div><p style="font-size:1.15rem;font-weight:700;margin:6px 0 0">❓ ${esc(x.ticket.q || '')}</p></div>`
        : `<div class="ticket"><div>${who(x)}</div><div class="tk tk3"><span>3 배운 것</span><ul>${li(x.ticket.l)}</ul></div><div class="tk tk2"><span>2 흥미로운 것</span><ul>${li(x.ticket.f)}</ul></div><div class="tk tk1"><span>1 궁금한 것</span><ul>${li([x.ticket.q])}</ul></div></div>`).join('')
        : '<div class="empty">아직 제출한 학생이 없어요. 📮</div>'}</div>`;
    qrInto($('#ex-qr', box), url, 172);
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'names') hideNames = !hideNames;
    if (b.dataset.x === 'q') onlyQ = !onlyQ;
    if (b.dataset.x === 'copy') {
      const txt = list.map(x => `[${x.name || '익명'}${S.teams[x.team] ? ' / ' + S.teams[x.team].name : ''}]\n배운 것: ${(x.ticket.l || []).filter(Boolean).join(' / ')}\n흥미로운 것: ${(x.ticket.f || []).filter(Boolean).join(' / ')}\n궁금한 것: ${x.ticket.q || ''}`).join('\n\n');
      navigator.clipboard?.writeText(txt).then(() => toast('📋 복사했어요. 한글·엑셀에 붙여 넣으세요'), () => toast('복사가 막혀 있어요'));
      return;
    }
    draw();
  });
  const round = Live.round();
  Live.set({ mode: 'exit', round, prompt: S.topic || '', game: g.title });
  const unsub = Live.watch('responses', round, (l) => { const before = list.length; list = l.filter(x => x.ticket).sort((a, b) => (a.at || 0) - (b.at || 0)); if (list.length > before) sfx.ding(); draw(); });
  addClean(() => unsub());
  draw();
};

// ---------- 30초 선생님 ----------
MOD.teach = (stage, g, items) => {
  let idx = Math.floor(Math.random() * Math.max(1, items.length)), who = 'A', endAt = 0, t = null, running = false, showA = false;
  stage.innerHTML = `<div class="qcard" id="qc" style="min-height:150px"></div>${ringHTML('rg')}<div class="ctrl" id="ctl"></div>`;
  const rg = $('#rg', stage);
  function draw() {
    const it = items[idx];
    $('#qc', stage).innerHTML = it ? `<div class="counter">👩‍🏫 오늘의 설명 개념</div><div class="q">${esc(it.q)}</div>${showA ? `<div class="hint">✔ 꼭 들어갈 말: ${esc(it.a)}</div>` : ''}` : '<div class="empty">개념이 없어요.</div>';
    const left = running ? Math.max(0, (endAt - Date.now()) / 1000) : 30;
    setRing(rg, left, 30, who === 'done' ? '끝! 👏' : `${who} 설명 중`, who === 'A' ? '#6C4CF5' : '#FF7A2F');
    $('#ctl', stage).innerHTML = `${running ? '<button class="btn big" data-stop>⏸</button>' : `<button class="btn huge primary" data-go>▶ ${who === 'B' ? 'B' : 'A'} 시작</button>`}
      <button class="btn big" data-ck ${showA ? 'disabled' : ''}>✔ 체크 포인트</button><button class="btn big" data-new>🎲 다른 개념</button>`;
  }
  function start() {
    if (who === 'done') who = 'A';
    running = true; endAt = Date.now() + 30000; clearInterval(t);
    t = setInterval(() => {
      const left = (endAt - Date.now()) / 1000; setRing(rg, left, 30);
      if (left <= 0) { clearInterval(t); running = false; sfx.end(); if (who === 'A') { who = 'B'; toast('🔄 역할 바꾸기! 이제 B가 설명해요'); } else { who = 'done'; confetti(30); } draw(); }
    }, 100);
    draw();
  }
  $('#ctl', stage).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('go' in b.dataset) start();
    if ('stop' in b.dataset) { running = false; clearInterval(t); draw(); }
    if ('ck' in b.dataset) { showA = true; draw(); }
    if ('new' in b.dataset) { idx = (idx + 1 + Math.floor(Math.random() * Math.max(1, items.length - 1))) % Math.max(1, items.length); who = 'A'; showA = false; running = false; clearInterval(t); sfx.whoosh(); draw(); }
  });
  addClean(() => clearInterval(t));
  draw();
};

// =============================================================
//  내용 편집 · 세트 저장 · AI 생성
// =============================================================
function openEditor(g, preset) {
  const F = FORMATS[g.format];
  const m = modal(`<h3>✏️ 내용 편집 — ${esc(g.title)}${g.packs ? ' · ' + esc(curPack(g).name) : ''} <button class="x btn ghost" data-close>✕</button></h3>
    <div class="help">한 줄에 하나씩, 칸은 <b>|</b> 로 나눠요. 칸 순서: <b>${F.fields.join(' | ')}</b><br>예) ${esc(F.example)}</div>
    <div class="field" style="margin-top:10px"><textarea id="ed">${esc(preset ?? gameLines(g))}</textarea></div>
    <div class="row">
      <button class="btn" id="ed-default">기본값으로</button>
      <button class="btn" id="ed-ai">✨ 문제 만들기</button>
      <span class="grow"></span>
      <button class="btn primary big" id="ed-apply">적용</button>
    </div>
    <div class="box" style="margin-top:14px">
      <h4>💾 내 문제 세트 <span class="chip">${cloud.user?.google ? '☁️ 구글 계정에 저장' : '이 기기에 저장'}</span></h4>
      <div class="row"><input id="set-name" class="grow" style="border:2px solid var(--line);border-radius:12px;padding:8px 10px" placeholder="세트 이름 (예: 2학년 설득하는 글 도입)"><button class="btn" id="set-save">현재 내용 저장</button></div>
      <div class="setlist" id="setlist" style="margin-top:8px"><div class="empty">불러오는 중…</div></div>
    </div>`, { wide: true });
  const ta = $('#ed', m.el);
  $('#ed-default', m.el).onclick = () => { ta.value = defLines(g); };
  $('#ed-ai', m.el).onclick = () => { m.close(); openMaker(g); };
  $('#ed-apply', m.el).onclick = () => {
    const items = parseLines(g.format, ta.value);
    if (!items.length) { toast('내용이 비어 있어요'); return; }
    saveLines(g, ta.value); m.close(); renderModule(); toast(`${items.length}개 적용했어요`);
  };
  $('#set-save', m.el).onclick = async () => {
    const name = $('#set-name', m.el).value.trim() || `${S.topic || g.title} ${new Date().toLocaleDateString('ko-KR')}`;
    try { const where = await cloud.saveSet(setId(g), name, ta.value); toast(where === 'cloud' ? '☁️ 계정에 저장했어요' : '💾 이 기기에 저장했어요'); listSets(); } catch (e) { toast('저장 실패: ' + e.message); }
  };
  async function listSets() {
    const box = $('#setlist', m.el);
    try {
      const sets = await cloud.listSets(setId(g));
      box.innerHTML = sets.length ? sets.map(s => `<div class="setitem"><span class="grow">${esc(s.name)}</span><span class="chip">${parseLines(g.format, s.lines).length}개</span>
        <button class="btn sm" data-load="${s.id}">불러오기</button><button class="btn sm" data-del="${s.id}">🗑</button></div>`).join('') : '<div class="empty">저장된 세트가 없어요.</div>';
      box.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const s = sets.find(x => x.id === (b.dataset.load || b.dataset.del));
        if (b.dataset.load) { ta.value = s.lines; toast(`'${s.name}' 불러옴 — [적용]을 누르세요`); }
        if (b.dataset.del && (await ask(`'${s.name}' 세트를 지울까요?`, { ok: '지우기', danger: true }))) { await cloud.deleteSet(s.id); listSets(); }
      };
    } catch (e) { box.innerHTML = `<div class="empty">목록을 못 불러왔어요: ${esc(e.message)}</div>`; }
  }
  listSets();
}

function openAI(g, presetExtra = '') {
  const m = modal(`<h3>✨ AI로 문제 만들기 — ${esc(g.title)} <button class="x btn ghost" data-close>✕</button></h3>
    <div class="field"><label>오늘 수업 주제</label><input id="ai-topic" value="${esc(S.topic)}" placeholder="예: 설득하는 글쓰기 — 주장과 근거의 타당성"></div>
    <div class="row">
      <div class="field grow"><label>학년</label><select id="ai-grade"><option>고1</option><option>고2</option><option>고3</option></select></div>
      <div class="field grow"><label>개수</label><select id="ai-count">${[5, 8, 10, 15].map(n => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field grow"><label>난이도</label><select id="ai-level"><option>쉬움</option><option selected>보통</option><option>도전</option></select></div>
    </div>
    <div class="field"><label>추가 요청 (선택)</label><input id="ai-extra" value="${esc(presetExtra)}" placeholder="예: 교과서 '연설문' 단원 용어 위주로, 유행어 한두 개 섞어서"></div>
    <div class="help">구글 AI 스튜디오(Gemini)가 만들어요. 만든 뒤 편집 화면에서 꼭 한 번 확인하고 고쳐 쓰세요.</div>
    <div class="row" style="margin-top:12px"><span class="grow" id="ai-msg"></span><button class="btn primary big" id="ai-go">✨ 만들기</button></div>`);
  const go = $('#ai-go', m.el);
  go.onclick = async () => {
    const topic = $('#ai-topic', m.el).value.trim();
    if (topic) { S.topic = topic; LS.set('co-topic', topic); }
    go.disabled = true; $('#ai-msg', m.el).textContent = '⏳ 만드는 중… (10초쯤 걸려요)';
    try {
      const r = await fetch(CONFIG.aiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        format: g.format, game: g.title, topic, grade: $('#ai-grade', m.el).value, count: $('#ai-count', m.el).value, level: $('#ai-level', m.el).value, extra: $('#ai-extra', m.el).value,
      }) });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('AI 서버(/api/generate)를 찾지 못했어요. 버셀에 배포한 주소에서 사용해 주세요.');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'AI 오류');
      const lines = itemsToLines(g.format, data.items);
      m.close(); openEditor(g, lines); toast('✨ 만들었어요! 확인하고 [적용]을 누르세요');
    } catch (e) {
      $('#ai-msg', m.el).textContent = '⚠️ ' + e.message; go.disabled = false;
    }
  };
}

// =============================================================
//  ✨ 문제 만들기 — 게임별 만들기 도구
//   · 초성 퀴즈: 개념 | 특징  → 초성 자동 (AI 없이도 정확)
//   · 미스터리 키워드: 개념 | 내용 → 힌트 5개 (AI, 없으면 문장 나누기)
//   · 이모지 퀴즈: 속담(AI) / 노래 가사 → 이모지 / 우리 반 친구 특징 → 이모지
// =============================================================
function openMaker(g) {
  if (g.maker === 'chosung' || g.maker === 'keyword') return openConceptMaker(g);
  if (g.packs) {
    const p = curPack(g).id;
    if (p === 'song') return openSongMaker(g);
    if (p === 'class') return openClassMaker(g);
    return openAI(g, '속담과 사자성어만 출제. 이모지로 장면을 그려서 맞히게. hint에는 "속담" 또는 "사자성어"라고만 쓰기.');
  }
  return openAI(g);
}

async function callAI(body) {
  const r = await fetch(CONFIG.aiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('AI 서버 연결 전');
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'AI 오류');
  return data.items || [];
}
function appendLines(g, lines) {
  const cur = gameLines(g).trim();
  return (cur ? cur + '\n' : '') + lines;
}

function openConceptMaker(g) {
  const isCho = g.maker === 'chosung';
  const key = 'co-maker-' + g.id;
  const m = modal(`<h3>✍️ 개념으로 ${isCho ? '초성 퀴즈' : '미스터리 키워드'} 만들기 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="help">한 줄에 개념 하나씩, <b>개념 | ${isCho ? '특징' : '내용'}</b> 형태로 적어 주세요.<br>
      ${isCho ? '초성은 자동으로 정확하게 뽑고, 특징은 힌트가 돼요. (특징 안에 정답이 들어 있으면 ○○로 가려요)' : '내용을 바탕으로 <b>어려운 힌트 → 쉬운 힌트</b> 5개를 만들어요. AI가 연결돼 있으면 AI가, 아니면 문장을 나눠서 만들어요.'}</div>
    <div class="field" style="margin-top:10px"><textarea id="cm" style="min-height:220px" placeholder="${isCho ? '공감적 듣기 | 상대의 입장이 되어 감정까지 헤아리며 듣기\n반언어적 표현 | 억양, 강세, 말의 크기와 속도\n고쳐쓰기 | 글쓰기의 마지막 단계, 추가·삭제·대치·재구성' : '은유법 | 원관념과 보조 관념을 \'A는 B이다\'로 연결한다. 직유법과 달리 \'~같이\'가 없다. 예: 내 마음은 호수요\n토론 | 찬성과 반대로 나뉘어 근거를 들어 상대를 설득한다. 사회자가 있고 발언 순서와 시간이 정해져 있다.'}">${esc(LS.get(key, ''))}</textarea></div>
    ${isCho ? '' : '<label class="chip"><input type="checkbox" id="cm-ai" checked> AI로 더 좋은 힌트 만들기 (버셀 배포 후)</label>'}
    <div class="row" style="margin-top:10px"><span class="grow" id="cm-msg"></span>
      <label class="chip"><input type="checkbox" id="cm-add"> 기존 문제 뒤에 덧붙이기</label>
      <button class="btn primary big" id="cm-go">문제 만들기</button></div>`, { wide: true });
  $('#cm', m.el).oninput = (e) => LS.set(key, e.target.value);
  $('#cm-go', m.el).onclick = async () => {
    const pairs = readPairs($('#cm', m.el).value);
    if (!pairs.length) { toast('개념을 한 줄 이상 적어 주세요'); return; }
    let lines;
    if (isCho) {
      lines = pairs.map(p => `${chosung(p.a)} | ${p.a} | ${maskWord(p.b, p.a)}`).join('\n');
    } else {
      const btn = $('#cm-go', m.el); btn.disabled = true;
      let items = null;
      if ($('#cm-ai', m.el)?.checked) {
        $('#cm-msg', m.el).textContent = '⏳ AI가 힌트를 만드는 중…';
        try { items = await callAI({ format: 'keyword_from', game: g.title, topic: S.topic, source: pairs.map(p => `${p.a} | ${p.b}`).join('\n'), count: pairs.length }); }
        catch (e) { toast('AI 연결 전이라 기본 방식으로 만들었어요'); }
      }
      lines = pairs.map((p, i) => {
        const ai = items?.find(x => (x.answer || '').replace(/\s/g, '') === p.a.replace(/\s/g, '')) || items?.[i];
        const hints = ai?.hints?.length >= 5 ? ai.hints.slice(0, 5).map(h => maskWord(h, p.a)) : localKeywordHints(p.a, p.b);
        return [p.a, ...hints].map(x => String(x).replace(/\|/g, '/')).join(' | ');
      }).join('\n');
      btn.disabled = false;
    }
    const add = $('#cm-add', m.el).checked;
    m.close(); openEditor(g, add ? appendLines(g, lines) : lines);
    toast('✨ 만들었어요! 확인하고 [적용]을 누르세요');
  };
}

function openSongMaker(g) {
  const made = [];
  const m = modal(`<h3>🎵 가사로 이모지 만들기 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="row"><div class="field grow"><label>노래 제목 (정답)</label><input id="sg-title" placeholder="예: 벚꽃 엔딩"></div>
      <div class="field grow"><label>가수 (힌트)</label><input id="sg-artist" placeholder="예: 버스커버스커"></div></div>
    <div class="field"><label>가사 (붙여 넣기)</label><textarea id="sg-lyrics" style="min-height:160px" placeholder="가사를 붙여 넣으면 가사 속 장면·단어를 이모지로 바꿔요"></textarea></div>
    <div class="help">가사는 이모지를 만드는 데만 쓰고 저장하지 않아요. 학생 화면에는 이모지·제목·가수만 나와요.</div>
    <div class="row" style="margin-top:10px"><span class="grow" id="sg-msg"></span><button class="btn primary big" id="sg-go">🎵 이모지 만들기</button></div>
    <div class="box hidden" id="sg-res" style="margin-top:12px">
      <h4>만든 이모지 — 마음에 안 들면 직접 고쳐도 돼요</h4>
      <div class="row"><input id="sg-emoji" class="grow" style="font-size:2.4rem;border:2px solid var(--line);border-radius:12px;padding:6px 10px"><button class="btn" id="sg-again">🔄 다시</button><button class="btn ok" id="sg-add">＋ 목록에 담기</button></div>
    </div>
    <div class="box" style="margin-top:12px"><h4>담은 노래 <span class="chip" id="sg-n">0곡</span></h4><div class="setlist" id="sg-list"><div class="empty">아직 없어요. 여러 곡을 담은 뒤 한 번에 넣을 수 있어요.</div></div>
      <div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn primary" id="sg-done" disabled>노래 퀴즈에 넣기 ▶</button></div></div>`, { wide: true });
  let alt = 0;
  const make = async () => {
    const title = $('#sg-title', m.el).value.trim(), lyrics = $('#sg-lyrics', m.el).value.trim();
    if (!title || !lyrics) { toast('제목과 가사를 넣어 주세요'); return; }
    $('#sg-go', m.el).disabled = true; $('#sg-msg', m.el).textContent = '⏳ 만드는 중…';
    let emoji = '';
    try {
      const items = await callAI({ format: 'song_emoji', game: '이모지 퀴즈', source: `제목: ${title}\n가수: ${$('#sg-artist', m.el).value}\n가사:\n${lyrics.slice(0, 3000)}`, count: 1, extra: alt ? `이전과 다른 조합으로 (${alt}번째 시도)` : '' });
      emoji = items[0]?.emoji || '';
    } catch { /* AI 없으면 아래 기본 방식 */ }
    if (!emoji) {
      const lines = lyrics.split('\n').filter(Boolean);
      const start = alt ? Math.floor(Math.random() * Math.max(1, lines.length - 4)) : 0;
      emoji = emojify(lines.slice(start).join(' '), 5);
      $('#sg-msg', m.el).textContent = 'AI 연결 전이라 가사 속 낱말로 만들었어요';
    } else $('#sg-msg', m.el).textContent = '';
    $('#sg-emoji', m.el).value = emoji; $('#sg-res', m.el).classList.remove('hidden'); $('#sg-go', m.el).disabled = false; sfx.ding();
  };
  const drawList = () => {
    $('#sg-n', m.el).textContent = made.length + '곡';
    $('#sg-list', m.el).innerHTML = made.map((x, i) => `<div class="setitem"><span style="font-size:1.6rem">${esc(x.e)}</span><span class="grow">${esc(x.t)} <small>${esc(x.a)}</small></span><button class="btn sm" data-rm="${i}">✕</button></div>`).join('') || '<div class="empty">아직 없어요.</div>';
    $('#sg-done', m.el).disabled = !made.length;
  };
  $('#sg-go', m.el).onclick = () => { alt = 0; make(); };
  $('#sg-again', m.el).onclick = () => { alt++; make(); };
  $('#sg-add', m.el).onclick = () => {
    made.push({ e: $('#sg-emoji', m.el).value.trim(), t: $('#sg-title', m.el).value.trim(), a: $('#sg-artist', m.el).value.trim() });
    ['#sg-title', '#sg-artist', '#sg-lyrics'].forEach(s => $(s, m.el).value = ''); $('#sg-res', m.el).classList.add('hidden'); drawList(); toast('담았어요. 다음 곡을 넣어 보세요');
  };
  $('#sg-list', m.el).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { made.splice(+b.dataset.rm, 1); drawList(); } };
  $('#sg-done', m.el).onclick = () => { const lines = made.map(x => `${x.e} | ${x.t} | ${x.a}`).join('\n'); m.close(); openEditor(g, appendLines(g, lines)); toast('확인하고 [적용]을 누르세요'); };
}

function openClassMaker(g) {
  const key = 'co-maker-class';
  const pre = LS.get(key, '') || (roster()?.names || []).map(n => `${n} | `).join('\n');
  const m = modal(`<h3>🧑‍🎓 우리 반 친구 이모지 만들기 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="help">한 줄에 한 명, <b>이름 | 특징</b>으로 적어 주세요. 예) <b>김민준 | 축구 좋아함, 라면 잘 끓임, 반장</b><br>
      ${roster() ? `'${esc(roster().name)}' 명렬의 이름을 미리 채워 두었어요.` : '이름 뽑기에서 반 명렬을 만들어 두면 이름이 자동으로 채워져요.'}
      친구들이 웃으며 맞힐 수 있는 <b>좋은 특징·취미</b>만 넣어 주세요. (외모·성적·가정사는 넣지 않기)</div>
    <div class="field" style="margin-top:10px"><textarea id="cl" style="min-height:240px" placeholder="김민준 | 축구, 라면, 반장\n이서연 | 그림 그리기, 고양이, 웃음이 많음">${esc(pre)}</textarea></div>
    <div class="row"><label class="chip"><input type="checkbox" id="cl-ai" checked> AI로 더 재치 있게 (버셀 배포 후)</label><span class="grow" id="cl-msg"></span><button class="btn primary big" id="cl-go">이모지 만들기</button></div>`, { wide: true });
  $('#cl', m.el).oninput = (e) => LS.set(key, e.target.value);
  $('#cl-go', m.el).onclick = async () => {
    const pairs = readPairs($('#cl', m.el).value).filter(p => p.b);
    if (!pairs.length) { toast('이름 옆에 | 특징 을 적어 주세요'); return; }
    let items = null;
    if ($('#cl-ai', m.el).checked) {
      $('#cl-go', m.el).disabled = true; $('#cl-msg', m.el).textContent = '⏳ 만드는 중…';
      try { items = await callAI({ format: 'class_emoji', game: '이모지 퀴즈', source: pairs.map(p => `${p.a} | ${p.b}`).join('\n'), count: pairs.length }); }
      catch { toast('AI 연결 전이라 특징 낱말로 만들었어요'); }
    }
    const lines = pairs.map((p, i) => {
      const ai = items?.find(x => (x.name || '').trim() === p.a) || items?.[i];
      const e = ai?.emoji || emojify(p.b, 5);
      return `${e} | ${p.a} | 초성 ${chosung(p.a)}`;
    }).join('\n');
    m.close(); openEditor(g, lines);
    toast('✨ 만들었어요! ❓가 나온 친구는 직접 고쳐 주세요');
  };
}

// =============================================================
//  이름 뽑기 · 명렬
// =============================================================
function openPicker() {
  let exclude = true, rolling = false;
  const m = modal(`<h3>👤 이름 뽑기 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="row">
      <select id="pk-roster" class="btn grow"></select>
      <button class="btn" id="pk-edit">명렬 편집</button>
      <button class="btn" id="pk-new">＋ 새 반</button>
    </div>
    <div class="row" id="pk-num" style="margin-top:8px"></div>
    <div class="picker-name" id="pk-name">?</div>
    <div class="ctrl"><button class="btn huge primary" id="pk-go">🎲 뽑기</button>
      <label class="chip"><input type="checkbox" id="pk-ex" checked> 뽑힌 사람 제외</label><button class="btn sm" id="pk-clear">초기화</button></div>
    <div class="picked" id="pk-hist" style="margin-top:10px"></div>`);
  const sel = $('#pk-roster', m.el);
  const fill = () => {
    sel.innerHTML = `<option value="">번호로 뽑기 (명렬 없이)</option>` + S.rosters.map(r => `<option value="${esc(r.id)}" ${r.id === S.rosterId ? 'selected' : ''}>${esc(r.name)} (${r.names.length}명)</option>`).join('');
    $('#pk-num', m.el).innerHTML = S.rosterId ? '' : `<span class="chip">1번부터</span><input id="pk-max" type="number" min="2" max="60" value="${LS.get('co-pick-max', 28)}" style="width:80px;border:2px solid var(--line);border-radius:10px;padding:6px"><span class="chip">번까지</span>`;
    $('#pk-max', m.el)?.addEventListener('change', (e) => LS.set('co-pick-max', +e.target.value));
    drawHist();
  };
  const pool = () => {
    const r = roster(); const all = r ? r.names : Array.from({ length: +($('#pk-max', m.el)?.value || 28) }, (_, i) => `${i + 1}번`);
    const p = exclude ? all.filter(n => !S.pickedNames.includes(n)) : all; return p.length ? p : all;
  };
  const drawHist = () => { $('#pk-hist', m.el).innerHTML = S.pickedNames.map(n => `<span class="chip">${esc(n)}</span>`).join(''); };
  sel.onchange = () => { S.rosterId = sel.value || null; LS.set('co-roster-id', S.rosterId); S.pickedNames = []; fill(); if (S.room?.sendRoster) Live.set({ roster: roster()?.names || [] }); };
  $('#pk-ex', m.el).onchange = (e) => { exclude = e.target.checked; };
  $('#pk-clear', m.el).onclick = () => { S.pickedNames = []; drawHist(); };
  $('#pk-edit', m.el).onclick = () => { m.close(); openRosterEditor(roster()); };
  $('#pk-new', m.el).onclick = () => { m.close(); openRosterEditor(null); };
  $('#pk-go', m.el).onclick = () => {
    if (rolling) return; rolling = true; const p = pool(); const el = $('#pk-name', m.el); el.classList.add('rolling'); let n = 0; const total = 20 + Math.floor(Math.random() * 6); let pick;
    const step = () => { pick = p[Math.floor(Math.random() * p.length)]; el.textContent = pick; sfx.roll(); n++;
      if (n < total) setTimeout(step, 35 + n * n * .4); else { el.classList.remove('rolling'); sfx.win(); S.pickedNames.push(pick); drawHist(); rolling = false; } };
    step();
  };
  fill();
}
function openRosterEditor(r) {
  const m = modal(`<h3>📋 ${r ? '명렬 편집' : '새 반 만들기'} <button class="x btn ghost" data-close>✕</button></h3>
    <div class="field"><label>반 이름</label><input id="ro-name" value="${esc(r?.name || '')}" placeholder="예: 2학년 3반"></div>
    <div class="field"><label>학생 이름 (한 줄에 한 명, 또는 쉼표로 구분)</label><textarea id="ro-names" style="min-height:220px">${esc((r?.names || []).join('\n'))}</textarea></div>
    <div class="help">${cloud.user?.google ? '☁️ 구글 계정(파이어베이스)에 저장돼요.' : '이 기기(브라우저)에만 저장돼요. 구글 로그인하면 계정에 저장돼요.'} 학생 휴대폰 참여 때 학생이 자기 이름을 <b>눌러서</b> 고를 수 있어요.</div>
    <div class="row" style="margin-top:10px">${r ? '<button class="btn bad" id="ro-del">삭제</button>' : ''}<span class="grow"></span><button class="btn primary big" id="ro-save">저장</button></div>`);
  $('#ro-save', m.el).onclick = async () => {
    const name = $('#ro-name', m.el).value.trim(); const names = $('#ro-names', m.el).value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (!name || !names.length) { toast('반 이름과 학생 이름을 넣어 주세요'); return; }
    try { const id = await cloud.saveRoster(name, names); if (r && r.id !== id) await cloud.deleteRoster(r.id); S.rosterId = id; LS.set('co-roster-id', id); await loadRosters(); m.close(); toast(`${name} ${names.length}명 저장`); if (S.room?.sendRoster) Live.set({ roster: names }); openPicker(); }
    catch (e) { toast('저장 실패: ' + e.message); }
  };
  $('#ro-del', m.el)?.addEventListener('click', async () => { if (!(await ask('이 명렬을 지울까요?', { ok: '지우기', danger: true }))) return; await cloud.deleteRoster(r.id); S.rosterId = null; LS.set('co-roster-id', null); await loadRosters(); m.close(); });
}

// =============================================================
//  학생 참여 방 (QR)
// =============================================================
function joinUrl(code) { if (window.CO_HASH_JOIN) return location.href.split('#')[0] + '#room-' + code; const base = (CONFIG.publicUrl || (location.origin + location.pathname)).replace(/index\.html$/, ''); return `${base}${base.includes('?') ? '&' : '?'}room=${code}`; }

async function createRoomNow(sendRoster) {
  const code = await cloud.createRoom({ mode: 'idle', game: S.game?.title || '', round: null, teams: S.teams.map(t => t.name), scores: S.teams.map(t => t.score), roster: sendRoster ? roster().names : [], oxSession: S.oxSession, buzzTop: [], options: [], prompt: '' });
  S.room = { code, sendRoster };
  S.unsubMembers = cloud.watchSub(code, 'members', null, (list) => { S.members = list; refreshRoomButton(); $$('.rm-count').forEach(c => c.textContent = list.length); });
  refreshRoomButton(); renderModule();
  return code;
}
function qrInto(el, url, size = 256) {
  if (!el) return;
  if (window.qrcode) { try { const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make(); el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); el.firstElementChild.style.cssText = `width:${size}px;height:${size}px;display:block`; return; } catch {} }
  el.innerHTML = `<div class="help">QR을 만들지 못했어요. 주소나 방 번호를 알려 주세요.</div>`;
}
async function openRoomModal() {
  if (!S.room) {
    const m = modal(`<h3>📱 학생 휴대폰 참여 <button class="x btn ghost" data-close>✕</button></h3>
      <p>방을 만들면 QR 코드가 나와요. 학생은 휴대폰 카메라로 찍고 <b>모둠과 이름을 눌러서</b> 들어와요. (글자 입력 없음)</p>
      <ul class="steps"><li>투표 게임: 휴대폰으로 선택 → 교사 화면에 실시간 그래프</li><li>퀴즈 게임: 빨리 누르기 버저 → 누른 순서 표시</li><li>휴대폰이 없는 학생·모둠도 손들기로 함께할 수 있어요.</li></ul>
      <label class="chip" style="margin:8px 0"><input type="checkbox" id="rm-roster" ${roster() ? 'checked' : 'disabled'}> 명렬에서 이름 고르기 ${roster() ? `(${esc(roster().name)})` : '(이름 뽑기에서 반을 먼저 만들면 켜져요)'}</label>
      ${cloud.mode === 'local' ? '<div class="help">🧪 지금은 체험 모드라 <b>같은 브라우저의 다른 탭</b>에서만 연결돼요. 실제 휴대폰 연결은 config.js에 파이어베이스를 넣어 주세요.</div>' : ''}
      <div class="row" style="margin-top:12px"><span class="grow" id="rm-msg"></span><button class="btn primary big" id="rm-go">방 만들기</button></div>`);
    $('#rm-go', m.el).onclick = async () => {
      $('#rm-go', m.el).disabled = true; $('#rm-msg', m.el).textContent = '만드는 중…';
      try { await createRoomNow(!!$('#rm-roster', m.el).checked && !!roster()); m.close(); showRoom(); }
      catch (e) { $('#rm-msg', m.el).textContent = '⚠️ ' + e.message; $('#rm-go', m.el).disabled = false; }
    };
    return;
  }
  showRoom();
}
function showRoom() {
  const code = S.room.code, url = joinUrl(code);
  const m = modal(`<h3>📱 학생 참여 중 <button class="x btn ghost" data-close>✕</button></h3>
    <div class="qr-wrap">
      <div class="qr" id="qr"></div>
      <div>
        <div class="sub" style="text-align:left">방 번호</div>
        <div class="code-big">${code}</div>
        <p class="url">${esc(url)}</p>
        <p><b>참여 <span class="rm-count">${S.members.length}</span>명</b> · 카메라로 QR을 찍거나, 주소에 들어가 방 번호를 눌러요.</p>
        <div class="row"><button class="btn" id="rm-copy">주소 복사</button><button class="btn bad" id="rm-close">방 닫기</button></div>
      </div>
    </div>`, { wide: true });
  qrInto($('#qr', m.el), url);
  $('#rm-copy', m.el).onclick = () => { navigator.clipboard?.writeText(url).then(() => toast('주소를 복사했어요')); };
  $('#rm-close', m.el).onclick = async () => {
    if (!(await ask('방을 닫으면 학생 화면 연결이 끊겨요. 닫을까요?', { ok: '방 닫기', danger: true }))) return;
    await cloud.closeRoom(code); S.unsubMembers?.(); S.room = null; S.members = []; m.close(); refreshRoomButton(); renderModule(); toast('방을 닫았어요');
  };
}

// ---------------- 진입점: ?room= 이 있으면 학생 화면 ----------------
const params = new URLSearchParams(location.search);
const hashRoom = (location.hash.match(/^#room-?(\d*)$/) || [])[1];
if (params.has('room') || params.has('join') || hashRoom != null) {
  import('./student.js').then(m => m.start(params.get('room') || params.get('join') || hashRoom || ''));
} else {
  startTeacher();
}
