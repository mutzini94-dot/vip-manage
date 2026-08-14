// 도메인 로직 — 등급 분류, 승급 게이지, 칭호 규칙, 인사이트 집계, 자동화 엔진.
// 모든 함수는 DB 객체를 인자로 받는 순수 함수(automation 로그 적재 제외).

export function gradeForCash(DB, cash) {
  const gs = [...DB.grades].sort((a,b)=>b.min-a.min);
  for (const g of gs) {
    if (g.mode==='over') { if (cash>=g.min) return g; }
    else { if (cash>=g.min && (g.max<=0 || cash<=g.max)) return g; }
  }
  return null;
}
export function nextGrade(DB, cash) {
  const gs = [...DB.grades].sort((a,b)=>a.min-b.min);
  for (const g of gs) if (g.min>cash) return g;
  return null;
}
export function gaugeData(DB, d) {
  const cur = gradeForCash(DB, d.cash), nx = nextGrade(DB, d.cash);
  if (!nx) return { top:true, cur: cur?{id:cur.id,name:cur.name}:null };
  const bs = cur?cur.min:0, span = (nx.min-bs)||1;
  const pct = Math.max(3, Math.min(100, Math.round((d.cash-bs)/span*100)));
  return { top:false, next:{id:nx.id,name:nx.name}, remaining:Math.max(0,nx.min-d.cash), pct };
}
const maxSingle = d => Math.max(0, ...(d.history||[]).map(h=>h.amt||0));
export function titleMatch(DB, t, d) {
  const r = t.rule;
  if (r.type==='cumulative') return d.cash>=r.n;
  if (r.type==='count')      return (d.count||0)>=r.n;
  if (r.type==='single')     return maxSingle(d)>=r.n;
  if (r.type==='grade')      { const g=gradeForCash(DB,d.cash); return !!(g&&g.id===r.grade); }
  if (r.type==='manual')     return (d.awards||[]).includes(t.id);
  return false;
}
export const donatorTitles = (DB,d) => DB.titles.filter(t=>titleMatch(DB,t,d));
const gradeDTO = g => g?{id:g.id,name:g.name}:null;
export function donatorDTO(DB, d, full) {
  const g = gradeForCash(DB, d.cash);
  const base = { id:d.id, name:d.name, alias:d.alias||'', cash:d.cash, count:d.count,
    grade:gradeDTO(g), tags:d.tags||[], blocked:!!d.blocked };
  if (!full) return base;
  return { ...base, memo:d.memo||'', awards:d.awards||[], blockReason:d.blockReason||null, blockedAt:d.blockedAt||null,
    join:d.join, last:d.last, types:d.types||[], nudged:!!d.nudged, celebrated:!!d.celebrated,
    reengaged:!!d.reengaged, reengagedAt:d.reengagedAt||null,
    gauge:gaugeData(DB,d), titles:donatorTitles(DB,d).map(t=>({id:t.id,name:t.name,icon:t.icon})),
    history:d.history||[] };
}

/* ---------- 인사이트 ---------- */
const parseD = s => { const p=(s||'2024-01-01').split('-').map(Number); return new Date(p[0],(p[1]||1)-1,p[2]||1).getTime(); };
export function refNow(DB) { let mx=0; DB.donators.forEach(d=>{ const t=parseD(d.last); if(t>mx)mx=t; }); return mx||parseD('2024-12-01'); }
const daysAgo = (DB,d) => Math.max(0, Math.round((refNow(DB)-parseD(d.last))/864e5));
export const totalCash = DB => DB.donators.reduce((s,d)=>s+d.cash,0);
export const monthlyTrend = DB => { const rec=Math.round(totalCash(DB)*0.42); return [.12,.14,.15,.16,.19,.24].map(p=>Math.round(rec*p/1000)*1000); };
export function monthLabels(DB, n) { const b=new Date(refNow(DB)), o=[]; for(let i=n-1;i>=0;i--){ const dt=new Date(b.getFullYear(),b.getMonth()-i,1); o.push((dt.getMonth()+1)+'월'); } return o; }
export function churn(DB, days) {
  return DB.donators.map(d=>({d,dorm:daysAgo(DB,d),g:gradeForCash(DB,d.cash)}))
    .filter(x=>x.g && !x.d.blocked && x.dorm>=days)
    .sort((a,b)=>(b.d.cash-a.d.cash)||(b.dorm-a.dorm))
    .map(x=>({ ...donatorDTO(DB,x.d,false), dormantDays:x.dorm }));
}
export function upgradeCandidates(DB, within) {
  return DB.donators.filter(d=>!d.blocked).map(d=>({d,g:gaugeData(DB,d)}))
    .filter(x=>!x.g.top && x.g.remaining<=within)
    .sort((a,b)=>a.g.remaining-b.g.remaining)
    .map(x=>({ ...donatorDTO(DB,x.d,false), gauge:x.g }));
}
export function annivInfo(DB, d) {
  const p=(d.join||'2024-01-01').split('-').map(Number); const now=new Date(refNow(DB));
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let nx=new Date(now.getFullYear(),p[1]-1,p[2]); if(nx<today) nx=new Date(now.getFullYear()+1,p[1]-1,p[2]);
  return { days:Math.round((nx-today)/864e5), years:nx.getFullYear()-p[0] };
}
export function anniversaries(DB, within) {
  return DB.donators.filter(d=>!d.blocked).map(d=>({d,...annivInfo(DB,d)}))
    .filter(x=>x.days<=within && x.years>=1).sort((a,b)=>a.days-b.days)
    .map(x=>({ ...donatorDTO(DB,x.d,false), anniversaryInDays:x.days, years:x.years }));
}

/* ---------- 자동화 엔진 ---------- */
export function targetHit(DB, a, d) {
  if (a.targetMode==='class') { const g=gradeForCash(DB,d.cash); return !!(g&&(a.classes||[]).includes(g.id)); }
  if (a.targetMode==='pick')  return (a.picks||[]).includes(d.id);
  return false;
}
export const amtHit = (a,amt) => { const m=a.amt||{}; return m.mode==='over'?amt>=m.min:(amt>=m.min&&amt<=m.max); };
export function scheduleOk(a) {
  const sc=a.schedule; if(!sc||!sc.on) return true; const dt=new Date();
  if ((sc.days||[]).length && !sc.days.includes(dt.getDay())) return false;
  if (sc.start&&sc.end) { const c=dt.getHours()*60+dt.getMinutes();
    const [sh,sm]=sc.start.split(':').map(Number), [eh,em]=sc.end.split(':').map(Number);
    const a0=sh*60+sm, a1=eh*60+em; if(a0<=a1){ if(c<a0||c>a1) return false; } else { if(c<a0&&c>a1) return false; } }
  return true;
}
export const nowClock = () => { const d=new Date(); const z=n=>String(n).padStart(2,'0'); return `${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
const NO_AMT = ['login','prestart','promote','anniv'];
// 이벤트 발생 → 매칭되는 자동화 발동, DB.autoLogs 에 적재, 발동 목록 반환
export function fireEvent(DB, kind, d, amt) {
  if (d.blocked) return [];
  const fired = [];
  DB.autos.filter(a=>a.on && scheduleOk(a)).forEach(a=>{
    let m=false;
    if (a.situ==='login'  && kind==='login')  m=targetHit(DB,a,d);
    else if (a.situ==='prestart' && kind==='prestart') m=targetHit(DB,a,d);
    else if (a.situ==='first'   && kind==='first')   m=true;
    else if (a.situ==='donate'  && kind==='donate')  m=targetHit(DB,a,d);
    else if (a.situ==='amount'  && kind==='donate')  m=amtHit(a,amt);
    else if (a.situ==='promote' && kind==='promote') m=targetHit(DB,a,d);
    if (m) {
      const g=gradeForCash(DB,d.cash);
      (a.actions||[]).forEach(ac=>DB.autoLogs.unshift({ when:nowClock(), situ:a.situ, name:d.alias||d.name, grade:g?g.name:'', action:ac.type, amt:NO_AMT.includes(a.situ)?0:amt }));
      fired.push({ id:a.id, situ:a.situ, actions:(a.actions||[]).map(x=>x.type) });
    }
  });
  while (DB.autoLogs.length>200) DB.autoLogs.pop();
  return fired;
}
export function renderMsgRaw(DB, msg, d) {
  const g=gradeForCash(DB,d.cash), gg=gaugeData(DB,d);
  return (msg||'')
    .replace(/{크리에이터}/g,'크리에이터').replace(/{닉네임}/g,d.alias||d.name)
    .replace(/{등급}/g,g?g.name:'VIP').replace(/{주년}/g,String(annivInfo(DB,d).years))
    .replace(/{남은금액}/g, gg.top?'0':String(gg.remaining)).replace(/{다음등급}/g, gg.top?'최고등급':gg.next.name);
}
export function renderMsg(DB, ac, d) {
  if (ac.type==='kakao_send') return renderMsgRaw(DB, ac.cfg&&ac.cfg.msg||'', d);
  if (ac.type==='widget') return '위젯 효과: '+(ac.cfg&&ac.cfg.widget||'');
  if (ac.type==='tts')    return 'TTS 보이스: '+(ac.cfg&&ac.cfg.voice||'');
  return ac.type;
}
/* ---------- 방송 스케줄 ---------- */
const SCHED_ICON = {'게임':'🎮','토크':'💬','먹방':'🍜','음악':'🎵','콘텐츠':'🎬','기타':'✨'};
function schedStart(s){ return new Date(`${s.date}T${s.start||'00:00'}`); }
function schedEndT(s){ return s.end ? new Date(`${s.date}T${s.end}`) : new Date(schedStart(s).getTime()+2*3600000); }
export function schedStatus(s){
  if (s.status==='cancelled') return 'cancelled';
  const now=Date.now(), st=schedStart(s).getTime(), en=schedEndT(s).getTime();
  if (now>=st && now<en) return 'live'; if (now>=en) return 'done'; return 'upcoming';
}
export function schedDTO(s){ return { ...s, status: schedStatus(s), icon: SCHED_ICON[s.category]||'✨' }; }
export function nextSched(DB){ return DB.schedules.filter(s=>schedStatus(s)!=='done'&&s.status!=='cancelled').sort((a,b)=>schedStart(a)-schedStart(b))[0]||null; }
const icsEsc = s => (s||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
export function toICS(schedules){
  const z=n=>String(n).padStart(2,'0');
  const dt=(date,time)=>{const[y,m,d]=date.split('-');const[hh,mm]=(time||'00:00').split(':');return `${y}${z(m)}${z(d)}T${z(hh)}${z(mm)}00`;};
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//투네이션//VIP 도네이터 관리//KR','CALSCALE:GREGORIAN','X-WR-CALNAME:방송 스케줄'];
  schedules.filter(s=>s.status!=='cancelled').forEach(s=>{
    L.push('BEGIN:VEVENT',`UID:${s.id}@toonation`,`DTSTART:${dt(s.date,s.start)}`,`DTEND:${dt(s.date,s.end||s.start||'23:59')}`,
      `SUMMARY:${icsEsc((SCHED_ICON[s.category]||'')+' '+s.title)}`,`CATEGORIES:${s.category}`);
    if(s.memo)L.push(`DESCRIPTION:${icsEsc(s.memo)}`);
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
// 방송 시작 → login 트리거 자동화 발동
export function fireBroadcastStart(DB){
  const before=DB.autoLogs.length;
  const logins=DB.autos.filter(a=>a.on && a.situ==='login' && scheduleOk(a));
  const fired=[];
  DB.donators.forEach(d=>{ if(d.blocked)return;
    logins.forEach(a=>{ if(!targetHit(DB,a,d))return; const g=gradeForCash(DB,d.cash);
      (a.actions||[]).forEach(ac=>DB.autoLogs.unshift({when:nowClock(),situ:'login',name:d.alias||d.name,grade:g?g.name:'',action:ac.type,amt:0}));
      fired.push({automationId:a.id,donator:d.alias||d.name}); });
  });
  while(DB.autoLogs.length>200)DB.autoLogs.pop();
  return { firedCount: DB.autoLogs.length-before, matches: fired.length };
}
// 방송 예정(사전) 알림 자동화 발동 (ON인 것만)
export function firePrestart(DB){
  const before=DB.autoLogs.length;
  const pres=DB.autos.filter(a=>a.on && a.situ==='prestart' && scheduleOk(a));
  DB.donators.forEach(d=>{ if(d.blocked)return;
    pres.forEach(a=>{ if(!targetHit(DB,a,d))return; const g=gradeForCash(DB,d.cash);
      (a.actions||[]).forEach(ac=>DB.autoLogs.unshift({when:nowClock(),situ:'prestart',name:d.alias||d.name,grade:g?g.name:'',action:ac.type,amt:0})); });
  });
  while(DB.autoLogs.length>200)DB.autoLogs.pop();
  return { firedCount: DB.autoLogs.length-before, active: pres.length };
}
export const AUTO_TEMPLATES = [
  { key:'vvip_live',   title:'VVIP 방송 시작 알림', situ:'login',   actions:['kakao_send'] },
  { key:'welcome',     title:'신규 팬 환영 패키지', situ:'first',   actions:['widget','kakao_send'] },
  { key:'bighand',     title:'큰손 축포',          situ:'amount',  actions:['widget','tts'] },
  { key:'vvip_remote', title:'VVIP 후원 즉시 알림', situ:'donate',  actions:['remote','kakao_recv'] },
  { key:'promote',     title:'등급 승급 축하',     situ:'promote', actions:['widget','kakao_send'] },
  { key:'anniv',       title:'가입 기념일 축하',   situ:'anniv',   actions:['kakao_send','widget'] },
];
