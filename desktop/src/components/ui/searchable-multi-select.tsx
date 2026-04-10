"use client"

import { useState } from "react"
import { Check, CaretUpDown, X } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

interface SearchableMultiSelectProps {
  values: string[]
  onValuesChange: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  options: Array<{ value: string; label: string; description?: string }>
  disabled?: boolean
  className?: string
}

export function SearchableMultiSelect({
  values,
  onValuesChange,
  placeholder = "Auswählen...",
  searchPlaceholder = "Suchen...",
  emptyMessage = "Keine Ergebnisse.",
  options,
  disabled = false,
  className,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false)

  const selectedOptions = options.filter((opt) => values.includes(opt.value))

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onValuesChange(values.filter((v) => v !== value))
    } else {
      onValuesChange([...values, value])
    }
  }

  const removeValue = (value: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onValuesChange(values.filter((v) => v !== value))
  }

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex min-h-[36px] w-full items-center justify-between gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-xs text-foreground transition-colors",
              "hover:bg-foreground/8 focus:outline-none focus:ring-1 focus:ring-foreground/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
          >
            <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
              {values.length > 0
                ? `${values.length} ausgewählt`
                : placeholder}
            </span>
            <CaretUpDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="glass-card w-[--radix-popover-trigger-width] border-foreground/10 p-0"
          align="start"
          sideOffset={4}
        >
          <Command className="bg-transparent">
            <CommandInput
              placeholder={searchPlaceholder}
              className="text-xs"
            />
            <CommandList>
              <CommandEmpty className="text-xs text-muted-foreground">
                {emptyMessage}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const isSelected = values.includes(option.value)
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.label + (option.description ? " " + option.description : "")}
                      onSelect={() => toggleValue(option.value)}
                      className="flex items-center gap-2 rounded-lg text-xs"
                    >
                      <Check
                        className={cn(
                          "size-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                        weight="bold"
                      />
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="truncate">{option.label}</span>
                        {option.description && (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected items as removable chips */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/10 text-accent text-[10px] border border-accent/20"
            >
              <span className="truncate max-w-[120px]">{opt.label}</span>
              <button
                type="button"
                onClick={(e) => removeValue(opt.value, e)}
                className="shrink-0 hover:text-red-400 transition-colors"
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
