// rumahl Ideas Board – Tracks planned features for future implementation

import { KanbanBoard, KanbanTask } from '@/components/KanbanBoard'
import { useState } from 'react'

const RUMAHL_IDEAS: KanbanTask[] = [
  {
    id: 'idea-04', title: 'Multi-Agent Collaboration', column: 'backlog', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Lead-Agent orchestriert Sub-Agents: Planner → Coder → Tester → Reviewer → Merger. Parallele Ausführung mit Koordination.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-05', title: 'Autonomous Code Review', column: 'backlog', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Automatischer PR-Review: Code-Qualität, Security-Scans, Performance-Analyse, Best-Practice-Checks. Integration mit GitHub.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-06', title: 'Voice-First Development', column: 'backlog', priority: 'medium', source: 'system',
    tags: ['feature'],
    description: 'Vollständige Sprachsteuerung für Coding: "rumahl, baue ein Login-Formular", "rumahl, was macht diese Funktion?".',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-07', title: 'Predictive Assistance', column: 'backlog', priority: 'medium', source: 'system',
    tags: ['feature'],
    description: 'Agent beobachtet deine Arbeit und schlägt proaktiv vor: "Soll ich Tests dafür schreiben?", "Brauchst du Doku?".',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-08', title: 'rumahl Self-Healing', column: 'backlog', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Überwacht rumahls eigene Gesundheit, erkennt Memory-Leaks, Error-Spikes, Performance-Probleme. Auto-fixt oder schlägt Fixes vor.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-09', title: 'Cost Intelligence', column: 'backlog', priority: 'medium', source: 'system',
    tags: ['feature'],
    description: 'Token-Tracking pro Provider, Budget-Alerts, günstigere Alternativen vorschlagen, Kosten-Reports.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-10', title: 'Template Library', column: 'backlog', priority: 'low', source: 'system',
    tags: ['docs'],
    description: 'Wiederverwendbare Agent-Task-Templates: "React Component", "CRUD API", "Docker Setup". Community-sharable.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-11', title: 'Learning from Mistakes', column: 'backlog', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Aus Loops/Fehlern lernen → Knowledge-Base → zukünftige Agents vermeiden gleiche Fehler. Baut auf Memory System auf.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
  {
    id: 'idea-12', title: 'Multi-Modal 2.0', column: 'backlog', priority: 'medium', source: 'system',
    tags: ['feature'],
    description: 'Screenshot-Analyse für UI-Debugging, Diagramm-Generierung aus Code, Video-Analyse erweitern.',
    createdAt: new Date().toISOString(), subtasks: [],
  },
]

// Mark the implemented ones as done
const IMPLEMENTED: KanbanTask[] = [
  {
    id: 'idea-01', title: 'AI Model Router', column: 'done', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Intelligentes Provider-Routing: Analysiert jede Anfrage und wählt automatisch den besten AI-Provider basierend auf Task-Typ, Kosten und Verfügbarkeit.',
    createdAt: new Date().toISOString(), subtasks: [],
    completedAt: new Date().toISOString(),
  },
  {
    id: 'idea-02', title: 'rumahl Memory System', column: 'done', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Persistentes Lernen: Codebase-Wissen, User-Präferenzen, Fehler-Patterns, automatische Wissensextraktion.',
    createdAt: new Date().toISOString(), subtasks: [],
    completedAt: new Date().toISOString(),
  },
  {
    id: 'idea-03', title: 'Autonomous Scheduler', column: 'done', priority: 'high', source: 'system',
    tags: ['feature'],
    description: 'Cron-basierte Agent-Tasks: Daily Code Health, Weekly Review, Security Audit. Zeit- und Event-gesteuert.',
    createdAt: new Date().toISOString(), subtasks: [],
    completedAt: new Date().toISOString(),
  },
]

export function ORAIdeasBoard() {
  const [tasks, setTasks] = useState<KanbanTask[]>([...IMPLEMENTED, ...RUMAHL_IDEAS])

  return (
    <div className="h-full">
      <KanbanBoard
        tasks={tasks}
        onTasksChange={setTasks}
        onMoveTask={(id, from, to) => {
          setTasks(prev => prev.map(t =>
            t.id === id ? { ...t, column: to, ...(to === 'done' ? { completedAt: new Date().toISOString() } : {}) } : t
          ))
        }}
        compact
      />
    </div>
  )
}
