/* ============================================================
   rumahl Forge v3 – Unlimited Idle Village
   Seasons • Consumption • Path Formation • Per-House Upgrades
   Village Stages • 12+ Jobs • Event Algorithm • Big Map
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// ---- rumahl Storage ----
const RUMAHL_HOME = process.env.RUMAHL_HOME_URL || 'http://rumahl-home:3001';
const SAVE_FILE = 'savegame.json';
function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.RUMAHL_API_KEY) h['Authorization'] = 'Bearer ' + process.env.RUMAHL_API_KEY;
  return h;
}
async function saveORA(d) {
  try { const r = await fetch(RUMAHL_HOME + '/api/apps/rumahl-forge/storage/files/' + SAVE_FILE, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(d) }); return r.ok; } catch (e) { return false; }
}
async function loadORA() {
  try { const r = await fetch(RUMAHL_HOME + '/api/apps/rumahl-forge/storage/files/' + SAVE_FILE, { method: 'GET', headers: getHeaders() }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

// ---- Constants ----
const MAP_COLS = 800, MAP_ROWS = 600;
const SEASON_DURATION = 300;

// ---- Noise Map Generator ----
function hash(x, y, seed) {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) / 2147483648;
}

function smoothNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash(ix, iy, seed), n10 = hash(ix + 1, iy, seed);
  const n01 = hash(ix, iy + 1, seed), n11 = hash(ix + 1, iy + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fractalNoise(x, y, seed, octaves = 4, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

function generateWorldMap(seed) {
  const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(2)); // Start all water
  const heightMap = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(0));

  // Define multiple islands
  const islands = [
    { cx: MAP_COLS*0.45, cy: MAP_ROWS*0.5, rx: MAP_COLS*0.40, ry: MAP_ROWS*0.35, main:true },
    { cx: MAP_COLS*0.88, cy: MAP_ROWS*0.12, rx: MAP_COLS*0.08, ry: MAP_ROWS*0.07, main:false, rare:'gems' },
    { cx: MAP_COLS*0.08, cy: MAP_ROWS*0.82, rx: MAP_COLS*0.07, ry: MAP_ROWS*0.06, main:false, rare:'spice' },
    { cx: MAP_COLS*0.85, cy: MAP_ROWS*0.82, rx: MAP_COLS*0.09, ry: MAP_ROWS*0.08, main:false, rare:'ore' },
    { cx: MAP_COLS*0.15, cy: MAP_ROWS*0.18, rx: MAP_COLS*0.06, ry: MAP_ROWS*0.05, main:false, rare:'gems' },
  ];

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      let bestElevation = -999;
      for (const isl of islands) {
        const dx = (c - isl.cx) / isl.rx, dy = (r - isl.cy) / isl.ry;
        let dist = Math.sqrt(dx*dx + dy*dy);
        const coastNoise = fractalNoise(c*0.03, r*0.03, seed+isl.cx, 2, 2, 0.5)*0.25;
        dist += coastNoise;
        const e = 1.0 - dist;
        if (e > bestElevation) bestElevation = e;
      }

      if (bestElevation < -0.05) { map[r][c]=2; heightMap[r][c]=0; }
      else if (bestElevation < 0.02) { map[r][c]=7; heightMap[r][c]=0.3; }
      else if (bestElevation < 0.08) { map[r][c]=8; heightMap[r][c]=0.8; }
      else {
        const terrainNoise = fractalNoise(c*0.04, r*0.04, seed+2000, 4, 2, 0.5);
        const mountainNoise = fractalNoise(c*0.012, r*0.012, seed+5000, 2, 2, 0.5);
        const h = 1 + bestElevation * 6 + terrainNoise * 1.5 + mountainNoise * 3;
        heightMap[r][c] = Math.max(1, Math.min(10, h));
        const moisture = fractalNoise(c*0.02+3000, r*0.02+3000, seed, 2, 2, 0.5);
        if (bestElevation < 0.15) map[r][c]=0;
        else if (bestElevation < 0.40) map[r][c]=moisture>0.4?9:5;
        else if (bestElevation < 0.60) map[r][c]=4;
        else if (bestElevation < 0.80) map[r][c]=11;
        else map[r][c]=10;
      }
    }
  }

  const mainIsland = islands[0];
  // Lakes
  for (let i = 0; i < 8; i++) {
    const lr = mainIsland.cy + (Math.random() - 0.5) * mainIsland.ry * 0.5;
    const lc = mainIsland.cx + (Math.random() - 0.5) * mainIsland.rx * 0.5;
    for (let rr = -2; rr <= 2; rr++) {
      for (let cc = -2; cc <= 2; cc++) {
        const tr = Math.floor(lr) + rr, tc = Math.floor(lc) + cc;
        if (tr >= 0 && tr < MAP_ROWS && tc >= 0 && tc < MAP_COLS) {
          if (map[tr][tc] !== 2 && map[tr][tc] !== 7 && heightMap[tr][tc] < 3) {
            map[tr][tc] = 2; heightMap[tr][tc] = 0;
          }
        }
      }
    }
  }

  // Rivers: flow from high elevation to coast
  for (let i = 0; i < 6; i++) {
    let rr = mainIsland.cy + (Math.random() - 0.5) * mainIsland.ry * 0.4;
    let cc = mainIsland.cx + (Math.random() - 0.5) * mainIsland.rx * 0.4;
    for (let step = 0; step < 120; step++) {
      const ir = Math.floor(rr), ic = Math.floor(cc);
      if (ir < 1 || ir >= MAP_ROWS - 1 || ic < 1 || ic >= MAP_COLS - 1) break;
      if (map[ir][ic] === 2 || map[ir][ic] === 7) break;
      map[ir][ic] = 1; map[Math.max(0,ir-1)][ic] = map[Math.max(0,ir-1)][ic] === 0 ? 1 : map[Math.max(0,ir-1)][ic];
      heightMap[ir][ic] = Math.max(0, heightMap[ir][ic] - 0.5);
      // Flow downhill
      let lowest = 99, nr = ir, nc = ic;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const tr2 = ir + dr, tc2 = ic + dc;
        if (tr2 >= 0 && tr2 < MAP_ROWS && tc2 >= 0 && tc2 < MAP_COLS && heightMap[tr2][tc2] < lowest) {
          lowest = heightMap[tr2][tc2]; nr = tr2; nc = tc2;
        }
      }
      rr = nr; cc = nc;
    }
  }

  // Spawn on main island
  const spawnR = Math.floor(mainIsland.cy + mainIsland.ry*0.2);
  const spawnC = Math.floor(mainIsland.cx + mainIsland.rx*0.1);

  return { map, heightMap, spawn: { r: spawnR, c: spawnC }, islands, seed };
}
const PRESTIGE_THRESHOLD = 100000;
const CHILD_GROW_TIME = 360; // 6 min to reach working age (6 years)
const PREGNANCY_DURATION = 120; // 2 min pregnancy
const WANDERER_INTERVAL = 30, REPRODUCTION_INTERVAL = 60, AUTO_BUILD_INTERVAL = 120;
const EVENT_INTERVAL = 120;
const DAY_LENGTH = 720; // 12 min day, 12 min night = 24min cycle

// ---- Building Definitions ----
const BUILDING_DEFS = {
  campfire:   { n:'Lagerfeuer', e:'🔥', cost:{}, max:1, pre:[], vps:4, stage:'camp', desc:'Basis-Camp' },
  tent:       { n:'Zelt', e:'⛺', cost:{wood:10}, max:6, pre:['campfire'], vps:2, stage:'camp', desc:'+2 Wohnplatz' },
  house:      { n:'Haus', e:'🏠', cost:{wood:60,stone:25}, max:20, pre:['tent'], vps:3, stage:'settlement', desc:'+3 Wohnplatz, upgradable' },
  lumberMill: { n:'Holzfäller', e:'🪓', cost:{wood:30,stone:15}, max:6, pre:['house'], vps:0, stage:'hamlet', prod:{wood:0.5}, desc:'+50% Holz/Holzfäller' },
  farm:       { n:'Farm', e:'🌾', cost:{wood:40,food:25}, max:8, pre:['house'], vps:0, stage:'hamlet', prod:{food:0.5}, desc:'+50% Nahrung/Bauer' },
  quarry:     { n:'Steinbruch', e:'⛏️', cost:{wood:60,stone:30}, max:5, pre:['house'], vps:0, stage:'hamlet', prod:{stone:0.4}, desc:'+50% Stein/Bergmann' },
  well:       { n:'Brunnen', e:'🪣', cost:{stone:40,wood:20}, max:3, pre:['house'], vps:0, stage:'settlement', prod:{food:0.2}, desc:'Grund-Nahrung' },
  market:     { n:'Marktplatz', e:'🏪', cost:{wood:100,gold:50,stone:50}, max:3, pre:['house'], vps:0, stage:'village', prod:{gold:0.5}, desc:'Handel & Gold' },
  academy:    { n:'Akademie', e:'📚', cost:{stone:200,gold:100,knowledge:50}, max:3, pre:['house'], vps:0, stage:'village', prod:{knowledge:0.3}, desc:'Wissen & Forschung' },
  bakery:     { n:'Bäckerei', e:'🍞', cost:{wood:50,stone:30,food:40}, max:3, pre:['farm'], vps:0, stage:'hamlet', prod:{food:0.8}, desc:'+Nahrung/Bäcker' },
  forge:      { n:'Schmiede', e:'⚒️', cost:{stone:80,wood:40,gold:30}, max:3, pre:['quarry'], vps:0, stage:'village', prod:{gold:0.6,stone:0.3}, desc:'Werkzeuge & Gold' },
  watchtower: { n:'Wachturm', e:'🗼', cost:{wood:80,stone:100}, max:4, pre:['house'], vps:0, stage:'town', prod:{}, desc:'Schutz vor Gefahren' },
  townhall:   { n:'Rathaus', e:'🏛️', cost:{wood:200,stone:200,gold:100}, max:1, pre:['market'], vps:0, stage:'town', prod:{knowledge:0.5}, desc:'Dorf-Verwaltung' },
  forester:   { n:'Förster', e:'🌲', cost:{wood:30,stone:10}, max:4, pre:['lumberMill'], vps:0, stage:'hamlet', prod:{wood:0.3}, desc:'Pflanzt Bäume, +Holz-Regeneration', needsWater:false, needsForest:true },
  sawmill:    { n:'Sägewerk', e:'🪚', cost:{wood:80,stone:50,planks:10}, max:3, pre:['lumberMill'], vps:0, stage:'village', prod:{planks:0.3}, desc:'Verarbeitet Holz zu Brettern (nur am Fluss!)', needsWater:true },
  storage:    { n:'Lagerhaus', e:'🏚️', cost:{wood:60,stone:40}, max:5, pre:['house'], vps:0, stage:'settlement', prod:{}, desc:'Zentrales Lager für Ressourcen' },
  ranch:      { n:'Viehzucht', e:'🐄', cost:{wood:80,food:50}, max:4, pre:['farm'], vps:0, stage:'hamlet', prod:{food:1}, desc:'Tierhaltung: Kühe, Schweine, Schafe' },
  traderpost: { n:'Handelsposten', e:'🏪', cost:{wood:100,stone:50,gold:30}, max:3, pre:['market'], vps:0, stage:'village', prod:{gold:0.8}, desc:'Import/Export von Waren' },
  tailor:     { n:'Schneiderei', e:'🧵', cost:{wood:40,planks:20}, max:3, pre:['house'], vps:0, stage:'hamlet', prod:{gold:0.3}, desc:'Kleidung & Stoffe' },
};

// ---- Village Stages ----
const STAGES = {
  camp:       { n:'Camp', e:'🏕️', minPop:0, maxPop:4, unlocks:['campfire','tent'] },
  settlement: { n:'Siedlung', e:'🏘️', minPop:5, maxPop:10, unlocks:['house','well'] },
  hamlet:     { n:'Weiler', e:'🏡', minPop:11, maxPop:24, unlocks:['lumberMill','farm','quarry','bakery'] },
  village:    { n:'Dorf', e:'🏰', minPop:25, maxPop:59, unlocks:['market','academy','forge'] },
  town:       { n:'Stadt', e:'🏙️', minPop:60, maxPop:999, unlocks:['watchtower','townhall'] },
};

function getStage(pop) {
  for (const [k, s] of Object.entries(STAGES)) {
    if (pop >= s.minPop && pop <= s.maxPop) return k;
  }
  return 'town';
}

// ---- Jobs (unlock based on buildings & stage) ----
const JOB_DEFS = {
  idle:       { n:'Arbeitslos', e:'😴', unlockStage:'camp', prod:{} },
  lumberjack: { n:'Holzfäller', e:'🪓', unlockStage:'camp', prod:{wood:2} },
  gatherer:   { n:'Sammler', e:'🧺', unlockStage:'camp', prod:{food:1.5,wood:0.3,stone:0.2} },
  builder:    { n:'Bauer', e:'🔨', unlockStage:'settlement', prod:{wood:0.5,stone:0.5}, needsBuilding:'house' },
  farmer:     { n:'Landwirt', e:'🌾', unlockStage:'hamlet', prod:{food:3}, needsBuilding:'farm' },
  miner:      { n:'Bergmann', e:'⛏️', unlockStage:'hamlet', prod:{stone:2}, needsBuilding:'quarry' },
  baker:      { n:'Bäcker', e:'🍞', unlockStage:'hamlet', prod:{food:4}, needsBuilding:'bakery' },
  trader:     { n:'Händler', e:'💰', unlockStage:'village', prod:{gold:2}, needsBuilding:'market' },
  scholar:    { n:'Gelehrter', e:'📚', unlockStage:'village', prod:{knowledge:1.5}, needsBuilding:'academy' },
  smith:      { n:'Schmied', e:'⚒️', unlockStage:'village', prod:{gold:1.5,stone:1}, needsBuilding:'forge' },
  guard:      { n:'Wächter', e:'🛡️', unlockStage:'town', prod:{}, needsBuilding:'watchtower' },
  mayor:      { n:'Bürgermeister', e:'👑', unlockStage:'town', prod:{knowledge:2,gold:1}, needsBuilding:'townhall' },
  forester:   { n:'Förster', e:'🌲', unlockStage:'hamlet', prod:{wood:1.5}, needsBuilding:'forester' },
  sawyer:     { n:'Säger', e:'🪚', unlockStage:'village', prod:{planks:1}, needsBuilding:'sawmill' },
  courier:    { n:'Bote', e:'📦', unlockStage:'settlement', prod:{}, needsBuilding:'storage' },
  rancher:    { n:'Viehzüchter', e:'🐄', unlockStage:'hamlet', prod:{food:3}, needsBuilding:'ranch' },
  trader:     { n:'Händler', e:'🏪', unlockStage:'village', prod:{gold:2}, needsBuilding:'traderpost' },
  tailor:     { n:'Schneider', e:'🧵', unlockStage:'hamlet', prod:{gold:1}, needsBuilding:'tailor' },
};

// ---- Seasons ----
const SEASONS = ['spring','summer','autumn','winter'];
const SEASON_MODS = {
  spring: { food: 1.0, wood: 1.0, stone: 1.0, gold: 1.0, knowledge: 1.0, desc:'🌸 Frühling' },
  summer: { food: 1.3, wood: 0.8, stone: 1.0, gold: 1.1, knowledge: 1.0, desc:'☀️ Sommer' },
  autumn: { food: 1.1, wood: 1.2, stone: 1.0, gold: 1.0, knowledge: 1.1, desc:'🍂 Herbst' },
  winter: { food: 0.5, wood: 0.6, stone: 0.8, gold: 0.7, knowledge: 1.2, desc:'❄️ Winter (Heizung nötig!)' },
};

// ---- Events ----
const EVENT_TYPES = [
  { id:'wolf_attack', n:'Wolfsangriff!', e:'🐺', minStage:'settlement', effect(s){ s.resources.food=Math.max(0,s.resources.food-20); return '20 Nahrung verloren!'; } },
  { id:'trader_caravan', n:'Handelskarawane', e:'🐪', minStage:'hamlet', effect(s){ s.resources.gold+=30; s.resources.food+=10; return '+30 Gold, +10 Nahrung!'; } },
  { id:'drought', n:'Dürre', e:'☀️', minStage:'settlement', effect(s){ s.resources.food=Math.max(0,s.resources.food-40); return 'Felder vertrocknet, -40 Nahrung!'; } },
  { id:'festival', n:'Dorffest', e:'🎉', minStage:'village', effect(s){ s.resources.gold+=20; s.resources.knowledge+=10; return '+20 Gold, +10 Wissen!'; } },
  { id:'baby_boom', n:'Baby-Boom', e:'👶', minStage:'hamlet', effect(s){ return 'Mehr Babys diese Saison!'; } },
  { id:'plague', n:'Seuche', e:'🤒', minStage:'village', effect(s){ const n=Math.max(1,Math.floor(s.villagers.length*0.1)); s.villagers.splice(-n,n); return n+' Bewohner gestorben!'; } },
  { id:'rich_deposit', n:'Reiche Erzader', e:'💎', minStage:'hamlet', effect(s){ s.resources.stone+=50; s.resources.gold+=20; return '+50 Stein, +20 Gold!'; } },
  { id:'forest_fire', n:'Waldbrand', e:'🔥', minStage:'hamlet', effect(s){ s.resources.wood=Math.max(0,s.resources.wood-50); return '50 Holz verbrannt!'; } },
  { id:'traveling_scholar', n:'Gelehrter auf Reisen', e:'📖', minStage:'village', effect(s){ s.resources.knowledge+=30; return '+30 Wissen!'; } },
];

// ---- State ----
function createState() {
  const seed = Math.floor(Math.random() * 1000000);
  const worldData = generateWorldMap(seed);
  return {
    resources: { food: 30, wood: 20, stone: 0, gold: 0, knowledge: 0, planks: 0 },
    buildings: {},
    houses: [],
    worldMap: worldData.map,
    worldHeight: worldData.heightMap,
    worldSpawn: worldData.spawn,
    worldSeed: seed, // [{id,level}] individual houses for per-house upgrades
    villagers: [],
    prestige: { points: 0, multiplier: 1.0 },
    stats: { totalClicks: 0, totalProd: { food:0, wood:0, stone:0, gold:0, knowledge:0 }, prestigeCount: 0, startedAt: Date.now(), lastSaved: Date.now() },
    achievements: [],
    autonomy: { level:0, wanderersEnabled:false, reproductionEnabled:false, autoBuildEnabled:false, children:0, wanderersArrived:0, totalBorn:0, autoBuilt:0, lastWandererCheck:Date.now(), lastReproductionCheck:Date.now(), lastAutoBuildCheck:Date.now() },
    season: { current:'spring', timer:SEASON_DURATION, year:1 },
    dayCycle: { isDay:true, timer:DAY_LENGTH/2, hour:8 }, // start at 8am
    pathWear: {}, // "row,col" -> wear level (0-100)
    villageStage: 'camp',
    consumption: { food:0, wood:0 },
    events: { active:null, cooldown:0, history:[], lastEvent:0 },
    mapTrees: {},
    stoneDeposits: {},
    transportLevel: 0,
    dayCycle: { isDay:true, timer:DAY_LENGTH/2, hour:8 },
    exploration: { islands:0, rareResources:{gems:0,spice:0,ore:0} },
    version: 7,
  };
}

function initNewGame(s) {
  if (!s.worldMap || !s.worldSpawn) {
    const wd = generateWorldMap(s.worldSeed || Math.floor(Math.random() * 1000000));
    s.worldMap = wd.map;
    s.worldSpawn = wd.spawn;
    s.worldSeed = wd.seed;
  }
  for (const [id, def] of Object.entries(BUILDING_DEFS)) s.buildings[id] = { count: 0, level: 1 };
  s.buildings.campfire.count = 1;
  s.buildings.tent.count = 2;
  const baseLife = 7200; // 2 hours base lifespan
  s.villagers = [
    { id:1, name:'Hans', gender:'male', job:'idle', age:'adult', ageTimer:0, level:1, xp:0, ageTicks:0, maxAge:baseLife+Math.floor(Math.random()*3600), since:Date.now(), partnerId:null, childrenIds:[], parentsIds:[], married:false, pregnant:false, pregnancyTimer:0 },
    { id:2, name:'Greta', gender:'female', job:'idle', age:'adult', ageTimer:0, level:1, xp:0, ageTicks:0, maxAge:baseLife+Math.floor(Math.random()*3600), since:Date.now(), partnerId:null, childrenIds:[], parentsIds:[], married:false, pregnant:false, pregnancyTimer:0 },
    { id:3, name:'Otto', gender:'male', job:'idle', age:'adult', ageTimer:0, level:1, xp:0, ageTicks:0, maxAge:baseLife+Math.floor(Math.random()*3600), since:Date.now(), partnerId:null, childrenIds:[], parentsIds:[], married:false, pregnant:false, pregnancyTimer:0 },
    { id:4, name:'Lina', gender:'female', job:'idle', age:'adult', ageTimer:0, level:1, xp:0, ageTicks:0, maxAge:baseLife+Math.floor(Math.random()*3600), since:Date.now(), partnerId:null, childrenIds:[], parentsIds:[], married:false, pregnant:false, pregnancyTimer:0 },
  ];
  // Hans & Greta start as married couple
  s.villagers[0].partnerId = 2; s.villagers[0].married = true;
  s.villagers[1].partnerId = 1; s.villagers[1].married = true;
  s.houses = [];
  s.pathWear = {};
  s.mapTrees = {};
  // Generate initial trees (VERY dense forests)
  for(let r=1;r<MAP_ROWS-1;r++)for(let c=1;c<MAP_COLS-1;c++){
    const t=s.worldMap?.[r]?.[c]||0;
    if(t===9&&Math.random()<0.9)s.mapTrees[r+','+c]=1;
    else if(t===5&&Math.random()<0.8)s.mapTrees[r+','+c]=1;
    else if(t===0&&Math.random()<0.25)s.mapTrees[r+','+c]=1;
    else if(t===4&&Math.random()<0.15)s.mapTrees[r+','+c]=1;
  }
  // Generate stone deposits (scattered around map)
  s.stoneDeposits = {};
  for (let i = 0; i < 15; i++) {
    const r = 3 + Math.floor(Math.random() * (MAP_ROWS - 6));
    const c = 3 + Math.floor(Math.random() * (MAP_COLS - 6));
    s.stoneDeposits[r + ',' + c] = 50 + Math.floor(Math.random() * 100); // 50-150 stone per deposit
  }
  s.villageStage = 'camp';
  s.consumption = { food:0, wood:0 };
  if (!s.season) s.season = { current:'spring', timer:SEASON_DURATION, year:1 };
  if (!s.events) s.events = { active:null, cooldown:0, history:[], lastEvent:0 };
  return s;
}

let gs = createState();
let lastProd = {}, pendingAch = [];
let tickMs = parseInt(process.env.TICK_INTERVAL || '1000', 10);

if (gs.version < 7) initNewGame(gs);
if (!gs.mapTrees) gs.mapTrees = {};
if (gs.transportLevel === undefined) gs.transportLevel = 0;
if (!gs.dayCycle) gs.dayCycle = { isDay:true, timer:DAY_LENGTH/2, hour:8 };
// Add family fields to existing villagers if missing
for (const v of gs.villagers) {
  if (v.partnerId === undefined) v.partnerId = null;
  if (!v.childrenIds) v.childrenIds = [];
  if (!v.parentsIds) v.parentsIds = [];
  if (v.married === undefined) v.married = false;
  if (v.pregnant === undefined) v.pregnant = false;
  if (v.pregnancyTimer === undefined) v.pregnancyTimer = 0;
  if (!v.maxAge || v.maxAge < 3600) v.maxAge = 7200 + Math.floor(Math.random()*3600);
}

// ---- Helpers ----
const M_NAMES = ['Karl','Fritz','Heinrich','Wilhelm','Gustav','Ludwig','Johann','Friedrich','Albert','Ernst','Georg','Hermann','Paul','Walter'];
const F_NAMES = ['Anna','Marta','Klara','Frieda','Hedwig','Elise','Sophie','Emma','Bertha','Marie','Charlotte','Luise','Ida','Helene'];
function rName(g) { const n = g==='male'?M_NAMES:F_NAMES; return n[Math.floor(Math.random()*n.length)]; }
function addVillager(g, a, j, parents) {
  const baseLife = 7200; // 2 hours base
  const v = { id:gs.villagers.length+1, name:rName(g||(Math.random()>.5?'male':'female')), gender:g||(Math.random()>.5?'male':'female'), job:j||'idle', age:a||'adult', ageTimer:a==='child'?CHILD_GROW_TIME:0, level:1, xp:0, ageTicks:0, maxAge:baseLife+Math.floor(Math.random()*3600), since:Date.now(), partnerId:null, childrenIds:[], parentsIds:parents||[], married:false, pregnant:false, pregnancyTimer:0 };
  // If parents provided, add child to their childrenIds
  if (parents) { for (const pid of parents) { const p = gs.villagers.find(v=>v.id===pid); if (p) { if (!p.childrenIds) p.childrenIds = []; p.childrenIds.push(v.id); } } }
  gs.villagers.push(v); return v;
}
function getCap() { let c=0; for(const[id,d]of Object.entries(BUILDING_DEFS)) c+=(gs.buildings[id]?.count||0)*d.vps; return c; }
function getAvailJobs() {
  const stage = getStage(gs.villagers.filter(v=>v.age==='adult').length);
  const avail = {};
  for (const [id, j] of Object.entries(JOB_DEFS)) {
    const stageIdx = Object.keys(STAGES).indexOf(j.unlockStage);
    const curIdx = Object.keys(STAGES).indexOf(stage);
    if (curIdx >= stageIdx) {
      if (j.needsBuilding && (gs.buildings[j.needsBuilding]?.count||0)===0) continue;
      avail[id] = j;
    }
  }
  return avail;
}

function canBuild(id) {
  const d = BUILDING_DEFS[id]; if (!d) return { ok:false, reason:'Unbekannt' };
  const b = gs.buildings[id]; if (!b) return { ok:false, reason:'Fehler' };
  if (b.count >= d.max) return { ok:false, reason:'Max ('+d.max+')' };
  const stage = getStage(gs.villagers.filter(v=>v.age==='adult').length);
  if (d.stage && Object.keys(STAGES).indexOf(d.stage) > Object.keys(STAGES).indexOf(stage)) {
    return { ok:false, reason:'Erst ab: '+STAGES[d.stage].n };
  }
  for (const p of d.pre) { if ((gs.buildings[p]?.count||0)===0) return { ok:false, reason:'Braucht: '+(BUILDING_DEFS[p]?.n||p) }; }
  for (const [r,a] of Object.entries(d.cost)) { if ((gs.resources[r]||0)<a) return { ok:false, reason:'Zu wenig '+r }; }
  // Water requirement check (client sends tile position, server validates)
  // Water check is done on the client side for map placement
  return { ok:true };
}

function buyBuilding(id) {
  const ck = canBuild(id); if (!ck.ok) return ck;
  const d = BUILDING_DEFS[id];
  for (const [r,a] of Object.entries(d.cost)) gs.resources[r] -= a;
  gs.buildings[id].count++;
  // If house, create individual house entry
  if (id === 'house') gs.houses.push({ id: gs.houses.length+1, level: 1 });
  // NO auto-spawn - villagers only come through wanderers or reproduction
  checkAch();
  return { ok:true, newCount:gs.buildings[id].count, maxReached:gs.buildings[id].count>=d.max };
}

function upgradeHouse(houseId) {
  const h = gs.houses.find(h=>h.id===houseId);
  if (!h) return { ok:false, reason:'Haus nicht gefunden' };
  const cost = { wood:30+h.level*20, stone:15+h.level*10, gold:h.level*5 };
  for (const [r,a] of Object.entries(cost)) { if ((gs.resources[r]||0)<a) return { ok:false, reason:'Zu wenig '+r }; }
  for (const [r,a] of Object.entries(cost)) gs.resources[r] -= a;
  h.level++;
  return { ok:true, house:h, newLevel:h.level };
}

function assignJob(vid, job) {
  const v = gs.villagers.find(v=>v.id===vid);
  if (!v) return { ok:false, reason:'Nicht gefunden' };
  if (v.age==='child') return { ok:false, reason:'Kinder arbeiten nicht' };
  const jobs = getAvailJobs();
  if (!jobs[job] && job!=='idle') return { ok:false, reason:'Job nicht verfügbar' };
  v.job = job; v.since = Date.now();
  return { ok:true, villager:v };
}

// ---- Tick ----
function tick() {
  const now = Date.now(); const prod = { food:0, wood:0, stone:0, gold:0, knowledge:0 };
  const adults = gs.villagers.filter(v=>v.age==='adult');
  const pop = gs.villagers.length;
  const cap = getCap();
  const stage = getStage(adults.length);
  gs.villageStage = stage;
  const sm = SEASON_MODS[gs.season.current];
  const lm = gs.buildings.lumberMill?.count||0, fm = gs.buildings.farm?.count||0, qm = gs.buildings.quarry?.count||0;
  const mk = gs.buildings.market?.count||0, am = gs.buildings.academy?.count||0, bm = gs.buildings.bakery?.count||0;
  const fg = gs.buildings.forge?.count||0;

  // --- DAY/NIGHT CYCLE ---
  gs.dayCycle.timer -= (tickMs / 1000);
  if (gs.dayCycle.timer <= 0) {
    gs.dayCycle.isDay = !gs.dayCycle.isDay;
    gs.dayCycle.timer = DAY_LENGTH / 2;
    gs.dayCycle.hour = gs.dayCycle.isDay ? 6 : 18;
  }
  const isNight = !gs.dayCycle.isDay;
  const dayMod = isNight ? 0.3 : 1.0; // 30% production at night

  // --- PRODUCTION ---
  for (const v of adults) {
    if (v.job==='idle') continue;
    const jp = JOB_DEFS[v.job]?.prod; if (!jp) continue;
    for (const [res, base] of Object.entries(jp)) {
      let m = gs.prestige.multiplier * (sm[res]||1) * dayMod;
      if (res==='wood'&&lm>0) m*=(1+lm*0.5);
      if (res==='wood'&&(v.job==='lumberjack'||v.job==='gatherer')&&Math.random()<.03){const keys=Object.keys(gs.mapTrees).filter(k=>gs.mapTrees[k]===1);if(keys.length>0)gs.mapTrees[keys[Math.floor(Math.random()*keys.length)]]=0;}
      if (res==='food'&&fm>0) m*=(1+fm*0.5);
      if (res==='food'&&bm>0) m*=(1+bm*0.4);
      if (res==='stone'&&qm>0) m*=(1+qm*0.5);
      if (res==='gold'&&mk>0) m*=(1+mk*0.5);
      if (res==='knowledge'&&am>0) m*=(1+am*0.5);
      if ((res==='gold'||res==='stone')&&fg>0) m*=(1+fg*0.4);
      const levelBonus = 1 + ((v.level || 1) - 1) * 0.10;
      const pregnancyPenalty = v.pregnant ? 0.5 : 1.0; // 50% production when pregnant
      const amt = parseFloat((base * m * levelBonus * pregnancyPenalty).toFixed(2));
      gs.resources[res] = parseFloat(((gs.resources[res]||0)+amt).toFixed(2));
      gs.stats.totalProd[res] = parseFloat(((gs.stats.totalProd[res]||0)+amt).toFixed(2));
      prod[res] = parseFloat(((prod[res]||0)+amt).toFixed(2));
      // Stone depletion
      if (res === 'stone' && amt > 0 && gs.stoneDeposits) {
        const keys = Object.keys(gs.stoneDeposits).filter(k => gs.stoneDeposits[k] > 0);
        if (keys.length > 0 && Math.random() < 0.1) {
          gs.stoneDeposits[keys[Math.floor(Math.random()*keys.length)]] = Math.max(0, (gs.stoneDeposits[keys[Math.floor(Math.random()*keys.length)]]||0) - amt * 2);
        }
      }
    }
  }

  // --- CONSUMPTION ---
  let foodConsume = adults.length * 1.0 + gs.villagers.filter(v=>v.age==='child').length * 0.5;
  let woodConsume = 0;
  if (gs.season.current==='winter') woodConsume = adults.length * 1.5; // Heating
  // Well reduces food consumption
  if ((gs.buildings.well?.count||0) > 0) foodConsume *= Math.max(0.5, 1 - (gs.buildings.well.count*0.15));
  gs.resources.food = Math.max(0, parseFloat((gs.resources.food - foodConsume).toFixed(2)));
  gs.resources.wood = Math.max(0, parseFloat((gs.resources.wood - woodConsume).toFixed(2)));
  gs.consumption = { food: parseFloat(foodConsume.toFixed(2)), wood: parseFloat(woodConsume.toFixed(2)) };

  // --- SEASON ---
  gs.season.timer -= (tickMs/1000);
  if (gs.season.timer <= 0) {
    const idx = SEASONS.indexOf(gs.season.current);
    gs.season.current = SEASONS[(idx+1)%4];
    gs.season.timer = SEASON_DURATION;
    if (gs.season.current==='spring') gs.season.year++;
    console.log('[Forge] Season: '+SEASON_MODS[gs.season.current].desc+' (Year '+gs.season.year+')');
  }

  // --- CHILD GROWTH ---
  for (const v of gs.villagers) {
    if (v.age==='child') { v.ageTimer-=(tickMs/1000); if (v.ageTimer<=0) { v.age='adult'; v.ageTimer=0; } }
  }

  // --- PATH WEAR ---
  // Track which tiles are walked on (approximated from villager positions)
  for (const v of gs.villagers) {
    const c = Math.floor(Math.random()*MAP_COLS), r = Math.floor(Math.random()*MAP_ROWS); // Simulated for now
    const key = r+','+c;
    gs.pathWear[key] = Math.min(100, (gs.pathWear[key]||0)+1);
  }
  // Slow decay
  if (Math.random()<0.01) { const keys=Object.keys(gs.pathWear); if(keys.length>0){const k=keys[Math.floor(Math.random()*keys.length)];gs.pathWear[k]=Math.max(0,gs.pathWear[k]-5);} }

  // --- AUTONOMY ---
  const a = gs.autonomy;
  if (pop>=4&&cap>pop) { a.wanderersEnabled=true; a.level=Math.max(a.level,1); }
  if (adults.length>=8&&gs.buildings.house?.count>=1) { a.reproductionEnabled=true; a.level=Math.max(a.level,2); }
  if (adults.length>=12&&gs.buildings.house?.count>=3) { a.autoBuildEnabled=true; a.level=Math.max(a.level,3); }

  // Wanderers
  if (a.wanderersEnabled&&cap>pop&&(now-a.lastWandererCheck)>WANDERER_INTERVAL*1000) {
    a.lastWandererCheck=now; if(Math.random()<Math.min(0.8,(cap-pop)*0.3)){addVillager(null,'adult','idle');a.wanderersArrived++;}
  }
  // --- LOVE & MARRIAGE ---
  const singleMen = adults.filter(v => v.gender === 'male' && !v.married);
  const singleWomen = adults.filter(v => v.gender === 'female' && !v.married);
  if (singleMen.length > 0 && singleWomen.length > 0 && Math.random() < 0.005) {
    const man = singleMen[Math.floor(Math.random() * singleMen.length)];
    const woman = singleWomen[Math.floor(Math.random() * singleWomen.length)];
    man.partnerId = woman.id; woman.partnerId = man.id;
    man.married = true; woman.married = true;
    console.log('[Forge] 💒 ' + man.name + ' & ' + woman.name + ' geheiratet!');
  }

  // --- PREGNANCY TIMER ---
  for (const v of adults) {
    if (v.pregnant) {
      v.pregnancyTimer -= (tickMs / 1000);
      if (v.pregnancyTimer <= 0) {
        v.pregnant = false;
        const freeSlots = cap - gs.villagers.length;
        if (freeSlots > 0 && v.partnerId) {
          const father = gs.villagers.find(p => p.id === v.partnerId);
          const baby = addVillager(null, 'child', 'idle', [v.id, v.partnerId]);
          a.totalBorn++; a.children++;
        }
      }
    }
  }

  // --- MARRIED COUPLES CONCEIVE ---
  if (a.reproductionEnabled && cap > pop && (now - a.lastReproductionCheck) > REPRODUCTION_INTERVAL * 1000) {
    a.lastReproductionCheck = now;
    const marriedWomen = adults.filter(v => v.gender === 'female' && v.married && !v.pregnant);
    if (marriedWomen.length > 0) {
      const popFactor = Math.max(0.08, 1 - (pop / Math.max(cap * 2, 30)));
      if (Math.random() < 0.4 * popFactor) {
        const mom = marriedWomen[Math.floor(Math.random() * marriedWomen.length)];
        mom.pregnant = true;
        mom.pregnancyTimer = PREGNANCY_DURATION;
        console.log('[Forge] 🤰 ' + mom.name + ' schwanger!');
      }
    }
  }
  // Auto job
  if(a.level>=1){const idle=adults.filter(v=>v.job==='idle');if(idle.length){const jobs=getAvailJobs();const jkeys=Object.keys(jobs).filter(j=>j!=='idle');if(jkeys.length){idle[0].job=jkeys[Math.floor(Math.random()*jkeys.length)];idle[0].since=now;}}}
  // Auto build
  if(a.autoBuildEnabled&&(now-a.lastAutoBuildCheck)>AUTO_BUILD_INTERVAL*1000){a.lastAutoBuildCheck=now;const hck=canBuild('house');if(hck.ok&&gs.resources.wood>200){buyBuilding('house');a.autoBuilt++;}}

  // --- EVENTS ---
  if ((now-(gs.events.lastEvent||now))>EVENT_INTERVAL*1000 && (gs.events.cooldown||0)<=0) {
    const availEvents = EVENT_TYPES.filter(ev=>{
      const evStage=Object.keys(STAGES).indexOf(ev.minStage);
      const curStage=Object.keys(STAGES).indexOf(stage);
      return curStage>=evStage;
    });
    if (availEvents.length>0) {
      const ev = availEvents[Math.floor(Math.random()*availEvents.length)];
      const msg = ev.effect(gs);
      gs.events.active = { id:ev.id, name:ev.n, emoji:ev.e, msg:msg, time:now };
      gs.events.history.push(gs.events.active);
      if (gs.events.history.length>50) gs.events.history.shift();
      gs.events.lastEvent = now;
      gs.events.cooldown = 30;
      console.log('[Forge] Event: '+ev.n+' - '+msg);
    }
  }
  if (gs.events.cooldown>0) gs.events.cooldown -= (tickMs/1000);

  // --- SAWMILL PRODUCTION (wood→planks, requires river) ---
  const sawmills = gs.buildings.sawmill?.count||0;
  if (sawmills > 0) {
    const sawyers = adults.filter(v=>v.job==='sawyer').length;
    const plankProd = sawyers * 1 * sawmills * (1 + (gs.buildings.sawmill?.level-1||0)*0.3) * gs.prestige.multiplier;
    const woodCost = plankProd * 2;
    if (gs.resources.wood >= woodCost) {
      gs.resources.wood = parseFloat((gs.resources.wood - woodCost).toFixed(2));
      gs.resources.planks = parseFloat(((gs.resources.planks||0) + plankProd).toFixed(2));
      prod.planks = parseFloat(((prod.planks||0) + plankProd).toFixed(2));
      gs.stats.totalProd.planks = parseFloat(((gs.stats.totalProd.planks||0) + plankProd).toFixed(2));
    }
  }

  // --- TREE REGROWTH (Forester) ---
  const foresters = gs.buildings.forester?.count||0;
  if (foresters > 0 && Math.random() < 0.05 * foresters) {
    // Regrow a random cut tree
    const keys = Object.keys(gs.mapTrees).filter(k=>gs.mapTrees[k]===0);
    if (keys.length > 0) {
      const rk = keys[Math.floor(Math.random()*keys.length)];
      gs.mapTrees[rk] = 1;
    }
  }
  // Natural slow regrowth
  if (Math.random() < 0.005) {
    const keys = Object.keys(gs.mapTrees).filter(k=>gs.mapTrees[k]===0);
    if (keys.length > 0) gs.mapTrees[keys[Math.floor(Math.random()*keys.length)]] = 1;
  }

  // --- TRANSPORT EVOLUTION ---
  const totalProd = Object.values(gs.stats.totalProd).reduce((a,b)=>a+b,0);
  if (totalProd > 50000 && gs.transportLevel < 1) { gs.transportLevel = 1; console.log('[Forge] Transport: Holzkarren freigeschaltet!'); }
  if (totalProd > 200000 && gs.transportLevel < 2) { gs.transportLevel = 2; console.log('[Forge] Transport: Pferdewagen freigeschaltet!'); }

  // --- VILLAGER LEVELING & AGING ---
  for (const v of adults) {
    // Initialize level fields if missing
    if (!v.level) v.level = 1;
    if (v.xp === undefined) v.xp = 0;
    if (!v.ageTicks) v.ageTicks = 0;
    if (!v.maxAge) v.maxAge = 3600 + Math.floor(Math.random() * 1800);

    // Age
    v.ageTicks += (tickMs / 1000);
    // Comfort bonus: houses, food surplus, happiness extend life
    const houses = gs.buildings.house?.count || 0;
    const comfortBonus = (houses * 100) + (gs.resources.food > 100 ? 200 : 0) + ((gs.happiness || 100) - 50) * 10;
    v.maxAge = Math.max(1800, (v.maxAge || 3600) + comfortBonus * 0.01);

    // XP gain for working villagers
    if (v.job !== 'idle') {
      v.xp = (v.xp || 0) + 1;
      // Knowledge transfer: bonus XP if higher-level colleague exists
      const colleagues = adults.filter(c => c.job === v.job && c.id !== v.id);
      const maxColleagueLevel = colleagues.reduce((max, c) => Math.max(max, c.level || 1), 1);
      if (maxColleagueLevel > (v.level || 1)) {
        v.xp += (maxColleagueLevel - v.level) * 0.5; // Bonus from mentor
      }

      // Level up check (XP needed = level * 100)
      const xpNeeded = (v.level || 1) * 100;
      if (v.xp >= xpNeeded) {
        v.level = (v.level || 1) + 1;
        v.xp -= xpNeeded;
        console.log('[Forge] ' + v.name + ' leveled up to ' + v.level + ' as ' + v.job + '!');
      }
    }
  }

  // --- MORTALITY ---
  const dying = [];
  for (const v of gs.villagers) {
    // Old age death
    if ((v.ageTicks || 0) >= (v.maxAge || 3600)) {
      dying.push(v);
      continue;
    }
    // Spontaneous death (0.002% per tick = ~1 per hour for 14 villagers)
    if (Math.random() < 0.00002) {
      dying.push(v);
    }
  }
  for (const dead of dying) {
    // Knowledge transfer: give 50% of XP to a random colleague in same job
    if (dead.job !== 'idle') {
      const colleagues = adults.filter(c => c.job === dead.job && c.id !== dead.id);
      if (colleagues.length > 0) {
        const heir = colleagues[Math.floor(Math.random() * colleagues.length)];
        const transferXP = Math.floor((dead.xp || 0) * 0.5 + (dead.level || 1) * 50);
        heir.xp = (heir.xp || 0) + transferXP;
        console.log('[Forge] ' + dead.name + ' died. ' + transferXP + ' XP transferred to ' + heir.name);
      }
    }
    // Remove villager
    gs.villagers = gs.villagers.filter(v => v.id !== dead.id);
    console.log('[Forge] ' + dead.name + ' passed away (age: ' + Math.floor(dead.ageTicks || 0) + 's, level ' + (dead.level || 1) + ' ' + dead.job + ')');
  }

  // --- HAPPINESS ---
  if (!gs.happiness) gs.happiness = 100;
  // Decay slowly, recover with food surplus
  gs.happiness = Math.max(0, Math.min(100, gs.happiness - 0.02 + (gs.resources.food>50?0.05:0)));
  // School system: children near academy get education
  if (gs.decrees?.includes('school') && gs.buildings.academy?.count>0) {
    for (const v of gs.villagers) {
      if (v.age==='child' && !v.education) v.education = 'In Schule';
    }
  }

  return prod;
}

// ---- Prestige ----
function getPP() { const t=Object.values(gs.stats.totalProd).reduce((a,b)=>a+b,0); return Math.floor(t/PRESTIGE_THRESHOLD); }
function prestige() {
  const pts=getPP(); if(pts<=0) return { ok:false, reason:'Sammle '+PRESTIGE_THRESHOLD+' Ressourcen' };
  const op=gs.prestige.points, om=gs.prestige.multiplier, oa=[...gs.achievements], ot={...gs.stats.totalProd}, os=gs.stats.startedAt, oc=gs.stats.totalClicks;
  const oldGoals = gs.goals||[], oldDecrees = gs.decrees||[], oldHappy = gs.happiness||100;
  gs = createState(); initNewGame(gs);
  gs.goals = oldGoals; gs.decrees = oldDecrees; gs.happiness = oldHappy;
  gs.prestige.points=op+pts; gs.prestige.multiplier=1.0+gs.prestige.points*0.10;
  gs.achievements=oa; gs.stats.totalProd=ot; gs.stats.startedAt=os; gs.stats.totalClicks=oc; gs.stats.prestigeCount++;
  const bonus=30*gs.prestige.points; for(const k of Object.keys(gs.resources)) gs.resources[k]=bonus;
  return { ok:true, pointsGained:pts, totalPoints:gs.prestige.points, newMultiplier:gs.prestige.multiplier };
}

// ---- Achievements ----
const ACHIEVEMENTS = [
  { id:'first_job', n:'Erster Job', e:'💼', c:s=>s.villagers.some(v=>v.job!=='idle') },
  { id:'all_working', n:'Vollbeschäftigung', e:'👷', c:s=>s.villagers.filter(v=>v.age==='adult').every(v=>v.job!=='idle') },
  { id:'first_house', n:'Eigenheim', e:'🏠', c:s=>s.buildings.house?.count>=1 },
  { id:'five_houses', n:'Siedlung', e:'🏘️', c:s=>s.buildings.house?.count>=5 },
  { id:'first_child', n:'Nachwuchs', e:'👶', c:s=>(s.autonomy?.totalBorn||0)>=1 },
  { id:'first_wanderer', n:'Zuzug', e:'🚶', c:s=>(s.autonomy?.wanderersArrived||0)>=1 },
  { id:'auto_village', n:'Selbstläufer', e:'🤖', c:s=>(s.autonomy?.autoBuildEnabled||false) },
  { id:'village_stage', n:'Dorf gegründet', e:'🏰', c:s=>gs.villageStage==='village'||Object.keys(STAGES).indexOf(gs.villageStage)>=Object.keys(STAGES).indexOf('village') },
  { id:'town_stage', n:'Stadt ernannt', e:'🏙️', c:s=>gs.villageStage==='town' },
  { id:'survived_winter', n:'Winter überlebt', e:'❄️', c:s=>s.season?.year>=2 },
  { id:'year_5', n:'5 Jahre', e:'📅', c:s=>s.season?.year>=5 },
  { id:'pop_50', n:'50 Bewohner', e:'👥', c:s=>s.villagers.length>=50 },
  { id:'pop_100', n:'100 Bewohner', e:'👨‍👩‍👧‍👦', c:s=>s.villagers.length>=100 },
  { id:'total_1M', n:'Millionär', e:'🏆', c:s=>Object.values(s.stats.totalProd).reduce((a,b)=>a+b,0)>=1000000 },
];

function checkAch() { const nw=[]; for(const a of ACHIEVEMENTS){if(!gs.achievements.includes(a.id)&&a.c(gs)){gs.achievements.push(a.id);nw.push(a);}} return nw; }

// ---- Express ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status:'healthy', service:'rumahl-forge', version:'3.0.0', pop:gs.villagers.length, stage:gs.villageStage, season:gs.season.current, uptime:process.uptime(), timestamp:new Date().toISOString() });
});

app.get('/api/game/state', (req, res) => {
  const cap = getCap(); const pop = gs.villagers.length; const adults = gs.villagers.filter(v=>v.age==='adult').length;
  const fr = {}; for(const[k,v]of Object.entries(gs.resources)) fr[k]=parseFloat(v.toFixed(2));
  const bd = {}; for(const[id,d]of Object.entries(BUILDING_DEFS)){const b=gs.buildings[id]||{count:0,level:1};const ck=canBuild(id);bd[id]={name:d.n,emoji:d.e,prereq:d.pre,villPerSlot:d.vps,stage:d.stage,desc:d.desc,prod:d.prod,cost:d.cost,maxBuildings:d.max,count:b.count,level:b.level,canBuild:ck.ok,buildBlocked:ck.reason||null};}
  const vi = gs.villagers.map(v=>({...v,level:v.level||1,xp:v.xp||0,ageTicks:v.ageTicks||0,maxAge:v.maxAge||3600,jobInfo:(JOB_DEFS[v.job]||{n:'Arbeitslos',e:'😴'})}));
  // Normalize jobInfo and add level display
  for(const v of vi){ const j=v.jobInfo; v.jobInfo={name:j.n||'Arbeitslos',emoji:j.e||'😴',prod:j.prod||{}}; v.levelDisplay='⭐'.repeat(Math.min((v.level||1),10)); }
  const allJobs = {}; for(const[id,j]of Object.entries(JOB_DEFS)){allJobs[id]={name:j.n,emoji:j.e,unlockStage:j.unlockStage,prod:j.prod,needsBuilding:j.needsBuilding};}
  const availJobs = {}; const aj = getAvailJobs(); for(const[id,j]of Object.entries(aj)) availJobs[id]={name:j.n,emoji:j.e,unlockStage:j.unlockStage,prod:j.prod,needsBuilding:j.needsBuilding};
  // Path data (only tiles with wear > 30)
  const paths = {}; for(const[k,v]of Object.entries(gs.pathWear||{})){if(v>30) paths[k]=v;}
  res.json({
    resources:fr, buildings:bd, villagers:vi, houses:gs.houses||[],
    villagerCapacity:cap, villagerCount:pop, adultCount:adults, childCount:pop-adults,
    autonomy:gs.autonomy, season:{...gs.season,desc:SEASON_MODS[gs.season.current]?.desc||''}, dayCycle:gs.dayCycle||{isDay:true,hour:8}, stage:gs.villageStage, stageInfo:{...STAGES[gs.villageStage],name:STAGES[gs.villageStage].n,emoji:STAGES[gs.villageStage].e},
    consumption:gs.consumption, events:gs.events, pathWear:paths,
    mapTrees:gs.mapTrees||{}, transportLevel:gs.transportLevel||0,
    mapData:{cols:MAP_COLS,rows:MAP_ROWS,seed:gs.worldSeed},
    worldMap:gs.worldMap,
    worldHeight:gs.worldHeight,
    worldSpawn:gs.worldSpawn,
    prestige:{...gs.prestige,availablePoints:getPP(),threshold:PRESTIGE_THRESHOLD},
    stats:gs.stats, jobs:allJobs, availJobs:availJobs,
    achievements:{unlocked:gs.achievements,all:ACHIEVEMENTS.map(a=>({...a,unlocked:gs.achievements.includes(a.id)}))},
    goals:(gs.goals||[]).map(g=>{let p=0;if(g.resource==='wood')p=Math.min(g.target,gs.resources.wood||0);else if(g.resource==='food')p=Math.min(g.target,gs.resources.food||0);else if(g.resource==='stone')p=Math.min(g.target,gs.resources.stone||0);else if(g.resource==='pop')p=Math.min(g.target,gs.villagers.length);else if(g.resource==='house')p=Math.min(g.target,gs.buildings.house?.count||0);return{...g,progress:p};}),
    decrees:gs.decrees||[],
    happiness:gs.happiness||100,
  });
});

app.get('/api/game/tick', (req, res) => {
  const fr = {}; for(const[k,v]of Object.entries(gs.resources)) fr[k]=parseFloat(v.toFixed(2));
  const stage = gs.villageStage;
  res.json({ resources:fr, produced:lastProd, newAchievements:[...pendingAch], prestigeAvailable:getPP(),
    season:gs.season, dayCycle:gs.dayCycle||{isDay:true}, stage:stage, stageInfo:{...STAGES[stage],name:STAGES[stage].n,emoji:STAGES[stage].e}, consumption:gs.consumption,
    activeEvent:gs.events.active, happiness:gs.happiness||100 });
  pendingAch = []; gs.events.active = null;
});

app.post('/api/game/buy/:id', (req, res) => { res.json(buyBuilding(req.params.id)); });
app.post('/api/game/upgrade-house/:id', (req, res) => { res.json(upgradeHouse(parseInt(req.params.id))); });
app.post('/api/game/assign/:vid/:job', (req, res) => { res.json(assignJob(parseInt(req.params.vid), req.params.job)); });

// Goals & Decrees
app.post('/api/game/goal/:id', (req, res) => {
  const goals = {
    wood_500: { n:'500 Holz sammeln', e:'🪵', t:500, r:'wood' },
    food_500: { n:'500 Nahrung sammeln', e:'🌾', t:500, r:'food' },
    pop_10: { n:'10 Bewohner', e:'👥', t:10, r:'pop' },
    house_5: { n:'5 Häuser bauen', e:'🏠', t:5, r:'house' },
    stone_200: { n:'200 Stein sammeln', e:'🪨', t:200, r:'stone' },
  };
  const g = goals[req.params.id];
  if (!g) return res.json({ ok: false });
  if (!gs.goals) gs.goals = [];
  if (!gs.goals.find(x => x.id === req.params.id)) {
    gs.goals.push({ id: req.params.id, name: g.n, emoji: g.e, target: g.t, resource: g.r, progress: 0 });
  }
  res.json({ ok: true });
});

app.post('/api/game/decree/:id', (req, res) => {
  if (!gs.decrees) gs.decrees = [];
  if (!gs.happiness) gs.happiness = 100;
  const dec = req.params.id;
  if (dec === 'school_mandatory') { gs.decrees.push('school'); gs.happiness = Math.max(50, gs.happiness - 5); }
  else if (dec === 'work_sunday') { gs.decrees.push('sunday_rest'); gs.happiness = Math.min(100, gs.happiness + 10); }
  else if (dec === 'tax_low') { gs.decrees.push('tax_low'); gs.resources.gold += 10; gs.happiness = Math.min(100, gs.happiness + 5); }
  else if (dec === 'tax_high') { gs.decrees.push('tax_high'); gs.resources.gold += 50; gs.happiness = Math.max(30, gs.happiness - 15); }
  else if (dec === 'festival') { gs.decrees.push('festival'); gs.resources.food = Math.max(0, gs.resources.food - 30); gs.happiness = Math.min(100, gs.happiness + 20); }
  res.json({ ok: true });
});

// Exploration: discover new islands
app.post('/api/game/explore', (req, res) => {
  if (!gs.exploration) gs.exploration = { islands:0, rareResources:{gems:0,spice:0,ore:0} };
  const harbor = gs.buildings.harbor?.count||0;
  const shipyard = gs.buildings.shipyard?.count||0;
  if (harbor === 0) return res.json({ ok:false, reason:'Baue zuerst einen Hafen!' });
  const cost = { wood:200, planks:50, gold:100 };
  for (const [r,a] of Object.entries(cost)) { if ((gs.resources[r]||0) < a) return res.json({ ok:false, reason:'Zu wenig '+r }); }
  for (const [r,a] of Object.entries(cost)) gs.resources[r] -= a;
  gs.exploration.islands++;
  // Discover rare resources
  gs.exploration.rareResources.gems += Math.floor(Math.random()*20)+5;
  gs.exploration.rareResources.spice += Math.floor(Math.random()*30)+10;
  gs.exploration.rareResources.ore += Math.floor(Math.random()*15)+5;
  res.json({ ok:true, islands:gs.exploration.islands, rareResources:gs.exploration.rareResources });
});

// Map info: click on tile to see resources
app.get('/api/game/map/:row/:col', (req, res) => {
  const r = parseInt(req.params.row), c = parseInt(req.params.col);
  const key = r + ',' + c;
  const trees = gs.mapTrees[key];
  const stone = gs.stoneDeposits?.[key];
  const tile = (gs.worldMap&&gs.worldMap[r]&&gs.worldMap[r][c]!==undefined)?gs.worldMap[r][c]:-1;
  const biomeNames={0:'🌿 Ebene',1:'💧 Fluss',2:'🌊 Meer',4:'⛰️ Hügel',5:'🌲 Wald',7:'🏖️ Küste',8:'🏝️ Strand',9:'🌳 Dichter Wald',10:'🗻 Berge',11:'⛰️ Hochland'};
  const info = {
    tile: key,
    biome: biomeNames[tile]||'?',
    treeCount: trees === 1 ? 1 : trees === 0 ? 0 : null,
    treesNearby: 0,
    stoneDeposit: stone || 0,
    stoneNearby: 0,
  };
  // Count nearby trees (3x3 area)
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nk = (r + dr) + ',' + (c + dc);
      if (gs.mapTrees[nk] === 1) info.treesNearby++;
      if (gs.stoneDeposits?.[nk]) info.stoneNearby += gs.stoneDeposits[nk];
    }
  }
  res.json(info);
});

app.post('/api/game/click', (req, res) => {
  gs.stats.totalClicks++; const m=gs.prestige.multiplier; const gn={};
  for(const k of Object.keys(gs.resources)){const b=0.1;gn[k]=parseFloat((b*m).toFixed(2));gs.resources[k]=parseFloat(((gs.resources[k]||0)+gn[k]).toFixed(2));}
  checkAch(); res.json({ success:true, gains:gn, totalClicks:gs.stats.totalClicks });
});

app.post('/api/game/prestige', (req, res) => { res.json(prestige()); });
app.post('/api/game/save', async (req, res) => { const d={...gs,savedAt:Date.now()}; const ok=await saveORA(d); try{fs.writeFileSync(path.join(__dirname,SAVE_FILE),JSON.stringify(d,null,2));}catch(e){} gs.stats.lastSaved=Date.now(); res.json({success:ok}); });
app.post('/api/game/load', async (req, res) => {
  let d=await loadORA(); if(!d){try{if(fs.existsSync(path.join(__dirname,SAVE_FILE)))d=JSON.parse(fs.readFileSync(path.join(__dirname,SAVE_FILE),'utf-8'));}catch(e){}}
  if(d&&d.version>=7){gs={...createState(),...d};if(!gs.buildings||Object.keys(gs.buildings).length===0)initNewGame(gs);if(!gs.houses)gs.houses=[];if(!gs.pathWear)gs.pathWear={};if(!gs.season)gs.season={current:'spring',timer:SEASON_DURATION,year:1};if(!gs.events)gs.events={active:null,cooldown:0,history:[],lastEvent:0};if(!gs.mapTrees)gs.mapTrees={};if(gs.transportLevel===undefined)gs.transportLevel=0;if(!gs.dayCycle)gs.dayCycle={isDay:true,timer:DAY_LENGTH/2,hour:8};if(!gs.exploration)gs.exploration={islands:0,rareResources:{gems:0,spice:0,ore:0}};gs.stats.lastSaved=Date.now();res.json({success:true});}
  else res.json({success:false,reason:'Kein Spielstand'});
});
app.post('/api/game/reset', (req, res) => { gs=createState(); initNewGame(gs); res.json({success:true}); });
app.get('/game3d.js', (req, res) => { res.type('application/javascript'); res.sendFile(path.join(__dirname,'public','game3d.js')); });
app.get('*', (req, res) => { if(req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'}); res.sendFile(path.join(__dirname,'public','index.html')); });

// ---- Startup ----
async function init() {
  let d=await loadORA(); if(!d){try{if(fs.existsSync(path.join(__dirname,SAVE_FILE)))d=JSON.parse(fs.readFileSync(path.join(__dirname,SAVE_FILE),'utf-8'));}catch(e){}}
  if(d&&d.version>=7){gs={...createState(),...d};if(!gs.buildings||Object.keys(gs.buildings).length===0)initNewGame(gs);if(!gs.houses)gs.houses=[];if(!gs.pathWear)gs.pathWear={};if(!gs.season)gs.season={current:'spring',timer:SEASON_DURATION,year:1};if(!gs.events)gs.events={active:null,cooldown:0,history:[],lastEvent:0};if(!gs.mapTrees)gs.mapTrees={};if(gs.transportLevel===undefined)gs.transportLevel=0;if(!gs.dayCycle)gs.dayCycle={isDay:true,timer:DAY_LENGTH/2,hour:8};if(!gs.exploration)gs.exploration={islands:0,rareResources:{gems:0,spice:0,ore:0}};console.log('[Forge] Loaded. Pop:'+gs.villagers.length+' Stage:'+gs.villageStage);}
  else { initNewGame(gs); console.log('[Forge] New game. 4 villagers ready!'); }

  setInterval(() => {
    lastProd = tick();
    const na = checkAch(); if (na.length) { pendingAch.push(...na); console.log('[Forge] Ach:', na.map(a=>a.n).join(', ')); }
  }, tickMs);

  setInterval(async () => { const d={...gs,savedAt:Date.now()}; await saveORA(d); try{fs.writeFileSync(path.join(__dirname,SAVE_FILE),JSON.stringify(d,null,2));}catch(e){} gs.stats.lastSaved=Date.now(); }, parseInt(process.env.AUTO_SAVE_INTERVAL||'60')*1000);

  console.log('[Forge] Tick:'+tickMs+'ms | Auto-Save:'+(parseInt(process.env.AUTO_SAVE_INTERVAL||'60'))+'s');
}

const server = app.listen(PORT, () => { console.log('[Forge] Port '+PORT); init(); });
process.on('SIGTERM', async () => { const d={...gs,savedAt:Date.now()}; await saveORA(d); try{fs.writeFileSync(path.join(__dirname,SAVE_FILE),JSON.stringify(d,null,2));}catch(e){} server.close(()=>process.exit(0)); });
