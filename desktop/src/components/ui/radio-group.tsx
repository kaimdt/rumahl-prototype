"use client"

import { ComponentProps } from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import CircleIcon from "lucide-react/dist/esm/icons/circle"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "border-foreground/25 bg-background/50 backdrop-blur-md focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 aspect-square size-5 shrink-0 rounded-full border shadow-sm transition-all duration-200 outline-none hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent/10 data-[state=checked]:shadow-[0_0_8px_var(--accent)_/_0.2]",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-accent absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-0 duration-200" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
