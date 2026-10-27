// 공통 도우미: DOM, 저장, 알림, 효과음, 색종이
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
export const TEAM_COLORS = ['#FF7A2F', '#2F86FF', '#15A773', '#EE4F86', '#6C4CF5', '#D99A00', '#00A3B4', '#8B5E3C'];
export const VOTE_COLORS = ['#FF7A2F', '#2F86FF', '#15A773', '#EE4F86', '#6C4CF5', '#D99A00'];

export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function toast(msg, ms = 2200) {
  const root = $('#toast-root'); if (!root) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  root.appendChild(t); setTimeout(() => t.remove(), ms);
}

export function modal(html, { wide = false, onClose } = {}) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  return { el: bg.firstChild, close };
}

export function confetti(n = 60) {
  const em = ['🎉', '✨', '🎊', '⭐', '💜', '🧡', '💚'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div'); s.className = 'conf';
    s.textContent = em[i % em.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = 1.8 + Math.random() * 2 + 's';
    s.style.animationDelay = Math.random() * .6 + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 4800);
  }
}
export function flash() { const f = document.createElement('div'); f.className = 'flash'; document.body.appendChild(f); setTimeout(() => f.remove(), 900); }

// ---------------- 효과음 (WebAudio, 파일 없음) ----------------
let ctx = null;
let muted = LS.get('co-muted', false);
function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } if (ctx?.state === 'suspended') ctx.resume(); return ctx; }
function tone(freq, dur = .12, type = 'sine', vol = .2, when = 0, slide = 0) {
  if (muted) return; const c = ac(); if (!c) return;
  const t0 = c.currentTime + when; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .02);
}
function noise(dur = .6, vol = .5) {
  if (muted) return; const c = ac(); if (!c) return;
  const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const s = c.createBufferSource(); s.buffer = b; const g = c.createGain(); g.gain.value = vol; s.connect(g).connect(c.destination); s.start();
}
export const sfx = {
  get muted() { return muted; },
  set muted(v) { muted = v; LS.set('co-muted', v); },
  unlock() { ac(); },
  tick() { tone(1200, .04, 'square', .08); },
  ding() { tone(880, .18, 'sine', .25); tone(1320, .3, 'sine', .2, .12); },
  ok() { tone(660, .1, 'triangle', .25); tone(990, .2, 'triangle', .25, .1); },
  bad() { tone(220, .3, 'sawtooth', .15, 0, -80); },
  buzz() { tone(523, .09, 'square', .2); tone(784, .15, 'square', .2, .09); },
  whoosh() { tone(300, .15, 'sine', .12, 0, 500); },
  boom() { noise(.9, .7); tone(90, .6, 'sine', .5, 0, -50); },
  end() { [0, .25, .5].forEach(w => tone(988, .18, 'square', .18, w)); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .22, 'triangle', .22, i * .12)); },
  roll() { tone(400 + Math.random() * 400, .03, 'square', .05); },
};

// 브라우저 confirm/prompt 대신 쓰는 화면 안 확인창 (일부 환경은 기본 대화상자를 막음)
export function ask(msg, { ok = '확인', danger = false } = {}) {
  return new Promise((res) => {
    let done = false;
    const m = modal(`<h3 style="font-size:1.3rem">${esc(msg)}</h3><div class="row" style="justify-content:flex-end"><button class="btn" data-no>취소</button><button class="btn ${danger ? 'bad' : 'primary'}" data-yes>${esc(ok)}</button></div>`, { onClose: () => { if (!done) res(false); } });
    m.el.querySelector('[data-no]').onclick = () => { done = true; m.close(); res(false); };
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); res(true); };
  });
}
export function askText(label, value = '') {
  return new Promise((res) => {
    let done = false;
    const m = modal(`<h3 style="font-size:1.3rem">${esc(label)}</h3><div class="field"><input id="ask-in" value="${esc(value)}" maxlength="12"></div><div class="row" style="justify-content:flex-end"><button class="btn" data-no>취소</button><button class="btn primary" data-yes>저장</button></div>`, { onClose: () => { if (!done) res(null); } });
    const inp = m.el.querySelector('#ask-in'); inp.focus(); inp.select();
    const yes = () => { done = true; const v = inp.value; m.close(); res(v); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') yes(); };
    m.el.querySelector('[data-no]').onclick = () => { done = true; m.close(); res(null); };
    m.el.querySelector('[data-yes]').onclick = yes;
  });
}
