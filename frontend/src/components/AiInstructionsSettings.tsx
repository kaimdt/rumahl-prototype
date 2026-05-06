import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalStorage } from '@/lib/storage'
import { 
  Sparkle, Chat, Smiley, Brain, Baby, Briefcase, 
  FloppyDisk, ArrowsClockwise, X 
} from '@phosphor-icons/react'
import { toast } from 'sonner'

// ─── Preset Styles ────────────────────────────────────────────────────────

const PRESETS: Array<{
  id: string
  label: string
  labelDe: string
  icon: typeof Sparkle
  prompt: string
}> = [
  {
    id: 'genz',
    label: 'Gen Z',
    labelDe: 'Gen Z',
    icon: Smiley,
    prompt: 'Sprich im Gen-Z-Slang. Verwende Begriffe wie "no cap", "fr", "slay", "sus", "bussin", "sheesh", "vibe". Halte es lässig und authentisch – wie in einem TikTok-Kommentar. Benutze viele Emojis aber nur die coolen: 💀😭🔥✨💅',
  },
  {
    id: 'funny',
    label: 'Funny',
    labelDe: 'Lustig',
    icon: Smiley,
    prompt: 'Antworte mit Humor und Witz. Verwende Wortspiele, clevere Vergleiche und eine Prise Sarkasmus. Jede Antwort sollte mindestens ein Schmunzeln auslösen. Übertreibe ruhig ein bisschen für den komödiantischen Effekt.',
  },
  {
    id: 'professional',
    label: 'Professional',
    labelDe: 'Professionell',
    icon: Briefcase,
    prompt: 'Antworte professionell, präzise und sachlich. Verwende eine formelle, aber nicht steife Sprache. Strukturiere komplexe Antworten mit Aufzählungen. Bleibe stets höflich und respektvoll.',
  },
  {
    id: 'eli5',
    label: 'ELI5',
    labelDe: 'ELI5',
    icon: Baby,
    prompt: 'Erkläre alles so einfach wie möglich – als würdest du mit einem 5-jährigen Kind sprechen. Verwende einfache Worte, konkrete Beispiele und Analogien aus dem Alltag. Keine Fachbegriffe ohne Erklärung.',
  },
  {
    id: 'poetic',
    label: 'Poetic',
    labelDe: 'Poetisch',
    icon: Sparkle,
    prompt: 'Antworte in einer poetischen, bildhaften Sprache. Verwende Metaphern, Vergleiche und eine rhythmische Satzstruktur. Deine Worte sollen Bilder im Kopf entstehen lassen.',
  },
  {
    id: 'pirate',
    label: 'Pirate',
    labelDe: 'Pirat',
    icon: Chat,
    prompt: 'Sprich wie ein Pirat! Arr! Verwende Piraten-Slang: "Arr", "Landratte", "Me hearties", "Schiffbruch", "Kapern". Beziehe dich auf die See, Schätze und Abenteuer. Halte den Piraten-Dialekt konsequent durch.',
  },
]

// ─── Component ─────────────────────────────────────────────────────────────

export function AiInstructionsSettings() {
  const { t, i18n } = useTranslation()
  const [instructions, setInstructions] = useLocalStorage('iora-ai-instructions', '')
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const isGerman = i18n.language === 'de'

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    if (activePreset === preset.id) {
      // Deselect
      setActivePreset(null)
      setInstructions('')
    } else {
      setActivePreset(preset.id)
      setInstructions(preset.prompt)
    }
  }

  const handleSave = () => {
    setInstructions(instructions) // triggers localStorage
    setSaved(true)
    toast.success(t('ai.instructionsSaved'))
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setActivePreset(null)
    setInstructions('')
    toast.success(t('ai.instructionsReset'))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkle size={16} className="text-accent" weight="fill" />
        <h3 className="text-sm font-semibold text-foreground">
          {isGerman ? 'AI-Persönlichkeit' : 'AI Personality'}
        </h3>
      </div>
      <p className="text-xs text-foreground/50">
        {isGerman 
          ? 'Passe an, wie ORA AI antworten soll – lustig, professionell oder ganz individuell.'
          : 'Customize how ORA AI responds – funny, professional, or completely custom.'
        }
      </p>

      {/* ─── Preset Chips ──────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
          {isGerman ? 'Vordefinierte Stile' : 'Preset Styles'}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {PRESETS.map(preset => {
            const Icon = preset.icon
            const isActive = activePreset === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                  isActive
                    ? 'border-accent bg-accent/10 shadow-sm'
                    : 'border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20 hover:bg-foreground/[0.06]'
                }`}
              >
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} className={isActive ? 'text-accent' : 'text-foreground/40'} />
                <span className={`text-[10px] font-medium ${isActive ? 'text-accent' : 'text-foreground/60'}`}>
                  {isGerman ? preset.labelDe : preset.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Custom Instructions Textarea ───────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider">
            {isGerman ? 'Eigene Anweisungen' : 'Custom Instructions'}
          </p>
          <span className="text-[9px] text-foreground/30 font-mono">
            {instructions.length}/2000
          </span>
        </div>
        <textarea
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value)
            setActivePreset(null) // clear preset when editing manually
          }}
          maxLength={2000}
          rows={5}
          placeholder={isGerman 
            ? 'z.B. "Antworte immer mit einer Prise Humor und verwende viele Emojis. Erkläre technische Dinge einfach."'
            : 'e.g. "Always respond with a touch of humor and use emojis. Explain technical things simply."'
          }
          className="w-full px-4 py-3 rounded-xl bg-foreground/[0.04] border border-foreground/10 text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-accent/50 resize-none transition-all font-mono text-xs leading-relaxed"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        />
      </div>

      {/* ─── Action Buttons ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-all shadow-sm"
        >
          <FloppyDisk size={12} />
          {saved ? (isGerman ? 'Gespeichert!' : 'Saved!') : t('common.save')}
        </button>
        {instructions && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground/50 hover:text-foreground hover:bg-foreground/[0.06] transition-all"
          >
            <ArrowsClockwise size={12} />
            {t('common.reset')}
          </button>
        )}
      </div>

      {/* ─── Preview ────────────────────────────────────────── */}
      {instructions && (
        <div className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/10">
          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
            {isGerman ? 'Vorschau (wird an AI gesendet)' : 'Preview (sent to AI)'}
          </p>
          <pre className="text-[10px] text-foreground/60 font-mono whitespace-pre-wrap leading-relaxed">
            {instructions}
          </pre>
        </div>
      )}
    </div>
  )
}
