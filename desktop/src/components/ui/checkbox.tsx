"use client"

import { ComponentProps } from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import CheckIcon from "lucide-react/dist/esm/icons/check"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-foreground/20 bg-background/50 backdrop-blur-md data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=checked]:border-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background size-5 shrink-0 rounded-md border shadow-sm transition-all duration-200 outline-none disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=checked]:shadow-[0_0_8px_var(--accent)_/_0.25]",
        "hover:border-foreground/30",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
