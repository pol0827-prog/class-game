// =============================================================
//  학생 휴대폰 화면 — 글자 입력 없이 버튼만 눌러 참여
// =============================================================
import { cloud } from './cloud.js';
import { $, esc, toast, sfx, TEAM_COLORS, confetti } from './ui.js';

const ssGet = (k, d) => { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };

let code = '', me = null, room = null, unsub = null;
const votes = {};   // round -> choice
const buzzed = {};  // round -> true
const tickets = {}; // round -> { draft, sent, editing }
let shownExit = null;
let secretDoc = null, unsubSecret = null, showRole = false;
const nightPick = {}; // round -> target id

export async function start(code0) {
  document.title = '수업 참여 · 수업이 재밌어지는 5분';
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  $('#app').innerHTML = `<div class="st"><div class="st-main"><div class="waiting"><div class="big">⏳</div><p class="lead">연결하는 중…</p></div></div></div>`;
  await cloud.init();
  code = String(code0 || '').replace(/\D/g, '').slice(0, 5);
  if (code.length === 5) enter(code); else keypad();
}

function shell(inner, top = '') {
  $('#app').innerHTML = `<div class="st">${top}<div class="st-main">${inner}</div></div>`;
}

// ---------------- 방 번호 키패드 ----------------
function keypad(msg = '') {
  let v = '';
  const draw = () => {
    shell(`<h2>📱 수업 참여하기</h2><p class="lead">선생님 화면의 <b>방 번호 5자리</b>를 눌러 주세요</p>
      <div class="codebox">${[0, 1, 2, 3, 4].map(i => `<span class="${v[i] ? 'f' : ''}">${v[i] || ''}</span>`).join('')}</div>
      ${msg ? `<p class="lead" style="color:var(--bad);font-weight:700">${esc(msg)}</p>` : ''}
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="del">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--brand);color:#fff">입장</button></div>`);
    $('.keypad').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
      if (k === 'del') v = v.slice(0, -1);
      else if (k === 'ok') { if (v.length === 5) { enter(v); return; } }
      else if (v.length < 5) v += k;
      msg = ''; draw(); if (v.length === 5) setTimeout(() => enter(v), 150);
    };
  };
  draw();
}

async function enter(c) {
  shell(`<div class="waiting"><div class="big">🔎</div><p class="lead">방 ${esc(c)} 찾는 중…</p></div>`);
  let ok = false; try { ok = await cloud.roomExists(c); } catch (e) { console.warn(e); }
  if (!ok) { keypad('그 번호의 방을 찾을 수 없어요. 다시 확인해 주세요.'); return; }
  code = c;
  try { if (window.CO_HASH_JOIN) location.hash = 'room-' + c; else history.replaceState(null, '', `${location.pathname}?room=${c}`); } catch {}
  me = ssGet('co-me-' + c, null);
  unsubSecret?.(); unsubSecret = cloud.watchMine(c, 'secret', (d) => { secretDoc = d; if (room && (room.mode === 'mafia' || room.mode === 'liar')) render(); });
  unsub?.(); unsub = cloud.watchRoom(c, (r) => {
    const prev = room; room = r;
    // 출구 티켓을 쓰는 중이면 점수 변화 등으로 화면을 다시 그리지 않음 (쓰던 글 보호)
    if (prev && r && r.mode === 'exit' && prev.mode === 'exit' && r.round === prev.round && shownExit === r.round && !r.closed) return;
    render();
  });
}

// ---------------- 모둠·이름 고르기 (탭만) ----------------
function pickTeam() {
  const teams = room?.teams || [];
  shell(`<h2>우리 모둠은?</h2><p class="lead">눌러서 골라 주세요</p>
    <div class="choices two">${teams.map((t, i) => `<button class="choice" data-t="${i}" style="border-color:${TEAM_COLORS[i % 8]}"><span class="e" style="color:${TEAM_COLORS[i % 8]}">●</span>${esc(t)}</button>`).join('')}</div>`);
  $('.choices').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; pickName(+b.dataset.t); };
}
function pickName(team) {
  const names = room?.roster || [];
  if (!names.length) return save({ team, name: '' });
  shell(`<h2>내 이름은?</h2><p class="lead">내 이름을 눌러 주세요</p>
    <div class="namegrid">${names.map((n, i) => `<button data-n="${i}">${esc(n)}</button>`).join('')}</div>
    <button class="btn" data-anon style="margin:6px auto 0">이름 없이 참여하기</button>`);
  $('.st-main').onclick = (e) => {
    const b = e.target.closest('[data-n],[data-anon]'); if (!b) return;
    save({ team, name: b.dataset.n != null ? names[+b.dataset.n] : '' });
  };
}
function save(m) {
  me = m; ssSet('co-me-' + code, me);
  cloud.send(code, 'members', { name: me.name, team: me.team }).catch(e => console.warn(e));
  sfx.ok(); render();
}

// ---------------- 메인 화면 ----------------
function render() {
  if (!room) { shell(`<div class="waiting"><div class="big">🔌</div><p class="lead">방을 찾을 수 없어요.</p></div>`); return; }
  if (room.closed || room.mode === 'closed') { shell(`<div class="waiting"><div class="big">👋</div><h2>수업 방이 닫혔어요</h2><p class="lead">함께해 줘서 고마워요!</p></div>`); unsub?.(); return; }
  if (!me || me.team == null || me.team >= (room.teams || []).length) { pickTeam(); return; }

  const teams = room.teams || [], scores = room.scores || [];
  const myTeam = teams[me.team] || '';
  const top = `<div class="st-top"><span class="who"><span style="color:${TEAM_COLORS[me.team % 8]}">●</span> ${esc(myTeam)} ${esc(me.name || '')}</span>
      <span class="chip">방 ${esc(code)}</span><button class="btn sm" id="chg">바꾸기</button></div>
    <div style="padding:8px 16px 0" class="myscore">${teams.map((t, i) => `<span class="chip ${i === me.team ? 'me' : ''}">${esc(t)} ${scores[i] ?? 0}점</span>`).join('')}</div>`;

  let inner = '';
  const mode = room.mode || 'idle';
  if (mode === 'vote') inner = voteView();
  else if (mode === 'buzzer') inner = buzzView();
  else if (mode === 'exit') inner = exitView();
  else if (mode === 'mafia') inner = mafiaView();
  else if (mode === 'liar') inner = liarView();
  else inner = `<div class="waiting"><div class="big">👀</div><h2>선생님 화면을 봐 주세요</h2><p class="lead">${room.game ? `지금 게임: <b>${esc(room.game)}</b>` : '곧 시작해요!'}</p></div>`;

  shownExit = mode === 'exit' ? room.round : null;
  shell(inner, top);
  $('#chg').onclick = () => { me = null; ssSet('co-me-' + code, null); pickTeam(); };
  bind(mode);
}

function oxKey() { return `co-oxout-${code}-${room.oxSession || ''}`; }

function voteView() {
  const r = room.round, opts = room.options || [], mine = votes[r];
  const rev = !!room.revealed, ans = room.answer ?? -1;
  const two = opts.length === 2 || room.kind === 'ox';
  const isOx = room.kind === 'ox';
  let outNote = '';
  if (isOx) {
    // OX 서바이벌: 정답 공개 때 틀리면 탈락 (계속 참여는 가능)
    if (rev && ans >= 0 && mine != null && mine !== ans && !ssGet(oxKey() + r, false)) { ssSet(oxKey() + r, true); ssSet(oxKey(), true); }
    if (ssGet(oxKey(), false)) outNote = `<p class="lead" style="color:var(--bad);font-weight:700">💀 탈락! 그래도 끝까지 풀어 봐요</p>`;
  }
  let result = '';
  if (rev && ans >= 0) {
    if (mine == null) result = `<div class="result">⏰ 이번엔 놓쳤어요</div>`;
    else result = mine === ans ? `<div class="result ok">⭕ 정답!</div>` : `<div class="result no">❌ 아쉬워요</div>`;
  } else if (rev) result = `<div class="result">📊 결과를 선생님 화면에서 확인해요</div>`;
  else if (mine != null) result = `<p class="lead">✅ 보냈어요! 바꾸고 싶으면 다시 누르세요</p>`;

  const big = isOx ? 'font-size:3rem;min-height:140px' : '';
  return `<h2>${esc(room.prompt || '골라 주세요')}</h2>${outNote}
    <div class="choices ${two ? 'two' : ''}">${opts.map((o, i) => {
      let cls = mine === i ? 'sel' : '';
      if (rev && ans >= 0) cls = i === ans ? 'ok' : (mine === i ? 'no' : '');
      return `<button class="choice ${cls}" data-c="${i}" ${rev ? 'disabled' : ''} style="${big}">${o.e ? `<span class="e">${esc(o.e)}</span>` : ''}${isOx ? '' : `<span>${esc(o.t)}</span>`}</button>`;
    }).join('')}</div>${result}`;
}

function buzzView() {
  const r = room.round, done = !!buzzed[r];
  const top = room.buzzTop || [];
  const my = top.findIndex(x => x.id === cloud.myId());
  const medal = ['🥇', '🥈', '🥉'];
  let msg = '<p class="lead">정답을 알면 빨리 눌러요! 먼저 누른 사람이 말할 기회를 얻어요</p>';
  if (done) msg = my >= 0 ? `<div class="result ${my === 0 ? 'ok' : ''}">${medal[my] || '🔔'} ${my + 1}번째로 눌렀어요!</div><p class="lead">${my === 0 ? '선생님이 부르면 정답을 말해요!' : '앞사람이 틀리면 기회가 와요'}</p>` : `<div class="result">🔔 눌렀어요!</div>`;
  const first = top[0];
  return `<h2>🔔 버저</h2>${room.prompt ? `<p class="lead">${esc(room.prompt)}</p>` : ''}
    <button class="buzzer ${done ? 'done' : ''}" id="bz" ${done ? 'disabled' : ''}>${done ? '✓' : 'BUZZ!'}</button>
    ${msg}
    ${first ? `<p class="lead">지금 1등: <b>${esc((room.teams || [])[first.team] || '')} ${esc(first.name || '')}</b></p>` : ''}`;
}

function exitView() {
  const t = tickets[room.round] || (tickets[room.round] = { d: ['', '', '', '', '', ''], sent: false });
  if (t.sent && !t.editing) {
    return `<div class="waiting"><div class="big">📮</div><h2>제출 완료!</h2><p class="lead">오늘도 수고했어요 👏</p><button class="btn" id="ex-edit" style="margin-top:12px">고쳐서 다시 내기</button></div>`;
  }
  const f = (i, ph) => `<input id="ex${i}" data-i="${i}" value="${esc(t.d[i])}" placeholder="${ph}" maxlength="120" autocomplete="off">`;
  return `<h2>🎫 3-2-1 출구 티켓</h2>${room.prompt ? `<p class="lead">📚 ${esc(room.prompt)}</p>` : ''}
    <form class="exit-form" id="exf">
      <fieldset><legend style="color:#4B6CF7">3 · 오늘 배운 것</legend>${f(0, '배운 것 ①')}${f(1, '배운 것 ②')}${f(2, '배운 것 ③')}</fieldset>
      <fieldset><legend style="color:#E2557A">2 · 흥미로웠던 것</legend>${f(3, '흥미로운 것 ①')}${f(4, '흥미로운 것 ②')}</fieldset>
      <fieldset><legend style="color:#0E9F6E">1 · 궁금한 것</legend>${f(5, '아직 궁금한 것 하나')}</fieldset>
      <button class="btn huge primary" type="submit">📮 제출하기</button>
      <p class="lead" style="font-size:.85rem">짧게 한 낱말이어도 괜찮아요. 다 안 채워도 낼 수 있어요.</p>
    </form>`;
}

// ---------------- 교실 마피아 ----------------
const ROLE_INFO = {
  mafia: ['🕶️', '마피아', '밤마다 한 명을 골라 탈락시켜요. 들키지 않게 시민인 척!'],
  police: ['🕵️', '경찰', '밤마다 한 명을 조사해 마피아인지 알아내요.'],
  doctor: ['🩺', '의사', '밤마다 한 명을 지켜요. (나도 지킬 수 있어요)'],
  reporter: ['🎤', '기자', '둘째 날부터 낮에 한 번, 한 사람의 직업을 모두에게 공개해요.'],
  politician: ['🎩', '정치인', '투표로 쫓겨날 때 한 번은 살아남아요.'],
  joker: ['🃏', '조커', '투표로 쫓겨나면 혼자 승리! 수상하게 굴어 보세요.'],
  citizen: ['🙂', '시민', '토론과 투표로 마피아를 찾아요.'],
};
function mafiaView() {
  const M = room.mafia || {}; const me_ = cloud.myId();
  const sec = secretDoc && secretDoc.game === 'mafia' && secretDoc.gid === M.gid ? secretDoc : null;
  const aliveIds = M.alive || [], names = M.names || {};
  const iAlive = aliveIds.includes(me_);
  if (!M.phase || M.phase === 'setup' || !sec) {
    return `<div class="waiting"><div class="big">🕶️</div><h2>교실 마피아</h2><p class="lead">${M.phase && M.phase !== 'setup' ? '이번 판에는 참여하지 않아요. 관전해 주세요 👀' : '선생님이 직업을 나눠 줄 때까지 기다려요'}</p></div>`;
  }
  const [e, n, d] = ROLE_INFO[sec.role] || ROLE_INFO.citizen;
  const card = `<button class="rolecard ${showRole ? '' : 'hide'}" id="rc">${showRole
    ? `<div class="re">${e}</div><b>${n}</b><p>${d}</p>${sec.mates?.length ? `<p>🤝 같은 편 마피아: <b style="font-size:1.1rem">${sec.mates.map(esc).join(', ')}</b></p>` : ''}${sec.inv?.length ? `<p>🔎 조사 결과<br>${sec.inv.map(v => `${v.day}일째: ${esc(v.n)} → ${v.m ? '🕶️ 마피아!' : '🙂 마피아 아님'}`).join('<br>')}</p>` : ''}<p style="font-size:.8rem">다시 누르면 가려져요</p>`
    : `<div class="re">🂠</div><b>내 직업 보기</b><p>주변에 보이지 않게 눌러요</p>`}</button>`;
  if (!iAlive && M.phase !== 'end') return `<div class="waiting"><div class="big">👻</div><h2>탈락했어요</h2><p class="lead">말없이 관전해요. 표정 관리!</p></div>${card}`;
  let body = '';
  const others = aliveIds.filter(id => id !== me_);
  if (M.phase === 'roles') body = `<p class="lead">카드를 눌러 직업을 확인하고, 다시 눌러 가려요.</p>`;
  if (M.phase === 'night') {
    const r = M.round, pick = nightPick[r];
    const act = { mafia: ['kill', '🕶️ 오늘 밤 탈락시킬 사람'], doctor: ['save', '🩺 오늘 밤 지켜 줄 사람'], police: ['inv', sec.blackout ? '🔦 정전! 조사할 수 없어요 (아무나 골라 위장해요)' : '🕵️ 조사할 사람'] }[sec.role] || ['memo', '🤔 가장 의심 가는 사람 (메모)'];
    const list = sec.role === 'doctor' ? aliveIds : others;
    const picks = sec.role === 'mafia' && sec.picks && Object.keys(sec.picks).length ? `<p class="lead">🤝 마피아 지목 현황: ${Object.entries(sec.picks).map(([k, v]) => `${esc(k)} ${v}표`).join(', ')}</p>` : '';
    body = `<h2>🌙 ${M.day}일째 밤</h2><p class="lead">${act[1]}</p>${picks}
      <div class="namegrid" id="np">${list.map(id => `<button data-tg="${id}" class="${pick === id ? 'sel' : ''}" style="${pick === id ? 'border-color:var(--brand);background:var(--brand-soft)' : ''}">${esc(names[id] || '?')}${id === me_ ? ' (나)' : ''}</button>`).join('')}</div>
      ${pick ? '<p class="lead">✅ 골랐어요. 바꾸려면 다시 누르세요.</p>' : ''}`;
    nightActKind = act[0];
  }
  if (M.phase === 'day' || M.phase === 'after') {
    body = `<h2>${M.phase === 'day' ? `☀️ ${M.day}일째 아침` : '⚖️ 투표 결과'}</h2><p class="lead" style="font-size:1.15rem;font-weight:700">${esc(M.msg || '')}</p>
      ${M.event && M.phase === 'day' ? `<div class="eventcard"><div class="re">${M.event.e}</div><b>${esc(M.event.t)}</b><p>${esc(M.event.d)}</p></div>` : ''}`;
    if (sec.role === 'reporter' && !sec.used && M.day >= 2) body += `<div class="box"><b>🎤 기자 특종 (한 번만)</b><p class="lead">직업을 공개할 사람을 눌러요</p><div class="namegrid" id="rp">${others.map(id => `<button data-rp="${id}">${esc(names[id])}</button>`).join('')}</div></div>`;
  }
  if (M.phase === 'vote') {
    const r = M.round, mine = votes[r];
    body = `<h2>🗳️ 마피아는 누구?</h2><div class="namegrid" id="mv">${aliveIds.map((id, i) => id === me_ ? '' : `<button data-v="${i}" style="${mine === i ? 'border-color:var(--brand);background:var(--brand-soft)' : ''}">${esc(names[id])}</button>`).join('')}</div>${mine != null ? '<p class="lead">✅ 투표했어요. 바꾸려면 다시 누르세요.</p>' : ''}`;
  }
  if (M.phase === 'end') {
    const rv = M.reveal || {};
    body = `<h2>${esc(M.msg || '게임 끝!')}</h2><div class="namegrid">${Object.keys(names).map(id => `<span class="chip" style="justify-content:center;padding:8px">${(ROLE_INFO[rv[id]] || ROLE_INFO.citizen)[0]} ${esc(names[id])}</span>`).join('')}</div>`;
  }
  return body + card;
}
let nightActKind = 'memo';

// ---------------- 라이어 게임 ----------------
function liarView() {
  const L = room.liar || {};
  const sec = secretDoc && secretDoc.game === 'liar' && secretDoc.gid === L.gid ? secretDoc : null;
  if (!sec) return `<div class="waiting"><div class="big">🤥</div><h2>라이어 게임</h2><p class="lead">${L.gid ? '이번 판에는 참여하지 않아요. 관전해 주세요 👀' : '선생님이 제시어를 나눠 줄 때까지 기다려요'}</p></div>`;
  const card = `<button class="rolecard ${showRole ? '' : 'hide'}" id="rc">${showRole
    ? (sec.word ? `<div class="re">🔑</div><p>카테고리: ${esc(sec.category)}</p><b>${esc(sec.word)}</b><p>제시어를 들키지 않게, 라이어만 모르게 설명해요</p>`
      : `<div class="re">🤥</div><b>당신은 라이어!</b><p>카테고리: <b>${esc(sec.category)}</b></p><p>남들 설명을 듣고 제시어를 눈치채서, 아는 척 설명해요</p>`) + '<p style="font-size:.8rem">다시 누르면 가려져요</p>'
    : `<div class="re">🂠</div><b>내 제시어 보기</b><p>주변에 보이지 않게 눌러요</p>`}</button>`;
  return `<h2>🤥 라이어 게임</h2><p class="lead">${esc(L.msg || '')}</p>${card}
    ${L.phase === 'end' ? `<div class="result">${esc(L.result || '')}</div>` : ''}`;
}

function bind(mode) {
  if (mode === 'mafia' || mode === 'liar') {
    $('#rc')?.addEventListener('click', () => { showRole = !showRole; navigator.vibrate?.(30); render(); });
    const M = room.mafia || {};
    $('#np')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tg]'); if (!b) return;
      nightPick[M.round] = b.dataset.tg; sfx.tick(); render();
      try { await cloud.send(code, 'responses', { round: M.round, act: nightActKind, target: b.dataset.tg }); } catch { toast('전송 실패, 다시 눌러 주세요'); }
    });
    $('#mv')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      votes[M.round] = +b.dataset.v; sfx.ok(); render();
      try { await cloud.send(code, 'responses', { round: M.round, choice: +b.dataset.v, name: me.name, team: me.team }); } catch { toast('전송 실패, 다시 눌러 주세요'); }
    });
    $('#rp')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rp]'); if (!b) return;
      try { await cloud.send(code, 'responses', { round: 'reporter', gid: M.gid, act: 'reveal', target: b.dataset.rp }); toast('🎤 특종을 보냈어요!'); } catch { toast('전송 실패'); }
    });
    return;
  }
  if (mode === 'exit') {
    const t = tickets[room.round];
    $('#ex-edit')?.addEventListener('click', () => { t.editing = true; render(); });
    const form = $('#exf'); if (!form) return;
    form.addEventListener('input', (e) => { const i = e.target.dataset.i; if (i != null) t.d[+i] = e.target.value; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!t.d.some(v => v.trim())) { toast('한 칸 이상 적어 주세요'); return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await cloud.send(code, 'responses', { round: room.round, name: me.name, team: me.team, ticket: { l: t.d.slice(0, 3).map(s => s.trim()), f: t.d.slice(3, 5).map(s => s.trim()), q: t.d[5].trim() } });
        t.sent = true; t.editing = false; sfx.win(); confetti(20); render();
      } catch { btn.disabled = false; toast('전송 실패, 다시 눌러 주세요'); }
    });
  }
  if (mode === 'vote') {
    document.querySelector('.choices')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-c]'); if (!b || b.disabled) return;
      const c = +b.dataset.c, r = room.round;
      votes[r] = c; sfx.ok(); navigator.vibrate?.(40); render();
      try { await cloud.send(code, 'responses', { round: r, choice: c, name: me.name, team: me.team }); }
      catch (err) { toast('전송 실패, 다시 눌러 주세요'); delete votes[r]; render(); }
    });
    if (room.revealed && room.answer >= 0 && votes[room.round] === room.answer && !votes['cf' + room.round]) { votes['cf' + room.round] = 1; confetti(25); sfx.win(); }
  }
  if (mode === 'buzzer') {
    $('#bz')?.addEventListener('click', async () => {
      const r = room.round; if (buzzed[r]) return;
      buzzed[r] = true; sfx.buzz(); navigator.vibrate?.(120); render();
      try { await cloud.send(code, 'buzz', { round: r, name: me.name, team: me.team }); }
      catch { buzzed[r] = false; toast('전송 실패, 다시 눌러 주세요'); render(); }
    });
  }
}
