import { VideoCamera } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { toBackendImageUrl } from '@/lib/imageUrl'

interface CameraWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function CameraWidget({ entity }: CameraWidgetProps) {
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const entityPicture = toBackendImageUrl(entity.attributes.entity_picture as string | undefined)

  return (
    <div className="glass-card rounded-2xl theme-transition relative overflow-hidden">
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
    </div>
  )
}
