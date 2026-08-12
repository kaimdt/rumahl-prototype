import { authFetch } from '@/lib/authHelpers'

export type AutomationNodeKind = 'trigger' | 'condition' | 'action'

export interface AutomationNode {
  id: string
  kind: AutomationNodeKind
  adapter: string
  config: Record<string, unknown>
  position: { x: number; y: number }
}

export interface AutomationEdge {
  id: string
  source: string
  target: string
}

export interface AutomationFlow {
  id: string
  name: string
  description: string
  enabled: boolean
  nodes: AutomationNode[]
  edges: AutomationEdge[]
  cooldown_seconds: number
  last_triggered_at: string | null
  trigger_count: number
  created_at: string
  updated_at: string
}

export interface AutomationExecution {
  id: number
  rule_id: string
  triggered_by: string
  trigger_data: unknown
  success: boolean
  result: unknown | null
  error: string | null
  executed_at: string
}

export type SaveAutomationFlow = Pick<AutomationFlow, 'name' | 'description' | 'enabled' | 'nodes' | 'edges' | 'cooldown_seconds'>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init)
  if (!response.ok) throw new Error(await response.text())
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const automationApi = {
  list: () => request<AutomationFlow[]>('/api/automations'),
  create: (flow: SaveAutomationFlow) => request<AutomationFlow>('/api/automations', jsonInit('POST', flow)),
  update: (id: string, flow: SaveAutomationFlow) => request<AutomationFlow>(`/api/automations/${id}`, jsonInit('PUT', flow)),
  remove: (id: string) => request<void>(`/api/automations/${id}`, { method: 'DELETE' }),
  run: (id: string) => request<AutomationExecution>(`/api/automations/${id}/run`, jsonInit('POST', { trigger_data: {} })),
  executions: (id: string) => request<AutomationExecution[]>(`/api/automations/${id}/executions`),
}
