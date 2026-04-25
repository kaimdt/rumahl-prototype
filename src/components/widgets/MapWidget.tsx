import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapTrifold, House, ArrowClockwise, GpsFix, User, Users, Plus, ClockCounterClockwise, Crosshair, Stack, FunnelSimple, Eye, EyeSlash, MapPin, NavigationArrow, CaretDown, Compass, Path, CalendarBlank, Play, Pause, Stop } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tip'

function getAuthToken(): string | null {
  const raw = localStorage.getItem('ha-auth-token') || sessionStorage.getItem('ha-auth-token')
  if (!raw) return null
  try { const parsed = JSON.parse(raw); return typeof parsed === 'string' ? parsed : null } catch { return raw }
}

interface MapWidgetConfig {
  title?: string
  latitude?: number
  longitude?: number
  zoom?: number
  entities?: string[]
  showControls?: boolean
  variant?: 'standard' | 'fullscreen' | 'compact' | 'list'
  cardVariant?: string
  markerLabel?: string
  showAttribution?: boolean
  showHeader?: boolean
  showEntityList?: boolean
  showZones?: boolean
  autoFitEntities?: boolean
  defaultHomeZone?: boolean
  darkMode?: boolean
  refreshInterval?: number
  hours_to_show?: number
  [key: string]: unknown
}

interface MapWidgetProps {
  config?: MapWidgetConfig
}

interface TrackedEntity {
  entity_id: string
  name: string
  latitude: number
  longitude: number
  state: string
  icon?: string
  picture?: string
  color: string
  battery?: number
  gpsAccuracy?: number
  source?: string
  lastUpdated: string
}

interface ZoneEntity {
  entity_id: string
  name: string
  latitude: number
  longitude: number
  radius: number
  icon?: string
}

interface HistoryPoint {
  lat: number
  lng: number
  time: string
  date: string   // YYYY-MM-DD
  isoTime: string // full ISO timestamp
  state: string
}

const HISTORY_HOURS_OPTIONS = [1, 3, 6, 12, 24, 48, 72, 168] as const
const HISTORY_HOURS_LABELS: Record<number, string> = { 1:'1h', 3:'3h', 6:'6h', 12:'12h', 24:'1T', 48:'2T', 72:'3T', 168:'7T' }

const ENTITY_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1',
]

function getEntityColor(index: number): string {
  return ENTITY_COLORS[index % ENTITY_COLORS.length]
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

// Filter out GPS outlier points that represent impossible movement
function filterGpsOutliers(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length < 3) return points
  const MAX_SPEED_KMH = 200 // max plausible speed in km/h
  const R = 6371 // earth radius in km
  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  // Pass 1: Mark "island" outliers — points far from BOTH neighbors
  // A point is an island if speed to prev AND speed to next are both implausible
  const isOutlier = new Array(points.length).fill(false)
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1]
    const distPrev = haversineKm(prev.lat, prev.lng, cur.lat, cur.lng)
    const distNext = haversineKm(cur.lat, cur.lng, next.lat, next.lng)
    const timePrevH = (new Date(cur.isoTime).getTime() - new Date(prev.isoTime).getTime()) / 3600000
    const timeNextH = (new Date(next.isoTime).getTime() - new Date(cur.isoTime).getTime()) / 3600000
    const speedPrev = timePrevH > 0 ? distPrev / timePrevH : 0
    const speedNext = timeNextH > 0 ? distNext / timeNextH : 0
    // Island: implausible speed to both neighbors
    if (speedPrev > MAX_SPEED_KMH && speedNext > MAX_SPEED_KMH) {
      isOutlier[i] = true
      continue
    }
    // Detour outlier: point is far from both neighbors but neighbors are close to each other
    const distNeighbors = haversineKm(prev.lat, prev.lng, next.lat, next.lng)
    if (distPrev > 0.5 && distNext > 0.5 && distNeighbors < 0.3) {
      // Point is >500m from both, but neighbors are <300m apart — clearly a GPS jump
      isOutlier[i] = true
    }
  }

  // Pass 2: Forward scan with speed check (skip already-flagged outliers)
  const result: HistoryPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (isOutlier[i]) continue
    const prev = result[result.length - 1]
    const cur = points[i]
    const dist = haversineKm(prev.lat, prev.lng, cur.lat, cur.lng)
    const timeDiffH = (new Date(cur.isoTime).getTime() - new Date(prev.isoTime).getTime()) / 3600000
    if (timeDiffH <= 0 || dist <= 0.01) { result.push(cur); continue }
    const speedKmh = dist / timeDiffH
    if (speedKmh <= MAX_SPEED_KMH) {
      result.push(cur)
    }
  }
  return result
}

// Build Leaflet srcdoc HTML (static, no user data embedded)
function buildMapHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="referrer" content="origin">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
.dark-tiles .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(1.15) contrast(0.9) saturate(0.3)}
.leaflet-control-attribution{font-size:9px!important;opacity:0.6}
.entity-marker{border-radius:50%;border:2.5px solid white;display:flex;align-items:center;justify-content:center;
color:white;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:transform .15s}
.entity-marker:hover{transform:scale(1.15)}
.pic-marker{border-radius:50%;border:2.5px solid white;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:transform .15s;display:flex;align-items:center;justify-content:center}
.pic-marker:hover{transform:scale(1.15)}
.pic-marker img{width:100%;height:100%;object-fit:cover;display:block}
.pulse-ring{position:absolute;inset:-4px;border-radius:50%;animation:pulse 3s ease-in-out infinite;opacity:.2;pointer-events:none}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(1.4);opacity:0}}
.history-tooltip .leaflet-tooltip-content{font-size:10px}
.marker-cluster-custom{background:rgba(59,130,246,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid rgba(59,130,246,0.4);backdrop-filter:blur(4px)}
.marker-cluster-custom span{font-size:12px;font-weight:700;color:#3b82f6}
.zone-label{background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:2px 8px;font-size:10px;color:rgba(255,255,255,0.9);font-weight:600;white-space:nowrap;letter-spacing:0.3px}
.zone-label-home{background:rgba(59,130,246,0.25);border:1px solid rgba(59,130,246,0.4);color:rgba(59,130,246,0.95)}
.arrow-icon{width:12px;height:12px;position:absolute;left:50%;top:50%;margin-left:-6px;margin-top:-6px}
.player-dot{width:18px;height:18px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,0.3),0 2px 8px rgba(0,0,0,0.3);animation:playerPulse 1.5s ease-in-out infinite}
@keyframes playerPulse{0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.3),0 2px 8px rgba(0,0,0,0.3)}50%{box-shadow:0 0 0 8px rgba(59,130,246,0.15),0 2px 8px rgba(0,0,0,0.3)}}
#player-overlay{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1000;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);color:white;padding:6px 14px;border-radius:10px;font-size:14px;font-weight:600;pointer-events:none;white-space:nowrap;border:1px solid rgba(255,255,255,0.15)}
</style></head><body><div id="map"></div>
<script>(function(){
var map=L.map('map',{center:[51.16,10.45],zoom:5,zoomControl:false,attributionControl:true});
var standardLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
attribution:'\\u00a9 <a href=\\"https://www.openstreetmap.org/copyright\\">OpenStreetMap</a>',maxZoom:19});
var satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
attribution:'Tiles \\u00a9 Esri',maxZoom:19});
var darkLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
attribution:'\\u00a9 CARTO',maxZoom:19,subdomains:'abcd'});
standardLayer.addTo(map);var currentTileLayer=standardLayer;var isDarkMode=false;
var rawMarkers={};var markerMeta={};var zones={};var accCircles={};var zoneLabels={};
var markerCluster=L.markerClusterGroup({maxClusterRadius:45,spiderfyOnMaxZoom:true,showCoverageOnHover:false,zoomToBoundsOnClick:true,
  animate:true,animateAddingMarkers:false,disableClusteringAtZoom:18,
  iconCreateFunction:function(cluster){var count=cluster.getChildCount();
    var sz=count>5?44:36;
    return L.divIcon({html:'<div class="marker-cluster-custom" style="width:'+sz+'px;height:'+sz+'px"><span>'+count+'</span></div>',className:'',iconSize:[sz,sz]})}
});
map.addLayer(markerCluster);
var historyLayer=L.layerGroup().addTo(map);
var entityHistoryLayers={};
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function initials(n){return n.split(' ').map(function(w){return w.charAt(0)}).filter(Boolean).slice(0,2).join('').toUpperCase()}

// ── DAY COLORS for multi-day trails ──
var DAY_COLORS=['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
function getDayColor(dayIndex){return DAY_COLORS[dayIndex%DAY_COLORS.length]}

function updateMarkers(entities){
  var ids={};
  entities.forEach(function(e){ids[e.id]=true;
    var inner;
    if(e.picture){
      inner='<div class="pic-marker" style="width:34px;height:34px;border-color:'+esc(e.color)+';background:'+esc(e.color)+'">'
        +'<img src="'+esc(e.picture)+'" onerror="this.style.display=\\'none\\';this.nextSibling.style.display=\\'flex\\'">'
        +'<div class="entity-marker" style="display:none;background:'+esc(e.color)+';width:34px;height:34px;border:none">'+esc(initials(e.name))+'</div></div>';
    }else{
      inner='<div class="entity-marker" style="background:'+esc(e.color)+';width:34px;height:34px">'+esc(initials(e.name))+'</div>';
    }
    var html='<div style="position:relative"><div class="pulse-ring" style="background:'+esc(e.color)+'"></div>'+inner+'</div>';
    var metaKey=e.picture+'|'+e.color+'|'+e.name;
    var icon=L.divIcon({className:'',html:html,iconSize:[34,34],iconAnchor:[17,17]});
    if(rawMarkers[e.id]){
      // Update position without removing from cluster (preserves spiderfy)
      var prev=rawMarkers[e.id].getLatLng();
      if(Math.abs(prev.lat-e.lat)>0.000001||Math.abs(prev.lng-e.lng)>0.000001){
        rawMarkers[e.id].setLatLng([e.lat,e.lng]);
      }
      if(markerMeta[e.id]!==metaKey){markerMeta[e.id]=metaKey;rawMarkers[e.id].setIcon(icon)}
    }else{
      markerMeta[e.id]=metaKey;
      rawMarkers[e.id]=L.marker([e.lat,e.lng],{icon:icon,zIndexOffset:1000});
      rawMarkers[e.id].on('click',function(){parent.postMessage({type:'entityClicked',entityId:e.id},'*')});
      markerCluster.addLayer(rawMarkers[e.id]);
    }
    if(e.gpsAccuracy&&e.gpsAccuracy>50){
      if(accCircles[e.id]){accCircles[e.id].setLatLng([e.lat,e.lng]);accCircles[e.id].setRadius(e.gpsAccuracy)}
      else{accCircles[e.id]=L.circle([e.lat,e.lng],{radius:e.gpsAccuracy,color:e.color,fillColor:e.color,fillOpacity:.06,weight:1,opacity:.15}).addTo(map)}
    }else if(accCircles[e.id]){map.removeLayer(accCircles[e.id]);delete accCircles[e.id]}
  });
  Object.keys(rawMarkers).forEach(function(id){if(!ids[id]){
    markerCluster.removeLayer(rawMarkers[id]);delete rawMarkers[id];
    if(accCircles[id]){map.removeLayer(accCircles[id]);delete accCircles[id]}}});
}

function updateZones(zd){
  var ids={};
  zd.forEach(function(z){ids[z.id]=true;var h=z.id==='zone.home';
    var zoneColor=h?'#3b82f6':'#a855f7';
    if(zones[z.id]){zones[z.id].setLatLng([z.lat,z.lng]);zones[z.id].setRadius(z.radius)}
    else{
      zones[z.id]=L.circle([z.lat,z.lng],{radius:z.radius,
        color:zoneColor,opacity:0.35,weight:2,dashArray:h?'':'6 4',
        fillColor:zoneColor,fillOpacity:0.08}).addTo(map);
      // Always show zone label
      var labelClass=h?'zone-label zone-label-home':'zone-label';
      var emoji=h?'\\ud83c\\udfe0 ':'\\ud83d\\udccd ';
      zoneLabels[z.id]=L.marker([z.lat,z.lng],{icon:L.divIcon({className:'',
        html:'<div class="'+labelClass+'">'+emoji+esc(z.name)+'</div>',
        iconAnchor:[0,-z.radius*0.0001]})}).addTo(map);
    }
  });
  Object.keys(zones).forEach(function(id){if(!ids[id]){map.removeLayer(zones[id]);delete zones[id];
    if(zoneLabels[id]){map.removeLayer(zoneLabels[id]);delete zoneLabels[id]}}});
}

// ── OSRM routing helper with cache ──
var routeCache={};
function routeCacheKey(points){
  if(points.length<2)return '';
  // Use first, last and middle point + count as cache key
  var f=points[0],l=points[points.length-1],m=points[Math.floor(points.length/2)];
  return points.length+'_'+f[0].toFixed(4)+','+f[1].toFixed(4)+'_'+m[0].toFixed(4)+','+m[1].toFixed(4)+'_'+l[0].toFixed(4)+','+l[1].toFixed(4);
}
function fetchRoute(points,callback){
  if(points.length<2){callback(null);return}
  var key=routeCacheKey(points);
  if(key&&routeCache[key]){callback(routeCache[key]);return}
  var coords=points.map(function(p){return p[1]+','+p[0]}).join(';');
  if(points.length>100){
    var sampled=[points[0]];
    var step=Math.max(1,Math.floor(points.length/98));
    for(var i=step;i<points.length-1;i+=step)sampled.push(points[i]);
    sampled.push(points[points.length-1]);
    coords=sampled.map(function(p){return p[1]+','+p[0]}).join(';');
  }
  var url='https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson';
  fetch(url).then(function(r){return r.json()}).then(function(data){
    if(data.routes&&data.routes[0]){
      var geom=data.routes[0].geometry.coordinates.map(function(c){return[c[1],c[0]]});
      if(key)routeCache[key]=geom;
      callback(geom);
    }else{callback(null)}
  }).catch(function(){callback(null)});
}

// ── Direction arrows helper ──
function addArrowsToLine(lg,coords,color){
  if(!coords||coords.length<2)return;
  var totalDist=0;var dists=[0];
  for(var ai=1;ai<coords.length;ai++){
    var dlat=coords[ai][0]-coords[ai-1][0];var dlng=coords[ai][1]-coords[ai-1][1];
    totalDist+=Math.sqrt(dlat*dlat+dlng*dlng);dists.push(totalDist);
  }
  if(totalDist<0.001)return;
  var numArrows=Math.max(1,Math.min(30,Math.floor(totalDist/0.004)));
  var interval=totalDist/(numArrows+1);
  var walked=0;
  for(var bi=1;bi<coords.length;bi++){
    var segLen=dists[bi]-dists[bi-1];
    while(walked+interval<=dists[bi]){
      walked+=interval;
      var t=(walked-dists[bi-1])/segLen;
      var iLat=coords[bi-1][0]+(coords[bi][0]-coords[bi-1][0])*t;
      var iLng=coords[bi-1][1]+(coords[bi][1]-coords[bi-1][1])*t;
      var bearing=Math.atan2(coords[bi][1]-coords[bi-1][1],coords[bi][0]-coords[bi-1][0])*180/Math.PI;
      var rot=90-bearing;
      var svg='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M6 1L10 9L6 7L2 9Z" fill="'+color+'" stroke="white" stroke-width="0.5" opacity="0.9"/></svg>';
      var arrowHtml='<div class="arrow-icon" style="transform:rotate('+rot+'deg)">'+svg+'</div>';
      var arrowIcon=L.divIcon({className:'',html:arrowHtml,iconSize:[12,12],iconAnchor:[6,6]});
      L.marker([iLat,iLng],{icon:arrowIcon,interactive:false,zIndexOffset:500}).addTo(lg);
    }
  }
}

// ── Parallel offset for overlapping segments ──
// Uses pixel-based offset via CSS transform for clean parallel display
function offsetLine(coords,offsetMeters){
  if(!coords||coords.length<2||offsetMeters===0)return coords;
  var result=[];
  var off=offsetMeters/111320;
  for(var oi=0;oi<coords.length;oi++){
    if(oi===0){
      var dx=coords[1][1]-coords[0][1];var dy=coords[1][0]-coords[0][0];
      var len=Math.sqrt(dx*dx+dy*dy)||1;
      result.push([coords[0][0]+(-dx/len)*off, coords[0][1]+(dy/len)*off]);
    }else if(oi===coords.length-1){
      var dx2=coords[oi][1]-coords[oi-1][1];var dy2=coords[oi][0]-coords[oi-1][0];
      var len2=Math.sqrt(dx2*dx2+dy2*dy2)||1;
      result.push([coords[oi][0]+(-dx2/len2)*off, coords[oi][1]+(dy2/len2)*off]);
    }else{
      var dx3=coords[oi+1][1]-coords[oi-1][1];var dy3=coords[oi+1][0]-coords[oi-1][0];
      var len3=Math.sqrt(dx3*dx3+dy3*dy3)||1;
      result.push([coords[oi][0]+(-dx3/len3)*off, coords[oi][1]+(dy3/len3)*off]);
    }
  }
  return result;
}

// ── Trip leg splitting: detect segments where user was stationary, then split into separate trips ──
function splitIntoTripLegs(pts){
  // Split at stops: when user was stationary >10 min between points
  var legs=[];var legStart=0;
  for(var li=1;li<pts.length;li++){
    var gap=0;
    if(pts[li].isoTime&&pts[li-1].isoTime){
      gap=(new Date(pts[li].isoTime)-new Date(pts[li-1].isoTime))/60000;
    }
    var dist=Math.abs(pts[li].lat-pts[li-1].lat)+Math.abs(pts[li].lng-pts[li-1].lng);
    // Split if: gap > 10 min AND didn't move much (was stationary)
    if(gap>10&&dist<0.001){
      if(li-legStart>=2)legs.push({start:legStart,end:li});
      legStart=li;
    }
  }
  if(pts.length-legStart>=2)legs.push({start:legStart,end:pts.length});
  return legs.length>0?legs:[{start:0,end:pts.length}];
}

// ── Check if two legs share roads (overlap) ──
function legsOverlap(coords1,coords2){
  // Sample some points from each and check proximity
  var step1=Math.max(1,Math.floor(coords1.length/10));
  var count=0;
  for(var oi=0;oi<coords1.length;oi+=step1){
    var step2=Math.max(1,Math.floor(coords2.length/10));
    for(var oj=0;oj<coords2.length;oj+=step2){
      var d=Math.abs(coords1[oi][0]-coords2[oj][0])+Math.abs(coords1[oi][1]-coords2[oj][1]);
      if(d<0.0003)count++; // ~30m proximity
    }
  }
  return count>=2; // at least 2 sampled points overlap
}

function resetSegmentCounts(){}
// ── Route Replay Player ──
var playerState='idle';
var playerPoints=[];  // original GPS points
var playerIdx=0;      // current GPS point index
var playerSpd=10;     // speed multiplier (10x default, 1x = real-time)
var playerTimer=null;
var playerMkr=null;
var playerOvl=null;
var playerRoute=[];   // OSRM routed coords [[lat,lng], ...]
var playerCumDist=[];  // cumulative distance at each route coord (meters)
var playerTotalDist=0;
var playerWaypoints=[];
var playerElapsed=0;   // elapsed real-time seconds in the animation
var playerTotalTime=0; // total real-time seconds for the full route
var playerFollowCam=true; // camera follows marker
var playerDeletedIdx={}; // deleted point indices to skip
var playerDwells=[];  // [{startSec,endSec,durationMin,wpIdx}] detected dwell periods
var playerStartTimeMs=0; // first waypoint timestamp

function haversineDist(lat1,lng1,lat2,lng2){
  var R=6371000;
  var dLat=(lat2-lat1)*Math.PI/180;var dLng=(lng2-lng1)*Math.PI/180;
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function buildCumDist(route){
  playerCumDist=[0];playerTotalDist=0;
  for(var i=1;i<route.length;i++){
    playerTotalDist+=haversineDist(route[i-1][0],route[i-1][1],route[i][0],route[i][1]);
    playerCumDist.push(playerTotalDist);
  }
}

function posAtDist(dist){
  if(dist<=0)return playerRoute[0];
  if(dist>=playerTotalDist)return playerRoute[playerRoute.length-1];
  var lo=0,hi=playerCumDist.length-1;
  while(lo<hi-1){var mid=(lo+hi)>>1;if(playerCumDist[mid]<=dist)lo=mid;else hi=mid;}
  var segLen=playerCumDist[hi]-playerCumDist[lo];
  var frac=segLen>0?(dist-playerCumDist[lo])/segLen:0;
  return[playerRoute[lo][0]+(playerRoute[hi][0]-playerRoute[lo][0])*frac,playerRoute[lo][1]+(playerRoute[hi][1]-playerRoute[lo][1])*frac];
}

function buildPlayerWaypoints(pts,route){
  playerRoute=route;
  buildCumDist(route);
  playerWaypoints=[];
  var lastRouteIdx=0;
  for(var pi=0;pi<pts.length;pi++){
    if(playerDeletedIdx[pi])continue; // skip deleted points
    var bestDist=Infinity;var bestIdx=lastRouteIdx;
    for(var ri=lastRouteIdx;ri<route.length;ri++){
      var d=haversineDist(route[ri][0],route[ri][1],pts[pi].lat,pts[pi].lng);
      if(d<bestDist){bestDist=d;bestIdx=ri}
      if(d>bestDist+100&&bestDist<200)break;
    }
    lastRouteIdx=bestIdx;
    var timeMs=pts[pi].isoTime?new Date(pts[pi].isoTime).getTime():0;
    playerWaypoints.push({routeDist:playerCumDist[bestIdx],timeMs:timeMs,ptIdx:pi,time:pts[pi].time,date:pts[pi].date,state:pts[pi].state});
  }
  if(playerWaypoints.length>=2){
    playerStartTimeMs=playerWaypoints[0].timeMs;
    var tN=playerWaypoints[playerWaypoints.length-1].timeMs;
    playerTotalTime=(tN-playerStartTimeMs)/1000;
    if(playerTotalTime<=0)playerTotalTime=playerWaypoints.length*60;
  }else{playerStartTimeMs=0;playerTotalTime=60;}

  // Detect dwell periods (>10 min stationary)
  playerDwells=[];
  for(var di=0;di<playerWaypoints.length-1;di++){
    var distBtw=Math.abs(playerWaypoints[di+1].routeDist-playerWaypoints[di].routeDist);
    var timeBtw=(playerWaypoints[di+1].timeMs-playerWaypoints[di].timeMs)/1000;
    if(distBtw<50&&timeBtw>600){ // <50m movement over >10min
      var startSec=(playerWaypoints[di].timeMs-playerStartTimeMs)/1000;
      var endSec=(playerWaypoints[di+1].timeMs-playerStartTimeMs)/1000;
      playerDwells.push({startSec:startSec,endSec:endSec,durationMin:Math.round(timeBtw/60),wpIdx:di});
    }
  }
  // Send dwell info to parent
  var dwellInfo=playerDwells.map(function(dw){
    var wp=playerWaypoints[dw.wpIdx];
    return{startSec:dw.startSec,endSec:dw.endSec,durationMin:dw.durationMin,time:wp?wp.time:'',state:wp?wp.state:''};
  });
  parent.postMessage({type:'playerDwells',dwells:dwellInfo,totalTimeSec:playerTotalTime,startTimeMs:playerStartTimeMs},'*');
}

function getPlayerStateAtTime(elapsedSec){
  if(playerWaypoints.length<2)return null;
  var currentTimeMs=playerStartTimeMs+elapsedSec*1000;
  var wpA=playerWaypoints[0],wpB=playerWaypoints[playerWaypoints.length-1];
  var wpIdx=0;
  for(var i=0;i<playerWaypoints.length-1;i++){
    if(currentTimeMs>=playerWaypoints[i].timeMs&&currentTimeMs<=playerWaypoints[i+1].timeMs){
      wpA=playerWaypoints[i];wpB=playerWaypoints[i+1];wpIdx=i;break;
    }
    if(currentTimeMs>playerWaypoints[i].timeMs){wpA=playerWaypoints[i];wpB=playerWaypoints[Math.min(i+1,playerWaypoints.length-1)];wpIdx=i;}
  }
  var timeFrac=0;var dtMs=wpB.timeMs-wpA.timeMs;
  if(dtMs>0)timeFrac=Math.max(0,Math.min(1,(currentTimeMs-wpA.timeMs)/dtMs));
  var dist=wpA.routeDist+(wpB.routeDist-wpA.routeDist)*timeFrac;
  var pos=posAtDist(dist);
  var speedKmh=0;var distBetween=Math.abs(wpB.routeDist-wpA.routeDist);
  if(dtMs>0)speedKmh=(distBetween/(dtMs/1000))*3.6;
  // Compute interpolated clock time
  var clockMs=wpA.timeMs+(wpB.timeMs-wpA.timeMs)*timeFrac;
  var clockDate=new Date(clockMs);
  var clockTime=String(clockDate.getHours()).padStart(2,'0')+':'+String(clockDate.getMinutes()).padStart(2,'0')+':'+String(clockDate.getSeconds()).padStart(2,'0');
  return {pos:pos,dist:dist,wpIdx:wpIdx,ptIdx:wpA.ptIdx,time:wpA.time,date:wpA.date,state:wpA.state,speedKmh:Math.round(speedKmh),clockTime:clockTime,clockMs:clockMs};
}

function startPlayer(d){
  stopPlayer();
  if(!d.points||d.points.length<2)return;
  playerPoints=d.points;playerIdx=0;playerSpd=d.speed||10;playerState='loading';
  if(d.deletedIndices){playerDeletedIdx={};d.deletedIndices.forEach(function(i){playerDeletedIdx[i]=true})}
  playerFollowCam=d.followCamera!==false;
  playerOvl=document.createElement('div');playerOvl.id='player-overlay';
  playerOvl.textContent='Route wird berechnet...';
  document.body.appendChild(playerOvl);

  var ll=d.points.filter(function(p,i){return!playerDeletedIdx[i]}).map(function(p){return[p.lat,p.lng]});
  fetchRoute(ll,function(routedCoords){
    var route=routedCoords||ll;
    buildPlayerWaypoints(d.points,route);
    playerElapsed=0;playerState='playing';
    var startPos=playerRoute[0]||[d.points[0].lat,d.points[0].lng];
    var ic=L.divIcon({className:'',html:'<div class="player-dot"><\\/div>',iconSize:[18,18],iconAnchor:[9,9]});
    playerMkr=L.marker(startPos,{icon:ic,zIndexOffset:3000}).addTo(map);
    if(playerFollowCam)map.setView(startPos,Math.max(map.getZoom(),16),{animate:true});
    playerOvl.textContent='';
    parent.postMessage({type:'playerProgress',index:0,total:playerPoints.length,
      time:d.points[0].time,date:d.points[0].date,lat:startPos[0],lng:startPos[1],
      state:d.points[0].state,speed:0,elapsedSec:0,totalSec:playerTotalTime,clockTime:'',clockMs:playerStartTimeMs},'*');
    playerTimer=setInterval(tickPlayer2,50);
  });
}

function tickPlayer2(){
  if(playerState!=='playing')return;
  playerElapsed+=0.05*playerSpd;
  if(playerElapsed>=playerTotalTime){
    playerElapsed=playerTotalTime;
    var endPos=playerRoute[playerRoute.length-1];
    if(playerMkr&&endPos)playerMkr.setLatLng(endPos);
    playerState='done';
    if(playerTimer){clearInterval(playerTimer);playerTimer=null}
    parent.postMessage({type:'playerDone'},'*');
    return;
  }
  var st=getPlayerStateAtTime(playerElapsed);
  if(!st)return;
  playerMkr.setLatLng(st.pos);
  if(playerFollowCam){
    if(!map.getBounds().pad(-0.3).contains(st.pos)){
      map.panTo(st.pos,{animate:true,duration:0.4});
    }
  }
  if(playerOvl){
    var lbl=st.clockTime||'';
    if(st.speedKmh>0)lbl+=' \\u00b7 '+st.speedKmh+' km/h';
    if(st.state&&st.state!=='not_home'&&st.state!=='unknown'){
      lbl+=' \\u00b7 '+(st.state==='home'?'Zuhause':st.state);
    }
    playerOvl.textContent=lbl;
  }
  // Always send progress (for live time counter)
  parent.postMessage({type:'playerProgress',index:st.ptIdx,total:playerPoints.length,
    time:st.time,date:st.date,lat:st.pos[0],lng:st.pos[1],
    state:st.state,speed:st.speedKmh,elapsedSec:playerElapsed,totalSec:playerTotalTime,
    clockTime:st.clockTime,clockMs:st.clockMs},'*');
  playerIdx=st.ptIdx;
}

function pausePlayer(){
  if(playerState!=='playing')return;playerState='paused';
  if(playerTimer){clearInterval(playerTimer);playerTimer=null}
}
function resumePlayer(){
  if(playerState==='paused'){playerState='playing';playerTimer=setInterval(tickPlayer2,50);}
  else if(playerState==='done'&&playerRoute.length>1){
    playerElapsed=0;playerIdx=0;playerState='playing';
    if(playerMkr)playerMkr.setLatLng(playerRoute[0]);
    playerTimer=setInterval(tickPlayer2,50);
  }
}
function seekToTime(sec){
  var wasP=playerState==='playing';
  if(playerTimer){clearInterval(playerTimer);playerTimer=null}
  playerElapsed=Math.max(0,Math.min(sec,playerTotalTime));
  var st=getPlayerStateAtTime(playerElapsed);
  if(st&&playerMkr){
    playerMkr.setLatLng(st.pos);
    if(playerFollowCam)map.setView(st.pos,map.getZoom(),{animate:true});
    playerIdx=st.ptIdx;
    if(playerOvl){
      var lbl=st.clockTime||'';
      if(st.speedKmh>0)lbl+=' \\u00b7 '+st.speedKmh+' km/h';
      playerOvl.textContent=lbl;
    }
    parent.postMessage({type:'playerProgress',index:st.ptIdx,total:playerPoints.length,
      time:st.time,date:st.date,lat:st.pos[0],lng:st.pos[1],state:st.state,speed:st.speedKmh,
      elapsedSec:playerElapsed,totalSec:playerTotalTime,clockTime:st.clockTime,clockMs:st.clockMs},'*');
  }
  playerState=wasP?'playing':'paused';
  if(wasP){playerTimer=setInterval(tickPlayer2,50);}
}
function seekPlayer(idx){seekToTime(idx);} // idx is now seconds
function setFollowCam(v){playerFollowCam=!!v;if(playerFollowCam&&playerMkr){map.panTo(playerMkr.getLatLng(),{animate:true})}}
function stopPlayer(){
  playerState='idle';
  if(playerTimer){clearInterval(playerTimer);playerTimer=null}
  if(playerMkr){map.removeLayer(playerMkr);playerMkr=null}
  if(playerOvl){playerOvl.remove();playerOvl=null}
  playerPoints=[];playerIdx=0;playerRoute=[];playerCumDist=[];playerWaypoints=[];playerElapsed=0;playerDwells=[];
}
function setPlayerSpd2(s){playerSpd=s||10}

function drawHistoryTrail(data){
  resetSegmentCounts();
  var today=new Date().toISOString().slice(0,10);
  var yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);

  // Determine unique days in the data
  var daySet={};var dayList=[];
  if(data.points){data.points.forEach(function(p){
    var d=p.date||today;
    if(!daySet[d]){daySet[d]=true;dayList.push(d)}
  });dayList.sort()}

  function formatLabel(p){
    var d=p.date||today;
    var label='';
    if(d===today){label=p.time||''}
    else if(d===yesterday){label='Gestern '+( p.time||'')}
    else{
      var parts=d.split('-');
      label=parts[2]+'.'+parts[1]+'. '+(p.time||'');
    }
    if(p.state&&p.state!=='not_home'&&p.state!=='unknown')label+=(label?' \\u2022 ':'')+p.state;
    return label;
  }

  function dayColorForPoint(p,entityColor){
    if(dayList.length<=1)return entityColor;
    var idx=dayList.indexOf(p.date||today);
    return getDayColor(idx>=0?idx:0);
  }

  function drawSegments(lg,pts,entityColor,useRouting){
    var ll=pts.map(function(p){return[p.lat,p.lng]});
    var allDrawnCoords=[];

    // Split points into trip legs (stationary gaps > 10 min)
    var tripLegs=splitIntoTripLegs(pts);

    function drawLeg(legPts,legCoords,offsetM){
      var drawCoords=offsetM>0?offsetLine(legCoords,offsetM):legCoords;
      var legColor=dayColorForPoint(legPts[0],entityColor);
      if(dayList.length>1){
        // Multi-day: split by day within this leg
        var segStart2=0;var curDay=legPts[0].date||today;
        for(var mi=1;mi<legPts.length;mi++){
          if((legPts[mi].date||today)!==curDay){
            var frac2=mi/legPts.length;
            var rIdx=Math.min(Math.floor(frac2*drawCoords.length),drawCoords.length-1);
            var dIdx=dayList.indexOf(curDay);
            var sc=drawCoords.slice(segStart2,rIdx+1);
            if(sc.length>1){
              L.polyline(sc,{color:getDayColor(dIdx>=0?dIdx:0),weight:4,opacity:0.75,lineCap:'round',lineJoin:'round'}).addTo(lg);
              allDrawnCoords.push({coords:sc,color:getDayColor(dIdx>=0?dIdx:0)});
            }
            segStart2=rIdx;curDay=legPts[mi].date||today;
          }
        }
        var ldi=dayList.indexOf(curDay);
        var ls=drawCoords.slice(segStart2);
        if(ls.length>1){
          L.polyline(ls,{color:getDayColor(ldi>=0?ldi:0),weight:4,opacity:0.75,lineCap:'round',lineJoin:'round'}).addTo(lg);
          allDrawnCoords.push({coords:ls,color:getDayColor(ldi>=0?ldi:0)});
        }
      }else{
        L.polyline(drawCoords,{color:legColor,weight:4,opacity:0.75,lineCap:'round',lineJoin:'round'}).addTo(lg);
        allDrawnCoords.push({coords:drawCoords,color:legColor});
      }
    }

    // For each trip leg, route and draw
    var legResults=[];var pending=tripLegs.length;
    function onAllLegsReady(){
      // Detect overlap between legs and apply offsets
      for(var la=0;la<legResults.length;la++){
        var offM=0;
        for(var lb=0;lb<la;lb++){
          if(legsOverlap(legResults[la].coords,legResults[lb].coords)){offM+=5}
        }
        drawLeg(legResults[la].pts,legResults[la].coords,offM);
      }
      // Direction arrows
      allDrawnCoords.forEach(function(seg){addArrowsToLine(lg,seg.coords,seg.color)});
      // Dwell + markers
      drawDwellAndMarkers(lg,pts,entityColor);
    }

    if(useRouting){
      tripLegs.forEach(function(leg,idx){
        var legPts=pts.slice(leg.start,leg.end);
        var legLL=legPts.map(function(p){return[p.lat,p.lng]});
        fetchRoute(legLL,function(routed){
          legResults[idx]={pts:legPts,coords:routed||legLL};
          pending--;
          if(pending===0)onAllLegsReady();
        });
      });
    }else{
      tripLegs.forEach(function(leg,idx){
        var legPts=pts.slice(leg.start,leg.end);
        var legLL=legPts.map(function(p){return[p.lat,p.lng]});
        legResults[idx]={pts:legPts,coords:legLL};
      });
      // No overlap detection for straight lines — just draw directly
      for(var si=0;si<legResults.length;si++){
        drawLeg(legResults[si].pts,legResults[si].coords,0);
      }
      allDrawnCoords.forEach(function(seg){addArrowsToLine(lg,seg.coords,seg.color)});
      drawDwellAndMarkers(lg,pts,entityColor);
    }
  }

  function drawDwellAndMarkers(lg,pts,entityColor){
      var DWELL_RADIUS=0.0005; // ~50m
      var dwellClusters=[];
      var ci=0;
      while(ci<pts.length){
        var cluster={lat:pts[ci].lat,lng:pts[ci].lng,startIdx:ci,endIdx:ci,points:[pts[ci]]};
        var cj=ci+1;
        while(cj<pts.length&&Math.abs(pts[cj].lat-cluster.lat)<DWELL_RADIUS&&Math.abs(pts[cj].lng-cluster.lng)<DWELL_RADIUS){
          cluster.points.push(pts[cj]);cluster.endIdx=cj;
          // Update centroid
          cluster.lat=(cluster.lat*(cluster.points.length-1)+pts[cj].lat)/cluster.points.length;
          cluster.lng=(cluster.lng*(cluster.points.length-1)+pts[cj].lng)/cluster.points.length;
          cj++;
        }
        // Calculate dwell duration if points have isoTime
        var dur=0;
        if(cluster.points.length>1&&cluster.points[0].isoTime&&cluster.points[cluster.points.length-1].isoTime){
          dur=(new Date(cluster.points[cluster.points.length-1].isoTime)-new Date(cluster.points[0].isoTime))/60000;
        }
        cluster.durationMin=dur;
        dwellClusters.push(cluster);
        ci=cj;
      }

      // Merge clusters at same location (repeated visits) with time windows
      var mergedSpots={};
      dwellClusters.forEach(function(cl){
        var key=Math.round(cl.lat*1000)+','+Math.round(cl.lng*1000);
        if(!mergedSpots[key]){mergedSpots[key]={lat:cl.lat,lng:cl.lng,totalMin:0,visits:0,clusters:[],timeWindows:[]};}
        mergedSpots[key].totalMin+=cl.durationMin;
        mergedSpots[key].visits++;
        mergedSpots[key].clusters.push(cl);
        if(cl.points.length>0){
          var twS=cl.points[0].time||'';
          var twE=cl.points[cl.points.length-1].time||twS;
          mergedSpots[key].timeWindows.push({start:twS,end:twE,durationMin:cl.durationMin});
        }
      });

      // Draw dwell circles for significant stays (>5 min)
      Object.values(mergedSpots).forEach(function(spot){
        if(spot.totalMin<5)return;
        var r=Math.min(18,Math.max(8,4+Math.sqrt(spot.totalMin)*1.2));
        var ptColor=entityColor;
        if(spot.clusters.length>0){ptColor=dayColorForPoint(spot.clusters[0].points[0],entityColor)}
        var dwellCircle=L.circleMarker([spot.lat,spot.lng],{
          radius:r,fillColor:ptColor,fillOpacity:0.35,
          color:ptColor,weight:2,opacity:0.7
        }).addTo(lg);
        var tipLines=[];
        spot.timeWindows.forEach(function(tw){
          if(tw.durationMin<2)return;
          var durStr='';
          if(tw.durationMin>=60){durStr=Math.floor(tw.durationMin/60)+'h '+Math.round(tw.durationMin%60)+'min'}
          else{durStr=Math.round(tw.durationMin)+'min'}
          tipLines.push('\\u23f1 '+tw.start+'\\u2013'+tw.end+' ('+durStr+')');
        });
        if(tipLines.length===0){
          var durFallback='';
          if(spot.totalMin>=60){durFallback=Math.floor(spot.totalMin/60)+'h '+Math.round(spot.totalMin%60)+'min'}
          else{durFallback=Math.round(spot.totalMin)+'min'}
          tipLines.push('\\u23f1 '+durFallback);
        }
        if(spot.visits>1){tipLines.push(spot.visits+'x besucht')}
        dwellCircle.bindTooltip(tipLines.join('\\n'),{className:'history-tooltip',direction:'top',offset:[0,-r]});
      });

      // Draw regular point markers (skip points inside major dwell clusters)
      var dwellIndices={};
      dwellClusters.forEach(function(cl){
        if(cl.durationMin>=5){for(var di=cl.startIdx;di<=cl.endIdx;di++)dwellIndices[di]=true}
      });
      var step=Math.max(1,Math.floor(pts.length/30));
      pts.forEach(function(p,i){
        if(dwellIndices[i])return; // Skip, covered by dwell circle
        if(i===0||i===pts.length-1||i%step===0){
          var isEnd=i===0||i===pts.length-1;
          var ptColor=dayColorForPoint(p,entityColor);
          var cm=L.circleMarker([p.lat,p.lng],{
            radius:isEnd?6:3,fillColor:ptColor,fillOpacity:isEnd?1:0.7,
            color:'white',weight:isEnd?2:1
          }).addTo(lg);
          var label=formatLabel(p);
          if(label)cm.bindTooltip(label,{className:'history-tooltip',direction:'top',offset:[0,-6]});
          if(isEnd&&i===pts.length-1){
            cm.bindTooltip(label||'Jetzt',{className:'history-tooltip',direction:'top',offset:[0,-6],permanent:true}).openTooltip();
          }
        }
      });

      // Day legend if multi-day
      if(dayList.length>1){
        var legendHtml='<div style="background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);border-radius:8px;padding:6px 10px;font-size:10px;color:white;line-height:1.6">';
        dayList.forEach(function(d,i){
          var dParts=d.split('-');
          var dlabel=d===today?'Heute':d===yesterday?'Gestern':dParts[2]+'.'+dParts[1]+'.';
          legendHtml+='<div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:3px;border-radius:2px;background:'+getDayColor(i)+'"></div><span>'+dlabel+'</span></div>';
        });
        legendHtml+='</div>';
        var legendIcon=L.divIcon({className:'',html:legendHtml,iconAnchor:[0,0]});
        // Place legend at the start point
        L.marker([pts[0].lat,pts[0].lng],{icon:legendIcon,zIndexOffset:2000,interactive:false}).addTo(lg);
      }
    }

  if(data.entityId){
    if(entityHistoryLayers[data.entityId]){historyLayer.removeLayer(entityHistoryLayers[data.entityId])}
    var lg=L.layerGroup();entityHistoryLayers[data.entityId]=lg;
    if(!data.points||data.points.length<2){return}
    var col=data.color||'#3b82f6';
    drawSegments(lg,data.points,col,!!data.routeMode);
    lg.addTo(historyLayer);
    if(data.fitBounds){var bll=data.points.map(function(p){return[p.lat,p.lng]});map.fitBounds(L.latLngBounds(bll),{padding:[40,40],animate:true})}
    return;
  }
  historyLayer.clearLayers();entityHistoryLayers={};
  if(!data.points||data.points.length<2)return;
  var col2=data.color||'#3b82f6';
  var lg2=L.layerGroup();
  drawSegments(lg2,data.points,col2,!!data.routeMode);
  lg2.addTo(historyLayer);
  if(data.fitBounds){var bll2=data.points.map(function(p){return[p.lat,p.lng]});map.fitBounds(L.latLngBounds(bll2),{padding:[40,40],animate:true})}
}

function switchMapLayer(layer){
  map.removeLayer(currentTileLayer);
  if(layer==='satellite')currentTileLayer=satelliteLayer;
  else if(layer==='dark')currentTileLayer=darkLayer;
  else currentTileLayer=standardLayer;
  currentTileLayer.addTo(map);
  document.getElementById('map').classList.remove('dark-tiles');
  if(isDarkMode&&currentTileLayer===standardLayer){
    document.getElementById('map').classList.add('dark-tiles');
  }
}

window.addEventListener('message',function(e){
  var d=e.data;if(!d||!d.type)return;
  switch(d.type){
    case 'setView':map.setView([d.lat,d.lng],d.zoom,{animate:true});break;
    case 'fitBounds':map.fitBounds([[d.south,d.west],[d.north,d.east]],{padding:[30,30],animate:true});break;
    case 'updateMarkers':if(d.entities)updateMarkers(d.entities);if(d.zones)updateZones(d.zones);break;
    case 'setDarkMode':isDarkMode=!!d.dark;document.getElementById('map').classList.toggle('dark-tiles',isDarkMode&&currentTileLayer===standardLayer);break;
    case 'invalidateSize':map.invalidateSize();break;
    case 'drawHistoryTrail':drawHistoryTrail(d);break;
    case 'clearHistoryTrail':if(d.entityId&&entityHistoryLayers[d.entityId]){historyLayer.removeLayer(entityHistoryLayers[d.entityId]);delete entityHistoryLayers[d.entityId]}else{historyLayer.clearLayers();entityHistoryLayers={}}break;
    case 'switchLayer':switchMapLayer(d.layer);break;
    case 'fitAll':if(d.bounds)map.fitBounds([[d.bounds.south,d.bounds.west],[d.bounds.north,d.bounds.east]],{padding:[40,40],animate:true});break;
    case 'startPlayer':startPlayer(d);break;
    case 'pausePlayer':pausePlayer();break;
    case 'resumePlayer':resumePlayer();break;
    case 'stopPlayer':stopPlayer();break;
    case 'seekPlayer':seekPlayer(d.index);break;
    case 'seekToTime':seekToTime(d.seconds);break;
    case 'setPlayerSpeed':setPlayerSpd2(d.speed);break;
    case 'setFollowCam':setFollowCam(d.value);break;
    case 'skipDwell':seekToTime(d.endSec);break;
  }
});
parent.postMessage({type:'mapReady'},'*');
})()<\/script></body></html>`
}

const MAP_HTML = buildMapHtml()

export default function MapWidget({ config }: MapWidgetProps) {
  const { entities: allEntities } = useEntityStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [mapReady, setMapReady] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<TrackedEntity | null>(null)
  const [iframeKey, setIframeKey] = useState(0)
  const initialViewSet = useRef(false)
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null)
  const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyHours, setHistoryHours] = useState(24)
  const [mapLayer, setMapLayer] = useState<'standard' | 'satellite' | 'dark'>('standard')
  const [stateFilter, setStateFilter] = useState<'all' | 'home' | 'away'>('all')
  const [hiddenEntityIds, setHiddenEntityIds] = useState<Set<string>>(new Set())
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [modalSelectedEntity, setModalSelectedEntity] = useState<TrackedEntity | null>(null)
  const [modalHistoryEntityIds, setModalHistoryEntityIds] = useState<Set<string>>(new Set())
  const [modalHistoryData, setModalHistoryData] = useState<Record<string, HistoryPoint[]>>({})
  const [modalHistoryLoading, setModalHistoryLoading] = useState<Set<string>>(new Set())
  const [modalHistoryHours, setModalHistoryHours] = useState(24)
  const [modalMapLayer, setModalMapLayer] = useState<'standard' | 'satellite' | 'dark'>('standard')
  const [modalTab, setModalTab] = useState<'entities' | 'zones' | 'history'>('entities')
  const [routeMode, setRouteMode] = useState(false)
  const [modalRouteMode, setModalRouteMode] = useState(false)
  const [historyDate, setHistoryDate] = useState<string | null>(null) // YYYY-MM-DD or null for hours mode
  const [modalHistoryDate, setModalHistoryDate] = useState<string | null>(null)
  const [playerActive, setPlayerActive] = useState(false)
  const [playerPlaying, setPlayerPlaying] = useState(false)
  const [playerProgressData, setPlayerProgressData] = useState<{ index: number; total: number; time: string; date: string; state: string; speed?: number; elapsedSec?: number; totalSec?: number; clockTime?: string; clockMs?: number } | null>(null)
  const [playerSpeed, setPlayerSpeed] = useState(10)
  const [playerFollowCam, setPlayerFollowCam] = useState(true)
  const [playerDwells, setPlayerDwells] = useState<{ startSec: number; endSec: number; durationMin: number; time: string; state: string }[]>([])
  const [playerDwellPrompt, setPlayerDwellPrompt] = useState<{ startSec: number; endSec: number; durationMin: number } | null>(null)
  const [modalPlayerActive, setModalPlayerActive] = useState(false)
  const [modalPlayerPlaying, setModalPlayerPlaying] = useState(false)
  const [modalPlayerProgressData, setModalPlayerProgressData] = useState<{ index: number; total: number; time: string; date: string; state: string; speed?: number; elapsedSec?: number; totalSec?: number; clockTime?: string; clockMs?: number } | null>(null)
  const [modalPlayerSpeed, setModalPlayerSpeed] = useState(10)
  const [modalPlayerFollowCam, setModalPlayerFollowCam] = useState(true)
  const [modalPlayerDwells, setModalPlayerDwells] = useState<{ startSec: number; endSec: number; durationMin: number; time: string; state: string }[]>([])
  const [modalPlayerDwellPrompt, setModalPlayerDwellPrompt] = useState<{ startSec: number; endSec: number; durationMin: number } | null>(null)
  const modalIframeRef = useRef<HTMLIFrameElement>(null)
  const [modalMapReady, setModalMapReady] = useState(false)
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  // Refs to avoid stale closures in message handlers
  const playerDwellsRef = useRef(playerDwells)
  playerDwellsRef.current = playerDwells
  const playerDwellPromptRef = useRef(playerDwellPrompt)
  playerDwellPromptRef.current = playerDwellPrompt
  const modalPlayerDwellsRef = useRef(modalPlayerDwells)
  modalPlayerDwellsRef.current = modalPlayerDwells
  const modalPlayerDwellPromptRef = useRef(modalPlayerDwellPrompt)
  modalPlayerDwellPromptRef.current = modalPlayerDwellPrompt

  const variant = (config?.variant || config?.cardVariant || 'standard') as string
  const darkMode = config?.darkMode ?? false
  const showHeader = config?.showHeader !== false
  const showEntityList = config?.showEntityList !== false
  const showZones = config?.showZones !== false
  const autoFitEntities = config?.autoFitEntities ?? true
  const trackedEntityIds = config?.entities ?? []
  const configLat = config?.latitude
  const configLng = config?.longitude
  const configZoom = config?.zoom ?? 10

  // Extract tracked entities
  const trackedEntities = useMemo<TrackedEntity[]>(() => {
    const result: TrackedEntity[] = []
    const targetIds = trackedEntityIds.length > 0 ? trackedEntityIds : []

    for (const entity of allEntities) {
      const isTracked = targetIds.length === 0
        ? (entity.entity_id.startsWith('person.') || entity.entity_id.startsWith('device_tracker.'))
        : targetIds.includes(entity.entity_id)
      if (!isTracked) continue

      const lat = entity.attributes?.latitude as number | undefined
      const lng = entity.attributes?.longitude as number | undefined
      if (lat == null || lng == null) continue

      const idx = result.length
      result.push({
        entity_id: entity.entity_id,
        name: (entity.attributes?.friendly_name as string) || entity.entity_id.split('.')[1].replace(/_/g, ' '),
        latitude: lat,
        longitude: lng,
        state: entity.state,
        picture: entity.attributes?.entity_picture as string | undefined,
        icon: entity.attributes?.icon as string | undefined,
        color: getEntityColor(idx),
        battery: entity.attributes?.battery_level as number | undefined,
        gpsAccuracy: entity.attributes?.gps_accuracy as number | undefined,
        source: entity.attributes?.source_type as string | undefined,
        lastUpdated: entity.last_updated,
      })
    }
    return result
  }, [allEntities, trackedEntityIds])

  // Extract zones
  const zones = useMemo<ZoneEntity[]>(() => {
    if (!showZones) return []
    return allEntities
      .filter(e => e.entity_id.startsWith('zone.'))
      .map(e => ({
        entity_id: e.entity_id,
        name: (e.attributes?.friendly_name as string) || e.entity_id.split('.')[1],
        latitude: e.attributes?.latitude as number,
        longitude: e.attributes?.longitude as number,
        radius: (e.attributes?.radius as number) || 100,
        icon: e.attributes?.icon as string | undefined,
      }))
      .filter(z => z.latitude != null && z.longitude != null)
  }, [allEntities, showZones])

  const homeZone = useMemo(() => zones.find(z => z.entity_id === 'zone.home'), [zones])

  const trackedEntitiesMap = useMemo(() => {
    return new Map(trackedEntities.map(e => [e.entity_id, e]))
  }, [trackedEntities])

  // Filtered entities based on state filter and visibility
  const filteredEntities = useMemo(() => {
    return trackedEntities.filter(e => {
      if (hiddenEntityIds.has(e.entity_id)) return false
      if (stateFilter === 'home' && e.state !== 'home') return false
      if (stateFilter === 'away' && e.state === 'home') return false
      return true
    })
  }, [trackedEntities, stateFilter, hiddenEntityIds])

  // Toggle entity visibility
  const toggleEntityVisibility = useCallback((entityId: string) => {
    setHiddenEntityIds(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId)
      else next.add(entityId)
      return next
    })
  }, [])

  // Send message to iframe
  const sendToMap = useCallback((data: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(data, '*')
  }, [])

  // Listen for iframe messages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'mapReady') setMapReady(true)
      if (e.data?.type === 'entityClicked') {
        const entity = trackedEntitiesMap.get(e.data.entityId)
        if (entity) setSelectedEntity(prev => prev?.entity_id === entity.entity_id ? null : entity)
      }
      if (e.data?.type === 'playerProgress') {
        const d = e.data
        setPlayerProgressData({ index: d.index, total: d.total, time: d.time, date: d.date, state: d.state, speed: d.speed, elapsedSec: d.elapsedSec, totalSec: d.totalSec, clockTime: d.clockTime, clockMs: d.clockMs })
        // Check if entering a dwell zone - prompt to skip
        if (d.elapsedSec != null && playerDwellsRef.current.length > 0) {
          const dw = playerDwellsRef.current.find((dw: { startSec: number; endSec: number; durationMin: number }) => d.elapsedSec >= dw.startSec && d.elapsedSec < dw.startSec + 2 && dw.durationMin >= 10)
          if (dw && !playerDwellPromptRef.current) {
            setPlayerDwellPrompt({ startSec: dw.startSec, endSec: dw.endSec, durationMin: dw.durationMin })
            // auto-pause so user can decide
            sendToMap({ type: 'pausePlayer' })
            setPlayerPlaying(false)
          }
        }
      }
      if (e.data?.type === 'playerDwells') {
        setPlayerDwells(e.data.dwells || [])
      }
      if (e.data?.type === 'playerDone') {
        setPlayerPlaying(false)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [trackedEntities])

  // Initial view + markers on map ready
  useEffect(() => {
    if (!mapReady) return

    sendToMap({ type: 'setDarkMode', dark: darkMode })

    sendToMap({
      type: 'updateMarkers',
      entities: filteredEntities.map(e => ({
        id: e.entity_id, lat: e.latitude, lng: e.longitude,
        name: e.name, color: e.color, state: e.state, gpsAccuracy: e.gpsAccuracy,
        picture: e.picture ? new URL(e.picture, window.location.origin).href : undefined,
      })),
      zones: zones.map(z => ({
        id: z.entity_id, lat: z.latitude, lng: z.longitude,
        radius: z.radius, name: z.name,
      })),
    })

    if (!initialViewSet.current) {
      initialViewSet.current = true
      if (configLat != null && configLng != null) {
        sendToMap({ type: 'setView', lat: configLat, lng: configLng, zoom: configZoom })
      } else if (autoFitEntities && filteredEntities.length > 0) {
        const lats = filteredEntities.map(e => e.latitude)
        const lngs = filteredEntities.map(e => e.longitude)
        if (filteredEntities.length === 1) {
          sendToMap({ type: 'setView', lat: lats[0], lng: lngs[0], zoom: 15 })
        } else {
          sendToMap({
            type: 'fitBounds',
            south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01,
            north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01,
          })
        }
      } else if (homeZone) {
        sendToMap({ type: 'setView', lat: homeZone.latitude, lng: homeZone.longitude, zoom: 14 })
      } else {
        sendToMap({ type: 'setView', lat: 51.1657, lng: 10.4515, zoom: configZoom })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady])

  // Update markers when entities change
  useEffect(() => {
    if (!mapReady || !initialViewSet.current) return
    sendToMap({
      type: 'updateMarkers',
      entities: filteredEntities.map(e => ({
        id: e.entity_id, lat: e.latitude, lng: e.longitude,
        name: e.name, color: e.color, state: e.state, gpsAccuracy: e.gpsAccuracy,
        picture: e.picture ? new URL(e.picture, window.location.origin).href : undefined,
      })),
      zones: zones.map(z => ({
        id: z.entity_id, lat: z.latitude, lng: z.longitude,
        radius: z.radius, name: z.name,
      })),
    })
  }, [mapReady, filteredEntities, zones, sendToMap])

  // Update dark mode
  useEffect(() => {
    if (!mapReady) return
    sendToMap({ type: 'setDarkMode', dark: darkMode })
  }, [mapReady, darkMode, sendToMap])

  // Focus entity on map
  const focusEntity = useCallback((entity: TrackedEntity) => {
    setSelectedEntity(prev => prev?.entity_id === entity.entity_id ? null : entity)
    sendToMap({ type: 'setView', lat: entity.latitude, lng: entity.longitude, zoom: 15 })
  }, [sendToMap])

  const centerOnHome = useCallback(() => {
    if (homeZone) {
      sendToMap({ type: 'setView', lat: homeZone.latitude, lng: homeZone.longitude, zoom: 14 })
    } else if (trackedEntities.length > 0) {
      const lats = trackedEntities.map(e => e.latitude)
      const lngs = trackedEntities.map(e => e.longitude)
      sendToMap({
        type: 'fitBounds',
        south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01,
        north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01,
      })
    }
  }, [homeZone, trackedEntities, sendToMap])

  const refreshMap = useCallback(() => {
    setIframeKey(k => k + 1)
    setMapReady(false)
    initialViewSet.current = false
    setHistoryEntityId(null)
    setHistoryPoints([])
    setPlayerActive(false)
    setPlayerPlaying(false)
    setPlayerProgressData(null)
  }, [])

  const startRoutePlayer = useCallback(() => {
    if (historyPoints.length < 2) return
    sendToMap({ type: 'startPlayer', points: historyPoints, speed: playerSpeed, followCamera: playerFollowCam })
    setPlayerActive(true)
    setPlayerPlaying(true)
    setPlayerDwellPrompt(null)
    setPlayerDwells([])
    setPlayerProgressData({ index: 0, total: historyPoints.length, time: historyPoints[0].time, date: historyPoints[0].date, state: historyPoints[0].state })
  }, [historyPoints, playerSpeed, playerFollowCam, sendToMap])

  const stopRoutePlayer = useCallback(() => {
    sendToMap({ type: 'stopPlayer' })
    setPlayerActive(false)
    setPlayerPlaying(false)
    setPlayerProgressData(null)
    setPlayerDwellPrompt(null)
    setPlayerDwells([])
  }, [sendToMap])

  // Fit all tracked entities
  const fitAllEntities = useCallback(() => {
    if (trackedEntities.length === 0) return
    const lats = trackedEntities.map(e => e.latitude)
    const lngs = trackedEntities.map(e => e.longitude)
    if (trackedEntities.length === 1) {
      sendToMap({ type: 'setView', lat: lats[0], lng: lngs[0], zoom: 15 })
    } else {
      sendToMap({
        type: 'fitAll',
        bounds: {
          south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01,
          north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01,
        },
      })
    }
  }, [trackedEntities, sendToMap])

  // Switch map layer
  const switchLayer = useCallback((layer: 'standard' | 'satellite' | 'dark') => {
    setMapLayer(layer)
    sendToMap({ type: 'switchLayer', layer })
  }, [sendToMap])

  // Calculate distance from home
  const distanceFromHome = useCallback((entity: TrackedEntity) => {
    if (!homeZone) return null
    const R = 6371000
    const dLat = (entity.latitude - homeZone.latitude) * Math.PI / 180
    const dLng = (entity.longitude - homeZone.longitude) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(homeZone.latitude * Math.PI / 180) * Math.cos(entity.latitude * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (d < 1000) return `${Math.round(d)}m`
    return `${(d / 1000).toFixed(1)}km`
  }, [homeZone])

  // Fetch location history for an entity (hours or specific date)
  const fetchLocationHistory = useCallback(async (entityId: string, hours: number, date?: string | null) => {
    setHistoryLoading(true)
    try {
      const token = getAuthToken()
      let start: string
      let end: string | undefined
      if (date) {
        // Specific date: fetch from start of day to end of day
        start = new Date(date + 'T00:00:00').toISOString()
        end = new Date(date + 'T23:59:59').toISOString()
      } else {
        start = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
      }
      const params = new URLSearchParams({ filter_entity_id: entityId })
      if (end) params.set('end_time', end)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/history/period/${encodeURIComponent(start)}?${params}`, { headers })
      if (!res.ok) { setHistoryPoints([]); return }
      const data = await res.json()
      if (!data?.[0]) { setHistoryPoints([]); return }

      const points: HistoryPoint[] = data[0]
        .filter((entry: Record<string, unknown>) => {
          const attrs = entry.attributes as Record<string, unknown> | undefined
          return attrs?.latitude != null && attrs?.longitude != null
        })
        .map((entry: Record<string, unknown>) => {
          const attrs = entry.attributes as Record<string, number>
          const dt = new Date(entry.last_changed as string)
          return {
            lat: attrs.latitude,
            lng: attrs.longitude,
            time: dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            date: dt.toISOString().slice(0, 10),
            isoTime: dt.toISOString(),
            state: entry.state as string,
          }
        })

      // Deduplicate points that haven't moved
      const deduped: HistoryPoint[] = []
      for (const p of points) {
        const last = deduped[deduped.length - 1]
        if (!last || Math.abs(p.lat - last.lat) > 0.00005 || Math.abs(p.lng - last.lng) > 0.00005) {
          deduped.push(p)
        }
      }
      setHistoryPoints(filterGpsOutliers(deduped))
    } catch {
      setHistoryPoints([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Toggle history for an entity
  const toggleHistory = useCallback((entityId: string) => {
    if (historyEntityId === entityId) {
      setHistoryEntityId(null)
      setHistoryPoints([])
      sendToMap({ type: 'clearHistoryTrail' })
    } else {
      setHistoryEntityId(entityId)
      fetchLocationHistory(entityId, historyHours, historyDate)
    }
  }, [historyEntityId, historyHours, historyDate, fetchLocationHistory, sendToMap])

  // Send history trail to map when points change
  const historyEntityColor = useMemo(() => {
    if (!historyEntityId) return '#3b82f6'
    return trackedEntitiesMap.get(historyEntityId)?.color || '#3b82f6'
  }, [historyEntityId, trackedEntitiesMap])

  useEffect(() => {
    if (!mapReady || !historyEntityId) return
    if (historyPoints.length > 0) {
      sendToMap({
        type: 'drawHistoryTrail',
        points: historyPoints,
        color: historyEntityColor,
        fitBounds: true,
        routeMode,
      })
    } else {
      sendToMap({ type: 'clearHistoryTrail' })
    }
  }, [mapReady, historyPoints, historyEntityId, historyEntityColor, sendToMap, routeMode])

  // Re-fetch history when hours or date change
  useEffect(() => {
    if (historyEntityId) {
      fetchLocationHistory(historyEntityId, historyHours, historyDate)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyHours, historyDate])

  // Stop player when history context changes
  useEffect(() => {
    if (!playerActive) return
    sendToMap({ type: 'stopPlayer' })
    setPlayerActive(false)
    setPlayerPlaying(false)
    setPlayerProgressData(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyEntityId, historyHours, historyDate])

  // ── hours_to_show: auto-fetch history for all entities ──
  const fetchHistoryPoints = useCallback(async (entityId: string, hours: number, date?: string | null): Promise<HistoryPoint[]> => {
    try {
      const token = getAuthToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      let start: string
      let end: string
      if (date) {
        start = new Date(date + 'T00:00:00').toISOString()
        end = new Date(date + 'T23:59:59').toISOString()
      } else {
        start = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        end = new Date().toISOString()
      }

      // Try our own location history API first (long-term storage)
      const ownParams = new URLSearchParams({ start, end, limit: '5000' })
      const ownRes = await fetch(`/api/location-history/${encodeURIComponent(entityId)}?${ownParams}`, { headers })
      if (ownRes.ok) {
        const ownData = await ownRes.json()
        if (ownData?.points?.length > 0) {
          const points: HistoryPoint[] = ownData.points.map((p: { latitude: number; longitude: number; recorded_at: string; state?: string }) => {
            const dt = new Date(p.recorded_at)
            return {
              lat: p.latitude, lng: p.longitude,
              time: dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
              date: dt.toISOString().slice(0, 10),
              isoTime: dt.toISOString(),
              state: p.state || '',
            }
          })
          const deduped: HistoryPoint[] = []
          for (const p of points) {
            const last = deduped[deduped.length - 1]
            if (!last || Math.abs(p.lat - last.lat) > 0.00005 || Math.abs(p.lng - last.lng) > 0.00005) deduped.push(p)
          }
          return filterGpsOutliers(deduped)
        }
      }

      // Fallback to HA history proxy
      const params = new URLSearchParams({ filter_entity_id: entityId })
      if (date) params.set('end_time', end)
      const res = await fetch(`/api/history/period/${encodeURIComponent(start)}?${params}`, { headers })
      if (!res.ok) return []
      const data = await res.json()
      if (!data?.[0]) return []
      const points: HistoryPoint[] = data[0]
        .filter((entry: Record<string, unknown>) => {
          const attrs = entry.attributes as Record<string, unknown> | undefined
          return attrs?.latitude != null && attrs?.longitude != null
        })
        .map((entry: Record<string, unknown>) => {
          const attrs = entry.attributes as Record<string, number>
          const dt = new Date(entry.last_changed as string)
          return {
            lat: attrs.latitude, lng: attrs.longitude,
            time: dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            date: dt.toISOString().slice(0, 10),
            isoTime: dt.toISOString(),
            state: entry.state as string,
          }
        })
      const deduped: HistoryPoint[] = []
      for (const p of points) {
        const last = deduped[deduped.length - 1]
        if (!last || Math.abs(p.lat - last.lat) > 0.00005 || Math.abs(p.lng - last.lng) > 0.00005) deduped.push(p)
      }
      return filterGpsOutliers(deduped)
    } catch { return [] }
  }, [])

  const hoursToShow = config?.hours_to_show
  const autoTrailsLoaded = useRef(false)

  // Auto-show trails on widget map when hours_to_show is set
  useEffect(() => {
    if (!mapReady || !hoursToShow || hoursToShow <= 0 || trackedEntities.length === 0) return
    if (autoTrailsLoaded.current) return
    autoTrailsLoaded.current = true
    ;(async () => {
      for (const entity of trackedEntities) {
        const points = await fetchHistoryPoints(entity.entity_id, hoursToShow)
        if (points.length >= 2) {
          sendToMap({ type: 'drawHistoryTrail', entityId: entity.entity_id, points, color: entity.color, fitBounds: false, routeMode })
        }
      }
    })()
  }, [mapReady, hoursToShow, trackedEntities, fetchHistoryPoints, sendToMap])

  // Reset auto-trails flag when iframe reloads
  useEffect(() => {
    if (!mapReady) autoTrailsLoaded.current = false
  }, [mapReady])

  // ── Modal map helpers ──
  const sendToModalMap = useCallback((data: unknown) => {
    modalIframeRef.current?.contentWindow?.postMessage(data, '*')
  }, [])

  // Modal player callbacks
  const startModalRoutePlayer = useCallback(() => {
    const allPoints: HistoryPoint[] = []
    for (const entityId of modalHistoryEntityIds) {
      const pts = modalHistoryData[entityId]
      if (pts) allPoints.push(...pts)
    }
    allPoints.sort((a, b) => new Date(a.isoTime).getTime() - new Date(b.isoTime).getTime())
    if (allPoints.length < 2) return
    sendToModalMap({ type: 'startPlayer', points: allPoints, speed: modalPlayerSpeed, followCamera: modalPlayerFollowCam })
    setModalPlayerActive(true)
    setModalPlayerPlaying(true)
    setModalPlayerDwellPrompt(null)
    setModalPlayerDwells([])
    setModalPlayerProgressData({ index: 0, total: allPoints.length, time: allPoints[0].time, date: allPoints[0].date, state: allPoints[0].state })
  }, [modalHistoryEntityIds, modalHistoryData, modalPlayerSpeed, modalPlayerFollowCam, sendToModalMap])

  const stopModalRoutePlayer = useCallback(() => {
    sendToModalMap({ type: 'stopPlayer' })
    setModalPlayerActive(false)
    setModalPlayerPlaying(false)
    setModalPlayerProgressData(null)
    setModalPlayerDwellPrompt(null)
    setModalPlayerDwells([])
  }, [sendToModalMap])

  // Reset modal state when opening
  useEffect(() => {
    if (dialogOpen) {
      setModalSelectedEntity(null)
      setModalHistoryEntityIds(new Set())
      setModalHistoryData({})
      setModalHistoryLoading(new Set())
      setModalMapReady(false)
      setModalTab('entities')
      setModalPlayerActive(false)
      setModalPlayerPlaying(false)
      setModalPlayerProgressData(null)
    }
  }, [dialogOpen])

  // Listen for modal map messages
  useEffect(() => {
    if (!dialogOpen) return
    const handler = (e: MessageEvent) => {
      if (e.source !== modalIframeRef.current?.contentWindow) return
      if (e.data?.type === 'mapReady') setModalMapReady(true)
      if (e.data?.type === 'entityClicked') {
        const entity = trackedEntitiesMap.get(e.data.entityId)
        if (entity) setModalSelectedEntity(prev => prev?.entity_id === entity.entity_id ? null : entity)
      }
      if (e.data?.type === 'playerProgress') {
        const d = e.data
        setModalPlayerProgressData({ index: d.index, total: d.total, time: d.time, date: d.date, state: d.state, speed: d.speed, elapsedSec: d.elapsedSec, totalSec: d.totalSec, clockTime: d.clockTime, clockMs: d.clockMs })
        // Check if entering a dwell zone
        if (d.elapsedSec != null && modalPlayerDwellsRef.current.length > 0) {
          const dw = modalPlayerDwellsRef.current.find((dw: { startSec: number; endSec: number; durationMin: number }) => d.elapsedSec >= dw.startSec && d.elapsedSec < dw.startSec + 2 && dw.durationMin >= 10)
          if (dw && !modalPlayerDwellPromptRef.current) {
            setModalPlayerDwellPrompt({ startSec: dw.startSec, endSec: dw.endSec, durationMin: dw.durationMin })
            sendToModalMap({ type: 'pausePlayer' })
            setModalPlayerPlaying(false)
          }
        }
      }
      if (e.data?.type === 'playerDwells') {
        setModalPlayerDwells(e.data.dwells || [])
      }
      if (e.data?.type === 'playerDone') {
        setModalPlayerPlaying(false)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [dialogOpen, trackedEntities])

  // Update modal map markers (only markers, no layer switch)
  useEffect(() => {
    if (!modalMapReady) return
    sendToModalMap({
      type: 'updateMarkers',
      entities: filteredEntities.map(e => ({
        id: e.entity_id, lat: e.latitude, lng: e.longitude,
        name: e.name, color: e.color, state: e.state, gpsAccuracy: e.gpsAccuracy,
        picture: e.picture ? new URL(e.picture, window.location.origin).href : undefined,
      })),
      zones: zones.map(z => ({
        id: z.entity_id, lat: z.latitude, lng: z.longitude,
        radius: z.radius, name: z.name,
      })),
    })
  }, [modalMapReady, filteredEntities, zones, sendToModalMap])

  // Update modal dark mode
  useEffect(() => {
    if (!modalMapReady) return
    sendToModalMap({ type: 'setDarkMode', dark: darkMode })
  }, [modalMapReady, darkMode, sendToModalMap])

  // Update modal map layer
  useEffect(() => {
    if (!modalMapReady) return
    sendToModalMap({ type: 'switchLayer', layer: modalMapLayer })
  }, [modalMapReady, modalMapLayer, sendToModalMap])

  // Initial modal map view
  useEffect(() => {
    if (!modalMapReady) return
    if (configLat != null && configLng != null) {
      sendToModalMap({ type: 'setView', lat: configLat, lng: configLng, zoom: configZoom })
    } else if (filteredEntities.length > 0) {
      const lats = filteredEntities.map(e => e.latitude)
      const lngs = filteredEntities.map(e => e.longitude)
      if (filteredEntities.length === 1) {
        sendToModalMap({ type: 'setView', lat: lats[0], lng: lngs[0], zoom: 15 })
      } else {
        sendToModalMap({
          type: 'fitBounds',
          south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01,
          north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01,
        })
      }
    } else if (homeZone) {
      sendToModalMap({ type: 'setView', lat: homeZone.latitude, lng: homeZone.longitude, zoom: 14 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalMapReady])

  // Auto-show trails on modal map when hours_to_show is set
  useEffect(() => {
    if (!modalMapReady || !hoursToShow || hoursToShow <= 0 || trackedEntities.length === 0) return
    ;(async () => {
      for (const entity of trackedEntities) {
        const points = await fetchHistoryPoints(entity.entity_id, hoursToShow)
        if (points.length >= 2) {
          sendToModalMap({ type: 'drawHistoryTrail', entityId: entity.entity_id, points, color: entity.color, fitBounds: false, routeMode: modalRouteMode })
        }
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalMapReady])

  // Modal history fetch (per-entity, supports multiple)
  const fetchModalEntityHistory = useCallback(async (entityId: string, hours: number, date?: string | null) => {
    setModalHistoryLoading(prev => new Set(prev).add(entityId))
    try {
      const points = await fetchHistoryPoints(entityId, hours, date)
      setModalHistoryData(prev => ({ ...prev, [entityId]: points }))
    } finally {
      setModalHistoryLoading(prev => { const s = new Set(prev); s.delete(entityId); return s })
    }
  }, [fetchHistoryPoints])

  // Toggle modal history for an entity (multi-select)
  const toggleModalHistory = useCallback((entityId: string) => {
    setModalHistoryEntityIds(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) {
        next.delete(entityId)
        // Remove trail from map
        sendToModalMap({ type: 'clearHistoryTrail', entityId })
        setModalHistoryData(p => { const n = { ...p }; delete n[entityId]; return n })
      } else {
        next.add(entityId)
        fetchModalEntityHistory(entityId, modalHistoryHours, modalHistoryDate)
      }
      return next
    })
  }, [modalHistoryHours, modalHistoryDate, fetchModalEntityHistory, sendToModalMap])

  // Draw modal history trails when data changes (per-entity)
  useEffect(() => {
    if (!modalMapReady) return
    for (const entityId of modalHistoryEntityIds) {
      const points = modalHistoryData[entityId]
      if (points && points.length >= 2) {
        const entity = trackedEntitiesMap.get(entityId)
        sendToModalMap({ type: 'drawHistoryTrail', entityId, points, color: entity?.color || '#3b82f6', fitBounds: false, routeMode: modalRouteMode })
      }
    }
  }, [modalMapReady, modalHistoryData, modalHistoryEntityIds, trackedEntitiesMap, sendToModalMap, modalRouteMode])

  // Re-fetch all active modal histories when hours or date change
  useEffect(() => {
    if (modalHistoryEntityIds.size === 0) return
    for (const entityId of modalHistoryEntityIds) {
      fetchModalEntityHistory(entityId, modalHistoryHours, modalHistoryDate)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalHistoryHours, modalHistoryDate])

  // Focus entity on modal map
  const focusModalEntity = useCallback((entity: TrackedEntity) => {
    setModalSelectedEntity(prev => prev?.entity_id === entity.entity_id ? null : entity)
    sendToModalMap({ type: 'setView', lat: entity.latitude, lng: entity.longitude, zoom: 16 })
  }, [sendToModalMap])

  // Fit all entities in modal
  const fitAllModal = useCallback(() => {
    const ents = filteredEntities.length > 0 ? filteredEntities : trackedEntities
    if (ents.length === 0) return
    const lats = ents.map(e => e.latitude)
    const lngs = ents.map(e => e.longitude)
    if (ents.length === 1) {
      sendToModalMap({ type: 'setView', lat: lats[0], lng: lngs[0], zoom: 15 })
    } else {
      sendToModalMap({ type: 'fitAll', bounds: { south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01, north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01 } })
    }
  }, [filteredEntities, trackedEntities, sendToModalMap])

  // Compute stats for modal
  const entityStats = useMemo(() => {
    const home = trackedEntities.filter(e => e.state === 'home').length
    const away = trackedEntities.filter(e => e.state !== 'home').length
    const hidden = hiddenEntityIds.size
    return { home, away, hidden, total: trackedEntities.length }
  }, [trackedEntities, hiddenEntityIds])

  const formatTimeAgo = useCallback((iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'gerade eben'
    if (mins < 60) return `vor ${mins} Min.`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `vor ${hrs} Std.`
    return `vor ${Math.floor(hrs / 24)} T.`
  }, [])

  const stateLabel = useCallback((state: string) => {
    const labels: Record<string, string> = { home: 'Zuhause', not_home: 'Unterwegs', unknown: 'Unbekannt' }
    return labels[state] || state
  }, [])

  // Map iframe element
  const mapIframe = (
    <iframe
      ref={iframeRef}
      key={iframeKey}
      srcDoc={MAP_HTML}
      sandbox="allow-scripts allow-same-origin"
      className="w-full h-full border-0"
      title="Karte"
      style={{ minHeight: 0 }}
    />
  )

  // Route replay player controls (floating over map)
  const formatElapsed = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  }

  const renderPlayerControls = () => {
    if (!playerActive) return null
    const p = playerProgressData
    const elapsed = p?.elapsedSec ?? 0
    const total = p?.totalSec ?? 1
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="absolute bottom-3 left-3 right-3 z-30"
      >
        <div className="bg-card/95 backdrop-blur-2xl rounded-xl border border-foreground/10 shadow-2xl px-3 py-2">
          {/* Dwell skip prompt */}
          {playerDwellPrompt && (
            <div className="flex items-center gap-2 mb-2 px-1 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <span className="text-[10px] text-amber-400 flex-1">Aufenthalt: {playerDwellPrompt.durationMin} Min. — Zur nächsten Bewegung springen?</span>
              <button
                onClick={() => {
                  sendToMap({ type: 'skipDwell', endSec: playerDwellPrompt!.endSec })
                  setPlayerDwellPrompt(null)
                  sendToMap({ type: 'resumePlayer' })
                  setPlayerPlaying(true)
                }}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-all"
              >
                Springen
              </button>
              <button
                onClick={() => {
                  setPlayerDwellPrompt(null)
                  sendToMap({ type: 'resumePlayer' })
                  setPlayerPlaying(true)
                }}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-foreground/5 text-foreground/40 hover:bg-foreground/10 transition-all"
              >
                Weiter
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (playerPlaying) {
                  sendToMap({ type: 'pausePlayer' })
                  setPlayerPlaying(false)
                } else {
                  sendToMap({ type: 'resumePlayer' })
                  setPlayerPlaying(true)
                }
              }}
              className="w-7 h-7 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 flex items-center justify-center text-blue-400 transition-all shrink-0"
            >
              {playerPlaying ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            <button
              onClick={stopRoutePlayer}
              className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 transition-all shrink-0"
            >
              <Stop size={14} weight="fill" />
            </button>
            {/* Camera follow toggle */}
            <button
              onClick={() => {
                const next = !playerFollowCam
                setPlayerFollowCam(next)
                sendToMap({ type: 'setFollowCam', value: next })
              }}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all shrink-0 ${playerFollowCam ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40'}`}
              title={playerFollowCam ? 'Kamera folgt' : 'Kamera frei'}
            >
              <Crosshair size={13} weight="bold" />
            </button>
            {/* Time-based slider */}
            <div className="flex-1 min-w-0">
              <input
                type="range"
                min={0}
                max={Math.round(total)}
                step={1}
                value={Math.round(elapsed)}
                onChange={e => sendToMap({ type: 'seekToTime', seconds: parseInt(e.target.value) })}
                className="w-full h-1 appearance-none bg-foreground/10 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {[{v:1,l:'1x'},{v:10,l:'10x'},{v:30,l:'30x'},{v:60,l:'60x'},{v:120,l:'120x'}].map(s => (
                <button
                  key={s.v}
                  onClick={() => { setPlayerSpeed(s.v); sendToMap({ type: 'setPlayerSpeed', speed: s.v }) }}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-all ${playerSpeed === s.v ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40'}`}
                >
                  {s.l}
                </button>
              ))}
            </div>
          </div>
          {/* Progress info: live elapsed timer + clock time + speed */}
          {p && (
            <div className="flex items-center justify-between text-[9px] text-foreground/50 mt-1">
              <span>{p.clockTime || p.time}{p.speed != null && p.speed > 0 ? ` · ${Math.round(p.speed)} km/h` : ''}{p.state && p.state !== 'not_home' && p.state !== 'unknown' ? ` · ${p.state === 'home' ? '🏠' : p.state}` : ''}</span>
              <span>{formatElapsed(elapsed)} / {formatElapsed(total)}</span>
            </div>
          )}
        </div>
      </motion.div>
    )
  }

  // History panel (reusable)
  const renderHistoryPanel = () => {
    if (!historyEntityId) return null
    const entity = trackedEntitiesMap.get(historyEntityId)
    if (!entity) return null
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="px-3 py-2 bg-blue-500/5 border-y border-blue-500/10">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <ClockCounterClockwise size={12} className="text-blue-400" />
              <span className="text-[11px] font-medium text-foreground/70">
                Verlauf: {entity.name}
              </span>
              {historyLoading && (
                <div className="w-3 h-3 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
              )}
            </div>
            <button
              onClick={() => { setHistoryEntityId(null); setHistoryPoints([]); sendToMap({ type: 'clearHistoryTrail' }) }}
              className="p-0.5 rounded hover:bg-foreground/10 text-foreground/40"
            >
              <Plus size={10} className="rotate-45" />
            </button>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {HISTORY_HOURS_OPTIONS.map(h => (
              <button
                key={h}
                onClick={() => { setHistoryDate(null); setHistoryHours(h) }}
                className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${
                  !historyDate && historyHours === h
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'
                }`}
              >
                {HISTORY_HOURS_LABELS[h] || `${h}h`}
              </button>
            ))}
            <button
              onClick={() => setRouteMode(r => !r)}
              className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all flex items-center gap-0.5 ${routeMode ? 'bg-green-500/20 text-green-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}
              title={routeMode ? 'Straßenmodus aktiv' : 'Straßenmodus'}
            >
              <Path size={10} /> Straße
            </button>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <CalendarBlank size={10} className="text-foreground/40" />
            <input
              type="date"
              value={historyDate || ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => { const v = e.target.value; setHistoryDate(v || null) }}
              className="bg-foreground/5 text-foreground/60 text-[9px] rounded-md px-1.5 py-0.5 border border-foreground/10 outline-none focus:border-blue-400/40"
              title="Bestimmten Tag anzeigen"
            />
            {historyDate && (
              <button
                onClick={() => setHistoryDate(null)}
                className="text-[9px] text-foreground/40 hover:text-foreground/60"
              >✕</button>
            )}
          </div>
          {historyPoints.length > 0 && !historyLoading && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[9px] text-foreground/30">
                {historyPoints.length} Punkte{historyDate ? ` · ${historyDate.split('-').reverse().join('.')}` : ` · Letzte ${HISTORY_HOURS_LABELS[historyHours] || `${historyHours}h`}`}
              </p>
              <button
                onClick={playerActive ? stopRoutePlayer : startRoutePlayer}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                  playerActive ? 'bg-red-500/25 text-red-400 hover:bg-red-500/35 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
                }`}
              >
                {playerActive ? <><Stop size={14} weight="fill" /> Stop</> : <><Play size={14} weight="fill" /> Route abspielen</>}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    )
  }

  // Map layer selector (reusable)
  const renderLayerSelector = () => (
    <div className="flex items-center gap-0.5 bg-foreground/5 rounded-lg p-0.5">
      {([['standard', 'Karte'], ['satellite', 'Satellit'], ['dark', 'Dunkel']] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={() => switchLayer(key)}
          className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${
            mapLayer === key
              ? 'bg-foreground/10 text-foreground/70 shadow-sm'
              : 'text-foreground/35 hover:text-foreground/50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  // Entity detail card (reusable)
  const renderEntityDetails = (entity: TrackedEntity) => (
    <div className="bg-card/95 backdrop-blur-2xl rounded-xl border border-foreground/10 shadow-2xl p-3">
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 shadow-lg"
          style={{ borderColor: entity.color, backgroundColor: entity.picture ? 'transparent' : entity.color }}
        >
          {entity.picture ? (
            <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            <span className="text-white text-sm font-bold">{getInitials(entity.name)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{entity.name}</p>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
            <span className="text-[11px] text-foreground/60">{stateLabel(entity.state)}</span>
          </div>
        </div>
        <button
          onClick={() => setSelectedEntity(null)}
          className="p-1 rounded-md hover:bg-foreground/10 text-foreground/40 transition-colors"
        >
          <Plus size={12} className="rotate-45" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {entity.battery != null && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
            <span className="text-foreground/40">🔋</span>
            <span className="text-foreground/70">{entity.battery}%</span>
          </div>
        )}
        {entity.gpsAccuracy != null && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
            <GpsFix size={10} className="text-foreground/40" />
            <span className="text-foreground/70">±{entity.gpsAccuracy}m</span>
          </div>
        )}
        {entity.source && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
            <span className="text-foreground/40">📡</span>
            <span className="text-foreground/70 capitalize">{entity.source}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
          <span className="text-foreground/40">🕐</span>
          <span className="text-foreground/70">{formatTimeAgo(entity.lastUpdated)}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-foreground/6 flex items-center justify-between">
        <p className="text-[9px] text-foreground/30 font-mono">
          {entity.latitude.toFixed(5)}, {entity.longitude.toFixed(5)}
          {distanceFromHome(entity) && (
            <span className="ml-2 text-foreground/50">📍 {distanceFromHome(entity)} von Zuhause</span>
          )}
        </p>
        <button
          onClick={() => toggleHistory(entity.entity_id)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium transition-all ${
            historyEntityId === entity.entity_id
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/60'
          }`}
        >
          <ClockCounterClockwise size={10} />
          {historyEntityId === entity.entity_id ? 'Verlauf aus' : 'Verlauf'}
        </button>
      </div>
    </div>
  )

  // ── Map detail dialog (shared across all variants) ──
  const mapDialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[95vw] h-[95vh] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>{config?.title || 'Karte'}</DialogTitle>
        </DialogHeader>

        {/* ── Modal Header ── */}
        <div className="border-b border-foreground/8 px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/12 flex items-center justify-center">
                <MapTrifold size={16} weight="fill" className="text-blue-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{config?.title || 'Karte'}</h3>
                <p className="text-[10px] text-foreground/40">
                  {entityStats.total} Personen · {entityStats.home} Zuhause · {entityStats.away} Unterwegs
                  {entityStats.hidden > 0 && <span> · {entityStats.hidden} ausgeblendet</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Tip content="Alle zeigen">
                <button onClick={fitAllModal} className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all">
                  <Crosshair size={14} />
                </button>
              </Tip>
              {homeZone && (
                <Tip content="Zuhause">
                  <button onClick={() => sendToModalMap({ type: 'setView', lat: homeZone.latitude, lng: homeZone.longitude, zoom: 14 })} className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all">
                    <House size={14} weight="fill" />
                  </button>
                </Tip>
              )}
              <Tip content="Filter">
                <button
                  onClick={() => setShowFilterPanel(p => !p)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showFilterPanel ? 'bg-blue-500/15 text-blue-400' : 'bg-foreground/5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground'}`}
                >
                  <FunnelSimple size={14} />
                </button>
              </Tip>
            </div>
          </div>

          {/* Layer Selector + State Filter */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5 bg-foreground/5 rounded-lg p-0.5">
              {([['standard', 'Karte'], ['satellite', 'Satellit'], ['dark', 'Dunkel']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setModalMapLayer(key)} className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${modalMapLayer === key ? 'bg-foreground/10 text-foreground/70 shadow-sm' : 'text-foreground/35 hover:text-foreground/50'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 bg-foreground/5 rounded-lg p-0.5">
              {([['all', 'Alle'], ['home', 'Zuhause'], ['away', 'Unterwegs']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setStateFilter(key)} className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${stateFilter === key ? 'bg-foreground/10 text-foreground/70 shadow-sm' : 'text-foreground/35 hover:text-foreground/50'}`}>
                  {label} {key === 'all' ? `(${entityStats.total})` : key === 'home' ? `(${entityStats.home})` : `(${entityStats.away})`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Filter panel (toggle visibility per entity) ── */}
        <AnimatePresence>
          {showFilterPanel && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden shrink-0">
              <div className="px-4 py-2 bg-foreground/[0.02] border-b border-foreground/8">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-foreground/50">Sichtbarkeit</span>
                  <button onClick={() => setHiddenEntityIds(new Set())} className="text-[9px] text-blue-400 hover:text-blue-300 font-medium">Alle anzeigen</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {trackedEntities.map(entity => {
                    const isHidden = hiddenEntityIds.has(entity.entity_id)
                    return (
                      <button
                        key={entity.entity_id}
                        onClick={() => toggleEntityVisibility(entity.entity_id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                          isHidden ? 'bg-foreground/[0.02] border-foreground/8 text-foreground/30' : 'bg-foreground/5 border-foreground/10 text-foreground/70'
                        }`}
                      >
                        {isHidden ? <EyeSlash size={10} /> : <Eye size={10} />}
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: isHidden ? 'transparent' : entity.color, border: isHidden ? `1px solid ${entity.color}` : 'none' }} />
                        {entity.name.split(' ')[0]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Modal history bar ── */}
        <AnimatePresence>
          {modalHistoryEntityIds.size > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden shrink-0">
              <div className="px-4 py-2 bg-blue-500/5 border-b border-blue-500/10">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Path size={12} className="text-blue-400" />
                    <span className="text-[10px] font-medium text-foreground/70">
                      Verlauf: {Array.from(modalHistoryEntityIds).map(id => trackedEntitiesMap.get(id)?.name?.split(' ')[0]).filter(Boolean).join(', ')}
                    </span>
                    {modalHistoryLoading.size > 0 && <div className="w-2.5 h-2.5 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />}
                  </div>
                  <button onClick={() => {
                    for (const id of modalHistoryEntityIds) sendToModalMap({ type: 'clearHistoryTrail', entityId: id })
                    setModalHistoryEntityIds(new Set())
                    setModalHistoryData({})
                  }} className="p-0.5 rounded hover:bg-foreground/10 text-foreground/40">
                    <Plus size={10} className="rotate-45" />
                  </button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {HISTORY_HOURS_OPTIONS.map(h => (
                    <button key={h} onClick={() => { setModalHistoryDate(null); setModalHistoryHours(h) }} className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${!modalHistoryDate && modalHistoryHours === h ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}>{HISTORY_HOURS_LABELS[h] || `${h}h`}</button>
                  ))}
                  <button
                    onClick={() => setModalRouteMode(r => !r)}
                    className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all flex items-center gap-0.5 ${modalRouteMode ? 'bg-green-500/20 text-green-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}
                    title={modalRouteMode ? 'Straßenmodus aktiv' : 'Straßenmodus'}
                  >
                    <Path size={10} /> Straße
                  </button>
                  {Object.values(modalHistoryData).flat().length > 0 && modalHistoryLoading.size === 0 && (
                    <span className="text-[9px] text-foreground/30 ml-2">{Object.values(modalHistoryData).flat().length} Punkte</span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <CalendarBlank size={10} className="text-foreground/40" />
                  <input
                    type="date"
                    value={modalHistoryDate || ''}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => { const v = e.target.value; setModalHistoryDate(v || null) }}
                    className="bg-foreground/5 text-foreground/60 text-[9px] rounded-md px-1.5 py-0.5 border border-foreground/10 outline-none focus:border-blue-400/40"
                  />
                  {modalHistoryDate && (
                    <button onClick={() => setModalHistoryDate(null)} className="text-[9px] text-foreground/40 hover:text-foreground/60">✕</button>
                  )}
                </div>
                {/* Active trail entity chips */}
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {Array.from(modalHistoryEntityIds).map(id => {
                    const entity = trackedEntitiesMap.get(id)
                    if (!entity) return null
                    const pts = modalHistoryData[id]?.length || 0
                    const loading = modalHistoryLoading.has(id)
                    return (
                      <button
                        key={id}
                        onClick={() => toggleModalHistory(id)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-foreground/5 hover:bg-foreground/10 text-foreground/60 transition-all"
                      >
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entity.color }} />
                        {entity.name.split(' ')[0]}
                        {loading ? <div className="w-2 h-2 border border-current/40 border-t-current rounded-full animate-spin" /> : <span className="text-foreground/30">{pts}pt</span>}
                        <Plus size={8} className="rotate-45 text-foreground/30" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Map area ── */}
        <div className="flex-1 min-h-0 relative">
          <iframe
            ref={modalIframeRef}
            srcDoc={MAP_HTML}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title="Karte"
          />
          {/* Floating entity detail card */}
          <AnimatePresence>
            {modalSelectedEntity && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-3 left-3 z-20 w-[280px]"
              >
                <div className="bg-card/95 backdrop-blur-2xl rounded-xl border border-foreground/10 shadow-2xl p-3">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 shadow-lg" style={{ borderColor: modalSelectedEntity.color, backgroundColor: modalSelectedEntity.picture ? 'transparent' : modalSelectedEntity.color }}>
                      {modalSelectedEntity.picture ? <img src={modalSelectedEntity.picture} alt="" className="w-full h-full rounded-full object-cover" /> : <span className="text-white text-sm font-bold">{getInitials(modalSelectedEntity.name)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{modalSelectedEntity.name}</p>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${modalSelectedEntity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
                        <span className="text-[11px] text-foreground/60">{stateLabel(modalSelectedEntity.state)}</span>
                        {distanceFromHome(modalSelectedEntity) && <span className="text-[10px] text-foreground/40">· {distanceFromHome(modalSelectedEntity)}</span>}
                      </div>
                    </div>
                    <button onClick={() => setModalSelectedEntity(null)} className="p-1 rounded-md hover:bg-foreground/10 text-foreground/40"><Plus size={12} className="rotate-45" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {modalSelectedEntity.battery != null && (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                        <span className="text-foreground/40">🔋</span><span className="text-foreground/70">{modalSelectedEntity.battery}%</span>
                      </div>
                    )}
                    {modalSelectedEntity.gpsAccuracy != null && (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                        <GpsFix size={10} className="text-foreground/40" /><span className="text-foreground/70">±{modalSelectedEntity.gpsAccuracy}m</span>
                      </div>
                    )}
                    {modalSelectedEntity.source && (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                        <span className="text-foreground/40">📡</span><span className="text-foreground/70 capitalize">{modalSelectedEntity.source}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                      <span className="text-foreground/40">🕐</span><span className="text-foreground/70">{formatTimeAgo(modalSelectedEntity.lastUpdated)}</span>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-foreground/6 flex items-center justify-between">
                    <p className="text-[9px] text-foreground/30 font-mono">{modalSelectedEntity.latitude.toFixed(5)}, {modalSelectedEntity.longitude.toFixed(5)}</p>
                    <button onClick={() => toggleModalHistory(modalSelectedEntity.entity_id)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium transition-all ${modalHistoryEntityIds.has(modalSelectedEntity.entity_id) ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}>
                      <ClockCounterClockwise size={10} />
                      {modalHistoryEntityIds.has(modalSelectedEntity.entity_id) ? 'Verlauf aus' : 'Verlauf'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Bottom tabs + content ── */}
        <div className="shrink-0 border-t border-foreground/8">
          {/* Tab bar */}
          <div className="flex items-center gap-0 px-4 pt-1.5 border-b border-foreground/6">
            {([['entities', 'Personen', Users], ['zones', 'Zonen', MapPin], ['history', 'Verlauf', ClockCounterClockwise]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setModalTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-all ${
                  modalTab === key
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-foreground/40 hover:text-foreground/60'
                }`}
              >
                <Icon size={12} />
                {label}
                {key === 'entities' && <span className="text-[9px] bg-foreground/5 px-1.5 py-0.5 rounded-full">{filteredEntities.length}</span>}
                {key === 'zones' && <span className="text-[9px] bg-foreground/5 px-1.5 py-0.5 rounded-full">{zones.length}</span>}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="max-h-[25vh] overflow-y-auto px-4 py-2 space-y-1.5">
            {/* Entities tab */}
            {modalTab === 'entities' && (
              filteredEntities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-foreground/30 gap-1">
                  <User size={24} />
                  <p className="text-xs">{stateFilter !== 'all' ? 'Keine Personen in diesem Filter' : 'Keine Personen konfiguriert'}</p>
                </div>
              ) : filteredEntities.map(entity => (
                <button
                  key={entity.entity_id}
                  onClick={() => focusModalEntity(entity)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                    modalSelectedEntity?.entity_id === entity.entity_id
                      ? 'bg-foreground/10 ring-1 ring-foreground/15'
                      : 'bg-foreground/[0.03] border border-foreground/8 hover:bg-foreground/[0.06]'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: entity.color, backgroundColor: entity.picture ? 'transparent' : entity.color }}>
                    {entity.picture ? <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" /> : <span className="text-white text-[11px] font-bold">{getInitials(entity.name)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{entity.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-foreground/50">
                      <span className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
                        {stateLabel(entity.state)}
                      </span>
                      {entity.battery != null && <span>🔋 {entity.battery}%</span>}
                      {distanceFromHome(entity) && <span>📍 {distanceFromHome(entity)}</span>}
                      <span>{formatTimeAgo(entity.lastUpdated)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleModalHistory(entity.entity_id) }}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                        modalHistoryEntityIds.has(entity.entity_id) ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/30 hover:text-foreground/50'
                      }`}
                    >
                      <Path size={11} />
                    </button>
                  </div>
                </button>
              ))
            )}

            {/* Zones tab */}
            {modalTab === 'zones' && (
              zones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-foreground/30 gap-1">
                  <MapPin size={24} />
                  <p className="text-xs">Keine Zonen konfiguriert</p>
                </div>
              ) : zones.map(zone => {
                const isHome = zone.entity_id === 'zone.home'
                const entitiesInZone = trackedEntities.filter(e => {
                  const d = Math.sqrt((e.latitude - zone.latitude) ** 2 + (e.longitude - zone.longitude) ** 2) * 111320
                  return d <= zone.radius
                })
                return (
                  <button
                    key={zone.entity_id}
                    onClick={() => sendToModalMap({ type: 'setView', lat: zone.latitude, lng: zone.longitude, zoom: Math.max(14, 18 - Math.log2(zone.radius / 50)) })}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/8 hover:bg-foreground/[0.06] transition-all text-left"
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isHome ? 'bg-blue-500/12' : 'bg-purple-500/12'}`}>
                      {isHome ? <House size={16} weight="fill" className="text-blue-500" /> : <MapPin size={16} weight="fill" className="text-purple-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{zone.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-foreground/50">
                        <span>Radius: {zone.radius}m</span>
                        {entitiesInZone.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Users size={9} />
                            {entitiesInZone.length} {entitiesInZone.length === 1 ? 'Person' : 'Personen'}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[9px] text-foreground/25 font-mono shrink-0">{zone.latitude.toFixed(4)}, {zone.longitude.toFixed(4)}</p>
                  </button>
                )
              })
            )}

            {/* History tab */}
            {modalTab === 'history' && (
              <div className="space-y-2">
                <p className="text-[10px] text-foreground/40 mb-2">Wähle eine oder mehrere Personen um deren Bewegungsverlauf anzuzeigen:</p>
                
                {/* Entity selection (multi-select) */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {trackedEntities.map(entity => {
                    const isActive = modalHistoryEntityIds.has(entity.entity_id)
                    const isLoading = modalHistoryLoading.has(entity.entity_id)
                    return (
                      <button
                        key={entity.entity_id}
                        onClick={() => toggleModalHistory(entity.entity_id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                          isActive ? 'border-blue-500/30 bg-blue-500/10 text-blue-400' : 'bg-foreground/[0.03] border-foreground/8 text-foreground/50 hover:bg-foreground/[0.06]'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0" style={{ borderColor: entity.color, backgroundColor: entity.picture ? 'transparent' : entity.color }}>
                          {entity.picture ? <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" /> : <span className="text-white text-[7px] font-bold">{getInitials(entity.name)}</span>}
                        </div>
                        {entity.name.split(' ')[0]}
                        {isLoading && <div className="w-2.5 h-2.5 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />}
                        {isActive && !isLoading && <Path size={10} weight="fill" />}
                      </button>
                    )
                  })}
                </div>

                {/* Buttons: all on / all off */}
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => {
                      for (const entity of trackedEntities) {
                        if (!modalHistoryEntityIds.has(entity.entity_id)) toggleModalHistory(entity.entity_id)
                      }
                    }}
                    className="text-[9px] text-blue-400 hover:text-blue-300 font-medium"
                  >Alle aktivieren</button>
                  {modalHistoryEntityIds.size > 0 && (
                    <button
                      onClick={() => {
                        for (const id of modalHistoryEntityIds) {
                          sendToModalMap({ type: 'clearHistoryTrail', entityId: id })
                        }
                        setModalHistoryEntityIds(new Set())
                        setModalHistoryData({})
                      }}
                      className="text-[9px] text-foreground/40 hover:text-foreground/60 font-medium"
                    >Alle deaktivieren</button>
                  )}
                </div>

                {/* Time range selector */}
                <div className="pb-2 border-b border-foreground/8 mb-2">
                  <p className="text-[10px] text-foreground/40 mb-1.5">Zeitraum:</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {HISTORY_HOURS_OPTIONS.map(h => (
                      <button key={h} onClick={() => { setModalHistoryDate(null); setModalHistoryHours(h) }} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${!modalHistoryDate && modalHistoryHours === h ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}>{HISTORY_HOURS_LABELS[h] || `${h}h`}</button>
                    ))}
                    <button
                      onClick={() => setModalRouteMode(r => !r)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all flex items-center gap-0.5 ${modalRouteMode ? 'bg-green-500/20 text-green-400' : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'}`}
                      title={modalRouteMode ? 'Straßenmodus aktiv' : 'Straßenmodus'}
                    >
                      <Path size={10} /> Straße
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CalendarBlank size={12} className="text-foreground/40" />
                    <input
                      type="date"
                      value={modalHistoryDate || ''}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => { const v = e.target.value; setModalHistoryDate(v || null) }}
                      className="bg-foreground/5 text-foreground/60 text-[10px] rounded-lg px-2 py-1 border border-foreground/10 outline-none focus:border-blue-400/40"
                      title="Bestimmten Tag anzeigen"
                    />
                    {modalHistoryDate && (
                      <button onClick={() => setModalHistoryDate(null)} className="text-[10px] text-foreground/40 hover:text-foreground/60">✕</button>
                    )}
                  </div>
                </div>

                {/* Route Player */}
                {modalHistoryEntityIds.size > 0 && Object.values(modalHistoryData).some(p => p && p.length >= 2) && (
                  <div className="pb-2 border-b border-foreground/8 mb-2">
                    {!modalPlayerActive ? (
                      <button
                        onClick={startModalRoutePlayer}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30"
                      >
                        <Play size={16} weight="fill" /> Route abspielen
                      </button>
                    ) : (
                      <div className="space-y-2">
                        {/* Modal dwell skip prompt */}
                        {modalPlayerDwellPrompt && (
                          <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                            <span className="text-[10px] text-amber-400 flex-1">Aufenthalt: {modalPlayerDwellPrompt.durationMin} Min. — Zur nächsten Bewegung springen?</span>
                            <button
                              onClick={() => {
                                sendToModalMap({ type: 'skipDwell', endSec: modalPlayerDwellPrompt!.endSec })
                                setModalPlayerDwellPrompt(null)
                                sendToModalMap({ type: 'resumePlayer' })
                                setModalPlayerPlaying(true)
                              }}
                              className="px-2 py-0.5 rounded text-[9px] font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-all"
                            >
                              Springen
                            </button>
                            <button
                              onClick={() => {
                                setModalPlayerDwellPrompt(null)
                                sendToModalMap({ type: 'resumePlayer' })
                                setModalPlayerPlaying(true)
                              }}
                              className="px-2 py-0.5 rounded text-[9px] font-medium bg-foreground/5 text-foreground/40 hover:bg-foreground/10 transition-all"
                            >
                              Weiter
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (modalPlayerPlaying) {
                                sendToModalMap({ type: 'pausePlayer' })
                                setModalPlayerPlaying(false)
                              } else {
                                sendToModalMap({ type: 'resumePlayer' })
                                setModalPlayerPlaying(true)
                              }
                            }}
                            className="w-8 h-8 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 flex items-center justify-center text-blue-400 transition-all shrink-0"
                          >
                            {modalPlayerPlaying ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
                          </button>
                          <button
                            onClick={stopModalRoutePlayer}
                            className="w-8 h-8 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 transition-all shrink-0"
                          >
                            <Stop size={16} weight="fill" />
                          </button>
                          {/* Modal camera follow toggle */}
                          <button
                            onClick={() => {
                              const next = !modalPlayerFollowCam
                              setModalPlayerFollowCam(next)
                              sendToModalMap({ type: 'setFollowCam', value: next })
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0 ${modalPlayerFollowCam ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40'}`}
                            title={modalPlayerFollowCam ? 'Kamera folgt' : 'Kamera frei'}
                          >
                            <Crosshair size={14} weight="bold" />
                          </button>
                          {/* Time-based slider */}
                          <div className="flex-1 min-w-0">
                            <input
                              type="range"
                              min={0}
                              max={Math.round(modalPlayerProgressData?.totalSec || 1)}
                              step={1}
                              value={Math.round(modalPlayerProgressData?.elapsedSec || 0)}
                              onChange={e => sendToModalMap({ type: 'seekToTime', seconds: parseInt(e.target.value) })}
                              className="w-full h-1.5 appearance-none bg-foreground/10 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {[{v:1,l:'1x'},{v:10,l:'10x'},{v:30,l:'30x'},{v:60,l:'60x'},{v:120,l:'120x'}].map(s => (
                              <button
                                key={s.v}
                                onClick={() => { setModalPlayerSpeed(s.v); sendToModalMap({ type: 'setPlayerSpeed', speed: s.v }) }}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${modalPlayerSpeed === s.v ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40'}`}
                              >
                                {s.l}
                              </button>
                            ))}
                          </div>
                        </div>
                        {modalPlayerProgressData && (
                          <div className="flex items-center justify-between text-[10px] text-foreground/50">
                            <span>{modalPlayerProgressData.clockTime || modalPlayerProgressData.time}{modalPlayerProgressData.state && modalPlayerProgressData.state !== 'not_home' && modalPlayerProgressData.state !== 'unknown' ? ` · ${modalPlayerProgressData.state === 'home' ? '🏠' : modalPlayerProgressData.state}` : ''}{modalPlayerProgressData.speed != null && modalPlayerProgressData.speed > 0 ? ` · ${Math.round(modalPlayerProgressData.speed)} km/h` : ''}</span>
                            <span>{formatElapsed(modalPlayerProgressData.elapsedSec || 0)} / {formatElapsed(modalPlayerProgressData.totalSec || 0)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Timeline: merged chronological view */}
                {modalHistoryEntityIds.size > 0 && (() => {
                  // Build combined timeline entries from all active entities
                  const timelineEntries: { entityId: string; name: string; color: string; point: HistoryPoint; picture?: string }[] = []
                  for (const entityId of modalHistoryEntityIds) {
                    const points = modalHistoryData[entityId]
                    const entity = trackedEntitiesMap.get(entityId)
                    if (!points || !entity) continue
                    for (const p of points) {
                      timelineEntries.push({ entityId, name: entity.name, color: entity.color, point: p, picture: entity.picture })
                    }
                  }
                  // Sort by time string (HH:MM format)
                  timelineEntries.sort((a, b) => a.point.time.localeCompare(b.point.time))
                  // Show latest first, limit display
                  const reversed = [...timelineEntries].reverse()
                  const display = reversed.slice(0, 100)
                  
                  if (display.length === 0 && modalHistoryLoading.size === 0) {
                    return <p className="text-[10px] text-foreground/30 text-center py-4">Keine Verlaufsdaten gefunden</p>
                  }
                  if (display.length === 0) return null

                  return (
                    <div className="space-y-0.5">
                      <p className="text-[9px] text-foreground/30 mb-1">{timelineEntries.length} Einträge · neueste zuerst</p>
                      {display.map((entry, i) => (
                        <button
                          key={`${entry.entityId}-${i}`}
                          onClick={() => sendToModalMap({ type: 'setView', lat: entry.point.lat, lng: entry.point.lng, zoom: 16 })}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-all text-left group"
                        >
                          <div className="text-[9px] text-foreground/30 font-mono w-10 shrink-0 text-right">{entry.point.time}</div>
                          <div className="w-0.5 h-5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                          <div className="w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0" style={{ borderColor: entry.color, backgroundColor: entry.picture ? 'transparent' : entry.color }}>
                            {entry.picture ? <img src={entry.picture} alt="" className="w-full h-full rounded-full object-cover" /> : <span className="text-white text-[6px] font-bold">{getInitials(entry.name)}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] text-foreground/70 font-medium">{entry.name.split(' ')[0]}</span>
                            {entry.point.state && entry.point.state !== 'not_home' && entry.point.state !== 'unknown' && (
                              <span className="text-[9px] text-foreground/40 ml-1.5">{entry.point.state === 'home' ? '🏠 Zuhause' : entry.point.state}</span>
                            )}
                            {entry.point.state === 'not_home' && (
                              <span className="text-[9px] text-foreground/40 ml-1.5">📍 Unterwegs</span>
                            )}
                          </div>
                          <span className="text-[8px] text-foreground/20 font-mono opacity-0 group-hover:opacity-100 transition-opacity">{entry.point.lat.toFixed(4)},{entry.point.lng.toFixed(4)}</span>
                        </button>
                      ))}
                      {reversed.length > 100 && (
                        <p className="text-[9px] text-foreground/30 text-center py-1">… und {reversed.length - 100} weitere</p>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  // ═══════════════════════════════════════════════════
  // VARIANT: List - No map, full entity status cards
  // ═══════════════════════════════════════════════════
  if (variant === 'list') {
    return (
      <>
      <motion.div
        {...longPressHandlers}
        className="rounded-2xl h-full flex flex-col overflow-hidden glass-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/12 flex items-center justify-center">
            <Users size={16} weight="fill" className="text-blue-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">{config?.title || 'Standort-Übersicht'}</h3>
            <p className="text-[10px] text-foreground/40">
              {trackedEntities.length} {trackedEntities.length === 1 ? 'Person' : 'Personen'}
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2">
          {trackedEntities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/30 gap-2">
              <User size={32} />
              <p className="text-xs">Keine Personen konfiguriert</p>
            </div>
          ) : (
            trackedEntities.map(entity => (
              <div
                key={entity.entity_id}
                className="rounded-xl bg-foreground/[0.03] border border-foreground/8 p-3"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div
                    className="w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{ borderColor: entity.color, backgroundColor: entity.picture ? 'transparent' : entity.color }}
                  >
                    {entity.picture ? (
                      <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <span className="text-white text-[11px] font-bold">{getInitials(entity.name)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{entity.name}</p>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
                      <span className="text-[11px] text-foreground/60">{stateLabel(entity.state)}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {entity.battery != null && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                      <span className="text-foreground/40">🔋</span>
                      <span className="text-foreground/70">{entity.battery}%</span>
                    </div>
                  )}
                  {entity.gpsAccuracy != null && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                      <GpsFix size={10} className="text-foreground/40" />
                      <span className="text-foreground/70">±{entity.gpsAccuracy}m</span>
                    </div>
                  )}
                  {entity.source && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                      <span className="text-foreground/40">📡</span>
                      <span className="text-foreground/70 capitalize">{entity.source}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-foreground/5">
                    <span className="text-foreground/40">🕐</span>
                    <span className="text-foreground/70">{formatTimeAgo(entity.lastUpdated)}</span>
                  </div>
                </div>
                <div className="mt-2 pt-1.5 border-t border-foreground/6">
                  <p className="text-[9px] text-foreground/25 font-mono">
                    {entity.latitude.toFixed(5)}, {entity.longitude.toFixed(5)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
      {mapDialog}
      </>
    )
  }

  // ═══════════════════════════════════════════════════
  // VARIANT: Fullscreen - Edge-to-edge map, floating UI
  // ═══════════════════════════════════════════════════
  if (variant === 'fullscreen') {
    return (
      <>
      <motion.div
        {...longPressHandlers}
        className="rounded-2xl h-full overflow-hidden relative border border-foreground/8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="absolute inset-0">{mapIframe}</div>

        {config?.title && (
          <div className="absolute top-3 left-3 z-10">
            <div className="bg-card/80 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-foreground/10 shadow-lg">
              <p className="text-xs font-semibold text-foreground">{config.title}</p>
            </div>
          </div>
        )}

        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          {trackedEntities.length > 1 && (
            <Tip content="Alle zeigen" side="left">
              <button
                onClick={fitAllEntities}
                className="w-8 h-8 rounded-lg bg-card/80 backdrop-blur-xl border border-foreground/10 flex items-center justify-center text-foreground/60 hover:text-foreground shadow-lg transition-all active:scale-95"
              >
                <Crosshair size={14} />
              </button>
            </Tip>
          )}
          {homeZone && (
            <Tip content="Zentrieren" side="left">
              <button
                onClick={centerOnHome}
                className="w-8 h-8 rounded-lg bg-card/80 backdrop-blur-xl border border-foreground/10 flex items-center justify-center text-foreground/60 hover:text-foreground shadow-lg transition-all active:scale-95"
              >
                <House size={14} weight="fill" />
              </button>
            </Tip>
          )}
          <Tip content="Aktualisieren" side="left">
            <button
              onClick={refreshMap}
              className="w-8 h-8 rounded-lg bg-card/80 backdrop-blur-xl border border-foreground/10 flex items-center justify-center text-foreground/60 hover:text-foreground shadow-lg transition-all active:scale-95"
            >
              <ArrowClockwise size={14} />
            </button>
          </Tip>
        </div>

        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-card/80 backdrop-blur-xl rounded-lg border border-foreground/10 shadow-lg p-0.5 flex items-center gap-0.5">
            {([['standard', 'Karte'], ['satellite', 'Satellit'], ['dark', 'Dunkel']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => switchLayer(key)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  mapLayer === key
                    ? 'bg-foreground/10 text-foreground/80 shadow-sm'
                    : 'text-foreground/40 hover:text-foreground/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {trackedEntities.length > 0 && (
          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2 overflow-x-auto">
            {trackedEntities.map(entity => (
              <button
                key={entity.entity_id}
                onClick={() => focusEntity(entity)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shrink-0 backdrop-blur-xl shadow-lg border transition-all ${
                  selectedEntity?.entity_id === entity.entity_id
                    ? 'bg-card/90 border-foreground/20 ring-1 ring-accent/30'
                    : 'bg-card/70 border-foreground/10 hover:bg-card/90'
                }`}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ backgroundColor: entity.color }}
                >
                  {entity.picture ? (
                    <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : getInitials(entity.name).charAt(0)}
                </div>
                <span className="text-[11px] text-foreground/80 font-medium">{entity.name.split(' ')[0]}</span>
                <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
              </button>
            ))}
          </div>
        )}

        <AnimatePresence>
          {historyEntityId && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute bottom-16 right-3 z-20 w-[200px]"
            >
              <div className="bg-card/90 backdrop-blur-xl rounded-lg border border-foreground/10 shadow-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    <ClockCounterClockwise size={10} className="text-blue-400" />
                    <span className="text-[10px] font-medium text-foreground/70">Verlauf</span>
                    {historyLoading && <div className="w-2.5 h-2.5 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />}
                  </div>
                  <button onClick={() => { setHistoryEntityId(null); setHistoryPoints([]); sendToMap({ type: 'clearHistoryTrail' }) }} className="text-foreground/40 hover:text-foreground/60">
                    <Plus size={9} className="rotate-45" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {HISTORY_HOURS_OPTIONS.map(h => (
                    <button key={h} onClick={() => { setHistoryDate(null); setHistoryHours(h) }} className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-all ${!historyDate && historyHours === h ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/40'}`}>{HISTORY_HOURS_LABELS[h] || `${h}h`}</button>
                  ))}
                  <button
                    onClick={() => setRouteMode(r => !r)}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-all flex items-center gap-0.5 ${routeMode ? 'bg-green-500/20 text-green-400' : 'bg-foreground/5 text-foreground/40'}`}
                    title={routeMode ? 'Straßenmodus aktiv' : 'Straßenmodus'}
                  >
                    <Path size={9} />
                  </button>
                </div>
                <div className="flex items-center gap-0.5 mt-1">
                  <input
                    type="date"
                    value={historyDate || ''}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => { const v = e.target.value; setHistoryDate(v || null) }}
                    className="bg-foreground/5 text-foreground/60 text-[8px] rounded px-1 py-0.5 border border-foreground/10 outline-none focus:border-blue-400/40 w-full"
                  />
                  {historyDate && (
                    <button onClick={() => setHistoryDate(null)} className="text-[8px] text-foreground/40 hover:text-foreground/60 shrink-0">✕</button>
                  )}
                </div>
                {historyPoints.length > 0 && !historyLoading && (
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[8px] text-foreground/30">{historyPoints.length} Punkte</p>
                    <button
                      onClick={playerActive ? stopRoutePlayer : startRoutePlayer}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shadow-sm ${playerActive ? 'bg-red-500/25 text-red-400 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}
                    >
                      {playerActive ? <><Stop size={12} weight="fill" /> Stop</> : <><Play size={12} weight="fill" /> Abspielen</>}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedEntity && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-16 left-3 z-20 w-[260px]"
            >
              {renderEntityDetails(selectedEntity)}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {renderPlayerControls()}
        </AnimatePresence>
      </motion.div>
      {mapDialog}
      </>
    )
  }

  // ═══════════════════════════════════════════════════
  // VARIANT: Compact - Map top, entity panel bottom
  // ═══════════════════════════════════════════════════
  if (variant === 'compact') {
    return (
      <>
      <motion.div
        {...longPressHandlers}
        className="rounded-2xl h-full flex flex-col overflow-hidden glass-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
          <div className="flex items-center gap-1.5">
            <MapTrifold size={14} weight="fill" className="text-blue-500" />
            <h3 className="text-xs font-semibold text-foreground leading-tight">{config?.title || 'Karte'}</h3>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-foreground/40 mr-1">
              {trackedEntities.length} {trackedEntities.length === 1 ? 'Person' : 'Pers.'}
            </span>
            {homeZone && (
              <button onClick={centerOnHome} className="w-6 h-6 rounded-md bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 transition-all">
                <House size={11} weight="fill" />
              </button>
            )}
            <button onClick={refreshMap} className="w-6 h-6 rounded-md bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 transition-all">
              <ArrowClockwise size={11} />
            </button>
          </div>
        </div>

        <div className="flex-[3] min-h-0 relative mx-2 rounded-lg overflow-hidden border border-foreground/8">
          {mapIframe}
        </div>

        <div className="flex-[2] min-h-0 overflow-y-auto px-2 py-2 space-y-1">
          {trackedEntities.length === 0 ? (
            <div className="flex items-center justify-center h-full text-foreground/30 text-xs">
              Keine Personen konfiguriert
            </div>
          ) : (
            trackedEntities.map(entity => (
              <button
                key={entity.entity_id}
                onClick={() => focusEntity(entity)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-left ${
                  selectedEntity?.entity_id === entity.entity_id
                    ? 'bg-foreground/10 ring-1 ring-foreground/15'
                    : 'bg-foreground/[0.03] hover:bg-foreground/[0.06]'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 text-[9px] font-bold text-white"
                  style={{ borderColor: entity.color, backgroundColor: entity.picture ? 'transparent' : entity.color }}
                >
                  {entity.picture ? (
                    <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : getInitials(entity.name).charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-foreground truncate">{entity.name}</p>
                  <div className="flex items-center gap-2 text-[9px] text-foreground/50">
                    <span className="flex items-center gap-1">
                      <div className={`w-1 h-1 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
                      {stateLabel(entity.state)}
                    </span>
                    {entity.battery != null && <span>🔋 {entity.battery}%</span>}
                    <span>{formatTimeAgo(entity.lastUpdated)}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </motion.div>
      {mapDialog}
      </>
    )
  }

  // ═══════════════════════════════════════════════════
  // VARIANT: Standard - Classic card layout (default)
  // ═══════════════════════════════════════════════════
  return (
    <>
    <motion.div
      {...longPressHandlers}
      className="rounded-2xl h-full flex flex-col overflow-hidden glass-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {showHeader && (
        <>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2 z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/12 flex items-center justify-center">
              <MapTrifold size={16} weight="fill" className="text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground leading-tight">{config?.title || 'Karte'}</h3>
              {trackedEntities.length > 0 && (
                <p className="text-[10px] text-foreground/40">
                  {trackedEntities.length} {trackedEntities.length === 1 ? 'Person' : 'Personen'} verfolgt
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {trackedEntities.length > 1 && (
              <Tip content="Alle Personen zeigen">
                <button
                  onClick={fitAllEntities}
                  className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
                >
                  <Crosshair size={14} />
                </button>
              </Tip>
            )}
            {homeZone && (
              <Tip content="Auf Zuhause zentrieren">
                <button
                  onClick={centerOnHome}
                  className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
                >
                  <House size={14} weight="fill" />
                </button>
              </Tip>
            )}
            <Tip content="Karte aktualisieren">
              <button
                onClick={refreshMap}
                className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
              >
                <ArrowClockwise size={14} />
              </button>
            </Tip>
          </div>
        </div>
        <div className="px-4 pb-1.5 flex items-center justify-between">
          {renderLayerSelector()}
        </div>
        </>
      )}

      <div className="flex-1 min-h-0 relative">
        {mapIframe}
        <AnimatePresence>
          {renderPlayerControls()}
        </AnimatePresence>
      </div>

      {showEntityList && trackedEntities.length > 0 && (
        <div className="border-t border-foreground/8 px-3 py-2 flex items-center gap-2 overflow-x-auto">
          {trackedEntities.map(entity => (
            <button
              key={entity.entity_id}
              onClick={() => focusEntity(entity)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all shrink-0 ${
                selectedEntity?.entity_id === entity.entity_id
                  ? 'bg-foreground/10 ring-1 ring-foreground/15'
                  : 'bg-foreground/5 hover:bg-foreground/10'
              }`}
            >
              <div
                className="w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-bold text-white"
                style={{ backgroundColor: entity.color, borderColor: entity.color }}
              >
                {entity.picture ? (
                  <img src={entity.picture} alt="" className="w-full h-full rounded-full object-cover" />
                ) : getInitials(entity.name).charAt(0)}
              </div>
              <span className="text-[11px] text-foreground/70 font-medium">{entity.name.split(' ')[0]}</span>
              <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {renderHistoryPanel()}
      </AnimatePresence>

      <AnimatePresence>
        {selectedEntity && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-foreground/8"
          >
            <div className="px-3 py-2.5">
              {renderEntityDetails(selectedEntity)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(config?.showAttribution ?? true) && (
        <div className="px-3 pb-1.5 pt-0.5">
          <p className="text-[8px] text-foreground/20 text-right">
            © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/40 transition-colors">OpenStreetMap</a>
          </p>
        </div>
      )}
    </motion.div>
      {mapDialog}
      </>
  )
}
