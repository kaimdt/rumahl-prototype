import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Sparkle, Plus, FloppyDisk, Trash, X, Pencil,
  Moon, Lightbulb, Confetti, Sun, CloudSun, Buildings, 
  CloudMoon, Star, Flame, Snowflake, Rainbow, Meteor
} from '@phosphor-icons/react'
import type { ColorScene } from '@/lib/colorScenes'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SceneSelectorProps {
  lightEntities: LightEntity[]
  onUpdate?: () => void
}

const ICON_OPTIONS = [
  { key: 'moon', Icon: Moon },
  { key: 'lightbulb', Icon: Lightbulb },
  { key: 'confetti', Icon: Confetti },
  { key: 'sun', Icon: Sun },
  { key: 'cloudsun', Icon: CloudSun },
  { key: 'buildings', Icon: Buildings },
  { key: 'cloudmoon', Icon: CloudMoon },
  { key: 'star', Icon: Star },
  { key: 'flame', Icon: Flame },
  { key: 'snowflake', Icon: Snowflake },
  { key: 'rainbow', Icon: Rainbow },
  { key: 'meteor', Icon: Meteor },
]

const getIconComponent = (iconKey: string) => {
  const option = ICON_OPTIONS.find(opt => opt.key === iconKey)
  return option?.Icon || Lightbulb
}

export function SceneSelector({ lightEntities, onUpdate }: SceneSelectorProps) {
  const [scenes, setScenes] = useKV<ColorScene[]>('color-scenes', [])
  const [isApplying, setIsApplying] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingScene, setEditingScene] = useState<ColorScene | null>(null)
  const [newSceneName, setNewSceneName] = useState('')
  const [newSceneIcon, setNewSceneIcon] = useState('lightbulb')

  const captureCurrentState = (): ColorScene['settings'] => {
    const settings: ColorScene['settings'] = {}
    
    lightEntities.forEach(light => {
      if (light.state === 'on') {
        settings[light.entity_id] = {
          brightness: light.attributes.brightness || 255,
          ...(light.attributes.rgb_color && { rgb_color: light.attributes.rgb_color }),
          ...(light.attributes.color_temp && { color_temp: light.attributes.color_temp }),
        }
      }
    })
    
    return settings
  }

  const handleCreateScene = () => {
    if (!newSceneName.trim()) {
      toast.error('Bitte geben Sie einen Namen ein')
      return
    }

    const settings = captureCurrentState()
    
    if (Object.keys(settings).length === 0) {
      toast.error('Schalten Sie mindestens ein Licht ein')
      return
    }

    const newScene: ColorScene = {
      id: `scene-${Date.now()}`,
      name: newSceneName.trim(),
      icon: newSceneIcon,
      settings,
      createdAt: new Date().toISOString(),
    }

    setScenes((currentScenes) => [...(currentScenes || []), newScene])
    toast.success(`Szene "${newSceneName}" gespeichert`)
    haptics.notification('success')
    
    setNewSceneName('')
    setNewSceneIcon('lightbulb')
    setCreateDialogOpen(false)
  }

  const handleUpdateScene = () => {
    if (!editingScene || !newSceneName.trim()) return

    const settings = captureCurrentState()
    
    if (Object.keys(settings).length === 0) {
      toast.error('Schalten Sie mindestens ein Licht ein')
      return
    }

    setScenes((currentScenes) =>
      (currentScenes || []).map(scene =>
        scene.id === editingScene.id
          ? { ...scene, name: newSceneName.trim(), icon: newSceneIcon, settings }
          : scene
      )
    )
    
    toast.success(`Szene "${newSceneName}" aktualisiert`)
    haptics.notification('success')
    
    setEditingScene(null)
    setNewSceneName('')
    setNewSceneIcon('lightbulb')
  }

  const handleApplyScene = async (scene: ColorScene) => {
    haptics.impact('medium')
    setIsApplying(true)

    try {
      const promises = Object.entries(scene.settings).map(([entityId, settings]) => {
        return haService.turnOn(entityId, settings)
      })

      await Promise.all(promises)
      
      toast.success(`Szene "${scene.name}" angewendet`)
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anwenden der Szene')
      haptics.notification('error')
    } finally {
      setIsApplying(false)
    }
  }

  const handleDeleteScene = (sceneId: string, sceneName: string) => {
    setScenes((currentScenes) => (currentScenes || []).filter(s => s.id !== sceneId))
    toast.success(`Szene "${sceneName}" gelöscht`)
    haptics.impact('light')
  }

  const startEdit = (scene: ColorScene) => {
    setEditingScene(scene)
    setNewSceneName(scene.name)
    setNewSceneIcon(scene.icon)
  }

  const cancelEdit = () => {
    setEditingScene(null)
    setNewSceneName('')
    setNewSceneIcon('lightbulb')
  }

  if (lightEntities.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-medium text-foreground/60 flex items-center gap-2">
          <Sparkle size={16} weight="fill" className="text-accent" />
          Farbszenen
        </h3>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          variant="ghost"
          size="sm"
          className="gap-2 h-8"
        >
          <Plus size={16} weight="bold" />
          Neue Szene
        </Button>
      </div>

      {(scenes && scenes.length > 0) ? (
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-2">
            <AnimatePresence mode="popLayout">
              {scenes.map((scene) => {
                const SceneIcon = getIconComponent(scene.icon)
                return (
                  <motion.div
                    key={scene.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex-shrink-0"
                  >
                    <div className="glass-card rounded-xl p-4 min-w-[140px] relative group hover:shadow-lg transition-shadow duration-300">
                      <button
                        onClick={() => handleApplyScene(scene)}
                        disabled={isApplying}
                        className="w-full text-left space-y-2 disabled:opacity-50"
                      >
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-accent/30 to-accent/15 mx-auto shadow-inner border border-accent/20">
                          <SceneIcon size={28} weight="fill" className="text-accent drop-shadow-sm" />
                        </div>
                        <div>
                          <div className="text-sm font-medium truncate">{scene.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {Object.keys(scene.settings).length} {Object.keys(scene.settings).length === 1 ? 'Licht' : 'Lichter'}
                          </div>
                        </div>
                      </button>
                      
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={() => startEdit(scene)}
                          className="p-1.5 rounded-lg bg-background/90 hover:bg-accent/20 transition-colors backdrop-blur-sm shadow-sm border border-foreground/10"
                        >
                          <Pencil size={14} className="text-foreground/70" />
                        </button>
                        <button
                          onClick={() => handleDeleteScene(scene.id, scene.name)}
                          className="p-1.5 rounded-lg bg-background/90 hover:bg-destructive/20 transition-colors backdrop-blur-sm shadow-sm border border-foreground/10"
                        >
                          <Trash size={14} className="text-destructive" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </ScrollArea>
      ) : (
        <div className="glass-card rounded-xl p-6 text-center">
          <Sparkle size={32} weight="fill" className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            Keine Szenen gespeichert
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Erstellen Sie Ihre erste Farbszene
          </p>
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md glass-card border-foreground/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkle size={20} weight="fill" className="text-accent" />
              Neue Farbszene
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="scene-name">Szenenname</Label>
              <Input
                id="scene-name"
                value={newSceneName}
                onChange={(e) => setNewSceneName(e.target.value)}
                placeholder="z.B. Gemütlicher Abend"
                maxLength={30}
              />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="grid grid-cols-6 gap-2">
                {ICON_OPTIONS.map(({ key, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setNewSceneIcon(key)}
                    className={`p-3 rounded-lg transition-all flex items-center justify-center ${
                      newSceneIcon === key
                        ? 'bg-accent/20 scale-110 ring-2 ring-accent'
                        : 'bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    <Icon size={24} weight="fill" className={newSceneIcon === key ? 'text-accent' : 'text-foreground/60'} />
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-card rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-foreground/80">Aktueller Status wird gespeichert:</p>
              <p className="text-xs text-muted-foreground">
                {lightEntities.filter(l => l.state === 'on').length} von {lightEntities.length} Lichter eingeschaltet
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreateScene}
                className="flex-1 gap-2"
              >
                <FloppyDisk size={16} weight="bold" />
                Speichern
              </Button>
              <Button
                onClick={() => setCreateDialogOpen(false)}
                variant="outline"
              >
                Abbrechen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingScene !== null} onOpenChange={(open) => !open && cancelEdit()}>
        <DialogContent className="sm:max-w-md glass-card border-foreground/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil size={20} weight="bold" className="text-accent" />
              Szene bearbeiten
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-scene-name">Szenenname</Label>
              <Input
                id="edit-scene-name"
                value={newSceneName}
                onChange={(e) => setNewSceneName(e.target.value)}
                placeholder="z.B. Gemütlicher Abend"
                maxLength={30}
              />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="grid grid-cols-6 gap-2">
                {ICON_OPTIONS.map(({ key, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setNewSceneIcon(key)}
                    className={`p-3 rounded-lg transition-all flex items-center justify-center ${
                      newSceneIcon === key
                        ? 'bg-accent/20 scale-110 ring-2 ring-accent'
                        : 'bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    <Icon size={24} weight="fill" className={newSceneIcon === key ? 'text-accent' : 'text-foreground/60'} />
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-card rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-foreground/80">Aktueller Status überschreibt die Szene:</p>
              <p className="text-xs text-muted-foreground">
                {lightEntities.filter(l => l.state === 'on').length} von {lightEntities.length} Lichter eingeschaltet
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleUpdateScene}
                className="flex-1 gap-2"
              >
                <FloppyDisk size={16} weight="bold" />
                Aktualisieren
              </Button>
              <Button
                onClick={cancelEdit}
                variant="outline"
              >
                <X size={16} weight="bold" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
