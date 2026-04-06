import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapTrifold, House, ArrowClockwise, GpsFix, User, Users, Plus } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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

// Build Leaflet srcdoc HTML (static, no user data embedded)
function buildMapHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
.dark-tiles .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(1.15) contrast(0.9) saturate(0.3)}
.leaflet-control-attribution{font-size:9px!important;opacity:0.6}
.entity-marker{border-radius:50%;border:2.5px solid white;display:flex;align-items:center;justify-content:center;
color:white;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:transform .15s}
.entity-marker:hover{transform:scale(1.15)}
.pulse-ring{position:absolute;inset:-4px;border-radius:50%;animation:pulse 3s ease-in-out infinite;opacity:.2;pointer-events:none}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(1.4);opacity:0}}
</style></head><body><div id="map"></div>
<script>(function(){
var map=L.map('map',{center:[51.16,10.45],zoom:5,zoomControl:false,attributionControl:true});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
attribution:'\\u00a9 <a href=\\"https://www.openstreetmap.org/copyright\\">OpenStreetMap</a>',maxZoom:19}).addTo(map);

var markers={},zones={},accCircles={},zoneLabels={};
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function initials(n){return n.split(' ').map(function(w){return w.charAt(0)}).filter(Boolean).slice(0,2).join('').toUpperCase()}

function updateMarkers(entities){
  var ids={};
  entities.forEach(function(e){ids[e.id]=true;
    var html='<div style="position:relative"><div class="pulse-ring" style="background:'+esc(e.color)+'"></div>'
      +'<div class="entity-marker" style="background:'+esc(e.color)+';width:32px;height:32px">'+esc(initials(e.name))+'</div></div>';
    var icon=L.divIcon({className:'',html:html,iconSize:[32,32],iconAnchor:[16,16]});
    if(markers[e.id]){markers[e.id].setLatLng([e.lat,e.lng]);markers[e.id].setIcon(icon)}
    else{markers[e.id]=L.marker([e.lat,e.lng],{icon:icon,zIndexOffset:1000}).addTo(map);
      markers[e.id].on('click',function(){parent.postMessage({type:'entityClicked',entityId:e.id},'*')})}
    if(e.gpsAccuracy&&e.gpsAccuracy>50){
      if(accCircles[e.id]){accCircles[e.id].setLatLng([e.lat,e.lng]);accCircles[e.id].setRadius(e.gpsAccuracy)}
      else{accCircles[e.id]=L.circle([e.lat,e.lng],{radius:e.gpsAccuracy,color:e.color,fillColor:e.color,fillOpacity:.06,weight:1,opacity:.15}).addTo(map)}
    }else if(accCircles[e.id]){map.removeLayer(accCircles[e.id]);delete accCircles[e.id]}
  });
  Object.keys(markers).forEach(function(id){if(!ids[id]){map.removeLayer(markers[id]);delete markers[id];
    if(accCircles[id]){map.removeLayer(accCircles[id]);delete accCircles[id]}}});
}

function updateZones(zd){
  var ids={};
  zd.forEach(function(z){ids[z.id]=true;var h=z.id==='zone.home';
    if(zones[z.id]){zones[z.id].setLatLng([z.lat,z.lng]);zones[z.id].setRadius(z.radius)}
    else{zones[z.id]=L.circle([z.lat,z.lng],{radius:z.radius,
      color:h?'rgba(59,130,246,0.2)':'rgba(168,85,247,0.15)',
      fillColor:h?'rgba(59,130,246,0.08)':'rgba(168,85,247,0.06)',fillOpacity:1,weight:1}).addTo(map);
      if(z.radius>200){zoneLabels[z.id]=L.marker([z.lat,z.lng],{icon:L.divIcon({className:'',
        html:'<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:6px;padding:1px 6px;font-size:10px;color:rgba(59,130,246,0.6);font-weight:500;white-space:nowrap">'
          +(h?'\\ud83c\\udfe0 ':'')+esc(z.name)+'</div>',iconAnchor:[0,0]})}).addTo(map)}}
  });
  Object.keys(zones).forEach(function(id){if(!ids[id]){map.removeLayer(zones[id]);delete zones[id];
    if(zoneLabels[id]){map.removeLayer(zoneLabels[id]);delete zoneLabels[id]}}});
}

window.addEventListener('message',function(e){
  var d=e.data;if(!d||!d.type)return;
  switch(d.type){
    case 'setView':map.setView([d.lat,d.lng],d.zoom,{animate:true});break;
    case 'fitBounds':map.fitBounds([[d.south,d.west],[d.north,d.east]],{padding:[30,30],animate:true});break;
    case 'updateMarkers':if(d.entities)updateMarkers(d.entities);if(d.zones)updateZones(d.zones);break;
    case 'setDarkMode':document.getElementById('map').classList.toggle('dark-tiles',!!d.dark);break;
    case 'invalidateSize':map.invalidateSize();break;
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
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

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
        const entity = trackedEntities.find(te => te.entity_id === e.data.entityId)
        if (entity) setSelectedEntity(prev => prev?.entity_id === entity.entity_id ? null : entity)
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
      entities: trackedEntities.map(e => ({
        id: e.entity_id, lat: e.latitude, lng: e.longitude,
        name: e.name, color: e.color, state: e.state, gpsAccuracy: e.gpsAccuracy,
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
      } else if (autoFitEntities && trackedEntities.length > 0) {
        const lats = trackedEntities.map(e => e.latitude)
        const lngs = trackedEntities.map(e => e.longitude)
        if (trackedEntities.length === 1) {
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
      entities: trackedEntities.map(e => ({
        id: e.entity_id, lat: e.latitude, lng: e.longitude,
        name: e.name, color: e.color, state: e.state, gpsAccuracy: e.gpsAccuracy,
      })),
      zones: zones.map(z => ({
        id: z.entity_id, lat: z.latitude, lng: z.longitude,
        radius: z.radius, name: z.name,
      })),
    })
  }, [mapReady, trackedEntities, zones, sendToMap])

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
  }, [])

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
      sandbox="allow-scripts"
      className="w-full h-full border-0"
      title="Karte"
      style={{ minHeight: 0 }}
    />
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
      <div className="mt-2 pt-2 border-t border-foreground/6">
        <p className="text-[9px] text-foreground/30 font-mono">
          {entity.latitude.toFixed(5)}, {entity.longitude.toFixed(5)}
        </p>
      </div>
    </div>
  )

  // ── Map detail dialog (shared across all variants) ──
  const mapDialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[90vw] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{config?.title || 'Karte'}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-foreground/8">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/12 flex items-center justify-center">
              <MapTrifold size={16} weight="fill" className="text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{config?.title || 'Karte'}</h3>
              {trackedEntities.length > 0 && (
                <p className="text-[10px] text-foreground/40">
                  {trackedEntities.length} {trackedEntities.length === 1 ? 'Person' : 'Personen'} verfolgt
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {homeZone && (
              <button
                onClick={centerOnHome}
                className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
                title="Auf Zuhause zentrieren"
              >
                <House size={14} weight="fill" />
              </button>
            )}
          </div>
        </div>

        <div className="w-full" style={{ height: '60vh' }}>
          <iframe
            srcDoc={MAP_HTML}
            sandbox="allow-scripts"
            className="w-full h-full border-0"
            title="Karte"
            ref={(el) => {
              if (!el) return
              const handler = (e: MessageEvent) => {
                if (e.source !== el.contentWindow) return
                if (e.data?.type === 'mapReady') {
                  el.contentWindow?.postMessage({ type: 'setDarkMode', dark: darkMode }, '*')
                  el.contentWindow?.postMessage({
                    type: 'updateMarkers',
                    entities: trackedEntities.map(te => ({
                      id: te.entity_id, lat: te.latitude, lng: te.longitude,
                      name: te.name, color: te.color, state: te.state, gpsAccuracy: te.gpsAccuracy,
                    })),
                    zones: zones.map(z => ({
                      id: z.entity_id, lat: z.latitude, lng: z.longitude,
                      radius: z.radius, name: z.name,
                    })),
                  }, '*')
                  if (configLat != null && configLng != null) {
                    el.contentWindow?.postMessage({ type: 'setView', lat: configLat, lng: configLng, zoom: configZoom }, '*')
                  } else if (autoFitEntities && trackedEntities.length > 0) {
                    const lats = trackedEntities.map(e => e.latitude)
                    const lngs = trackedEntities.map(e => e.longitude)
                    if (trackedEntities.length === 1) {
                      el.contentWindow?.postMessage({ type: 'setView', lat: lats[0], lng: lngs[0], zoom: 15 }, '*')
                    } else {
                      el.contentWindow?.postMessage({
                        type: 'fitBounds',
                        south: Math.min(...lats) - 0.01, west: Math.min(...lngs) - 0.01,
                        north: Math.max(...lats) + 0.01, east: Math.max(...lngs) + 0.01,
                      }, '*')
                    }
                  } else if (homeZone) {
                    el.contentWindow?.postMessage({ type: 'setView', lat: homeZone.latitude, lng: homeZone.longitude, zoom: 14 }, '*')
                  }
                  window.removeEventListener('message', handler)
                }
              }
              window.addEventListener('message', handler)
            }}
          />
        </div>

        {trackedEntities.length > 0 && (
          <div className="border-t border-foreground/8 px-4 py-3 space-y-2 max-h-[30vh] overflow-y-auto">
            {trackedEntities.map(entity => (
              <div
                key={entity.entity_id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/8"
              >
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
                  <div className="flex items-center gap-2 text-[10px] text-foreground/50">
                    <span className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${entity.state === 'home' ? 'bg-green-500' : 'bg-orange-500'}`} />
                      {stateLabel(entity.state)}
                    </span>
                    {entity.battery != null && <span>🔋 {entity.battery}%</span>}
                    {entity.gpsAccuracy != null && <span>±{entity.gpsAccuracy}m</span>}
                    <span>{formatTimeAgo(entity.lastUpdated)}</span>
                  </div>
                </div>
                <p className="text-[9px] text-foreground/25 font-mono shrink-0">
                  {entity.latitude.toFixed(4)}, {entity.longitude.toFixed(4)}
                </p>
              </div>
            ))}
          </div>
        )}
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
          {homeZone && (
            <button
              onClick={centerOnHome}
              className="w-8 h-8 rounded-lg bg-card/80 backdrop-blur-xl border border-foreground/10 flex items-center justify-center text-foreground/60 hover:text-foreground shadow-lg transition-all active:scale-95"
              title="Zentrieren"
            >
              <House size={14} weight="fill" />
            </button>
          )}
          <button
            onClick={refreshMap}
            className="w-8 h-8 rounded-lg bg-card/80 backdrop-blur-xl border border-foreground/10 flex items-center justify-center text-foreground/60 hover:text-foreground shadow-lg transition-all active:scale-95"
            title="Aktualisieren"
          >
            <ArrowClockwise size={14} />
          </button>
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
            {homeZone && (
              <button
                onClick={centerOnHome}
                className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
                title="Auf Zuhause zentrieren"
              >
                <House size={14} weight="fill" />
              </button>
            )}
            <button
              onClick={refreshMap}
              className="w-7 h-7 rounded-lg bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground transition-all"
              title="Karte aktualisieren"
            >
              <ArrowClockwise size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {mapIframe}
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
