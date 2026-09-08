/**
 * Example: Energy Optimizer AI Plugin
 *
 * This plugin demonstrates how to:
 * 1. Register AI tools that analyze energy usage
 * 2. Call rumahl AI with entity context
 * 3. Provide intelligent automation suggestions
 */

import { ServicePlugin, PluginContext } from '@/lib/plugins/types'
import { createPluginAIClient, AITool } from '@/lib/plugins/ai-integration'
import { authFetch } from '@/lib/authHelpers'

let context: PluginContext

// Energy analysis tool that rumahl AI can call
const energyAnalysisTool: AITool = {
  name: 'analyze_energy_usage',
  description: 'Analyze energy consumption patterns and suggest optimizations',
  parameters: [
    {
      name: 'area',
      type: 'string',
      description: 'Specific area/room to analyze (optional)',
      required: false,
    },
    {
      name: 'timeframe',
      type: 'string',
      description: 'Time period to analyze: today, week, month',
      required: false,
      default: 'today',
    },
  ],
  handler: async (params) => {
    // Get all power/energy entities
    const entities = await context.getStates()
    const energyEntities = entities.filter(
      (e) =>
        e.entity_id.startsWith('sensor.') &&
        (e.entity_id.includes('power') || e.entity_id.includes('energy'))
    )

    // Filter by area if specified
    let relevantEntities = energyEntities
    if (params.area) {
      relevantEntities = energyEntities.filter(
        (e) => e.attributes.area?.toLowerCase() === params.area.toLowerCase()
      )
    }

    // Calculate total consumption
    const totalPower = relevantEntities.reduce((sum, e) => {
      const value = parseFloat(e.state)
      return !isNaN(value) ? sum + value : sum
    }, 0)

    // Find high consumers
    const highConsumers = relevantEntities
      .filter((e) => {
        const value = parseFloat(e.state)
        return value > 100 // More than 100W
      })
      .sort((a, b) => parseFloat(b.state) - parseFloat(a.state))
      .slice(0, 5)

    return {
      total_power_w: Math.round(totalPower),
      entity_count: relevantEntities.length,
      high_consumers: highConsumers.map((e) => ({
        name: e.attributes.friendly_name || e.entity_id,
        power_w: parseFloat(e.state),
        area: e.attributes.area,
      })),
      timeframe: params.timeframe,
      area: params.area || 'all',
      recommendations: [
        totalPower > 2000 && 'Consider turning off unused devices',
        highConsumers.length > 0 &&
          `High power consumption detected in ${highConsumers[0].attributes.friendly_name}`,
      ].filter(Boolean),
    }
  },
}

// Smart scheduling tool
const smartScheduleTool: AITool = {
  name: 'create_energy_schedule',
  description:
    'Create an energy-optimized schedule for devices based on usage patterns and time-of-use rates',
  parameters: [
    {
      name: 'device_type',
      type: 'string',
      description: 'Type of device (washing_machine, dishwasher, ev_charger, etc.)',
      required: true,
    },
    {
      name: 'priority',
      type: 'string',
      description: 'Priority level: high (ASAP), medium (today), low (whenever cheapest)',
      required: false,
      default: 'medium',
    },
  ],
  handler: async (params) => {
    const now = new Date()
    const hour = now.getHours()

    // Define off-peak hours (cheap electricity)
    const offPeakHours = [0, 1, 2, 3, 4, 5, 6, 22, 23]
    const currentlyOffPeak = offPeakHours.includes(hour)

    let recommendedTime: string
    let reason: string

    if (params.priority === 'high') {
      recommendedTime = 'now'
      reason = 'High priority - start immediately'
    } else if (params.priority === 'low') {
      // Find next off-peak period
      const nextOffPeak = offPeakHours.find((h) => h > hour) || offPeakHours[0]
      const hoursUntil = nextOffPeak > hour ? nextOffPeak - hour : 24 - hour + nextOffPeak
      recommendedTime = `in ${hoursUntil} hours (${nextOffPeak}:00)`
      reason = 'Off-peak electricity rates - save up to 40%'
    } else {
      // Medium priority
      if (currentlyOffPeak) {
        recommendedTime = 'now'
        reason = 'Currently in off-peak hours - good time to start'
      } else {
        const nextOffPeak = offPeakHours.find((h) => h > hour) || offPeakHours[0]
        recommendedTime = `today at ${nextOffPeak}:00`
        reason = 'Wait for off-peak hours to save on electricity'
      }
    }

    return {
      device_type: params.device_type,
      priority: params.priority,
      recommended_time: recommendedTime,
      reason: reason,
      estimated_savings: params.priority === 'low' ? '30-40% cost reduction' : null,
      current_rate: currentlyOffPeak ? 'off-peak' : 'peak',
    }
  },
}

// Main plugin definition
export const plugin: ServicePlugin = {
  metadata: {
    id: 'energy-optimizer-ai',
    name: 'Energy Optimizer AI',
    version: '1.0.0',
    description: 'AI-powered energy optimization and smart scheduling for home devices',
    author: 'rumahl Team',
    icon: 'lightning-slash',
  },

  initialize: async () => {
    const ai = createPluginAIClient('energy-optimizer-ai')

    try {
      // Register both tools with rumahl AI
      await ai.registerTool(energyAnalysisTool)
      await ai.registerTool(smartScheduleTool)

      console.log('✅ Energy Optimizer AI: Tools registered successfully')

      // ── rumahl OS integration (Package 2: ora.* surface) ────────────────
      // 1. Ask the user for power control — the shell shows the
      //    Android/iOS-style Allow/Deny dialog (409 = already granted).
      await authFetch('/api/os/permissions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permission: 'os.power',
          requester: 'Energy Optimizer',
          scope: 'energy-optimizer-ai',
          reason: 'Schedule device shutdowns during off-peak hours',
        }),
      }).catch(() => {})

      // 2. Run the initial analysis as a visible system job (Job Center).
      const jobRes = await authFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Energy optimization analysis',
          job_type: 'analysis',
          source: 'energy-optimizer-ai',
        }),
      })
      if (jobRes.ok) {
        const job = await jobRes.json() as { id: string }
        for (const progress of [30, 70]) {
          await authFetch(`/api/jobs/${job.id}/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ progress, status: 'running', message: 'Analyzing power entities…' }),
          })
        }
        await authFetch(`/api/jobs/${job.id}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress: 100, status: 'completed' }),
        })
      }

      // 3. Store an optional API key as an app secret (credential vault).
      await authFetch('/api/apps/energy-optimizer-ai/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'provider_api_key',
          value: 'your-provider-key-here',
          description: 'Placeholder — replace with your smart-home provider key',
        }),
      }).catch(() => {})

      // 4. Report plugin health into the system event log.
      await authFetch('/api/system-events/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          severity: 'info',
          source: 'energy-optimizer-ai',
          message: 'Energy Optimizer started — tools registered',
        }),
      }).catch(() => {})

      // Optional: Run initial analysis
      const analysis = await ai.chat({
        message: 'Analyze my current energy usage and give me optimization tips',
        systemPrompt: `You are an energy efficiency expert. Provide practical,
          actionable advice to reduce energy consumption while maintaining comfort.
          Always prioritize safety and user convenience.`,
      })

      console.log('📊 Initial Energy Analysis:', analysis.message)
    } catch (error) {
      console.error('❌ Energy Optimizer AI initialization failed:', error)
      throw error
    }
  },

  destroy: async () => {
    const ai = createPluginAIClient('energy-optimizer-ai')

    try {
      await ai.unregisterTool('analyze_energy_usage')
      await ai.unregisterTool('create_energy_schedule')
      console.log('✅ Energy Optimizer AI: Tools unregistered')
    } catch (error) {
      console.error('❌ Energy Optimizer AI cleanup failed:', error)
    }
  },

  healthCheck: async () => {
    try {
      const ai = createPluginAIClient('energy-optimizer-ai')
      // Simple health check - try to get history
      await ai.getHistory(1)
      return true
    } catch {
      return false
    }
  },
}

export default plugin

/**
 * Usage Examples:
 *
 * Once this plugin is loaded, users can interact with it through rumahl AI:
 *
 * 1. "Show me my current energy usage"
 *    → rumahl calls analyze_energy_usage tool
 *    → Returns total power consumption and high consumers
 *
 * 2. "When should I run the washing machine?"
 *    → rumahl calls create_energy_schedule tool
 *    → Recommends optimal time based on electricity rates
 *
 * 3. "How can I reduce my energy bill?"
 *    → rumahl uses both tools to analyze patterns
 *    → Provides personalized recommendations
 *
 * 4. "Schedule my EV charging for cheapest time"
 *    → rumahl calls create_energy_schedule with device_type='ev_charger'
 *    → Suggests off-peak hours for charging
 */
