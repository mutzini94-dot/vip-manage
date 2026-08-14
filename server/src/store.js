// 데이터 저장소 — 프론트엔드와 동일한 스키마. data.json 파일에 영속화.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
export const uid = () => 'id' + Math.random().toString(36).slice(2, 9);

const KO_NAMES = ['톰하디','모아이','순정남','달빛여우','치킨마요','코딩하는곰','별헤는밤','라면요정','무지개송어','밤샘전사','고구마맛탕','파스텔','겨울나그네','핑크덤보','왕눈이','초코나무숲','빙수','한여름밤','노을','청포도','까망','하양이','불꽃남자','물빛','산들바람','도토리','은하수','민들레','참치캔','솜사탕'];

export function seedTitles() {
  return [
    { id:'t_first',  name:'첫 후원',     icon:'🌱', color:'#33d69f', rule:{type:'count',n:1} },
    { id:'t_yeol',   name:'열혈팬',      icon:'💜', color:'#a45bff', rule:{type:'cumulative',n:100000} },
    { id:'t_gold',   name:'골드 서포터', icon:'👑', color:'#ffcb45', rule:{type:'cumulative',n:300000} },
    { id:'t_regular',name:'단골',        icon:'🔥', color:'#ff8a5c', rule:{type:'count',n:50} },
    { id:'t_big',    name:'큰손',        icon:'💎', color:'#4fc0e8', rule:{type:'single',n:50000} },
    { id:'t_vvip',   name:'VVIP 등극',   icon:'⭐', color:'#ff5c7a', rule:{type:'grade',grade:'g_vvip'} },
    { id:'t_bday',   name:'생일 축하',   icon:'🎂', color:'#ff3d68', rule:{type:'manual'} },
  ];
}
function seedLogs(donators) {
  const gname = c => c>=300000?'VVIP':c>=100000?'VIP':c>=30000?'열혈':'';
  const top = donators.slice().sort((a,b)=>b.cash-a.cash).slice(0,12);
  const rows = [['10-31 21:14','donate','remote',50000],['10-31 20:58','amount','widget',30000],
    ['10-31 20:41','first','kakao_send',3000],['10-31 20:22','login','kakao_send',0],
    ['10-30 22:03','promote','widget',0],['10-30 21:47','anniv','kakao_send',0],
    ['10-30 21:20','amount','tts',100000],['10-29 19:55','donate','remote',5000]];
  return rows.map((r,i)=>{ const d=top[i%top.length]; return { when:r[0], situ:r[1], name:d.alias||d.name, grade:gname(d.cash), action:r[2], amt:r[3] }; });
}
export const SCHED_CATS = {
  '게임':{icon:'🎮',color:'#5b8cff'}, '토크':{icon:'💬',color:'#33d69f'}, '먹방':{icon:'🍜',color:'#ff8a5c'},
  '음악':{icon:'🎵',color:'#a45bff'}, '콘텐츠':{icon:'🎬',color:'#ff5c7a'}, '기타':{icon:'✨',color:'#ffcb45'},
};
function nowClock() { const d=new Date(), z=n=>String(n).padStart(2,'0'); return `${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; }
export function seedSchedules() {
  const now=new Date(), z=n=>String(n).padStart(2,'0');
  const iso=dd=>`${dd.getFullYear()}-${z(dd.getMonth()+1)}-${z(dd.getDate())}`;
  const day=add=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+add);
  const mk=(add,start,end,title,category,extra={})=>({id:uid(),title,date:iso(day(add)),start,end,category,repeat:'none',days:[],visible:true,notify:true,memo:'',reminded:false,...extra});
  return [
    mk(0,'20:00','23:00','롤 랭크 올리기 🎮','게임'),
    mk(1,'21:00','23:30','같이 수다 떨어요 (저챗)','토크'),
    mk(3,'19:00','21:00','먹방 — 마라탕 리뷰','먹방'),
    mk(5,'22:00','24:00','신곡 커버 라이브','음악',{memo:'세트리스트 준비'}),
    mk(6,'14:00','19:00','주말 롱런 방송','게임',{repeat:'weekly',days:[6]}),
    mk(-2,'20:00','22:30','지난 게임 방송','게임'),
  ];
}
export function seed() {
  const donators = KO_NAMES.map((nm,i)=>{
    const cash = Math.round((Math.random()*480000+3000)/100)*100;
    const cnt = Math.max(1, Math.round(cash/(2000+Math.random()*6000)));
    const y=2023+(i%2), m=1+(i*3%12), d=1+(i*7%27);
    const tagPool=['단골','게임팬','매너좋음','고정닉','이벤트참여','생일챙기기'];
    return { id:uid(), name:nm, alias:'', cash, count:cnt,
      tags: tagPool.filter(()=>Math.random()>.74),
      memo: Math.random()>.85 ? '방송 시작 시 인사 꼭 챙기기' : '',
      join:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
      last:`2024-${String(1+(i%10)).padStart(2,'0')}-${String(1+(i*5%27)).padStart(2,'0')}`,
      types:['text','signature','voice','quest'].filter(()=>Math.random()>.4),
      awards: Math.random()>.85 ? ['t_bday'] : [], blocked:false,
      history: Array.from({length:3+Math.round(Math.random()*3)},(_,k)=>({
        time:`2024-10-${String(10-k).padStart(2,'0')} ${String(10+k).padStart(2,'0')}:${String(k*7%60).padStart(2,'0')}:00`,
        kind:['텍스트','음성','시그니처','퀘스트'][k%4], amt:[1000,5000,10000,3000,50000][k%5],
        msg:['후원합니다!','오늘도 화이팅','방송 잘보고있어요','1일 1후원','고생 많으셨어요'][k%5] })) };
  });
  if (donators[22]) { donators[22].blocked=true; donators[22].blockReason='부적절한 후원 메시지 반복'; donators[22].blockedAt='2024-09-14'; }
  const maxLast = donators.reduce((mx,d)=>{ const p=d.last.split('-').map(Number); const t=new Date(p[0],p[1]-1,p[2]).getTime(); return t>mx?t:mx; },0);
  const base = new Date(maxLast);
  [[1,3,2],[4,10,1],[8,18,2],[12,25,1],[18,7,3]].forEach(([idx,ad,ya])=>{ if(!donators[idx])return;
    const dt=new Date(base.getFullYear(),base.getMonth(),base.getDate()+ad);
    donators[idx].join=`${dt.getFullYear()-ya}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; });
  return {
    grades: [
      { id:'g_vvip', name:'VVIP', cls:'vvip', color:'#ffcb45', mode:'over',  min:300000, max:0 },
      { id:'g_vip',  name:'VIP',  cls:'vip',  color:'#a45bff', mode:'range', min:100000, max:299999 },
      { id:'g_yeol', name:'열혈', cls:'yeol', color:'#5b8cff', mode:'range', min:30000,  max:99999 },
    ],
    donators, titles: seedTitles(), autoLogs: seedLogs(donators), annivAuto: true, schedules: seedSchedules(),
    msgCredit: { balance:300, sent:0, log:[{ ts:nowClock(), type:'init', amount:300, balance:300 }] },
    autos: [
      { id:uid(), on:true, situ:'login', targetMode:'class', classes:['g_vvip'], actions:[{type:'kakao_send',cfg:{msg:'{크리에이터} 님이 방송을 시작하였습니다'}}] },
      { id:uid(), on:true, situ:'amount', amt:{mode:'range',min:10000,max:100000}, actions:[{type:'widget',cfg:{widget:'팡파르'}},{type:'tts',cfg:{voice:'ara'}}] },
      { id:uid(), on:true, situ:'first', actions:[{type:'widget',cfg:{widget:'하트비'}},{type:'kakao_send',cfg:{msg:'{닉네임}님, 첫 후원 감사합니다!'}}] },
    ],
  };
}
function normalize(DB) {
  if (!DB.titles) DB.titles = seedTitles();
  if (!DB.autoLogs) DB.autoLogs = [];
  if (DB.annivAuto === undefined) DB.annivAuto = true;
  (DB.donators||[]).forEach(d=>{ d.tags=d.tags||[]; d.awards=d.awards||[]; d.blocked=d.blocked||false; });
  (DB.autos||[]).forEach(a=>{ if(!a.actions){ a.actions=a.action?[{type:a.action,cfg:a.cfg||{}}]:[]; delete a.action; delete a.cfg; } });
  if (!DB.schedules) DB.schedules = seedSchedules();
  if (!DB.msgCredit) DB.msgCredit = { balance:300, sent:0, log:[{ ts:nowClock(), type:'init', amount:300, balance:300 }] };
  return DB;
}
export function load() {
  let DB;
  if (existsSync(DATA_FILE)) { try { DB = JSON.parse(readFileSync(DATA_FILE,'utf8')); } catch(e){} }
  if (!DB) { DB = seed(); }
  normalize(DB);
  if (!existsSync(DATA_FILE)) save(DB);
  return DB;
}
export function save(DB) { writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2)); }
export function reset() { const DB = seed(); save(DB); return DB; }
