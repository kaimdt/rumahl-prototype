import { useTranslation } from 'react-i18next'
import { useEffect, useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { GridFour } from '@phosphor-icons/react'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { ThemeWidgetWrapper } from '@/components/ThemeWidgetWrapper'
import { LightWidget } from '@/components/widgets/LightWidget'
import { ClimateWidget } from '@/components/widgets/ClimateWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { SensorWidget } from '@/components/widgets/SensorWidget'
import { MediaPlayerWidget } from '@/components/widgets/MediaPlayerWidget'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { GreetingWidget } from '@/components/widgets/GreetingWidget'
import { AnalogClock } from '@/components/widgets/AnalogClock'
import { DigitalClock } from '@/components/widgets/DigitalClock'
import { CalendarWidget } from '@/components/widgets/CalendarWidget'
import { InputNumberWidget } from '@/components/widgets/InputNumberWidget'
import { InputSelectWidget } from '@/components/widgets/InputSelectWidget'
import { CoverWidget } from '@/components/widgets/CoverWidget'
import { FanWidget } from '@/components/widgets/FanWidget'
import { LockWidget } from '@/components/widgets/LockWidget'
import { AutomationWidget } from '@/components/widgets/AutomationWidget'
import { ScriptWidget } from '@/components/widgets/ScriptWidget'
import { ButtonWidget } from '@/components/widgets/ButtonWidget'
import { SceneEntityWidget } from '@/components/widgets/SceneEntityWidget'
import { TextInputWidget } from '@/components/widgets/TextInputWidget'
import { DateTimeWidget } from '@/components/widgets/DateTimeWidget'
import { PersonWidget } from '@/components/widgets/PersonWidget'
import { TimerWidget } from '@/components/widgets/TimerWidget'
import { CounterWidget } from '@/components/widgets/CounterWidget'
import { BinarySensorWidget } from '@/components/widgets/BinarySensorWidget'
import { CameraWidget } from '@/components/widgets/CameraWidget'
import { VacuumWidget } from '@/components/widgets/VacuumWidget'
import { HumidifierWidget } from '@/components/widgets/HumidifierWidget'
import { AlarmWidget } from '@/components/widgets/AlarmWidget'
import { SceneSelector } from '@/components/scenes/SceneSelector'
import { ChatCardWidget } from '@/components/widgets/ChatCardWidget'
import { DynamicTextWidget } from '@/components/widgets/DynamicTextWidget'
import EntityHistoryWidget from '@/components/widgets/EntityHistoryWidget'
import StatisticsChartWidget from '@/components/widgets/StatisticsChartWidget'
import EnergyMonitorWidget from '@/components/widgets/EnergyMonitorWidget'
import EntityStatisticsWidget from '@/components/widgets/EntityStatisticsWidget'
import QuickActionsWidget from '@/components/widgets/QuickActionsWidget'
import SystemMonitorWidget from '@/components/widgets/SystemMonitorWidget'
import { OraStorageWidget, OraSystemWidget, OraJobsWidget, OraRecentFilesWidget } from '@/components/widgets/OraSystemWidgets'
import { OraPresenceWidget } from '@/components/widgets/OraPresenceWidget'
import SceneManagerWidget from '@/components/widgets/SceneManagerWidget'
import RoomSummaryWidget from '@/components/widgets/RoomSummaryWidget'
import NotificationLogWidget from '@/components/widgets/NotificationLogWidget'
import WaterUsageWidget from '@/components/widgets/WaterUsageWidget'
import PageLinkWidget from '@/components/widgets/PageLinkWidget'
import WasteCollectionWidget from '@/components/widgets/WasteCollectionWidget'
import WidgetCarouselWidget from '@/components/widgets/WidgetCarouselWidget'
import NinaWarningWidget from '@/components/widgets/NinaWarningWidget'
import MapWidget from '@/components/widgets/MapWidget'
import IFrameWidget from '@/components/widgets/IFrameWidget'
import StreamWidget from '@/components/widgets/StreamWidget'
import { getCardStyleClass } from '@/lib/defaults'
import { useLocalStorage } from '@/lib/storage'
import type {
  DashboardPage,
  DashboardWidget,
  EntityState,
  LightEntity,
  ClimateEntity,
  SwitchEntity,
  SensorEntity,
  WeatherEntity,
  MediaPlayerEntity,
} from '@/lib/types'

type VisibilityMode =
  | 'always'
  | 'when_music_playing'
  | 'when_evening'
  | 'when_night'
  | 'when_entity_state'
  | 'when_entity_not_state'
  | 'when_entity_state_in'
  | 'when_entity_numeric'
  | 'when_time_between'
  | 'when_weekday'
  | 'when_recently_changed'

type NumericOperator = 'lt' | 'lte' | 'eq' | 'gte' | 'gt'

interface VisibilityCondition {
  mode?: VisibilityMode
  entityId?: string
  state?: string
  states?: string
  numericOperator?: NumericOperator
  numericValue?: number | string
  startTime?: string
  endTime?: string
  weekdays?: number[]
  changedWithinMinutes?: number | string
}

type VisibilityOperator = 'all' | 'any'

function parseWeekdayList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
}

function parseTimeToMinutes(raw: unknown): number | null {
  const time = String(raw || '').trim()
  if (!time || !time.includes(':')) return null
  const [hRaw, mRaw] = time.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function isNowWithinTimeWindow(startMinutes: number, endMinutes: number): boolean {
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  if (startMinutes === endMinutes) return true
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current <= endMinutes
  }
  return current >= startMinutes || current <= endMinutes
}

function evaluateNumeric(value: number, expected: number, operator: NumericOperator): boolean {
  switch (operator) {
    case 'lt':
      return value < expected
    case 'lte':
      return value <= expected
    case 'eq':
      return Math.abs(value - expected) < 0.000001
    case 'gte':
      return value >= expected
    case 'gt':
      return value > expected
    default:
      return false
  }
}

function findVisibilityEntity(entities: EntityState[], visibilityEntityId: unknown): EntityState | undefined {
  const entityId = String(visibilityEntityId || '')
  if (!entityId) return undefined
  return entities.find((e) => e.entity_id === entityId)
}

function evaluateVisibilityCondition(condition: VisibilityCondition, entities: EntityState[]): boolean {
  const mode = ((condition.mode as string) || 'always') as VisibilityMode
  if (mode === 'always') return true

  if (mode === 'when_music_playing') {
    return entities.some((entity) =>
      entity.entity_id.startsWith('media_player.')
      && ['playing', 'buffering'].includes(String(entity.state).toLowerCase())
    )
  }

  const hour = new Date().getHours()
  if (mode === 'when_evening') {
    return hour >= 18 || hour < 2
  }
  if (mode === 'when_night') {
    return hour >= 22 || hour < 6
  }

  if (mode === 'when_entity_state') {
    const expectedState = String(condition.state || '').trim()
    if (!expectedState) return true
    const entity = findVisibilityEntity(entities, condition.entityId)
    if (!entity) return false
    return String(entity.state).toLowerCase() === expectedState.toLowerCase()
  }

  if (mode === 'when_entity_not_state') {
    const expectedState = String(condition.state || '').trim()
    if (!expectedState) return true
    const entity = findVisibilityEntity(entities, condition.entityId)
    if (!entity) return false
    return String(entity.state).toLowerCase() !== expectedState.toLowerCase()
  }

  if (mode === 'when_entity_state_in') {
    const stateList = String(condition.states || '')
      .split(',')
      .map((state) => state.trim().toLowerCase())
      .filter(Boolean)
    if (stateList.length === 0) return true
    const entity = findVisibilityEntity(entities, condition.entityId)
    if (!entity) return false
    return stateList.includes(String(entity.state).toLowerCase())
  }

  if (mode === 'when_entity_numeric') {
    const entity = findVisibilityEntity(entities, condition.entityId)
    if (!entity) return false
    const operator = String(condition.numericOperator || 'gte') as NumericOperator
    const threshold = Number(condition.numericValue)
    const entityValue = Number(entity.state)
    if (!Number.isFinite(entityValue) || !Number.isFinite(threshold)) return false
    return evaluateNumeric(entityValue, threshold, operator)
  }

  if (mode === 'when_time_between') {
    const start = parseTimeToMinutes(condition.startTime)
    const end = parseTimeToMinutes(condition.endTime)
    if (start === null || end === null) return true
    return isNowWithinTimeWindow(start, end)
  }

  if (mode === 'when_weekday') {
    const weekdays = parseWeekdayList(condition.weekdays)
    if (weekdays.length === 0) return true
    return weekdays.includes(new Date().getDay())
  }

  if (mode === 'when_recently_changed') {
    const entity = findVisibilityEntity(entities, condition.entityId)
    if (!entity) return false
    const minutes = Number(condition.changedWithinMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return true
    const changedAt = Date.parse(String(entity.last_changed))
    if (!Number.isFinite(changedAt)) return false
    return (Date.now() - changedAt) <= minutes * 60 * 1000
  }

  return true
}

function evaluateConditionSet(
  conditions: VisibilityCondition[],
  operator: VisibilityOperator,
  entities: EntityState[],
): boolean {
  if (conditions.length === 0) return true
  if (operator === 'any') {
    return conditions.some((condition) => evaluateVisibilityCondition(condition, entities))
  }
  return conditions.every((condition) => evaluateVisibilityCondition(condition, entities))
}

function evaluateLegacyVisibility(widget: DashboardWidget, entities: EntityState[]): boolean {
  const legacyCondition: VisibilityCondition = {
    mode: (((widget.config?.visibilityMode as string) || 'always') as VisibilityMode),
    entityId: String(widget.config?.visibilityEntityId || ''),
    state: String(widget.config?.visibilityState || ''),
    states: String(widget.config?.visibilityStates || ''),
    numericOperator: String(widget.config?.visibilityNumericOperator || 'gte') as NumericOperator,
    numericValue: widget.config?.visibilityNumericValue as number | string | undefined,
    startTime: String(widget.config?.visibilityStartTime || ''),
    endTime: String(widget.config?.visibilityEndTime || ''),
    weekdays: parseWeekdayList(widget.config?.visibilityWeekdays),
    changedWithinMinutes: widget.config?.visibilityChangedWithinMinutes as number | string | undefined,
  }
  return evaluateVisibilityCondition(legacyCondition, entities)
}

function isWidgetVisible(widget: DashboardWidget, entities: EntityState[]): boolean {
  const conditions = Array.isArray(widget.config?.visibilityConditions)
    ? widget.config?.visibilityConditions.filter((item) => item && typeof item === 'object') as VisibilityCondition[]
    : []
  const exceptions = Array.isArray(widget.config?.visibilityExceptions)
    ? widget.config?.visibilityExceptions.filter((item) => item && typeof item === 'object') as VisibilityCondition[]
    : []

  const hasRuleSets = conditions.length > 0 || exceptions.length > 0
  if (!hasRuleSets) {
    return evaluateLegacyVisibility(widget, entities)
  }

  const conditionOperator = String(widget.config?.visibilityConditionOperator || 'all') === 'any' ? 'any' : 'all'
  const exceptionOperator = String(widget.config?.visibilityExceptionOperator || 'any') === 'all' ? 'all' : 'any'
  const conditionsMatch = evaluateConditionSet(conditions, conditionOperator, entities)
  if (!conditionsMatch) return false
  const hasExceptionMatch = exceptions.length > 0 && evaluateConditionSet(exceptions, exceptionOperator, entities)
  return !hasExceptionMatch
}

interface CustomPageRendererProps {
  page: DashboardPage
  entities: EntityState[]
  onUpdate: () => void
  userName?: string
  weatherEntity?: WeatherEntity
  lightEntities?: LightEntity[]
  hideTitle?: boolean
}

function WidgetPlaceholder({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation()
  return (
    <div className="glass-card rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[120px]">
      <GridFour size={32} weight="light" className="text-foreground/30" />
      <p className="text-sm text-foreground/50">
        {widget.type === 'media_player' ? t('widgets.mediaPlayer.playing') : t('common.default')}
      </p>
      {widget.entity_id && (
        <p className="text-xs text-foreground/30 truncate max-w-full">{widget.entity_id}</p>
      )}
    </div>
  )
}

export function RenderWidget({
  widget,
  entities,
  onUpdate,
  userName,
  weatherEntity,
  lightEntities,
  widgetSize,
}: {
  widget: DashboardWidget
  entities: EntityState[]
  onUpdate: () => void
  userName?: string
  weatherEntity?: WeatherEntity
  lightEntities?: LightEntity[]
  widgetSize?: { w: number; h: number }
}) {
  const resolvedSize = widgetSize || widget.size
  const entity = widget.entity_id
    ? entities.find((e) => e.entity_id === widget.entity_id)
    : undefined

  switch (widget.type) {
    case 'light':
      return entity ? (
        <ThemeWidgetWrapper widgetType="light" entity={entity} config={widget.config} widgetSize={resolvedSize}
          fallback={<LightWidget entity={entity as LightEntity} onUpdate={onUpdate} allEntities={entities} config={widget.config} widgetSize={resolvedSize} />}
        />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'climate':
      return entity ? (
        <ThemeWidgetWrapper widgetType="climate" entity={entity} config={widget.config} widgetSize={resolvedSize}
          fallback={<ClimateWidget entity={entity as ClimateEntity} onUpdate={onUpdate} config={widget.config} widgetSize={resolvedSize} />}
        />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'switch':
      return entity ? (
        <ThemeWidgetWrapper widgetType="switch" entity={entity} config={widget.config}
          fallback={<SwitchWidget entity={entity as SwitchEntity} onUpdate={onUpdate} config={widget.config} />}
        />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'sensor':
      return entity ? (
        <ThemeWidgetWrapper widgetType="sensor" entity={entity} config={widget.config} widgetSize={resolvedSize}
          fallback={<SensorWidget entity={entity as SensorEntity} onUpdate={onUpdate} config={widget.config} widgetSize={resolvedSize} />}
        />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'weather':
      return <WeatherWidget entity={(entity as WeatherEntity) || weatherEntity} config={widget.config} widgetSize={resolvedSize} />
    case 'greeting':
      return <GreetingWidget userName={userName} weatherEntity={weatherEntity} config={widget.config} />
    case 'chat_card':
      return (
        <ChatCardWidget
          title={(widget.config?.title as string) || widget.label}
          messages={((widget.config?.messages as string[]) || widget.label?.split('|').map(v => v.trim()).filter(Boolean))}
        />
      )
    case 'dynamic_text':
      return (
        <DynamicTextWidget
          template={(widget.config?.template as string) || widget.label}
          userName={userName}
        />
      )
    case 'analog_clock':
      return (
        <AnalogClock
          showSeconds={(widget.config?.showSeconds as boolean) ?? true}
          size={(widget.config?.size as number) ?? 200}
          secondsMode={(widget.config?.secondsMode as 'tick' | 'sweep' | 'hidden') ?? 'tick'}
          faceStyle={(widget.config?.faceStyle as 'numbers' | 'ticks' | 'minimal' | 'none') ?? 'ticks'}
          showDigitalTime={(widget.config?.showDigitalTime as boolean) ?? true}
        />
      )
    case 'digital_clock':
      return (
        <DigitalClock
          showSeconds={(widget.config?.showSeconds as boolean) ?? true}
          show24Hour={(widget.config?.show24Hour as boolean) ?? true}
          showDate={(widget.config?.showDate as boolean) ?? true}
        />
      )
    case 'calendar':
      return <CalendarWidget config={widget.config} />
    case 'scene_selector': {
      const lights = lightEntities || entities.filter(e => e.entity_id.startsWith('light.')) as LightEntity[]
      return <SceneSelector lightEntities={lights} onUpdate={onUpdate} />
    }
    case 'input_boolean':
      return entity ? (
        <SwitchWidget entity={entity as SwitchEntity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'input_number':
      return entity ? (
        <InputNumberWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'input_select':
      return entity ? (
        <InputSelectWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'binary_sensor':
      return entity ? (
        <BinarySensorWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'cover':
      return entity ? (
        <CoverWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'fan':
      return entity ? (
        <FanWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'lock':
      return entity ? (
        <LockWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'automation':
      return entity ? (
        <AutomationWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'script':
      return entity ? (
        <ScriptWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'button':
      return entity ? (
        <ButtonWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'scene_entity':
      return entity ? (
        <SceneEntityWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'number':
      return entity ? (
        <InputNumberWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'select':
      return entity ? (
        <InputSelectWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'input_text':
    case 'text':
      return entity ? (
        <TextInputWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'input_datetime':
      return entity ? (
        <DateTimeWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'person':
    case 'device_tracker':
      return entity ? (
        <PersonWidget entity={entity} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'timer':
      return entity ? (
        <TimerWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'counter':
      return entity ? (
        <CounterWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'group':
      return entity ? (
        <SwitchWidget entity={entity as SwitchEntity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'camera':
      return entity ? (
        <CameraWidget entity={entity} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'vacuum':
      return entity ? (
        <VacuumWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'humidifier':
      return entity ? (
        <HumidifierWidget entity={entity} onUpdate={onUpdate} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'alarm_control_panel':
      return entity ? (
        <AlarmWidget entity={entity} onUpdate={onUpdate} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'spacer':
      return <div className="min-h-[40px]" />
    case 'section_header':
      return (
        <h3 className="text-xl font-medium text-foreground px-1 py-2">
          {widget.label || (widget.config?.title as string) || 'Abschnitt'}
        </h3>
      )
    case 'widget_group': {
      const rawGroupWidgets = Array.isArray(widget.config?.widgets)
        ? widget.config?.widgets as DashboardWidget[]
        : []
      const groupWidgets = rawGroupWidgets
        .filter((item) => item && typeof item === 'object' && typeof item.type === 'string')
        .sort((a, b) => {
          if (a.position.y !== b.position.y) return a.position.y - b.position.y
          return a.position.x - b.position.x
        })
      const visibleGroupWidgets = groupWidgets.filter((item) => isWidgetVisible(item, entities))
      const groupColumns = Math.max(1, Math.min(4, Number(widget.config?.groupColumns || 2)))

      if (visibleGroupWidgets.length === 0) {
        return null
      }

      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${groupColumns}, minmax(0, 1fr))` }}>
          {visibleGroupWidgets.map((childWidget) => {
            const clampedX = Math.min(childWidget.position.x, groupColumns - 1)
            const clampedW = Math.max(1, Math.min(childWidget.size.w, groupColumns - clampedX))

            return (
              <div
                key={childWidget.id}
                style={{
                  gridColumnStart: clampedX + 1,
                  gridColumnEnd: `span ${clampedW}`,
                  gridRowStart: childWidget.position.y + 1,
                  gridRowEnd: `span ${childWidget.size.h}`,
                }}
              >
                <RenderWidget
                  widget={childWidget}
                  entities={entities}
                  onUpdate={onUpdate}
                  userName={userName}
                  weatherEntity={weatherEntity}
                  lightEntities={lightEntities}
                  widgetSize={childWidget.size}
                />
              </div>
            )
          })}
        </div>
      )
    }
    case 'media_player':
      return entity ? (
        <MediaPlayerWidget entity={entity as MediaPlayerEntity} onUpdate={onUpdate} widgetSize={resolvedSize} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'entity_history':
      return entity ? (
        <EntityHistoryWidget entityId={entity.entity_id} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'statistics_chart':
      return entity ? (
        <StatisticsChartWidget entityId={entity.entity_id} config={widget.config} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'energy_monitor':
      return <EnergyMonitorWidget config={widget.config} />
    case 'entity_statistics':
      return entity ? (
        <EntityStatisticsWidget entityId={entity.entity_id} />
      ) : (
        <WidgetPlaceholder widget={widget} />
      )
    case 'quick_actions':
      return <QuickActionsWidget config={widget.config} />
    case 'system_monitor':
      return <SystemMonitorWidget config={widget.config} />
    case 'ora_storage':
      return <OraStorageWidget config={widget.config} />
    case 'ora_system':
      return <OraSystemWidget />
    case 'ora_jobs':
      return <OraJobsWidget />
    case 'ora_recent_files':
      return <OraRecentFilesWidget />
    case 'ora_presence':
      return <OraPresenceWidget config={widget.config} />
    case 'scene_manager':
      return <SceneManagerWidget config={widget.config} />
    case 'room_summary':
      return <RoomSummaryWidget config={widget.config} />
    case 'notification_log':
      return <NotificationLogWidget config={widget.config} />
    case 'water_usage':
      return <WaterUsageWidget />
    case 'waste_collection':
      return <WasteCollectionWidget config={widget.config} />
    case 'widget_carousel':
      return <WidgetCarouselWidget widget={widget} entities={entities} onUpdate={onUpdate} />
    case 'page_link':
      return <PageLinkWidget config={widget.config} widgetSize={resolvedSize} />
    case 'nina_warnings':
      return <NinaWarningWidget config={widget.config} />
    case 'map':
      return <MapWidget config={widget.config} />
    case 'iframe':
      return <IFrameWidget config={widget.config} />
    case 'stream':
      return <StreamWidget config={widget.config} widgetSize={resolvedSize} />
    case 'custom':
    default:
      return <WidgetPlaceholder widget={widget} />
  }
}

function getPageLayoutFromStorage(pageId: string): { cols: number; gap: number; rows: number } {
  try {
    const raw = localStorage.getItem('ha-page-designer-layouts')
    if (!raw) return { cols: 6, gap: 10, rows: 6 }
    const layouts = JSON.parse(raw) as Record<string, { cols?: number; gap?: number; rows?: number }>
    const layout = layouts[pageId]
    if (!layout) return { cols: 6, gap: 10, rows: 6 }
    return {
      cols: Math.max(2, Math.min(8, layout.cols ?? 6)),
      gap: Math.max(0, Math.min(24, layout.gap ?? 10)),
      rows: Math.max(6, layout.rows ?? 6),
    }
  } catch {
    return { cols: 6, gap: 10, rows: 6 }
  }
}

export function CustomPageRenderer({
  page,
  entities,
  onUpdate,
  userName,
  weatherEntity,
  lightEntities,
  hideTitle,
}: CustomPageRendererProps) {
  const { pageLayouts, pageSettings, globalCustomCss, userCustomCss } = usePageNavigation()
  const layout = pageLayouts[page.id]
  const ps = pageSettings[page.id]
  const [globalCardStyle] = useLocalStorage('ha-global-card-style', 'default')
  const designerCols = Math.max(2, Math.min(8, layout?.cols ?? 6))
  const designerGap = Math.max(0, Math.min(24, layout?.gap ?? 10))
  const designerRows = Math.max(6, layout?.rows ?? 6)
  const [, setVisibilityTick] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setVisibilityTick((v) => v + 1)
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Mobile-responsive column calculation:
  // On small screens, collapse columns proportionally but keep widget ratio
  const mobileColumns = useMemo(() => {
    if (viewportWidth >= 1024) return designerCols // Desktop: exact designer columns
    if (viewportWidth >= 768) return Math.max(2, Math.min(designerCols, Math.ceil(designerCols * 0.66))) // Tablet: ~66%
    if (viewportWidth >= 640) return Math.max(2, Math.min(designerCols, Math.ceil(designerCols * 0.5))) // Small tablet: ~50%
    return Math.min(designerCols, 2) // Phone: max 2 columns
  }, [viewportWidth, designerCols])

  // Responsive gap
  const mobileGap = viewportWidth < 640 ? Math.min(designerGap, 8) : designerGap

  const sortedWidgets = [...page.widgets].sort((a, b) => {
    if (a.position.y !== b.position.y) return a.position.y - b.position.y
    return a.position.x - b.position.x
  })

  const visibleWidgets = sortedWidgets.filter((widget) => isWidgetVisible(widget, entities))

  // On mobile (reduced columns): use auto-flow to prevent overlap
  // On desktop: use exact designer positions
  const isReduced = mobileColumns < designerCols

  const reflowedWidgets = useMemo(() => {
    if (!isReduced) {
      // No reflow needed, use exact designer positions
      return visibleWidgets.map(w => ({
        widget: w,
        col: w.position.x,
        colSpan: Math.min(w.size.w, designerCols - w.position.x),
        row: w.position.y,
        rowSpan: w.size.h,
        useAutoFlow: false,
      }))
    }

    // Mobile: auto-flow — just cap the column span, let CSS grid place items
    return visibleWidgets.map(w => {
      const scaledW = Math.max(1, Math.min(mobileColumns, Math.round(w.size.w * (mobileColumns / designerCols))))
      return {
        widget: w,
        col: 0,
        colSpan: Math.min(scaledW, mobileColumns),
        row: 0,
        rowSpan: 1, // flatten height on mobile for even flow
        useAutoFlow: true,
      }
    })
  }, [visibleWidgets, mobileColumns, designerCols, isReduced])

  // Per-page settings: determine effective card style for widgets without explicit card style
  const pageCardStyle = ps?.card_style && ps.card_style !== 'default' ? ps.card_style : undefined
  const effectiveDefaultCardStyle = pageCardStyle || (globalCardStyle !== 'default' ? globalCardStyle : undefined)
  const effectivePadding = ps?.padding ?? undefined
  const effectiveHideHeader = ps?.hide_header || false

  return (
    <div className="space-y-4" style={effectivePadding !== undefined ? { padding: `0 ${effectivePadding}px` } : undefined}>
      {/* Inject global custom CSS (all pages) */}
      {globalCustomCss && (
        <style dangerouslySetInnerHTML={{ __html: globalCustomCss }} />
      )}
      {/* Inject per-user custom CSS (overrides global) */}
      {userCustomCss && (
        <style dangerouslySetInnerHTML={{ __html: userCustomCss }} />
      )}
      {/* Inject per-page custom CSS (overrides global + user) */}
      {ps?.custom_css && (
        <style dangerouslySetInnerHTML={{ __html: ps.custom_css }} />
      )}

      {!hideTitle && !effectiveHideHeader && (
        <h3 className="text-xl font-medium text-foreground px-1">{page.name}</h3>
      )}

      {visibleWidgets.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-12 text-center"
        >
          <GridFour size={48} weight="light" className="mx-auto text-foreground/20 mb-4" />
          <p className="text-foreground/50 text-sm">
            Diese Seite hat noch keine Widgets.
          </p>
          <p className="text-foreground/30 text-xs mt-1">
            Widgets im Seiten-Designer hinzufügen
          </p>
        </motion.div>
      ) : (
        <div
          className="grid w-full"
          style={{
            gridTemplateColumns: `repeat(${mobileColumns}, minmax(0, 1fr))`,
            ...(isReduced
              ? { gridAutoRows: 'auto' }
              : { gridTemplateRows: `repeat(${Math.max(designerRows, maxWidgetRow(visibleWidgets))}, minmax(0, auto))` }),
            gap: `${mobileGap}px`,
          }}
        >
          {reflowedWidgets.map(({ widget, col, colSpan, row, rowSpan, useAutoFlow }) => {
            const alignment = (widget.config?.alignment as 'left' | 'center' | 'right' | undefined) || 'left'
            const fillHeight = !!widget.config?.fillHeight

            return (
              <motion.div
                key={widget.id}
                data-widget-type={widget.type}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={[
                  fillHeight ? 'h-full' : '',
                  widget.config?.transparentBackground ? 'widget-transparent' : '',
                  getCardStyleClass((widget.config?.cardStyle as string | undefined) || effectiveDefaultCardStyle),
                ].filter(Boolean).join(' ') || undefined}
                style={useAutoFlow ? {
                  gridColumn: `span ${colSpan}`,
                } : {
                  gridColumnStart: col + 1,
                  gridColumnEnd: `span ${colSpan}`,
                  gridRowStart: row + 1,
                  gridRowEnd: `span ${rowSpan}`,
                }}
              >
                <div
                  className={[
                    fillHeight ? 'h-full' : '',
                    alignment === 'center' ? 'mx-auto' : '',
                    alignment === 'right' ? 'ml-auto' : '',
                    alignment === 'left' ? 'w-full' : 'w-fit max-w-full',
                  ].filter(Boolean).join(' ')}
                >
                  <RenderWidget
                    widget={widget}
                    entities={entities}
                    onUpdate={onUpdate}
                    userName={userName}
                    weatherEntity={weatherEntity}
                    lightEntities={lightEntities}
                    widgetSize={fillHeight ? { w: colSpan, h: rowSpan } : undefined}
                  />
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function maxWidgetRow(widgets: DashboardWidget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.position.y + w.size.h), 0)
}
