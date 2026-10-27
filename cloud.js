// =============================================================
//  저장·로그인·실시간 참여 계층
//   - CONFIG.firebase 가 있으면: Firebase (Firestore + Auth)
//   - 없으면: 체험 모드 (localStorage + 같은 브라우저 탭 간 BroadcastChannel)
// =============================================================
import { CONFIG } from './config.js';

const FB_VER = '10.12.2';
const FB = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);

let fb = null;          // { app, auth, db, fs, au }
let user = null;        // { uid, name, email, google }
let authListeners = [];

function emitAuth() { authListeners.forEach(f => { try { f(user); } catch (e) { console.error(e); } }); }

export const cloud = {
  get mode() { return fb ? 'firebase' : 'local'; },
  get user() { return user; },
  onAuth(f) { authListeners.push(f); f(user); },

  async init() {
    if (!CONFIG.firebase) {
      user = { uid: localId(), name: '', email: '', google: false };
      emitAuth();
      return;
    }
    try {
      const [appM, authM, fsM] = await Promise.all([import(FB('app')), import(FB('auth')), import(FB('firestore'))]);
      const app = appM.initializeApp(CONFIG.firebase);
      const auth = authM.getAuth(app);
      const db = fsM.getFirestore(app);
      fb = { app, auth, db, fs: fsM, au: authM };
      await new Promise((resolve) => {
        let first = true;
        authM.onAuthStateChanged(auth, async (u) => {
          if (!u) {
            try { await authM.signInAnonymously(auth); } catch (e) { console.warn('익명 로그인 실패', e); if (first) { first = false; resolve(); } }
            return;
          }
          user = { uid: u.uid, name: u.displayName || '', email: u.email || '', google: !u.isAnonymous };
          emitAuth();
          if (first) { first = false; resolve(); }
        });
      });
    } catch (e) {
      console.warn('Firebase 초기화 실패 → 체험 모드로 동작', e);
      fb = null;
      user = { uid: localId(), name: '', email: '', google: false };
      emitAuth();
    }
  },

  async signInGoogle() {
    if (!fb) throw new Error('config.js에 파이어베이스 설정을 먼저 넣어 주세요.');
    const p = new fb.au.GoogleAuthProvider();
    await fb.au.signInWithPopup(fb.auth, p);
  },
  async signOut() { if (fb) await fb.au.signOut(fb.auth); },

  // ---------------- 문제 세트 ----------------
  async listSets(gameId) {
    if (fb && user?.google) {
      const { collection, getDocs, query, where } = fb.fs;
      const q = query(collection(fb.db, 'teachers', user.uid, 'sets'), where('gameId', '==', gameId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.t || 0) - (a.t || 0));
    }
    return ls.get('co-sets', []).filter(s => s.gameId === gameId).sort((a, b) => (b.t || 0) - (a.t || 0));
  },
  async saveSet(gameId, name, lines) {
    const rec = { gameId, name, lines, t: Date.now() };
    if (fb && user?.google) {
      const { collection, addDoc } = fb.fs;
      await addDoc(collection(fb.db, 'teachers', user.uid, 'sets'), rec);
      return 'cloud';
    }
    const all = ls.get('co-sets', []); all.push({ id: rid(), ...rec }); ls.set('co-sets', all);
    return 'local';
  },
  async deleteSet(id) {
    if (fb && user?.google) { const { doc, deleteDoc } = fb.fs; await deleteDoc(doc(fb.db, 'teachers', user.uid, 'sets', id)); return; }
    ls.set('co-sets', ls.get('co-sets', []).filter(s => s.id !== id));
  },

  // ---------------- 학급 명렬 ----------------
  async listRosters() {
    if (fb && user?.google) {
      const { collection, getDocs } = fb.fs;
      const snap = await getDocs(collection(fb.db, 'teachers', user.uid, 'rosters'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
    return ls.get('co-rosters', []).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  },
  async saveRoster(name, names) {
    const id = name.replace(/[\/\s]+/g, '_') || rid();
    const rec = { name, names, t: Date.now() };
    if (fb && user?.google) { const { doc, setDoc } = fb.fs; await setDoc(doc(fb.db, 'teachers', user.uid, 'rosters', id), rec); return id; }
    const all = ls.get('co-rosters', []).filter(r => r.id !== id); all.push({ id, ...rec }); ls.set('co-rosters', all);
    return id;
  },
  async deleteRoster(id) {
    if (fb && user?.google) { const { doc, deleteDoc } = fb.fs; await deleteDoc(doc(fb.db, 'teachers', user.uid, 'rosters', id)); return; }
    ls.set('co-rosters', ls.get('co-rosters', []).filter(r => r.id !== id));
  },

  // ---------------- 실시간: 교사 ----------------
  async createRoom(state) {
    if (fb) {
      const { doc, getDoc, setDoc, serverTimestamp } = fb.fs;
      for (let i = 0; i < 15; i++) {
        const code = String(Math.floor(10000 + Math.random() * 90000));
        const ref = doc(fb.db, 'rooms', code);
        const snap = await getDoc(ref);
        const old = snap.exists() ? snap.data() : null;
        // 이미 쓰는 중인 방이면 다른 번호로 (하루 지난 방은 재사용 가능)
        const stale = old && (!old.updatedAt || (Date.now() - old.updatedAt.toMillis()) > 86400000);
        if (old && !stale && old.owner !== user.uid) continue;
        try {
          await setDoc(ref, { ...state, owner: user.uid, closed: false, updatedAt: serverTimestamp() });
          return code;
        } catch (e) { console.warn(e); if (i > 12) throw e; }
      }
      throw new Error('방 코드를 만들지 못했어요. 다시 시도해 주세요.');
    }
    const code = String(Math.floor(10000 + Math.random() * 90000));
    localHost.open(code, state);
    return code;
  },
  async updateRoom(code, patch) {
    if (fb) { const { doc, updateDoc, serverTimestamp } = fb.fs; await updateDoc(doc(fb.db, 'rooms', code), { ...patch, updatedAt: serverTimestamp() }); return; }
    localHost.patch(patch);
  },
  async closeRoom(code) {
    if (fb) { try { await this.updateRoom(code, { closed: true, mode: 'closed' }); } catch {} return; }
    localHost.patch({ closed: true, mode: 'closed' }); localHost.close();
  },
  // 교사 → 특정 학생에게만 보이는 문서 (역할 카드 등)
  async put(code, sub, id, data) {
    if (fb) { const { doc, setDoc } = fb.fs; await setDoc(doc(fb.db, 'rooms', code, sub, id), data); return; }
    localHost.put(sub, id, data);
  },
  watchSub(code, sub, round, cb) {
    if (fb) {
      const { collection, query, where, onSnapshot } = fb.fs;
      const q = round == null ? collection(fb.db, 'rooms', code, sub) : query(collection(fb.db, 'rooms', code, sub), where('round', '==', round));
      return onSnapshot(q, (snap) => {
        cb(snap.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, at: x.at?.toMillis ? x.at.toMillis() : (x.at || 0) }; }));
      }, (e) => console.warn(sub, e));
    }
    return localHost.watch(sub, round, cb);
  },

  // ---------------- 실시간: 학생 ----------------
  myId() { return fb ? user?.uid : localId(); },
  async roomExists(code) {
    if (fb) { const { doc, getDoc } = fb.fs; const s = await getDoc(doc(fb.db, 'rooms', code)); return s.exists() && !s.data().closed; }
    return localGuest.ping(code);
  },
  watchRoom(code, cb) {
    if (fb) {
      const { doc, onSnapshot } = fb.fs;
      return onSnapshot(doc(fb.db, 'rooms', code), (s) => cb(s.exists() ? s.data() : null), (e) => console.warn(e));
    }
    return localGuest.watch(code, cb);
  },
  watchMine(code, sub, cb) {
    const id = this.myId();
    if (fb) {
      const { doc, onSnapshot } = fb.fs;
      return onSnapshot(doc(fb.db, 'rooms', code, sub, id), (s) => cb(s.exists() ? s.data() : null), (e) => console.warn(e));
    }
    return localGuest.watchPriv(code, sub, id, cb);
  },
  async send(code, sub, data) {
    const id = this.myId();
    if (fb) {
      const { doc, setDoc, serverTimestamp } = fb.fs;
      await setDoc(doc(fb.db, 'rooms', code, sub, id), { ...data, at: serverTimestamp() });
      return;
    }
    localGuest.post(code, { type: 'sub', sub, id, data: { ...data, at: Date.now() } });
  },
};

// =============================================================
//  체험 모드용 BroadcastChannel 구현
// =============================================================
function localId() {
  let id = ss.get('co-uid');
  if (!id) { id = 'u' + rid(10); ss.set('co-uid', id); }
  return id;
}

const localHost = {
  ch: null, code: null, state: null, subs: { responses: {}, buzz: {}, members: {} }, watchers: [], priv: {},
  open(code, state) {
    this.close();
    this.code = code; this.state = { ...state, closed: false };
    this.subs = { responses: {}, buzz: {}, members: {} }; this.priv = {};
    this.ch = new BroadcastChannel('co-room-' + code);
    this.ch.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'hello') { this.broadcast(); Object.entries(this.priv).forEach(([k, data]) => { const [sub, id] = k.split('|'); this.ch?.postMessage({ type: 'priv', sub, id, data }); }); }
      if (m.type === 'sub' && this.subs[m.sub]) {
        this.subs[m.sub][m.id] = m.data;
        this.notify(m.sub);
      }
    };
  },
  put(sub, id, data) { this.priv[sub + '|' + id] = data; this.ch?.postMessage({ type: 'priv', sub, id, data }); },
  patch(p) { if (!this.state) return; Object.assign(this.state, p); this.broadcast(); },
  broadcast() { this.ch?.postMessage({ type: 'state', state: this.state }); },
  close() { try { this.ch?.close(); } catch {} this.ch = null; },
  watch(sub, round, cb) {
    const w = { sub, round, cb };
    this.watchers.push(w);
    this.emit(w);
    return () => { this.watchers = this.watchers.filter(x => x !== w); };
  },
  notify(sub) { this.watchers.filter(w => w.sub === sub).forEach(w => this.emit(w)); },
  emit(w) {
    const list = Object.entries(this.subs[w.sub] || {}).map(([id, d]) => ({ id, ...d }))
      .filter(d => w.round == null || d.round === w.round);
    w.cb(list);
  },
};

const localGuest = {
  chs: {},
  chan(code) { return this.chs[code] || (this.chs[code] = new BroadcastChannel('co-room-' + code)); },
  ping(code) {
    return new Promise((res) => {
      const ch = this.chan(code);
      const t = setTimeout(() => { ch.removeEventListener('message', on); res(false); }, 800);
      const on = (ev) => { if (ev.data?.type === 'state' && !ev.data.state?.closed) { clearTimeout(t); ch.removeEventListener('message', on); res(true); } };
      ch.addEventListener('message', on);
      ch.postMessage({ type: 'hello' });
    });
  },
  watch(code, cb) {
    const ch = this.chan(code);
    const on = (ev) => { if (ev.data?.type === 'state') cb(ev.data.state); };
    ch.addEventListener('message', on);
    ch.postMessage({ type: 'hello' });
    return () => ch.removeEventListener('message', on);
  },
  post(code, m) { this.chan(code).postMessage(m); },
  watchPriv(code, sub, id, cb) {
    const ch = this.chan(code);
    const on = (ev) => { const m = ev.data; if (m?.type === 'priv' && m.sub === sub && m.id === id) cb(m.data); };
    ch.addEventListener('message', on);
    ch.postMessage({ type: 'hello' });
    return () => ch.removeEventListener('message', on);
  },
};
