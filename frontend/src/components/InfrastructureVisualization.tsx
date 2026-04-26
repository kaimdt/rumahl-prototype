import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Circle, Check, X, Lightning } from '@phosphor-icons/react'
import { adminFetch } from './AdminPanel'

interface ServiceNode {
  id: string
  name: string
  status: 'active' | 'inactive' | 'warning' | 'unknown'
  type: 'core' | 'assist' | 'app' | 'external'
  port?: number
  description: string
}

interface ServiceConnection {
  from: string
  to: string
  type: 'http' | 'websocket' | 'grpc'
  active: boolean
}

const SERVICES: ServiceNode[] = [
  { id: 'iora-home', name: 'IORA Home', status: 'unknown', type: 'core', port: 3000, description: 'Main Dashboard' },
  { id: 'iora-core', name: 'IORA Core', status: 'unknown', type: 'core', port: 8080, description: 'Core Services' },
  { id: 'iora-assist', name: 'ORA AI', status: 'unknown', type: 'assist', port: 8092, description: 'AI Assistant' },
  { id: 'iora-api', name: 'IORA API', status: 'unknown', type: 'core', port: 8084, description: 'API Gateway' },
  { id: 'iora-connector', name: 'Connector', status: 'unknown', type: 'core', port: 8081, description: 'External Integrations' },
  { id: 'iora-appstore', name: 'App Store', status: 'unknown', type: 'core', port: 8082, description: 'App Management' },
  { id: 'homeassistant', name: 'Home Assistant', status: 'unknown', type: 'external', port: 8123, description: 'Smart Home Hub' },
  { id: 'postgres', name: 'PostgreSQL', status: 'unknown', type: 'core', description: 'Database' },
]

const CONNECTIONS: ServiceConnection[] = [
  { from: 'iora-home', to: 'iora-core', type: 'http', active: false },
  { from: 'iora-home', to: 'iora-assist', type: 'http', active: false },
  { from: 'iora-home', to: 'iora-api', type: 'websocket', active: false },
  { from: 'iora-core', to: 'postgres', type: 'http', active: false },
  { from: 'iora-assist', to: 'postgres', type: 'http', active: false },
  { from: 'iora-api', to: 'iora-connector', type: 'http', active: false },
  { from: 'iora-connector', to: 'homeassistant', type: 'websocket', active: false },
  { from: 'iora-appstore', to: 'postgres', type: 'http', active: false },
]

export function InfrastructureVisualization({ token }: { token: string }) {
  const [services, setServices] = useState<ServiceNode[]>(SERVICES)
  const [connections, setConnections] = useState<ServiceConnection[]>(CONNECTIONS)
  const [isMonitoring, setIsMonitoring] = useState(false)

  // Fetch real service status from /api/admin/control/services. We map the
  // backend status (online/degraded/offline) to the visualization status
  // (active/warning/inactive). Services that the backend doesn't report on
  // stay at 'unknown' so we don't fake green dots like the previous
  // Math.random() simulation did.
  const checkServices = useCallback(async () => {
    if (!token) return
    try {
      const data = await adminFetch('/api/admin/control/services', token) as {
        services?: Array<{ name: string; status: string }>
      }
      const reported = new Map<string, string>()
      for (const s of data.services ?? []) {
        reported.set(s.name, s.status)
      }
      setServices(prev => prev.map(svc => {
        const backendStatus = reported.get(svc.id)
        if (!backendStatus) return { ...svc, status: 'unknown' as const }
        const mapped: ServiceNode['status'] =
          backendStatus === 'online' ? 'active' :
          backendStatus === 'degraded' ? 'warning' :
          backendStatus === 'offline' ? 'inactive' :
          'unknown'
        return { ...svc, status: mapped }
      }))
    } catch {
      // Leave previous state in place on transient errors instead of
      // flipping everything to red — this prevents the flicker / "alles
      // stürzt ab" effect the user reported.
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    checkServices()
    const interval = setInterval(checkServices, 10000)
    return () => clearInterval(interval)
  }, [token, checkServices])

  // Connection activity is purely visual — only animate when the user has
  // explicitly enabled live monitoring, and only between services that are
  // both 'active'. No more random flicker.
  useEffect(() => {
    if (!isMonitoring) {
      setConnections(prev => prev.map(c => ({ ...c, active: false })))
      return
    }
    const interval = setInterval(() => {
      setConnections(prev => prev.map(c => {
        const from = services.find(s => s.id === c.from)
        const to = services.find(s => s.id === c.to)
        const both = from?.status === 'active' && to?.status === 'active'
        return { ...c, active: both }
      }))
    }, 1500)
    return () => clearInterval(interval)
  }, [isMonitoring, services])

  const getStatusColor = (status: ServiceNode['status']) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'warning': return 'bg-yellow-500'
      case 'inactive': return 'bg-red-500'
      case 'unknown': return 'bg-foreground/30'
    }
  }

  const getTypeColor = (type: ServiceNode['type']) => {
    switch (type) {
      case 'core': return 'from-blue-500/20 to-blue-600/20 border-blue-500/30'
      case 'assist': return 'from-purple-500/20 to-pink-500/20 border-purple-500/30'
      case 'app': return 'from-green-500/20 to-emerald-500/20 border-green-500/30'
      case 'external': return 'from-orange-500/20 to-amber-500/20 border-orange-500/30'
    }
  }

  // SVG connection renderer
  const renderConnection = (conn: ServiceConnection, index: number) => {
    const fromService = services.find(s => s.id === conn.from)
    const toService = services.find(s => s.id === conn.to)
    if (!fromService || !toService) return null

    // Calculate positions (simplified grid layout)
    const fromIndex = services.indexOf(fromService)
    const toIndex = services.indexOf(toService)

    const cols = 3
    const fromX = (fromIndex % cols) * 200 + 100
    const fromY = Math.floor(fromIndex / cols) * 150 + 75
    const toX = (toIndex % cols) * 200 + 100
    const toY = Math.floor(toIndex / cols) * 150 + 75

    const strokeColor = conn.active ? '#8b5cf6' : '#4b5563'
    const strokeWidth = conn.active ? 2 : 1

    return (
      <g key={index}>
        <motion.line
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={conn.type === 'websocket' ? '5,5' : undefined}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5 }}
        />
        {conn.active && (
          <motion.circle
            r="4"
            fill="#8b5cf6"
            initial={{ offsetDistance: '0%' }}
            animate={{ offsetDistance: '100%' }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <animateMotion
              dur="2s"
              repeatCount="indefinite"
              path={`M${fromX},${fromY} L${toX},${toY}`}
            />
          </motion.circle>
        )}
      </g>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5 border border-foreground/10">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">IORA Infrastructure</h3>
          <p className="text-xs text-foreground/60">
            Live visualization of all services and connections
          </p>
        </div>
        <button
          onClick={() => setIsMonitoring(!isMonitoring)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            isMonitoring
              ? 'bg-accent text-white'
              : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
          }`}
        >
          <Lightning size={14} weight={isMonitoring ? 'fill' : 'regular'} />
          {isMonitoring ? 'Monitoring Active' : 'Start Monitoring'}
        </button>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-foreground/5 border border-foreground/10">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-xs text-foreground/70">Active</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="text-xs text-foreground/70">Warning</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-xs text-foreground/70">Inactive</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-1 bg-accent" />
          <span className="text-xs text-foreground/70">Data Flow</span>
        </div>
      </div>

      {/* Visualization */}
      <div className="relative rounded-xl bg-foreground/5 border border-foreground/10 p-6 overflow-auto">
        <svg
          width="600"
          height="450"
          className="mx-auto"
          style={{ minWidth: '600px' }}
        >
          {/* Render connections first (background layer) */}
          {connections.map((conn, i) => renderConnection(conn, i))}
        </svg>

        {/* Service nodes (absolute positioned over SVG) */}
        <div className="absolute inset-0 p-6 pointer-events-none">
          <div className="grid grid-cols-3 gap-4" style={{ maxWidth: '600px', margin: '0 auto' }}>
            {services.map((service, i) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className={`relative pointer-events-auto p-3 rounded-xl bg-gradient-to-br ${getTypeColor(
                  service.type
                )} border backdrop-blur-sm`}
              >
                {/* Status indicator */}
                <div className="absolute -top-1 -right-1">
                  <div
                    className={`w-3 h-3 rounded-full ${getStatusColor(
                      service.status
                    )} ring-2 ring-background`}
                  >
                    {service.status === 'active' && (
                      <motion.div
                        className={`absolute inset-0 rounded-full ${getStatusColor(
                          service.status
                        )}`}
                        animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    )}
                  </div>
                </div>

                {/* Service info */}
                <div className="text-xs font-semibold text-foreground mb-1">
                  {service.name}
                </div>
                <div className="text-[10px] text-foreground/50 mb-1">
                  {service.description}
                </div>
                {service.port && (
                  <div className="text-[10px] text-foreground/40 font-mono">
                    :{service.port}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Service Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10">
          <div className="text-xs text-foreground/60 mb-1">Total Services</div>
          <div className="text-2xl font-bold text-foreground">{services.length}</div>
        </div>
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
          <div className="text-xs text-green-400/80 mb-1">Active</div>
          <div className="text-2xl font-bold text-green-400">
            {services.filter(s => s.status === 'active').length}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
          <div className="text-xs text-yellow-400/80 mb-1">Warnings</div>
          <div className="text-2xl font-bold text-yellow-400">
            {services.filter(s => s.status === 'warning').length}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="text-xs text-red-400/80 mb-1">Inactive</div>
          <div className="text-2xl font-bold text-red-400">
            {services.filter(s => s.status === 'inactive').length}
          </div>
        </div>
      </div>
    </div>
  )
}
