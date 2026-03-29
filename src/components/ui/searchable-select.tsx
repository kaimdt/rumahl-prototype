"use client"

import { useState } from "react"
import { Check, CaretUpDown } from "@phosphor-icons/react"

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

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  options: Array<{ value: string; label: string; description?: string }>
  disabled?: boolean
  className?: string
}

export function SearchableSelect({
  value,
  onValueChange,
  placeholder = "Select an option...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  options,
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)

  const selectedOption = options.find((opt) => opt.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground transition-colors",
            "hover:bg-foreground/8 focus:outline-none focus:ring-1 focus:ring-foreground/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.label : placeholder}
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
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label + (option.description ? " " + option.description : "")}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg text-xs"
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      value === option.value ? "opacity-100" : "opacity-0"
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
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
