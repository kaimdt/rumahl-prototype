// IORA Forge – Complete Canvas 2D with all features
const cv=document.getElementById('c'),ctx=cv.getContext('2d');
let W,H,TS=6,wW=800,wHgt=600;
let wMap=null,wH=null,wSpawn=null,walkable=null;
let resources={},buildings={},villagers=[],houses=[],prestige={points:0};
let mapTrees={},pathWear={},season={current:'spring'},dayCycle={isDay:true};
let consumption={food:0,wood:0},happiness=100,transportLvl=0,events={active:null};
let npcSprites=[],npcData=[],particles=[],floatT=[];
let cam={x:0,y:0,tx:0,ty:0};

async function api(p,m){m=m||'GET';const r=await fetch(p,{method:m});return r.json();}
async function fetchState(){
  const s=await api('/api/game/state');
  resources=s.resources;buildings=s.buildings;villagers=s.villagers;houses=s.houses||[];prestige=s.prestige;
  mapTrees=s.mapTrees||{};pathWear=s.pathWear||{};season=s.season;dayCycle=s.dayCycle||{isDay:true};
  consumption=s.consumption||{food:0,wood:0};happiness=s.happiness||100;transportLvl=s.transportLevel||0;
  if(s.worldMap){wMap=s.worldMap;wH=s.worldHeight;wW=wMap[0].length;wHgt=wMap.length;
    walkable=Array.from({length:wHgt},()=>Array(wW).fill(false));
    for(let r=0;r<wHgt;r++)for(let c=0;c<wW;c++)walkable[r][c]=wMap[r][c]!==2;}
  if(s.worldSpawn){wSpawn=s.worldSpawn;if(!cam.tx){cam.x=wSpawn.c*TS-W/2;cam.y=wSpawn.r*TS-H/2;cam.tx=cam.x;cam.ty=cam.y;}}
  syncNPCs();ui();
}
function syncNPCs(){
  const keep=npcSprites.filter(n=>villagers.some(v=>v.id===n.vid));
  for(const v of villagers)if(!keep.some(n=>n.vid===v.id))keep.push({vid:v.id,name:v.name,gender:v.gender||'male',job:v.job||'idle',age:v.age||'adult',tx:wSpawn.c+Math.random()*6-3,ty:wSpawn.r+Math.random()*6-3,married:v.married,pregnant:v.pregnant,level:v.level||1,partnerId:v.partnerId});
  npcSprites=keep;
  for(const n of npcSprites){const v=villagers.find(v=>v.id===n.vid);if(v){n.job=v.job;n.name=v.name;n.gender=v.gender;n.age=v.age;n.married=v.married;n.pregnant=v.pregnant;n.level=v.level||1;n.partnerId=v.partnerId;}}
  npcData=npcSprites.map(n=>{let d=npcData.find(d2=>d2.sprite===n);if(!d)d={sprite:n,path:null,pi:0,timer:2,spd:.6+Math.random()*.4};d.sprite=n;return d;});
}
function ui(){
  document.getElementById('res').innerHTML=Object.entries({food:'🌾',wood:'🪵',stone:'🪨',gold:'💰'}).map(([k,e])=>`<span class="r">${e}${fmt(resources[k]||0)}</span>`).join('');
  const tln=['🖐️','🛒','🐎'];let info='👥'+villagers.length+' | 🌟'+prestige.points+' | '+(dayCycle.isDay?'☀️':'🌙')+' '+(season.current||'')+' | '+tln[transportLvl];
  if(consumption.food>0||consumption.wood>0)info+=' | 🔻'+fmt(consumption.food);
  info+=' | 😊'+Math.round(happiness)+'%';
  const hour=(dayCycle.hour||8);const min=Math.floor(((dayCycle.timer||360)/720)*60)%60;
  info+=' | 🕐'+String(hour).padStart(2,'0')+':'+String(min).padStart(2,'0')+' J'+(season.year||1);
  document.getElementById('info').textContent=info;
  document.getElementById('bbar').innerHTML=['tent','house','lumberMill','farm','quarry','well','storage','forester','sawmill','bakery','forge','market','academy'].map(t=>{
    const b=buildings[t];
    if(!b||!b.name)return'';
    const a=b.canBuild,mx=b.count>=b.maxBuildings;
    return`<div class="bb${!a||mx?' d':''}" ${a&&!mx?`onclick="buy('${t}')"`:''} title="${b.desc||''}"><span class="i">${b.emoji||'?'}</span><span class="n">${b.name||t}</span><span class="c">${mx?'MAX':'×'+b.count}</span></div>`;
  }).join('');
}
function toast(m){const e=document.createElement('div');e.className='toast';e.textContent=m;document.getElementById('toasts').appendChild(e);setTimeout(()=>e.remove(),3000);}
function fmt(n){if(n>=1e3)return(n/1e3).toFixed(1)+'K';if(n>=100)return Math.floor(n);return n.toFixed(1);}
async function buy(t){const r=await api('/api/game/buy/'+t,'POST');if(r.ok){await fetchState();}else toast(r.reason||'Fehler');}
async function upgradeHouse(id){const r=await api('/api/game/upgrade-house/'+id,'POST');if(r.ok){await fetchState();toast('🏠 Upgrade!');}else toast(r.reason||'Fehler');}
async function save(){await api('/api/game/save','POST');toast('💾');}
async function load(){const r=await api('/api/game/load','POST');if(r.success){await fetchState();toast('📂');}else toast('Kein Stand');}

function findPath(sr,sc,er,ec){
  if(!walkable||!walkable[er]||!walkable[er][ec])return null;
  const H=wHgt,W2=wW,v=Array.from({length:H},()=>Array(W2).fill(false)),p=Array.from({length:H},()=>Array(W2).fill(null)),q=[[sr,sc]];v[sr][sc]=true;
  while(q.length){const[r,c]=q.shift();if(r===er&&c===ec){const pt=[];let cr=er,cc=ec;while(cr!==sr||cc!==sc){pt.unshift([cr,cc]);const n=p[cr][cc];if(!n)break;cr=n[0];cc=n[1];}return pt;}
    for(const[dr,dc]of[[0,1],[1,0],[0,-1],[-1,0]]){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<H&&nc>=0&&nc<W2&&!v[nr][nc]&&walkable[nr][nc]){v[nr][nc]=true;p[nr][nc]=[r,c];q.push([nr,nc]);}}}
  return null;
}

function updateNPCs(dt){
  for(const d of npcData){
    d.timer-=dt;
    if(d.timer<=0||!d.path||d.path.length===0){
      d.timer=2+Math.random()*4;
      const cr=Math.floor(d.sprite.ty),cc=Math.floor(d.sprite.tx);
      let tr=wSpawn.r+Math.floor(Math.random()*8-4),tc=wSpawn.c+Math.floor(Math.random()*8-4);
      if(d.sprite.job==='lumberjack'){tr=wSpawn.r-6;tc=wSpawn.c-8+Math.floor(Math.random()*4);}
      tr=Math.max(0,Math.min(wHgt-1,tr));tc=Math.max(0,Math.min(wW-1,tc));
      d.path=findPath(cr,cc,tr,tc);if(d.path)d.pi=0;
    }
    if(d.path&&d.pi<d.path.length){
      const[pr,pc]=d.path[d.pi],ttx=pc+.5,tty=pr+.5,dx=ttx-d.sprite.tx,dy=tty-d.sprite.ty,dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<.1){d.pi++;if(d.pi>=d.path.length)d.path=null;}
      else{const s=d.spd*dt*2;d.sprite.tx+=dx/dist*s;d.sprite.ty+=dy/dist*s;}
      pathWear[Math.floor(d.sprite.ty)+','+Math.floor(d.sprite.tx)]=Math.min(100,(pathWear[Math.floor(d.sprite.ty)+','+Math.floor(d.sprite.tx)]||0)+1);
    }
    d.sprite.fr+=dt*4;
  }
}

function drawTerrain(){
  if(!wMap)return;
  const sc=Math.max(0,Math.floor(cam.x/TS)-2),sr=Math.max(0,Math.floor(cam.y/TS)-2),ec=Math.min(wW,sc+Math.ceil(W/TS)+4),er=Math.min(wHgt,sr+Math.ceil(H/TS)+4);
  const BC={0:'#5a9c4f',1:'#4a8adf',2:'#2255aa',4:'#8a8a60',5:'#3a6c2f',7:'#3388bb',8:'#e8d8a0',9:'#1a4c1a',10:'#6a6a7a',11:'#7a7a60'};
  for(let r=sr;r<er;r++){if(!wMap[r])continue;for(let c=sc;c<ec;c++){const t=wMap[r][c],x=c*TS,y=r*TS;let col=BC[t]||'#5a9c4f';
    const wear=pathWear[r+','+c]||0;if(wear>25&&(t===0||t===5)){const a=Math.min(.6,(wear-25)/50);col=`rgb(${200-a*50},${160-a*50},${120-a*40})`;}
    if(!dayCycle.isDay){const d=.7;col=`rgb(${parseInt(col.slice(1,3),16)*d},${parseInt(col.slice(3,5),16)*d},${parseInt(col.slice(5,7),16)*d})`;}
    // Winter snow on high elevation
    if(season.current==='winter'&&wH&&wH[r]&&wH[r][c]>5){col='#d8e8d8';}
    ctx.fillStyle=col;ctx.fillRect(x,y,TS+1,TS+1);
  }}
}
function drawTrees(){
  if(!wMap||!mapTrees||!wSpawn)return;
  const sc=Math.floor(cam.x/TS)-3,sr=Math.floor(cam.y/TS)-3,ec=sc+Math.ceil(W/TS)+6,er=sr+Math.ceil(H/TS)+6;
  for(const[k,v]of Object.entries(mapTrees)){if(v!==1)continue;const[r,c]=k.split(',').map(Number);if(r<sr||r>er||c<sc||c>ec)continue;
    const x=c*TS+TS/2,y=r*TS+TS*.2;
    ctx.fillStyle='#6b3a2a';ctx.fillRect(x-1,y,2,TS*.3);ctx.fillRect(x-2,y+TS*.25,4,1);
    ctx.fillStyle=season.current==='winter'?'#c8d8c8':'#2d5a1e';ctx.fillRect(x-TS*.3,y-TS*.1,TS*.6,TS*.2);
    ctx.fillStyle=season.current==='winter'?'#d8e8d8':'#3a7a2a';ctx.fillRect(x-TS*.2,y-TS*.2,TS*.4,TS*.15);
    ctx.fillStyle=season.current==='winter'?'#e8f0e8':'#4a8a3a';ctx.fillRect(x-TS*.1,y-TS*.25,TS*.2,TS*.1);
  }
}
function drawBuildings(){
  if(!wSpawn)return;const sr=wSpawn.r,sc=wSpawn.c,s=TS;
  const cx=sc*s+s/2,cy=sr*s+s/2;
  // Campfire
  ctx.fillStyle='#777';for(let a=0;a<8;a++){ctx.fillRect(cx+Math.cos(a*Math.PI/4)*5-1,cy+Math.sin(a*Math.PI/4)*5-1,3,3);}
  ctx.fillStyle='#f60';ctx.fillRect(cx-2,cy-2,5,5);ctx.fillStyle='#fa0';ctx.fillRect(cx,cy-4,2,3);
  // Tents
  const tp=[[-3,-3],[-1,-4],[1,-4],[3,-3],[0,-5],[-5,-2]],tc2=buildings.tent?.count||0;
  for(let i=0;i<Math.min(tc2,6);i++){const p=tp[i]||[0,3],x=(sc+p[0])*s,y=(sr+p[1])*s;
    ctx.fillStyle='#e8d8b8';ctx.fillRect(x+s*.2,y+s*.3,s*.6,s*.7);
    ctx.fillStyle='#c4956a';ctx.fillRect(x+s*.1,y+s*.05,s*.8,s*.3);
    ctx.fillStyle='#4a2a1a';ctx.fillRect(x+s*.35,y+s*.45,s*.3,s*.55);
  }
  // Houses
  const hg=[[2,2],[5,2],[2,5],[5,5],[8,2],[8,5],[2,8],[5,8]];
  houses.slice(0,8).forEach((h,i)=>{const p=hg[i]||[i*3,5+i],x=(sc+p[0])*s,y=(sr+p[1])*s,lv=h.level||1;
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(x+1,y+s*.85,s-2,2);
    ctx.fillStyle='#f0e4c8';ctx.fillRect(x+1,y+s*.3,s-2,s*.65);
    ctx.fillStyle='#a08060';ctx.fillRect(x+2,y+s*.35,2,s*.6);ctx.fillRect(x+s-4,y+s*.35,2,s*.6);
    ctx.fillStyle='#cc4a3a';ctx.fillRect(x,y+s*.05,s,s*.3);ctx.fillStyle='#dd5a4a';ctx.fillRect(x+1,y+s*.08,s-2,1);ctx.fillRect(x+1,y+s*.15,s-2,1);
    ctx.fillStyle='#6b3a2a';ctx.fillRect(x+s*.4,y+s*.5,s*.2,s*.5);
    ctx.fillStyle='#8cc8f0';ctx.fillRect(x+s*.7,y+s*.45,s*.12,s*.18);
    ctx.fillStyle='#8a7a6a';ctx.fillRect(x+s*.75,y+s*.05,s*.07,s*.18);
    if(lv>1)for(let st=0;st<Math.min(lv-1,6);st++){ctx.fillStyle='#fd0';ctx.fillRect(x+2+st*4,y-1,3,3);}
    if(lv>=3){ctx.fillStyle='#c4956a';for(let f=0;f<4;f++)ctx.fillRect(x+1+f*s*.2,y+s*.75,1,s*.1);}
  });
  // Production buildings
  const prodBld=[['lumberMill','🪓',-8,-6,'#8b6914','#c4956a'],['farm','🌾',-8,6,'#8a6a3a','#7ec850'],
    ['quarry','⛏️',8,6,'#8a8a7a','#9a9a8a'],['well','🪣',0,6,'#8a8a7a','#6abaff'],
    ['storage','🏚️',8,-4,'#a08060','#c4a050'],['forester','🌲',-10,-4,'#3a7c2f','#5a9c4f'],
    ['sawmill','🪚',10,-6,'#c4956a','#ccc'],['bakery','🍞',-6,8,'#e8d040','#c4956a'],
    ['forge','⚒️',6,8,'#6a6a7a','#f80'],['market','🏪',3,-4,'#ff8866','#fd0'],
    ['academy','📚',10,-2,'#c4a0ff','#e0d0ff']];
  prodBld.forEach(([type,emoji,ox,oy,wallCol,roofCol])=>{
    const cnt=buildings[type]?.count||0;if(cnt===0)return;
    for(let i=0;i<Math.min(cnt,3);i++){
      const x=(sc+ox+i*2)*s,y=(sr+oy)*s;
      ctx.fillStyle=wallCol;ctx.fillRect(x+1,y+s*.4,s-2,s*.6);
      ctx.fillStyle=roofCol;ctx.fillRect(x,y+s*.1,s,s*.35);
      ctx.fillStyle='#6b3a2a';ctx.fillRect(x+s*.4,y+s*.6,s*.2,s*.4);
      ctx.fillStyle='#fff';ctx.font='6px monospace';ctx.textAlign='center';ctx.fillText(emoji,x+s/2,y+s*.3);
    }
  });
}
function drawNPCs(){
  const zs=TS/8; // Scale NPCs with zoom (smaller base)
  npcData.forEach(d=>{const n=d.sprite,isC=n.age==='child',sc=(isC?.6:1)*zs,px=n.tx*TS,py=n.ty*TS,bob=Math.sin(n.fr||0)*2*zs;
    ctx.fillStyle='rgba(0,0,0,.15)';ctx.fillRect(px-2*sc,py+6*sc,4*sc,1*sc);
    ctx.fillStyle='#3a2a1a';ctx.fillRect(px-1*sc,py+3*sc,1*sc,3*sc);ctx.fillRect(px+1*sc,py+3*sc,1*sc,3*sc);
    const bc=n.gender==='male'?'#5577cc':'#dd7799';ctx.fillStyle=bc;ctx.fillRect(px-3*sc,py-1*sc,6*sc,5*sc);
    ctx.fillStyle=bc;ctx.fillRect(px-5*sc,py,2*sc,3*sc);ctx.fillRect(px+3*sc,py,2*sc,3*sc);
    ctx.fillStyle='#ffe0bd';ctx.fillRect(px-2*sc,py-5*sc+bob,4*sc,4*sc);
    ctx.fillStyle=n.gender==='male'?'#553311':'#885533';
    if(n.gender==='male')ctx.fillRect(px-3*sc,py-7*sc,6*sc,2*sc);else{ctx.fillRect(px-2*sc,py-8*sc,4*sc,4*sc);ctx.fillRect(px-4*sc,py-7*sc,2*sc,3*sc);ctx.fillRect(px+2*sc,py-7*sc,2*sc,3*sc);}
    ctx.fillStyle='#000';ctx.fillRect(px-1*sc,py-4*sc+bob,1*sc,1*sc);ctx.fillRect(px+1*sc,py-4*sc+bob,1*sc,1*sc);
    if(n.job&&n.job!=='idle'&&!isC){ctx.fillStyle='#864';ctx.fillRect(px-3*sc,py-9*sc,6*sc,2*sc);}
    if(n.pregnant){ctx.fillStyle='#f8c';ctx.fillRect(px-4*sc,py-2*sc,2*sc,2*sc);}
    if((n.level||1)>1)for(let s3=0;s3<Math.min((n.level||1)-1,4);s3++){ctx.fillStyle='#fd0';ctx.fillRect(px-4*sc+s3*3*sc,py-10*sc,2*sc,2*sc);}
    if(n.married){ctx.fillStyle='#f8f';ctx.fillRect(px+3*sc,py-8*sc,2*sc,2*sc);}
  });
}

function render(){
  ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(-cam.x,-cam.y);
  drawTerrain();drawTrees();drawBuildings();drawNPCs();
  // Night overlay
  if(!dayCycle.isDay){ctx.fillStyle='rgba(10,10,40,.25)';ctx.fillRect(cam.x,cam.y,W,H);}
  ctx.restore();
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];ctx.globalAlpha=1-p.age/p.ml;ctx.fillStyle=p.c;ctx.fillRect(p.x-2,p.y-2,4,4);if((p.age+=.016)>=p.ml)particles.splice(i,1);}ctx.globalAlpha=1;
  for(let i=floatT.length-1;i>=0;i--){const f=floatT[i];ctx.fillStyle=f.c;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText(f.m,f.x,f.y-f.age*30);if((f.age+=.016)>=f.life)floatT.splice(i,1);}
  const tb=Object.values(buildings||{}).reduce((s,b)=>s+(b?.count||0),0);
  if(tb<=2){ctx.fillStyle='rgba(255,215,0,'+(.3+Math.sin(Date.now()*.003)*.15)+')';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText('💼 Weise Bewohnern Jobs zu!',W/2,30);}
}

// Input
let down=false,mx=0,my=0,cx2=0,cy2=0;
cv.addEventListener('pointerdown',e=>{if(e.clientY<28||e.clientY>innerHeight-45)return;down=true;mx=e.clientX;my=e.clientY;cx2=cam.tx;cy2=cam.ty;});
cv.addEventListener('pointermove',e=>{
  if(down&&(Math.abs(e.clientX-mx)>5||Math.abs(e.clientY-my)>5)){cam.tx=cx2-(e.clientX-mx);cam.ty=cy2-(e.clientY-my);}
});
cv.addEventListener('pointerup',e=>{
  if(Math.abs(e.clientX-mx)<5&&Math.abs(e.clientY-my)<5){
    const rx=e.clientX-cv.getBoundingClientRect().left,ry=e.clientY-cv.getBoundingClientRect().top,wx=rx+cam.x,wy=ry+cam.y;
    // NPC click - show side panel
    for(const n of npcSprites){const px=n.tx*TS,py=n.ty*TS;if(Math.abs(wx-px)<10&&Math.abs(wy-py)<10){
      const v=villagers.find(v=>v.id===n.vid);if(v)showVillagerPanel(v);break;}
    }
    // House click
    for(let i=0;i<(houses||[]).length;i++){const h=houses[i];const hg=[[2,2],[5,2],[2,5],[5,5],[8,2],[8,5],[2,8],[5,8]];const p2=hg[i]||[i*3,5+i];
      const hx=(wSpawn.c+p2[0])*TS,hy=(wSpawn.r+p2[1])*TS;
      if(wx>=hx&&wx<=hx+TS&&wy>=hy&&wy<=hy+TS){showHousePanel(i+1,h);break;}
    }
    // Map info
    const tc=Math.floor(wx/TS),tr=Math.floor(wy/TS);
    fetch('/api/game/map/'+tr+'/'+tc).then(r=>r.json()).then(d=>{if(d.biome)toast(d.biome+(d.treesNearby?' 🌲'+d.treesNearby:'')+(d.stoneDeposit?' 🪨'+d.stoneDeposit:''));});
    for(let i=0;i<4;i++)particles.push({x:rx,y:ry,age:0,ml:.3+Math.random()*.2,c:'#fd0'});
  }
  down=false;cam.tx=cam.x;cam.ty=cam.y;
});
cv.addEventListener('wheel',e=>{e.preventDefault();const old=TS;const factor=1-e.deltaY*0.0003;TS=Math.max(2,Math.min(48,TS*factor));const rx=e.clientX-cv.getBoundingClientRect().left,ry=e.clientY-cv.getBoundingClientRect().top;cam.x=(cam.x+rx)*(TS/old)-rx;cam.y=(cam.y+ry)*(TS/old)-ry;cam.tx=cam.x;cam.ty=cam.y;},{passive:false});

function loop(t){const dt=.016;cam.x+=(cam.tx-cam.x)*.2;cam.y+=(cam.ty-cam.y)*.2;updateNPCs(dt);render();requestAnimationFrame(loop);}
function resize(){W=innerWidth;H=innerHeight;cv.width=W;cv.height=H;}
window.addEventListener('resize',resize);
async function init(){resize();await fetchState();requestAnimationFrame(loop);setInterval(async()=>{try{const d=await api('/api/game/tick');if(d.resources){resources=d.resources;dayCycle=d.dayCycle||{isDay:true};season=d.season||season;consumption=d.consumption||{food:0,wood:0};happiness=d.happiness||100;if(d.activeEvent)toast(d.activeEvent.emoji+' '+d.activeEvent.name+': '+d.activeEvent.msg);ui();}}catch(e){}},1000);}

// Side panels
function showVillagerPanel(v){
  const p=document.getElementById('sidepanel');if(!p)return;
  let h='<div style="display:flex;justify-content:space-between"><b>'+(v.gender==='male'?'♂️':'♀️')+' '+v.name+'</b><span onclick="closePanel()" style="cursor:pointer;color:#c44">✕</span></div>';
  h+='<div style="font-size:.6rem;margin:4px 0">'+(v.age==='child'?'👶 Kind':v.pregnant?'🤰 Schwanger':'')+' | '+(v.jobInfo?.name||'Arbeitslos')+' '+(v.jobInfo?.emoji||'')+'</div>';
  h+='<div style="font-size:.6rem">⭐ Level '+(v.level||1)+' | XP: '+(v.xp||0)+'</div>';
  if(v.married){const p2=villagers.find(p=>p.id===v.partnerId);if(p2)h+='<div style="font-size:.6rem">💒 Verheiratet mit '+p2.name+'</div>';}
  h+='<div style="font-size:.55rem;color:#888">Alter: '+Math.floor((v.ageTicks||0)/60)+'min / '+Math.floor((v.maxAge||3600)/60)+'min</div>';
  h+='<button onclick="closePanel()" style="margin-top:6px;padding:2px 8px;font-size:.6rem;font-family:monospace">Schließen</button>';
  p.innerHTML=h;p.style.display='block';
}
function showHousePanel(id,h){
  const p=document.getElementById('sidepanel');if(!p)return;
  let ht='<div style="display:flex;justify-content:space-between"><b>🏠 Haus #'+id+'</b><span onclick="closePanel()" style="cursor:pointer;color:#c44">✕</span></div>';
  ht+='<div style="font-size:.6rem;margin:4px 0">Stufe: '+'⭐'.repeat(Math.min(h.level||1,10))+' ('+(h.level||1)+')</div>';
  // Find residents (married couples)
  const residents=villagers.filter(v=>v.married);
  if(residents.length>0){ht+='<div style="font-size:.55rem;margin:4px 0">Bewohner (anklickbar):</div>';residents.slice(0,4).forEach(r=>{ht+='<div onclick="showVillagerPanelById('+r.id+')" style="font-size:.55rem;padding:1px 0;cursor:pointer;color:#8cf">'+(r.gender==='male'?'♂️':'♀️')+' '+r.name+' - '+(r.jobInfo?.name||'Idle')+'</div>';});}
  else ht+='<div style="font-size:.55rem">Leerstand</div>';
  const cost={wood:20+h.level*20,stone:10+h.level*10};
  const aff=Object.entries(cost).every(([r,a])=>(resources[r]||0)>=a);
  ht+='<button '+(aff?'onclick="upgradeHouse('+h.id+')"':'disabled')+' style="margin-top:6px;padding:2px 8px;font-size:.6rem;font-family:monospace">⬆️ Upgrade ('+cost.wood+'🪵'+cost.stone+'🪨)</button>';
  ht+='<button onclick="closePanel()" style="margin:4px 0 0 4px;padding:2px 8px;font-size:.6rem;font-family:monospace">Schließen</button>';
  p.innerHTML=ht;p.style.display='block';
}
function closePanel(){const p=document.getElementById('sidepanel');if(p)p.style.display='none';}
function showVillagerPanelById(id){const v=villagers.find(v=>v.id===id);if(v)showVillagerPanel(v);}
init();
