// 라이브 게이트웨이 — 서버가 접속·후원·랭킹을 시뮬레이션하며 모든 WS 클라이언트에 push.
// 클라이언트 명령(start/stop/happy/greet)도 처리. 라이브 데이터는 세션 인메모리(비영속).
import { load } from './store.js';
import { gradeForCash, fireEvent } from './domain.js';

const DONATE_AMTS = [1000, 3000, 5000, 10000, 30000, 50000];
const pick = arr => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

export class LiveHub {
  constructor() {
    this.clients = new Set();
    this.reset();
  }
  reset() {
    this.on = false; this.startTs = 0; this.db = null;
    this.online = new Map();   // id → {mins}
    this.rank = new Map();      // id → 세션 후원액
    this.feed = []; this.donation = 0;
    this.happy = { on: false, mult: 2, ends: 0 };
    clearInterval(this.timer); this.timer = null;
  }
  elapsed() { return this.on ? Math.floor((Date.now() - this.startTs) / 1000) : 0; }

  addClient(conn) {
    this.clients.add(conn);
    conn.send({ type: 'hello', state: this.snapshot() });
    conn.on('message', raw => { try { this.handleCmd(JSON.parse(raw)); } catch {} });
    conn.on('close', () => this.clients.delete(conn));
  }
  broadcast(obj) { for (const c of this.clients) c.send(obj); }

  handleCmd(m) {
    if (m.cmd === 'start') this.start();
    else if (m.cmd === 'stop') this.stop();
    else if (m.cmd === 'happy') this.happyStart(+m.mult || 2, +m.minutes || 10);
    else if (m.cmd === 'happyEnd') this.happyEnd();
    else if (m.cmd === 'greet') this.greet(m.donatorId);
  }
  // REST 제어(POST /live/*) — WS와 동일 상태를 조작
  handleRest(method, path, body) {
    if (method === 'POST' && path === '/live/start') { this.start(); return { status: 200, data: { started: true } }; }
    if (method === 'POST' && path === '/live/stop') { this.stop(); return { status: 200, data: { stopped: true } }; }
    if (method === 'GET' && path === '/live/state') return { status: 200, data: this.snapshot() };
    if (method === 'POST' && path === '/live/happy-hour') { this.happyStart(+body.mult || 2, +body.minutes || 10); return { status: 200, data: this.snapshot().happy }; }
    if (method === 'DELETE' && path === '/live/happy-hour') { this.happyEnd(); return { status: 200, data: { happy: false } }; }
    if (method === 'POST' && path === '/live/greet') { const ok = this.greet(body.donatorId); return ok ? { status: 200, data: { greeted: body.donatorId } } : { status: 404, data: { error: { code: 'NOT_FOUND', message: 'donator' } } }; }
    return { status: 404, data: { error: { code: 'NOT_FOUND', message: method + ' ' + path } } };
  }

  eligible() { return this.db.donators.filter(d => !d.blocked && gradeForCash(this.db, d.cash)); }

  start() {
    if (this.on) return;
    this.db = load();
    this.on = true; this.startTs = Date.now();
    this.online = new Map(); this.rank = new Map(); this.feed = []; this.donation = 0;
    this.happy = { on: false, mult: 2, ends: 0 };
    this.eligible().sort(() => Math.random() - .5).slice(0, 6).forEach(d => this.online.set(d.id, { mins: 1 + Math.floor(Math.random() * 35) }));
    this.pushFeed('start', null, '방송을 시작했습니다');
    this.timer = setInterval(() => this.tick(), 2800);
    this.broadcast({ type: 'live', on: true, state: this.snapshot() });
  }
  stop() {
    if (!this.on) return;
    clearInterval(this.timer); this.timer = null;
    this.on = false; this.online = new Map(); this.rank = new Map(); this.feed = []; this.donation = 0;
    this.happy = { on: false, mult: 2, ends: 0 };
    this.broadcast({ type: 'live', on: false, state: this.snapshot() });
  }
  happyStart(mult, minutes) {
    if (!this.on) return;
    this.happy = { on: true, mult, ends: this.elapsed() + minutes * 60 };
    this.broadcast({ type: 'happy', happy: this.snapshot().happy });
  }
  happyEnd() {
    if (!this.happy.on) return;
    this.happy = { on: false, mult: 2, ends: 0 };
    this.broadcast({ type: 'happy', happy: { on: false, mult: 2, remain: 0 } });
  }
  greet(id) {
    if (!this.on) return false;
    const d = this.db.donators.find(x => x.id === id); if (!d) return false;
    this.pushFeed('greet', d, null);
    this.broadcast({ type: 'event', event: this.feed[0], state: this.snapshot() });
    return true;
  }

  tick() {
    if (!this.on) return;
    if (this.happy.on && this.elapsed() >= this.happy.ends) this.happyEnd();
    this.online.forEach(v => v.mins++);
    const onlineIds = [...this.online.keys()];
    const offline = this.eligible().filter(d => !this.online.has(d.id));
    const r = Math.random(), hh = this.happy.on;
    let event = null;
    if (this.online.size < 3 && offline.length) event = this.login(offline);
    else if (r < (hh ? 0.3 : 0.45) && offline.length) event = this.login(offline);
    else if (!hh && r < 0.62 && this.online.size > 2) {
      const d = this.db.donators.find(x => x.id === pick(onlineIds));
      this.online.delete(d ? d.id : pick(onlineIds));
      event = this.pushFeed('logout', d, '퇴장했습니다');
    } else if (onlineIds.length) {
      const d = this.db.donators.find(x => x.id === pick(onlineIds));
      if (d) {
        const base = pick(DONATE_AMTS), boost = hh ? this.happy.mult : 1, amt = base * boost;
        this.donation += amt;
        this.rank.set(d.id, (this.rank.get(d.id) || 0) + amt);
        event = this.pushFeed('donate', d, null, amt, boost > 1 ? boost : 0);
        fireEvent(this.db, 'donate', d, amt); // 자동화 발동(인메모리)
      }
    }
    this.broadcast({ type: 'tick', event, state: this.snapshot() });
  }
  login(offline) { const d = pick(offline); if (!d) return null; this.online.set(d.id, { mins: 0 }); return this.pushFeed('login', d, '입장했습니다'); }

  pushFeed(type, d, msg, amt, boost) {
    const g = d ? gradeForCash(this.db, d.cash) : null;
    const e = { type, name: d ? (d.alias || d.name) : '', grade: g ? g.name : '', msg, amt: amt || 0, boost: boost || 0, at: this.elapsed() };
    this.feed.unshift(e); if (this.feed.length > 40) this.feed.pop();
    return e;
  }
  snapshot() {
    const el = this.elapsed();
    const online = [...this.online.entries()].map(([id, v]) => {
      const d = this.db && this.db.donators.find(x => x.id === id); if (!d) return null;
      const g = gradeForCash(this.db, d.cash);
      return { id, name: d.alias || d.name, grade: g ? g.name : '', mins: v.mins };
    }).filter(Boolean).sort((a, b) => b.mins - a.mins);
    const rank = [...this.rank.entries()].map(([id, amt]) => {
      const d = this.db && this.db.donators.find(x => x.id === id); if (!d) return null;
      const g = gradeForCash(this.db, d.cash);
      return { id, name: d.alias || d.name, grade: g ? g.name : '', amount: amt };
    }).filter(Boolean).sort((a, b) => b.amount - a.amount).slice(0, 5);
    return {
      on: this.on, elapsed: el, donation: this.donation, clients: this.clients.size,
      happy: { on: this.happy.on, mult: this.happy.mult, remain: this.happy.on ? Math.max(0, this.happy.ends - el) : 0 },
      online, rank, feed: this.feed.slice(0, 20),
    };
  }
}
