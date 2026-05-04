/* IORA Forge v3 – Full Frontend: Tutorial, Mayor, School, Happiness, Goals */
const cvs=document.getElementById('game'),ctx=cvs.getContext('2d');
let W,H;
const cam={x:0,y:0,tx:0,ty:0,dx:0,dy:0,cx:0,cy:0,drag:false};

// Map (starts smaller, expands)
let MAP_COLS=50, MAP_ROWS=36, TS=32;
let MAP,WALKABLE;
function buildMap(){
  MAP=Array.from({length:MAP_ROWS},()=>Array(MAP_COLS).fill(0));
  // River (flows from top-right to bottom-left)
  let rx=MAP_COLS-8, ry=0;
  while(ry<MAP_ROWS-1&&rx>2){
    for(let w=0;w<3;w++){if(ry>=0&&ry<MAP_ROWS&&rx+w>=0&&rx+w<MAP_COLS)MAP[ry][rx+w]=2;}
    ry++; if(Math.random()<.4)rx--; if(Math.random()<.2&&rx>4)rx-=2;
  }
  // Lake at river end
  for(let r=MAP_ROWS-6;r<MAP_ROWS-2;r++)for(let c=2;c<=6;c++)MAP[r][c]=2;
  // Pond top-right
  for(let r=3;r<=7;r++)for(let c=MAP_COLS-5;c<MAP_COLS-1;c++)MAP[r][c]=2;
  // Farmland
  for(let r=MAP_ROWS-7;r<MAP_ROWS-3;r++)for(let c=MAP_COLS-12;c<MAP_COLS-7;c++)MAP[r][c]=3;
  // Stone
  for(let r=MAP_ROWS-10;r<MAP_ROWS-6;r++)for(let c=MAP_COLS-14;c<MAP_COLS-9;c++)MAP[r][c]=4;
  WALKABLE=Array.from({length:MAP_ROWS},()=>Array(MAP_COLS).fill(true));
  for(let r=0;r<MAP_ROWS;r++)for(let c=0;c<MAP_COLS;c++)WALKABLE[r][c]=MAP[r][c]!==2;
}

// Check if tile is adjacent to water (for sawmill placement)
function isNearWater(col,row){for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){const nr=row+dr,nc=col+dc;if(nr>=0&&nr<MAP_ROWS&&nc>=0&&nc<MAP_COLS&&MAP[nr][nc]===2)return true;}return false;}
function expandMap(){
  const pop=villagers.length||0;
  if(pop>=20&&MAP_COLS<45){MAP_COLS=45;MAP_ROWS=32;buildMap();genScenery();initNPCs();}
  else if(pop>=10&&MAP_COLS<35){MAP_COLS=35;MAP_ROWS=26;buildMap();genScenery();initNPCs();}
}

const TREES=[],ROCKS=[],FLOWERS=[];
function genScenery(){TREES.length=0;ROCKS.length=0;FLOWERS.length=0;
  for(let i=0;i<MAP_COLS*2;i++)TREES.push([Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*Math.min(12,MAP_ROWS-10)),1+Math.floor(Math.random()*3),Math.floor(Math.random()*3)]);
  for(let i=0;i<40;i++)ROCKS.push([Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),Math.floor(Math.random()*3)]);
  for(let i=0;i<200;i++)FLOWERS.push([Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),Math.floor(Math.random()*6)]);
}

// Zones (relative to center area)
function getZones(){return{
  campfire:[Math.floor(MAP_COLS/2),Math.floor(MAP_ROWS/2)],
  tent:[[Math.floor(MAP_COLS/2)-1,Math.floor(MAP_ROWS/2)+1],[Math.floor(MAP_COLS/2)+1,Math.floor(MAP_ROWS/2)+1],[Math.floor(MAP_COLS/2)-2,Math.floor(MAP_ROWS/2)],[Math.floor(MAP_COLS/2)+2,Math.floor(MAP_ROWS/2)],[Math.floor(MAP_COLS/2)-1,Math.floor(MAP_ROWS/2)-1],[Math.floor(MAP_COLS/2)+1,Math.floor(MAP_ROWS/2)-1]],
  house:Array.from({length:20},(_,i)=>[Math.floor(MAP_COLS/2)-3+(i%5)*2,Math.floor(MAP_ROWS/2)+3+Math.floor(i/5)*2]),
  lumberMill:[[Math.floor(MAP_COLS/2)-6,Math.floor(MAP_ROWS/2)-5],[Math.floor(MAP_COLS/2)-5,Math.floor(MAP_ROWS/2)-5]],
  farm:[[3,Math.floor(MAP_ROWS/2)+4],[4,Math.floor(MAP_ROWS/2)+4],[5,Math.floor(MAP_ROWS/2)+4]],
  quarry:[[MAP_COLS-6,MAP_ROWS-6],[MAP_COLS-5,MAP_ROWS-6],[MAP_COLS-4,MAP_ROWS-6]],
  market:[[Math.floor(MAP_COLS/2)+2,Math.floor(MAP_ROWS/2)-2],[Math.floor(MAP_COLS/2)+3,Math.floor(MAP_ROWS/2)-2]],
  academy:[[MAP_COLS-6,Math.floor(MAP_ROWS/2)-4]],
  bakery:[[4,Math.floor(MAP_ROWS/2)+6]],
  forge:[[MAP_COLS-5,MAP_ROWS-4]],
  well:[[Math.floor(MAP_COLS/2)-1,Math.floor(MAP_ROWS/2)-3]],
  watchtower:[[2,2],[MAP_COLS-3,2],[2,MAP_ROWS-3]],
  townhall:[[Math.floor(MAP_COLS/2),Math.floor(MAP_ROWS/2)-2]],
  sawmill:(()=>{const spots=[];for(let r=0;r<MAP_ROWS;r++)for(let c=0;c<MAP_COLS;c++){if(MAP[r][c]===0&&isNearWater(c,r))spots.push([c,r]);}return spots.slice(0,3);})(),
  forester:[[Math.floor(MAP_COLS/2)-6,Math.floor(MAP_ROWS/2)-6],[Math.floor(MAP_COLS/2)-5,Math.floor(MAP_ROWS/2)-6]],
  storage:[[Math.floor(MAP_COLS/2)-2,Math.floor(MAP_ROWS/2)+3],[Math.floor(MAP_COLS/2),Math.floor(MAP_ROWS/2)+3],[Math.floor(MAP_COLS/2)+2,Math.floor(MAP_ROWS/2)+3]],
};}

// State
let resources={},buildings={},villagers=[],prestige={points:0,multiplier:1},stats={},unlocked=[];
let villagerCap=0,adultCount=0,childCount=0,autonomy={level:0},season={current:'spring'};
let stage='camp',stageInfo={},consumption={food:0,wood:0},events={active:null},pathWear={},dayCycle={isDay:true};
let houses=[],jobs={},availJobs={},produced={},happiness=100;
let goals=[],decrees=[];
let selectedVillager=null,selectedHouse=null;
let particles=[],floatTexts=[],npcs=[],chickens=[],birds=[],deer=[];
let gf=0,wa=0,mapTrees={},transportLevel=0;

// API
async function api(p,m){m=m||'GET';const r=await fetch(p,{method:m});return r.json();}
async function fetchState(){
  try{const s=await api('/api/game/state');
    resources=s.resources;buildings=s.buildings;villagers=s.villagers;prestige=s.prestige;
    stats=s.stats;unlocked=s.achievements.unlocked;villagerCap=s.villagerCapacity;jobs=s.jobs;
    availJobs=s.availJobs;adultCount=s.adultCount;childCount=s.childCount;
    autonomy=s.autonomy;season=s.season;dayCycle=s.dayCycle||{isDay:true};stage=s.stage;stageInfo=s.stageInfo;
    consumption=s.consumption;events=s.events;pathWear=s.pathWear;houses=s.houses||[];
    happiness=s.happiness||100;goals=s.goals||[];decrees=s.decrees||[];
    mapTrees=s.mapTrees||{};transportLevel=s.transportLevel||0;dayCycle=s.dayCycle||{isDay:true};
    MAP_COLS=(s.mapData||{}).cols||MAP_COLS;MAP_ROWS=(s.mapData||{}).rows||MAP_ROWS;
    produced={};expandMap();syncNPCs();updateUI();
  }catch(e){console.error(e);}
}

function syncNPCs(){
  npcs=npcs.filter(n=>villagers.some(v=>v.id===n.vid));
  for(const v of villagers){if(!npcs.some(n=>n.vid===v.id))npcs.push(createNPC(v));}
  for(const n of npcs){const v=villagers.find(v=>v.id===n.vid);if(v){n.job=v.job;n.jobInfo=v.jobInfo;n.name=v.name;n.gender=v.gender;n.age=v.age;}}
}
function createNPC(v){
  const mb=['#cc9966','#bb8855'],fb=['#ffbbaa','#eeaa99'],mh=['#553311','#442208'],fh=['#885533','#774422'];
  const body=v.gender==='male'?mb[Math.floor(Math.random()*2)]:fb[Math.floor(Math.random()*2)];
  const hair=v.gender==='male'?mh[Math.floor(Math.random()*2)]:fh[Math.floor(Math.random()*2)];
  const cx=Math.floor(MAP_COLS/2),cy=Math.floor(MAP_ROWS/2);
  const sx=cx*TS+TS/2+(Math.random()-.5)*4*TS,sy=cy*TS+TS/2+(Math.random()-.5)*4*TS;
  const shirts=['#cc6644','#4488cc','#66aa44','#cc9944','#aa66cc','#44aaaa','#cc4466','#8888cc'];
  const shirt=shirts[Math.floor(Math.random()*shirts.length)];
  return {vid:v.id,name:v.name,gender:v.gender,job:v.job,jobInfo:v.jobInfo,age:v.age||'adult',body,hair,shirt,x:sx,y:sy,tx:sx,ty:sy,path:null,pathIdx:0,frame:Math.random()*6,jobTimer:2+Math.random()*2,speed:v.age==='child'?.25:.45+Math.random()*.3,hat:v.gender==='male'?'#664422':'#aa5588'};
}

// Pathfinding
function findPath(sr,sc,er,ec){
  if(!WALKABLE[er]||!WALKABLE[er][ec])return null;
  const H=MAP_ROWS,W=MAP_COLS,visited=Array.from({length:H},()=>Array(W).fill(false)),prev=Array.from({length:H},()=>Array(W).fill(null));
  const q=[[sr,sc]];visited[sr][sc]=true;const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
  let found=false;
  while(q.length&&!found){const[r,c]=q.shift();if(r===er&&c===ec){found=true;break;}
    for(const[dr,dc]of dirs){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<H&&nc>=0&&nc<W&&!visited[nr][nc]&&WALKABLE[nr][nc]){visited[nr][nc]=true;prev[nr][nc]=[r,c];q.push([nr,nc]);}}}
  if(!found)return null;const path=[];let cr=er,cc=ec;
  while(cr!==sr||cc!==sc){path.unshift([cr,cc]);const p=prev[cr][cc];if(!p)break;cr=p[0];cc=p[1];}
  return path;
}

// UI
function updateUI(){updateParchment();updateShop();updatePanel();updateMayorPanel();}
function updateParchment(){
  const el=document.getElementById('parchmentStats');
  let h='';
  for(const[k,d]of Object.entries({food:{e:'🌾',c:'#7ec850'},wood:{e:'🪵',c:'#d4a574'},stone:{e:'🪨',c:'#9a9aaa'},planks:{e:'🪵',c:'#c4956a'},gold:{e:'💰',c:'#ffd700'},knowledge:{e:'📚',c:'#c4a0ff'}})){
    h+=`<div class="ps-row"><span>${d.e} ${k}</span><span class="ps-val" style="color:${d.c}">${fmt(resources[k]||0)}</span></div>`;
  }
  el.innerHTML=h;
  document.getElementById('ppVal').textContent=prestige.points;
  document.getElementById('multVal').textContent=prestige.multiplier.toFixed(2);
  document.getElementById('villagerCount').textContent='👥 '+villagers.length+'/'+villagerCap;
  const ch=document.getElementById('childInfo');if(ch)ch.textContent=childCount>0?'👶 '+childCount+' Kinder':'';
  const ac=document.getElementById('autonomyLevel');if(ac){const lv=['🔴 Manuell','🟡 Auto-Jobs','🟢 Selbstst.','⭐ Autonom'];ac.textContent=lv[autonomy.level]||lv[0];}
  const sn=document.getElementById('seasonInfo');if(sn){const snm={spring:'🌸 Frühling',summer:'☀️ Sommer',autumn:'🍂 Herbst',winter:'❄️ Winter'};sn.textContent=(snm[season.current]||'')+' J'+(season.year||1);}
  const st=document.getElementById('stageInfo');if(st)st.textContent=(stageInfo?.emoji||stageInfo?.e||'🏕️')+' '+(stageInfo?.name||stageInfo?.n||'Camp');
  const co=document.getElementById('consumptionInfo');if(co){let ct='';if((consumption.food||0)>0)ct+='🌾-'+fmt(consumption.food)+'/s ';if((consumption.wood||0)>0)ct+='🪵-'+fmt(consumption.wood)+'/s';co.textContent=ct||'';}
  document.getElementById('happinessInfo').textContent='😊 '+Math.round(happiness)+'%';
  const dn=document.getElementById('dayNightInfo');if(dn)dn.textContent=dayCycle.isDay?'☀️ Tag':'🌙 Nacht';
  const tl=document.getElementById('transportInfo');if(tl){const tln=['🖐️ Hand','🛒 Holzkarren','🐎 Pferdewagen'];tl.textContent=(tln[transportLevel]||'🖐️ Hand');}
}

function updateShop(){
  const el=document.getElementById('shopBar');let h='';
  for(const[t,b]of Object.entries(buildings||{})){
    if(!b||!b.name)continue;
    const aff=b.canBuild,atMax=b.count>=b.maxBuildings;
    h+=`<div class="shop-item${!aff||atMax?' disabled':''}" ${aff&&!atMax?`onclick="buyBuilding('${t}')"`:''} title="${b.desc||''}">
      <span class="si-icon">${b.emoji||'?'}</span><span class="si-name">${b.name||t}</span>
      <span class="si-count">${atMax?'MAX':'×'+b.count}</span><span class="si-cost">${atMax?'MAX':aff?'Bauen':b.buildBlocked||'???'}</span></div>`;
  }
  const tg=stats?.totalProd?Object.values(stats.totalProd).reduce((a,b)=>a+b,0):0;
  const av=Math.floor(tg/100000);
  h+=`<div class="shop-item prestige-btn${av>0?'':' disabled'}" ${av>0?'onclick="doPrestige()"':''}><span class="si-icon">🌟</span><span class="si-name">Prestige</span><span class="si-count">+${av}</span><span class="si-cost">×${prestige.multiplier.toFixed(2)}</span></div>`;
  el.innerHTML=h;
}

function updatePanel(){
  const panel=document.getElementById('villagerPanel');
  if(!panel)return;
  if(!selectedVillager&&!selectedHouse){panel.style.display='none';return;}
  if(selectedHouse){
    const h=houses.find(h=>h.id===selectedHouse);
    if(!h){panel.style.display='none';selectedHouse=null;return;}
    panel.style.display='block';
    document.getElementById('vpName').textContent='🏠 Haus #'+h.id+' (Stufe '+h.level+')';
    document.getElementById('vpJob').textContent='⭐'.repeat(Math.min(h.level,10));
    const cost={wood:20+h.level*20,stone:10+h.level*10};
    const aff=Object.entries(cost).every(([r,a])=>(resources[r]||0)>=a);
    document.getElementById('vpJobs').innerHTML=`<button class="job-btn${aff?'':' disabled'}" onclick="upgradeHouse(${h.id})">⬆️ Upgrade (${fmtCost(cost)})</button>`;
    document.getElementById('vpExtra').textContent=h.level>=5?'🏰 Großes Haus':h.level>=3?'🏡 Haus mit Garten':'🛖 Hütte';
    return;
  }
  const v=villagers.find(v=>v.id===selectedVillager);
  if(!v){panel.style.display='none';selectedVillager=null;return;}
  panel.style.display='block';
  document.getElementById('vpName').textContent=(v.gender==='male'?'♂️':'♀️')+' '+v.name+(v.age==='child'?' 👶':'');
  document.getElementById('vpJob').textContent=v.jobInfo?.emoji+' '+(v.jobInfo?.name||'Arbeitslos')+' '+('⭐'.repeat(Math.min(v.level||1,10)));
  const agePct=Math.round(((v.ageTicks||0)/(v.maxAge||3600))*100);
  let extra=(v.age==='child'?'👶 Kind (spielt)':v.pregnant?'🤰 Schwanger | ':'')+'🎂 '+Math.floor((v.ageTicks||0)/60)+'min | 💪 Lv.'+(v.level||1)+' ('+(v.xp||0)+' XP)';
  if(v.married){const p=villagers.find(p=>p.id===v.partnerId);if(p)extra+=' | 💒 '+p.name;}
  if(v.childrenIds&&v.childrenIds.length>0)extra+=' | 👶'+v.childrenIds.length+' Kinder';
  document.getElementById('vpExtra').textContent=extra;
  let bh='';
  for(const[jid,jinfo]of Object.entries(availJobs||{})){
    bh+=`<button class="job-btn${v.job===jid?' active':''}" onclick="assignJob(${v.id},'${jid}')">${jinfo.emoji} ${jinfo.name}</button>`;
  }
  if(v.job!=='idle')bh+=`<button class="job-btn" onclick="assignJob(${v.id},'idle')">😴 Freistellen</button>`;
  document.getElementById('vpJobs').innerHTML=bh;
}

function updateMayorPanel(){
  const mp=document.getElementById('mayorPanel');
  if(mp.style.display==='none')return;
  document.getElementById('mpStage').textContent=(stageInfo?.emoji||'')+' '+(stageInfo?.name||'Camp');
  document.getElementById('mpHappy').textContent=Math.round(happiness)+'%';
  const goalsEl=document.getElementById('mpGoals');
  if(goals.length===0)goalsEl.innerHTML='<div class="mp-goal">Keine aktiven Ziele</div>';
  else goalsEl.innerHTML=goals.map(g=>`<div class="mp-goal"><span>${g.emoji} ${g.name}</span><span>${g.progress||0}/${g.target||1}</span></div>`).join('');
}

async function buyBuilding(t){const r=await api('/api/game/buy/'+t,'POST');if(r.ok){spawnFX();await fetchState();if(r.maxReached)floatText('Max erreicht!',W/2,H/2,'#fd0');}else floatText(r.reason||'Fehler',W/2,H/2,'#f55');}
async function upgradeHouse(id){const r=await api('/api/game/upgrade-house/'+id,'POST');if(r.ok){floatText('🏠 Upgrade auf Stufe '+r.newLevel+'!',W/2,H/2,'#fd0');await fetchState();}else floatText(r.reason||'Fehler',W/2,H/2,'#f55');}
async function assignJob(vid,job){const r=await api('/api/game/assign/'+vid+'/'+job,'POST');if(r.ok){await fetchState();floatText('✅ Zugewiesen!',W/2,H/2,'#7c5');}else floatText(r.reason||'Fehler',W/2,H/2,'#f55');}
async function doPrestige(){const r=await api('/api/game/prestige','POST');if(r.ok){floatText('🌟 +'+r.pointsGained+' Prestige!',W/2,H/2,'#fd0');await fetchState();}else floatText(r.reason||'Mehr nötig',W/2,H/2,'#f55');}
async function saveGame(){await api('/api/game/save','POST');floatText('💾 Gespeichert!',W/2,H/2,'#7c5');}
async function loadGame(){const r=await api('/api/game/load','POST');if(r.success){floatText('📂 Geladen!',W/2,H/2,'#7c5');await fetchState();}else floatText('Kein Spielstand',W/2,H/2,'#f55');}

function closeTutorial(){document.getElementById('tutorialOverlay').style.display='none';}
function closePanel(){document.getElementById('villagerPanel').style.display='none';selectedVillager=null;selectedHouse=null;}
function openMayorPanel(){document.getElementById('mayorPanel').style.display='block';updateMayorPanel();}
function setGoal(){const sel=document.getElementById('mpGoalSelect').value;if(sel)api('/api/game/goal/'+sel,'POST').then(()=>fetchState());}
function issueDecree(){const sel=document.getElementById('mpDecreeSelect').value;if(sel)api('/api/game/decree/'+sel,'POST').then(()=>fetchState());}

let pt;
function startPoll(){pt=setInterval(async()=>{try{const d=await api('/api/game/tick');
  if(d.resources){resources=d.resources;produced=d.produced||{};season=d.season;stage=d.stage;stageInfo=d.stageInfo;consumption=d.consumption||{};happiness=d.happiness||100;
  if(d.activeEvent)toast(d.activeEvent.emoji+' '+d.activeEvent.name+': '+d.activeEvent.msg);
  if(d.newAchievements?.length){d.newAchievements.forEach(a=>toast('🏆 '+a.emoji+' '+a.name));fetchState();}
  updateParchment();updateShop();}
}catch(e){}},1000);}

function fmt(n){if(n>=1e12)return(n/1e12).toFixed(1)+'T';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';if(n>=100)return Math.floor(n).toString();if(n>=10)return n.toFixed(1);return n.toFixed(2);}
function fmtCost(c){return c?Object.entries(c).map(([r,a])=>r.charAt(0).toUpperCase()+fmt(a)).join(' '):'Gratis';}
function toast(m){const a=document.getElementById('toastArea');const e=document.createElement('div');e.className='toast';e.textContent=m;a.appendChild(e);setTimeout(()=>e.remove(),3000);}
function floatText(m,x,y,c){c=c||'#fff';floatTexts.push({msg:m,x,y,c,life:1.5,age:0});}
function spawnFX(){for(let i=0;i<20;i++)particles.push({x:W/2,y:H/2,vx:(Math.random()-.5)*6,vy:(Math.random()-.5)*6-3,life:1,age:0,ml:.4+Math.random()*.5,col:['#fd0','#7c5','#c4f'][Math.random()*3|0],sz:2+Math.random()*5});}
function spawnClickFX(x,y){const cols=['#fd0','#7c5','#c4f','#f88','#8cf'];for(let i=0;i<10;i++)particles.push({x,y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4-4,life:1,age:0,ml:.3+Math.random()*.3,col:cols[Math.random()*5|0],sz:2+Math.random()*4});}

// NPC Logic
function updateNPCs(dt){
  for(const n of npcs){
    n.jobTimer-=dt;
    if(n.jobTimer<=0||!n.path||n.path.length===0){
      n.jobTimer=2+Math.random()*4;
      let tr=Math.floor(MAP_ROWS/2)-4+Math.floor(Math.random()*10),tc=Math.floor(MAP_COLS/2)-4+Math.floor(Math.random()*10);
      if(n.job==='lumberjack'){tr=Math.floor(MAP_ROWS/2)-7;tc=Math.floor(MAP_COLS/2)-6+Math.floor(Math.random()*4);}
      else if(n.job==='gatherer'||n.job==='farmer'||n.job==='baker'){tr=MAP_ROWS-6;tc=4+Math.floor(Math.random()*6);}
      else if(n.job==='miner'||n.job==='smith'){tr=MAP_ROWS-6;tc=MAP_COLS-8+Math.floor(Math.random()*4);}
      const sr=Math.floor(n.y/TS),sc=Math.floor(n.x/TS);
      const path=findPath(sr,sc,tr,tc);
      if(path&&path.length>0){n.path=path;n.pathIdx=0;n.tx=(path[0][1]+.5)*TS;n.ty=(path[0][0]+.5)*TS;}
      else{n.tx=(tc+.5)*TS;n.ty=(tr+.5)*TS;n.path=null;}
    }
    if(n.path&&n.pathIdx<n.path.length){const t=n.path[n.pathIdx];n.tx=(t[1]+.5)*TS;n.ty=(t[0]+.5)*TS;
      const dx=n.tx-n.x,dy=n.ty-n.y,dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<4){n.pathIdx++;if(n.pathIdx>=n.path.length)n.path=null;}
      else{const s=n.speed*dt*60;n.x+=dx/dist*s;n.y+=dy/dist*s;}
    }else{const dx=n.tx-n.x,dy=n.ty-n.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist>4){const s=n.speed*dt*60;n.x+=dx/dist*s;n.y+=dy/dist*s;}}
    n.frame+=dt*4;
  }
}
function drawNPCs(){
  for(const n of npcs){
    const isChild=n.age==='child',sc=isChild?.7:1.3,px=Math.round(n.x),py=Math.round(n.y),bob=Math.sin(n.frame)*1.5*sc,f=n.tx>n.x?1:-1;
    // Shadow
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(px-4*sc,py+6*sc,8*sc,3*sc);
    // Body with shirt color
    ctx.fillStyle=n.shirt||n.body;
    if(n.gender==='female'){ctx.fillRect(px-4*sc,py-1*sc,8*sc,3*sc);ctx.fillRect(px-5*sc,py+2*sc,10*sc,5*sc);}
    else{ctx.fillRect(px-4*sc,py-1*sc,8*sc,7*sc);}
    // Arms
    const as=Math.sin(n.frame*2)*2*sc;ctx.fillStyle=n.shirt||n.body;
    ctx.fillRect(px-6*sc,py-1*sc+as*.5,3*sc,4*sc);ctx.fillRect(px+3*sc,py-1*sc-as*.5,3*sc,4*sc);
    // Head (bigger)
    ctx.fillStyle='#ffe0bd';ctx.fillRect(px-3*sc,py-6*sc+bob,6*sc,5*sc);
    // Hair
    ctx.fillStyle=n.hair;
    if(n.gender==='female'){ctx.fillRect(px-3*sc,py-10*sc+bob,6*sc,5*sc);ctx.fillRect(px-5*sc,py-9*sc+bob,3*sc,4*sc);ctx.fillRect(px+2*sc,py-9*sc+bob,3*sc,4*sc);}
    else{ctx.fillRect(px-4*sc,py-10*sc+bob,8*sc,4*sc);}
    // Hat
    if(n.job!=='idle'&&!isChild){ctx.fillStyle=n.hat;ctx.fillRect(px-5*sc,py-14*sc+bob,10*sc,5*sc);}
    // Eyes
    ctx.fillStyle='#000';ctx.fillRect(px+f*2-1,py-4*sc+bob,2*sc,2*sc);
    // Legs
    const lo=Math.sin(n.frame*3)*2*sc;ctx.fillStyle='#4a3a2a';ctx.fillRect(px-2*sc,py+5*sc,3*sc,(4+lo*.5)*sc);ctx.fillRect(px,py+5*sc,3*sc,(4-lo*.5)*sc);
    // Job tool
    if(!isChild&&n.jobTimer<1.5){
      if(n.job==='lumberjack'){ctx.fillStyle='#888';ctx.fillRect(px+f*7,py-8,3,10);ctx.fillStyle='#c4956a';ctx.fillRect(px+f*5,py-8,5,7);}
      else if(n.job==='miner'){ctx.fillStyle='#888';ctx.fillRect(px+f*7,py-5,3,7);ctx.fillStyle='#aaa';ctx.fillRect(px+f*5,py-6,6,4);}
      else if(n.job==='rancher'){ctx.fillStyle='#8b6914';ctx.fillRect(px+f*6,py-4,2,8);}
    }
    // Name
    if(n.job!=='idle'||isChild){ctx.fillStyle='rgba(0,0,0,.6)';ctx.font=(isChild?'6':'7')+'px monospace';ctx.textAlign='center';ctx.fillText((isChild?'👶':'')+n.name,px,py-(isChild?12:17)*sc);}
  }
}

function createAnimals(){chickens=[];for(let i=0;i<4;i++)chickens.push({x:(3+i)*TS+TS/2,y:(MAP_ROWS-5)*TS+TS/2,vx:0,vy:0,timer:Math.random()*3,frame:0});birds=[];for(let i=0;i<6;i++)birds.push({x:Math.random()*MAP_COLS*TS,y:20+Math.random()*80,vx:.3+Math.random()*.5,frame:0});deer=[];for(let i=0;i<3;i++)deer.push({x:(MAP_COLS-8+i*3)*TS+TS/2,y:4*TS+TS/2,vx:0,vy:0,timer:Math.random()*3,frame:0,dir:1});}
function updateAnimals(dt){for(const c of chickens){c.timer-=dt;if(c.timer<=0){c.timer=1+Math.random()*3;c.vx=(Math.random()-.5)*.6;c.vy=(Math.random()-.5)*.6;}c.x+=c.vx*dt*60;c.y+=c.vy*dt*60;c.x=Math.max(2*TS,Math.min(8*TS,c.x));c.y=Math.max((MAP_ROWS-7)*TS,Math.min((MAP_ROWS-3)*TS,c.y));c.frame+=dt*3;}for(const b of birds){b.x+=b.vx*dt*60;if(b.x>MAP_COLS*TS+60)b.x=-60;b.frame+=dt*3;}for(const d of deer){d.timer-=dt;if(d.timer<=0){d.timer=3+Math.random()*4;d.vx=(Math.random()-.5)*.4;d.dir=d.vx>0?1:-1;}d.x+=d.vx*dt*60;d.x=Math.max((MAP_COLS-10)*TS,Math.min((MAP_COLS-2)*TS,d.x));d.frame+=dt*2;}}

// Rendering
function drawTerrain(){
  const grass=season.current==='winter'?['#d8e8d8','#c8d8c8','#d0e0d0']:season.current==='autumn'?['#b8a060','#a89050','#b4a458']:['#5a9c4f','#4a8c3f','#559a4a'];
  for(let r=0;r<MAP_ROWS;r++)for(let c=0;c<MAP_COLS;c++){
    const x=c*TS,y=r*TS,t=MAP[r][c],wear=pathWear[r+','+c]||0;
    if(wear>30&&t===0){ctx.fillStyle='#c8a070';ctx.fillRect(x,y,TS+1,TS+1);}
    else if(t===0){ctx.fillStyle=grass[(c+r*7)%3];ctx.fillRect(x,y,TS+1,TS+1);}
    else if(t===2){const ws=Math.sin(wa+(c+r)*.4)*8;ctx.fillStyle=`rgb(${55+ws},${145+ws},${215+ws})`;ctx.fillRect(x,y,TS+1,TS+1);}
    else if(t===3){ctx.fillStyle='#8a6a3a';ctx.fillRect(x,y,TS+1,TS+1);}
    else if(t===4){ctx.fillStyle='#9a9a8a';ctx.fillRect(x,y,TS+1,TS+1);}
  }
}
function drawBuildings(){
  const Z=getZones();
  for(const[type,b]of Object.entries(buildings||{})){
    if(!b||b.count===0)continue;const zone=Z[type];if(!zone)continue;
    if(type==='campfire'){const[c,r]=zone,cx=c*TS+TS/2,cy=r*TS+TS/2;ctx.fillStyle='#888';ctx.fillRect(cx-8,cy+4,16,4);const fl=Math.sin(gf*.2)*2;ctx.fillStyle='#f80';ctx.fillRect(cx-4,cy-6+fl,8,10);ctx.fillStyle='#fa0';ctx.fillRect(cx-2,cy-8+fl,4,6);ctx.fillStyle='#ff0';ctx.fillRect(cx-1,cy-10+fl,2,3);}
    else if(type==='tent'){for(let i=0;i<Math.min(b.count,zone.length);i++){const[c,r]=zone[i],x=c*TS+4,y=r*TS;ctx.fillStyle='#e8d8b8';ctx.fillRect(x,y+TS*.35,TS-8,TS*.65);ctx.fillStyle='#c4956a';ctx.fillRect(x-2,y+TS*.1,TS-4,TS*.3);ctx.fillStyle='#5a3a2a';ctx.fillRect(x+TS*.35,y+TS*.45,TS*.3,TS*.55);}}
    else if(type==='house'){for(let i=0;i<Math.min(b.count,zone.length);i++){const[c,r]=zone[i],h=houses[i]||{level:1};drawHouse(c*TS+3,r*TS-2,TS-6,TS+6,h.level);}}
    else if(type==='sawmill'){for(let i=0;i<Math.min(b.count,zone.length);i++){const[c,r]=zone[i];drawSawmill(c*TS,r*TS,TS);}}
    else if(type==='forester'){for(let i=0;i<Math.min(b.count,zone.length);i++){const[c,r]=zone[i],x=c*TS+4,y=r*TS;ctx.fillStyle='#6b4a2a';ctx.fillRect(x+TS*.3,y+TS*.2,TS*.4,TS*.5);ctx.fillStyle='#3a7c2f';ctx.fillRect(x+TS*.2,y+TS*.1,TS*.6,TS*.2);ctx.fillStyle='#5a9c4f';ctx.fillRect(x+TS*.25,y+TS*.05,TS*.5,TS*.15);}}
    else if(type==='storage'){for(let i=0;i<Math.min(b.count,zone.length);i++){const[c,r]=zone[i],x=c*TS,y=r*TS;ctx.fillStyle='#a08060';ctx.fillRect(x+4,y+TS*.3,TS-8,TS*.7);ctx.fillStyle='#8a6a4a';ctx.fillRect(x+2,y+TS*.2,TS-4,TS*.15);ctx.fillStyle='#c4a050';ctx.fillRect(x+TS*.3,y+TS*.4,TS*.1,TS*.15);}}
  }
}

function drawSawmill(x,y,s){
  // Water wheel
  const cx=x+s/2, cy=y+s*.4;
  ctx.fillStyle='#8a6a4a';ctx.fillRect(cx-s*.15,cy-s*.1,s*.3,s*.35);
  ctx.fillStyle='#6a4a2a';ctx.fillRect(cx-s*.12,cy-s*.05,s*.24,s*.08);ctx.fillRect(cx-s*.12,cy+s*.1,s*.24,s*.08);
  ctx.fillStyle='#a08060';ctx.fillRect(cx-s*.08,cy-s*.08,s*.16,s*.25);
  // Blade
  ctx.fillStyle='#ccc';const ba=gf*.05;ctx.fillRect(cx-2,cy-s*.15,4,8);
  // Building
  ctx.fillStyle='#c4a070';ctx.fillRect(x+s*.05,y+s*.3,s*.4,s*.5);
  ctx.fillStyle='#8a6a4a';ctx.fillRect(x+s*.03,y+s*.25,s*.44,s*.1);
  ctx.fillStyle='#6a4a2a';ctx.fillRect(x+s*.48,y+s*.25,s*.15,s*.25);
}
function drawHouse(x,y,w,h,lvl){
  const t=lvl<=3?0:lvl<=6?1:2;
  ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(x+2,y+h-3,w-4,5);
  ctx.fillStyle='#f0e4c8';ctx.fillRect(x+3,y+h*.35,w-6,h*.65);
  ctx.fillStyle='#a08060';ctx.fillRect(x+5,y+h*.35,5,h*.65);ctx.fillRect(x+w-10,y+h*.35,5,h*.65);
  const wc=t>=2?3:t>=1?2:1;
  for(let i=0;i<wc;i++){const wx=x+w/2+(i-(wc-1)/2)*w*.15;ctx.fillStyle='#8cc8f0';ctx.fillRect(wx-w*.06,y+h*.4,w*.12,h*.18);}
  ctx.fillStyle='#7a4a2a';ctx.fillRect(x+w/2-w*.08,y+h*.55,w*.16,h*.3);
  ctx.fillStyle='#cc4a3a';ctx.fillRect(x,y+h*.05,w,h*.34);
  if(t>=1){ctx.fillStyle='#d4b896';ctx.fillRect(x-3,y+h*.5,8,h*.2);ctx.fillRect(x+w-5,y+h*.5,8,h*.2);}
  if(t>=2){ctx.fillStyle='#ffd700';ctx.fillRect(x,y+h*.25,w,3);}
  if(lvl>1)for(let s=0;s<Math.min(lvl-1,10);s++){ctx.fillStyle='#ffd700';ctx.fillRect(x+3+s*4,y-2,3,3);}
}

function drawParticles(){for(const p of particles){ctx.globalAlpha=1-p.age/p.ml;ctx.fillStyle=p.col;ctx.fillRect(Math.round(p.x-p.sz/2),Math.round(p.y-p.sz/2),p.sz,p.sz);}ctx.globalAlpha=1;}
function drawMapTrees(){
  for(const[key,state]of Object.entries(mapTrees||{})){
    const[r,c]=key.split(',').map(Number);if(!MAP[r]||MAP[r][c]!==0)continue;
    const x=c*TS,y=r*TS,s=TS,sc=.7,cx=x+s/2,cy=y+s*.2;
    if(state===0){// Stump
      ctx.fillStyle='#8b6b3a';ctx.fillRect(cx-4,cy+4,8,4);ctx.fillStyle='#c4956a';ctx.fillRect(cx-3,cy+3,6,3);
    }else{// Growing/Grown tree
      ctx.fillStyle='#8b6b3a';ctx.fillRect(cx-s*.04*sc,cy,s*.08*sc,s*.3*sc);
      const fol=[[0,-.12,.28],[-.15,-.03,.2],[.15,-.03,.2],[0,.02,.22]];
      for(const[ox,oy,rad]of fol){const fx=cx+ox*s*sc,fy=cy+oy*s*sc,fr=rad*s*sc;
        ctx.fillStyle='#3d6e3d';ctx.fillRect(fx-fr,fy-fr*.7,fr*2,fr*1.4);
        ctx.fillStyle='#4d7e4d';ctx.fillRect(fx-fr+2,fy-fr*.7+2,fr*2-4,fr*1.4-4);
        ctx.fillStyle='#5d8e4d';ctx.fillRect(fx-fr*.5,fy-fr*.7+1,fr*.8,fr*.4);
      }
    }
  }
}
function drawFarmAnimals(){
  const fx=MAP_COLS-10, fy=MAP_ROWS-6;
  // Cows
  for(let i=0;i<3;i++){const cx=fx*TS+TS*(i+1)*2,cy=fy*TS+TS*1+Math.sin(gf*.03+i)*3;
    ctx.fillStyle='#f5f0e0';ctx.fillRect(cx-6,cy-2,12,7);ctx.fillStyle='#e8d8c0';ctx.fillRect(cx+4,cy-3,4,4);
    ctx.fillStyle='#000';ctx.fillRect(cx+6,cy-2,1,1);ctx.fillStyle='#d4a574';ctx.fillRect(cx-2,cy+5,2,4);ctx.fillRect(cx+2,cy+5,2,4);
    ctx.fillStyle='#f0c0c0';ctx.fillRect(cx-5,cy-5,3,2);}
  // Pigs
  for(let i=0;i<2;i++){const cx=fx*TS+TS*(i+1)*2,cy=fy*TS+TS*3+Math.sin(gf*.04+i)*2;
    ctx.fillStyle='#f5c0c0';ctx.fillRect(cx-5,cy-1,10,5);ctx.fillStyle='#e8a0a0';ctx.fillRect(cx-4,cy-2,2,2);ctx.fillStyle='#000';ctx.fillRect(cx-3,cy-1,1,1);ctx.fillStyle='#d4a574';ctx.fillRect(cx-2,cy+4,1,3);ctx.fillRect(cx+2,cy+4,1,3);}
  // Sheep
  for(let i=0;i<3;i++){const cx=fx*TS+TS*(i+1)*2,cy=fy*TS+TS*5+Math.sin(gf*.05+i)*2;
    ctx.fillStyle='#f8f8f8';ctx.fillRect(cx-5,cy-2,10,6);ctx.fillStyle='#ddd';ctx.fillRect(cx-3,cy-4,6,4);ctx.fillStyle='#000';ctx.fillRect(cx+3,cy-2,1,1);ctx.fillStyle='#555';ctx.fillRect(cx-2,cy+4,1,2);ctx.fillRect(cx+2,cy+4,1,2);}
}
function drawNightOverlay(){if(dayCycle&&!dayCycle.isDay){ctx.fillStyle='rgba(10,10,40,0.35)';ctx.fillRect(0,0,MAP_COLS*TS,MAP_ROWS*TS);}}
function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt*60;p.y+=p.vy*dt*60;p.vy+=.04*dt*60;p.age+=dt;if(p.age>=p.ml)particles.splice(i,1);}}
function applyCam(){cam.x+=(cam.tx-cam.x)*.1;cam.y+=(cam.ty-cam.y)*.1;cam.x=Math.max(0,Math.min(Math.max(0,MAP_COLS*TS-W),cam.x));cam.y=Math.max(0,Math.min(Math.max(0,MAP_ROWS*TS-H),cam.y));ctx.save();ctx.translate(-cam.x,-cam.y);}
function restoreCam(){ctx.restore();}

function render(){
  ctx.clearRect(0,0,W,H);applyCam();
  const grad=ctx.createLinearGradient(0,0,0,MAP_ROWS*TS+100);
  grad.addColorStop(0,'#6a8fc5');grad.addColorStop(.3,'#8ec8ea');grad.addColorStop(.6,'#7abaaa');grad.addColorStop(1,'#4a8c3f');
  ctx.fillStyle=grad;ctx.fillRect(0,0,MAP_COLS*TS,MAP_ROWS*TS+100);
  drawTerrain();drawMapTrees();drawBuildings();drawNPCs();drawNightOverlay();
  for(const c of chickens){ctx.fillStyle='#fff';ctx.fillRect(Math.round(c.x)-2,Math.round(c.y),5,4);}
  for(const b of birds){ctx.fillStyle='#555';ctx.fillRect(Math.round(b.x)-3,Math.round(b.y)+Math.sin(b.frame*.5)*4,6,2);}
  restoreCam();drawParticles();
  // Draw farm animals (if ranch exists)
  if((buildings.ranch?.count||0)>0)drawFarmAnimals();
  const tb=Object.values(buildings||{}).reduce((s,b)=>s+(b?.count||0),0);
  if(tb<=2){const a=.4+Math.sin(gf*.05)*.25;ctx.fillStyle=`rgba(255,215,0,${a})`;ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillText('💼 Klicke auf Bewohner & weise Jobs zu!',W/2,24);ctx.fillText('🪓 Holzfäller & 🧺 Sammler zuerst',W/2,38);}
}

// Input
cvs.addEventListener('mousedown',e=>{if(e.button===2){cam.drag=true;cam.dx=e.clientX;cam.dy=e.clientY;cam.cx=cam.tx;cam.cy=cam.ty;e.preventDefault();}});
cvs.addEventListener('mousemove',e=>{if(cam.drag){cam.tx=cam.cx-(e.clientX-cam.dx);cam.ty=cam.cy-(e.clientY-cam.dy);}});
cvs.addEventListener('mouseup',e=>{if(e.button===2)cam.drag=false;});
cvs.addEventListener('mouseleave',()=>{cam.drag=false;});
cvs.addEventListener('click',e=>{
  if(cam.drag)return;const rect=cvs.getBoundingClientRect(),sx=e.clientX-rect.left,sy=e.clientY-rect.top,wx=sx+cam.x,wy=sy+cam.y;
  for(const n of npcs){const dx=wx-n.x,dy=wy-n.y;if(Math.sqrt(dx*dx+dy*dy)<12){selectedVillager=n.vid;selectedHouse=null;updatePanel();return;}}
  const Z=getZones();
  for(const h of(houses||[])){const zone=Z.house;if(!zone||h.id>zone.length)continue;const[c,r]=zone[h.id-1]||[0,0];if(wx>=c*TS&&wx<=c*TS+TS&&wy>=r*TS&&wy<=r*TS+TS){selectedHouse=h.id;selectedVillager=null;updatePanel();return;}}
  const tc=Math.floor(wx/TS),tr=Math.floor(wy/TS);
  fetch('/api/game/map/'+tr+'/'+tc).then(r=>r.json()).then(d=>{
    let info='';if(d.treeCount===1)info+='🌳 Baum ';if(d.treesNearby>0)info+='🌲'+d.treesNearby+' Bäume ';if(d.stoneDeposit>0)info+='🪨'+Math.floor(d.stoneDeposit)+' ';if(d.stoneNearby>0)info+='⛰️~'+Math.floor(d.stoneNearby);
    if(info){floatText(info,sx,sy-15,'#fff');}
  });
  spawnClickFX(sx,sy);fetch('/api/game/click',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success)floatText('+0.1',sx,sy-30,'#888');});
});

let lt=0;
function loop(t){const dt=Math.min(.1,(t-lt)/1000);lt=t;gf++;wa+=.04;updateNPCs(dt);updateAnimals(dt);updateParticles(dt);for(let i=floatTexts.length-1;i>=0;i--){floatTexts[i].age+=dt;if(floatTexts[i].age>=floatTexts[i].life)floatTexts.splice(i,1);}render();requestAnimationFrame(loop);}
function resize(){W=window.innerWidth;H=window.innerHeight;cvs.width=W;cvs.height=H;}
function init(){resize();buildMap();genScenery();createAnimals();cam.x=Math.floor(MAP_COLS/2)*TS-W/2;cam.y=Math.floor(MAP_ROWS/2)*TS-H/2;cam.tx=cam.x;cam.ty=cam.y;fetchState().then(()=>{startPoll();lt=performance.now();requestAnimationFrame(loop);});}
window.addEventListener('load',init);window.addEventListener('resize',resize);
