// 라우트 테이블 + 디스패처. 각 핸들러는 (DB, params, query, body) → {status, data, mut?}.
import { load, save, reset, uid } from './store.js';
import * as D from './domain.js';

const err = (status, code, message) => ({ status, data:{ error:{ code, message } } });
function paginate(arr, query) {
  const page=+query.page||1, limit=+query.limit||20, start=(page-1)*limit;
  return { data:arr.slice(start,start+limit), meta:{ page, limit, total:arr.length } };
}
function notify(DB, id, b, kind, flag) {
  const d = DB.donators.find(x=>x.id===id); if(!d) return err(404,'NOT_FOUND','donator');
  if (flag==='nudged') d.nudged=true; if (flag==='celebrated') d.celebrated=true;
  return { status:200, mut:1, data:{ sent:true, channel:'kakao_alimtalk', type:kind, to:d.alias||d.name, message:D.renderMsgRaw(DB,b.message||'',d), at:D.nowClock() } };
}

const ROUTES = [
  // grades
  ['GET','/grades',(DB)=>({status:200,data:[...DB.grades].sort((a,b)=>b.min-a.min).map(g=>({...g,count:DB.donators.filter(d=>{const x=D.gradeForCash(DB,d.cash);return x&&x.id===g.id;}).length}))})],
  ['POST','/grades',(DB,p,q,b)=>{ if(!b.name) return err(400,'VALIDATION_ERROR','name required'); const g={id:uid(),name:b.name,cls:b.cls||'custom',color:b.color||'#5b8cff',mode:b.mode||'range',min:+b.min||0,max:+b.max||0}; DB.grades.push(g); return {status:201,data:g,mut:1}; }],
  ['GET','/grades/:id',(DB,p)=>{ const g=DB.grades.find(x=>x.id===p.id); return g?{status:200,data:g}:err(404,'NOT_FOUND','grade'); }],
  ['PUT','/grades/:id',(DB,p,q,b)=>{ const g=DB.grades.find(x=>x.id===p.id); if(!g) return err(404,'NOT_FOUND','grade'); Object.assign(g,{name:b.name??g.name,color:b.color??g.color,mode:b.mode??g.mode,min:b.min!=null?+b.min:g.min,max:b.max!=null?+b.max:g.max}); return {status:200,data:g,mut:1}; }],
  ['DELETE','/grades/:id',(DB,p)=>{ const n=DB.grades.length; DB.grades=DB.grades.filter(x=>x.id!==p.id); return n===DB.grades.length?err(404,'NOT_FOUND','grade'):{status:200,data:{deleted:p.id},mut:1}; }],
  // donators (literal routes before :id)
  ['POST','/donators/bulk',(DB,p,q,b)=>{ const ids=b.ids||[]; let n=0; DB.donators.forEach(d=>{ if(!ids.includes(d.id))return; n++;
    if(b.action==='tag'&&b.tag){ d.tags=d.tags||[]; if(!d.tags.includes(b.tag))d.tags.push(b.tag); }
    if(b.action==='block'){ d.blocked=true; d.blockedAt=D.nowClock().slice(0,5); }
    if(b.action==='unblock'){ d.blocked=false; delete d.blockReason; delete d.blockedAt; } });
    return {status:200,data:{affected:n,action:b.action},mut:1}; }],
  ['GET','/donators',(DB,p,q)=>{ let rows=DB.donators.slice(); const st=q.status||'active';
    if(st==='active')rows=rows.filter(d=>!d.blocked); else if(st==='blocked')rows=rows.filter(d=>d.blocked);
    if(q.grade)rows=rows.filter(d=>{const g=D.gradeForCash(DB,d.cash);return g&&g.id===q.grade;});
    if(q.q){const s=(q.q+'').toLowerCase();rows=rows.filter(d=>d.name.toLowerCase().includes(s)||(d.alias||'').toLowerCase().includes(s)||(d.tags||[]).some(t=>t.toLowerCase().includes(s))||(d.memo||'').toLowerCase().includes(s));}
    const col=q.sort==='count'?'count':'cash', ord=q.order==='asc'?1:-1; rows.sort((a,b)=>ord*((a[col]||0)-(b[col]||0)));
    return {status:200,data:paginate(rows.map(d=>D.donatorDTO(DB,d,false)),q)}; }],
  ['GET','/donators/:id/titles',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); return {status:200,data:D.donatorTitles(DB,d).map(t=>({id:t.id,name:t.name,icon:t.icon,rule:t.rule,manual:t.rule.type==='manual'}))}; }],
  ['POST','/donators/:id/awards/:titleId',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); d.awards=d.awards||[]; if(!d.awards.includes(p.titleId))d.awards.push(p.titleId); return {status:200,data:{awards:d.awards},mut:1}; }],
  ['DELETE','/donators/:id/awards/:titleId',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); d.awards=(d.awards||[]).filter(a=>a!==p.titleId); return {status:200,data:{awards:d.awards},mut:1}; }],
  ['POST','/donators/:id/tags',(DB,p,q,b)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); if(!b.tag) return err(400,'VALIDATION_ERROR','tag required'); d.tags=d.tags||[]; if(!d.tags.includes(b.tag))d.tags.push(b.tag); return {status:200,data:{tags:d.tags},mut:1}; }],
  ['DELETE','/donators/:id/tags/:tag',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); d.tags=(d.tags||[]).filter(t=>t!==p.tag); return {status:200,data:{tags:d.tags},mut:1}; }],
  ['POST','/donators/:id/block',(DB,p,q,b)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); d.blocked=true; d.blockReason=b.reason||''; d.blockedAt=D.nowClock().slice(0,5); return {status:200,data:D.donatorDTO(DB,d,true),mut:1}; }],
  ['POST','/donators/:id/unblock',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); d.blocked=false; delete d.blockReason; delete d.blockedAt; return {status:200,data:D.donatorDTO(DB,d,true),mut:1}; }],
  ['POST','/donators/:id/nudge',(DB,p,q,b)=>notify(DB,p.id,b,'nudge','nudged')],
  ['POST','/donators/:id/reengage',(DB,p,q,b)=>notify(DB,p.id,b,'reengage')],
  ['POST','/donators/:id/celebrate',(DB,p,q,b)=>notify(DB,p.id,b,'celebrate','celebrated')],
  ['GET','/donators/:id',(DB,p)=>{ const d=DB.donators.find(x=>x.id===p.id); return d?{status:200,data:D.donatorDTO(DB,d,true)}:err(404,'NOT_FOUND','donator'); }],
  ['PATCH','/donators/:id',(DB,p,q,b)=>{ const d=DB.donators.find(x=>x.id===p.id); if(!d) return err(404,'NOT_FOUND','donator'); if(b.alias!=null)d.alias=b.alias; if(b.memo!=null)d.memo=b.memo; return {status:200,data:D.donatorDTO(DB,d,true),mut:1}; }],
  // titles
  ['GET','/titles',(DB)=>({status:200,data:DB.titles.map(t=>({...t,holders:DB.donators.filter(d=>D.titleMatch(DB,t,d)).length}))})],
  ['POST','/titles',(DB,p,q,b)=>{ if(!b.name||!b.rule) return err(400,'VALIDATION_ERROR','name, rule required'); const t={id:uid(),name:b.name,icon:b.icon||'🏅',color:b.color||'#ffcb45',rule:b.rule}; DB.titles.push(t); return {status:201,data:t,mut:1}; }],
  ['GET','/titles/:id/holders',(DB,p)=>{ const t=DB.titles.find(x=>x.id===p.id); if(!t) return err(404,'NOT_FOUND','title'); return {status:200,data:DB.donators.filter(d=>D.titleMatch(DB,t,d)).map(d=>D.donatorDTO(DB,d,false))}; }],
  ['PUT','/titles/:id',(DB,p,q,b)=>{ const t=DB.titles.find(x=>x.id===p.id); if(!t) return err(404,'NOT_FOUND','title'); Object.assign(t,{name:b.name??t.name,icon:b.icon??t.icon,color:b.color??t.color,rule:b.rule??t.rule}); return {status:200,data:t,mut:1}; }],
  ['DELETE','/titles/:id',(DB,p)=>{ const n=DB.titles.length; DB.titles=DB.titles.filter(x=>x.id!==p.id); DB.donators.forEach(d=>{d.awards=(d.awards||[]).filter(a=>a!==p.id);}); return n===DB.titles.length?err(404,'NOT_FOUND','title'):{status:200,data:{deleted:p.id},mut:1}; }],
  // automations
  ['GET','/automations/templates',()=>({status:200,data:D.AUTO_TEMPLATES})],
  ['GET','/automations',(DB)=>({status:200,data:DB.autos})],
  ['POST','/automations',(DB,p,q,b)=>{ const a={id:uid(),on:true,...b}; DB.autos.push(a); return {status:201,data:a,mut:1}; }],
  ['POST','/automations/:id/test',(DB,p)=>{ const a=DB.autos.find(x=>x.id===p.id); if(!a) return err(404,'NOT_FOUND','automation'); const d=DB.donators.slice().sort((x,y)=>y.cash-x.cash)[0]; return {status:200,data:{tested:true,situ:a.situ,sampleDonator:D.donatorDTO(DB,d,false),actions:(a.actions||[]).map(ac=>({type:ac.type,rendered:D.renderMsg(DB,ac,d)}))}}; }],
  ['GET','/automations/:id',(DB,p)=>{ const a=DB.autos.find(x=>x.id===p.id); return a?{status:200,data:a}:err(404,'NOT_FOUND','automation'); }],
  ['PUT','/automations/:id',(DB,p,q,b)=>{ const i=DB.autos.findIndex(x=>x.id===p.id); if(i<0) return err(404,'NOT_FOUND','automation'); DB.autos[i]={...DB.autos[i],...b,id:p.id}; return {status:200,data:DB.autos[i],mut:1}; }],
  ['PATCH','/automations/:id',(DB,p,q,b)=>{ const a=DB.autos.find(x=>x.id===p.id); if(!a) return err(404,'NOT_FOUND','automation'); if(b.on!=null)a.on=!!b.on; return {status:200,data:a,mut:1}; }],
  ['DELETE','/automations/:id',(DB,p)=>{ const n=DB.autos.length; DB.autos=DB.autos.filter(x=>x.id!==p.id); return n===DB.autos.length?err(404,'NOT_FOUND','automation'):{status:200,data:{deleted:p.id},mut:1}; }],
  // logs
  ['GET','/automation-logs',(DB,p,q)=>({status:200,data:DB.autoLogs.slice(0,+q.limit||50)})],
  ['DELETE','/automation-logs',(DB)=>{ DB.autoLogs=[]; return {status:200,data:{cleared:true},mut:1}; }],
  // insights
  ['GET','/insights/summary',(DB)=>{ const tr=D.monthlyTrend(DB),tm=tr[5],lm=tr[4]||tm; return {status:200,data:{totalCash:D.totalCash(DB),activeVip:DB.donators.filter(d=>D.gradeForCash(DB,d.cash)).length,thisMonth:tm,trendDeltaPct:lm?Math.round((tm-lm)/lm*100):0,churnCount:D.churn(DB,30).length}}; }],
  ['GET','/insights/trend',(DB,p,q)=>{ const n=+q.months||6; return {status:200,data:{labels:D.monthLabels(DB,n),values:D.monthlyTrend(DB).slice(-n)}}; }],
  ['GET','/insights/grade-distribution',(DB)=>{ const map={};let tot=0; DB.donators.forEach(d=>{const g=D.gradeForCash(DB,d.cash);const k=g?g.id:'none';map[k]=(map[k]||0)+d.cash;tot+=d.cash;}); return {status:200,data:{total:tot,rows:DB.grades.map(g=>({id:g.id,name:g.name,color:g.color,amount:map[g.id]||0,pct:Math.round((map[g.id]||0)/(tot||1)*100)})).filter(r=>r.amount>0)}}; }],
  ['GET','/insights/pareto',(DB)=>{ const s=DB.donators.slice().sort((a,b)=>b.cash-a.cash);const tot=D.totalCash(DB)||1;const n20=Math.max(1,Math.round(s.length*0.2));const sum20=s.slice(0,n20).reduce((x,d)=>x+d.cash,0); return {status:200,data:{topCount:n20,topContributionPct:Math.round(sum20/tot*100),top5:s.slice(0,5).map(d=>({...D.donatorDTO(DB,d,false),sharePct:Math.round(d.cash/tot*100)}))}}; }],
  ['GET','/insights/churn',(DB,p,q)=>({status:200,data:D.churn(DB,+q.days||30)})],
  ['GET','/insights/upgrade-candidates',(DB,p,q)=>({status:200,data:D.upgradeCandidates(DB,+q.within||50000)})],
  ['GET','/insights/anniversaries',(DB,p,q)=>({status:200,data:D.anniversaries(DB,+q.within||30)})],
  // settings
  ['GET','/settings',(DB)=>({status:200,data:{annivAuto:!!DB.annivAuto}})],
  ['PUT','/settings',(DB,p,q,b)=>{ if(b.annivAuto!=null)DB.annivAuto=!!b.annivAuto; return {status:200,data:{annivAuto:!!DB.annivAuto},mut:1}; }],
  // schedules
  ['GET','/schedules',(DB,p,q)=>{ let rows=DB.schedules.map(D.schedDTO); if(q.status)rows=rows.filter(s=>s.status===q.status); rows.sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)); return {status:200,data:{data:rows,next:D.nextSched(DB)?D.schedDTO(D.nextSched(DB)):null}}; }],
  ['POST','/schedules',(DB,p,q,b)=>{ if(!b.title||!b.date)return err(400,'VALIDATION_ERROR','title, date required');
    const base={id:uid(),title:b.title,date:b.date,start:b.start||'',end:b.end||'',category:b.category||'기타',repeat:b.repeat||'none',days:b.days||[],visible:b.visible!==false,notify:b.notify!==false,memo:b.memo||'',reminded:false};
    DB.schedules.push(base); const made=[base];
    if(base.repeat==='weekly'){ const d0=new Date(base.date); for(let w=1;w<=7;w++){const nd=new Date(d0.getFullYear(),d0.getMonth(),d0.getDate()+w*7);const z=n=>String(n).padStart(2,'0');const occ={...base,id:uid(),date:`${nd.getFullYear()}-${z(nd.getMonth()+1)}-${z(nd.getDate())}`,repeatGroup:base.id};DB.schedules.push(occ);made.push(occ);} }
    return {status:201,data:{created:made.length,schedule:D.schedDTO(base)},mut:1}; }],
  ['PUT','/schedules/:id',(DB,p,q,b)=>{ const s=DB.schedules.find(x=>x.id===p.id); if(!s)return err(404,'NOT_FOUND','schedule'); Object.assign(s,b,{id:p.id}); return {status:200,data:D.schedDTO(s),mut:1}; }],
  ['DELETE','/schedules/:id',(DB,p)=>{ const n=DB.schedules.length; DB.schedules=DB.schedules.filter(x=>x.id!==p.id); return n===DB.schedules.length?err(404,'NOT_FOUND','schedule'):{status:200,data:{deleted:p.id},mut:1}; }],
  ['POST','/schedules/:id/remind',(DB,p)=>{ const s=DB.schedules.find(x=>x.id===p.id); if(!s)return err(404,'NOT_FOUND','schedule');
    const recipients=DB.donators.filter(d=>!d.blocked&&D.gradeForCash(DB,d.cash)).length; s.reminded=true;
    return {status:200,data:{sent:true,channel:'kakao_alimtalk',recipients,schedule:s.title},mut:1}; }],
  // broadcasts
  ['POST','/broadcasts/start',(DB)=>{ const r=D.fireBroadcastStart(DB); return {status:200,data:{started:true,...r,next:D.nextSched(DB)?D.schedDTO(D.nextSched(DB)):null},mut:1}; }],
  ['POST','/broadcasts/prestart',(DB)=>{ const r=D.firePrestart(DB); return {status:200,data:{...r},mut:1}; }],
  // admin
  ['POST','/admin/reset',()=>{ reset(); return {status:200,data:{reset:true}}; }],
  // webhooks
  ['POST','/webhooks/donation',(DB,p,q,b)=>{
    if(!b.amount) return err(400,'VALIDATION_ERROR','amount required');
    let d = b.donatorId ? DB.donators.find(x=>x.id===b.donatorId) : DB.donators.find(x=>x.name===b.name||x.alias===b.name);
    let isFirst=false;
    if(!d){ d={id:uid(),name:b.name||'익명',alias:'',cash:0,count:0,tags:[],awards:[],blocked:false,join:D.nowClock().slice(0,5),last:'2024-10-31',types:[b.type||'text'],history:[]}; DB.donators.push(d); isFirst=true; }
    const before=D.gradeForCash(DB,d.cash);
    d.cash+=(+b.amount); d.count=(d.count||0)+1;
    (d.history=d.history||[]).unshift({time:D.nowClock(),kind:b.type||'텍스트',amt:+b.amount,msg:b.message||''});
    const after=D.gradeForCash(DB,d.cash); const gradeChanged=(before?before.id:null)!==(after?after.id:null);
    const fired=[...D.fireEvent(DB,'donate',d,+b.amount)];
    if(isFirst)fired.push(...D.fireEvent(DB,'first',d,+b.amount));
    if(gradeChanged)fired.push(...D.fireEvent(DB,'promote',d,+b.amount));
    return {status:200,data:{donator:D.donatorDTO(DB,d,false),gradeChanged,firstDonation:isFirst,firedAutomations:fired},mut:1}; }],
  ['POST','/webhooks/login',(DB,p,q,b)=>{ const d=b.donatorId?DB.donators.find(x=>x.id===b.donatorId):DB.donators.find(x=>x.name===b.name); if(!d) return err(404,'NOT_FOUND','donator'); return {status:200,data:{online:true,firedAutomations:D.fireEvent(DB,'login',d,0)},mut:1}; }],
];

function matchRoute(tmpl, path) {
  const t=tmpl.split('/').filter(Boolean), p=path.split('/').filter(Boolean);
  if(t.length!==p.length) return null; const params={};
  for(let i=0;i<t.length;i++){ if(t[i][0]===':')params[t[i].slice(1)]=decodeURIComponent(p[i]); else if(t[i]!==p[i]) return null; }
  return params;
}
// 디스패처 — 메서드+경로 매칭 → 핸들러 실행 → 변경 시 저장.
export function dispatch(method, path, query, body) {
  const DB = load();
  for (const [m, tmpl, fn] of ROUTES) {
    if (m!==method) continue;
    const params = matchRoute(tmpl, path); if(!params) continue;
    const res = fn(DB, params, query||{}, body||{});
    if (res.mut) save(DB);
    return { status:res.status, data:res.data };
  }
  return { status:404, data:{ error:{ code:'NOT_FOUND', message:`${method} ${path} — 라우트 없음` } } };
}
export { ROUTES };
