import { useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import type { EntityState } from '@/lib/types'

interface EntityPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (entityId: string) => void
  entityDomain?: string
  currentEntityId?: string
  entities: EntityState[]
}

export function EntityPickerDialog({
  open,
  onOpenChange,
  onSelect,
  entityDomain,
  currentEntityId,
  entities,
}: EntityPickerDialogProps) {
  const filteredEntities = entityDomain
    ? entities.filter((e) => e.entity_id.startsWith(`${entityDomain}.`))
    : entities

  // Group entities by domain
  const grouped = filteredEntities.reduce<Record<string, EntityState[]>>((acc, entity) => {
    const domain = entity.entity_id.split('.')[0]
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(entity)
    return acc
  }, {})

  const handleSelect = (entityId: string) => {
    onSelect(entityId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold">
            Entity auswählen
          </DialogTitle>
        </DialogHeader>
        <Command className="border-none" shouldFilter={true}>
          <div className="px-3 pb-2">
            <CommandInput placeholder="Entity suchen..." className="h-9" />
          </div>
          <CommandList className="max-h-[400px] overflow-y-auto border-t border-foreground/5">
            <CommandEmpty className="py-8 text-center text-sm text-foreground/40">
              Keine Entities gefunden.
            </CommandEmpty>
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([domain, domainEntities]) => (
                <CommandGroup key={domain} heading={domain} className="px-2">
                  {domainEntities
                    .sort((a, b) => {
                      const nameA = (a.attributes?.friendly_name as string) || a.entity_id
                      const nameB = (b.attributes?.friendly_name as string) || b.entity_id
                      return nameA.localeCompare(nameB)
                    })
                    .map((entity) => {
                      const name = (entity.attributes?.friendly_name as string) || entity.entity_id
                      const isCurrent = entity.entity_id === currentEntityId
                      return (
                        <CommandItem
                          key={entity.entity_id}
                          value={`${name} ${entity.entity_id}`}
                          onSelect={() => handleSelect(entity.entity_id)}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg ${
                            isCurrent ? 'bg-accent/10' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-foreground truncate block">{name}</span>
                            <span className="text-[10px] text-foreground/40 truncate block">{entity.entity_id}</span>
                          </div>
                          <span className="text-[10px] text-foreground/30 shrink-0 max-w-[80px] truncate">
                            {entity.state}
                          </span>
                        </CommandItem>
                      )
                    })}
                </CommandGroup>
              ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
