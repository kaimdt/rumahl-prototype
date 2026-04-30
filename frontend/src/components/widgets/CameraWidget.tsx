import { motion } from 'framer-motion'
import { VideoCamera } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { toBackendImageUrl } from '@/lib/imageUrl'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getModalSizeClass } from '@/lib/utils'

interface CameraWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: { modalSize?: string; [key: string]: unknown }
}

export function CameraWidget({ entity, config }: CameraWidgetProps) {
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const entityPicture = toBackendImageUrl(entity.attributes.entity_picture as string | undefined)
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
      <motion.div
        {...longPressHandlers}
        className="glass-card rounded-2xl theme-transition relative overflow-hidden"
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="relative">
          {entityPicture ? (
            <div className="aspect-video w-full overflow-hidden rounded-t-2xl bg-foreground/5">
              <img
                src={entityPicture}
                alt={name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-video w-full overflow-hidden rounded-t-2xl bg-foreground/5 flex items-center justify-center">
              <VideoCamera size={48} weight="light" className="text-foreground/20" />
            </div>
          )}
          <div className="p-3">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {entity.state === 'idle' ? 'Bereit' : entity.state}
            </p>
          </div>
        </div>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={`${getModalSizeClass(config?.modalSize as string | undefined)} glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden`}>
          <DialogHeader className="sr-only">
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>

          {entityPicture ? (
            <div className="w-full overflow-hidden bg-black">
              <img
                src={entityPicture}
                alt={name}
                className="w-full h-auto max-h-[70vh] object-contain"
              />
            </div>
          ) : (
            <div className="w-full aspect-video bg-foreground/5 flex items-center justify-center">
              <VideoCamera size={64} weight="light" className="text-foreground/20" />
            </div>
          )}

          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-accent/15">
                <VideoCamera size={20} weight="fill" className="text-accent" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
                <p className="text-xs text-foreground/40 font-mono truncate">{entity.entity_id}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-foreground/5 border border-foreground/8 px-3 py-2">
                <p className="text-foreground/40">Status</p>
                <p className="font-medium text-foreground capitalize">{entity.state === 'idle' ? 'Bereit' : entity.state}</p>
              </div>
              {(entity.attributes.brand as string | undefined) && (
                <div className="rounded-xl bg-foreground/5 border border-foreground/8 px-3 py-2">
                  <p className="text-foreground/40">Marke</p>
                  <p className="font-medium text-foreground">{entity.attributes.brand as string}</p>
                </div>
              )}
              {(entity.attributes.model_name as string | undefined) && (
                <div className="rounded-xl bg-foreground/5 border border-foreground/8 px-3 py-2">
                  <p className="text-foreground/40">Modell</p>
                  <p className="font-medium text-foreground">{entity.attributes.model_name as string}</p>
                </div>
              )}
              {(entity.attributes.frontend_stream_type as string | undefined) && (
                <div className="rounded-xl bg-foreground/5 border border-foreground/8 px-3 py-2">
                  <p className="text-foreground/40">Stream</p>
                  <p className="font-medium text-foreground capitalize">{entity.attributes.frontend_stream_type as string}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
