"use client"

import { ComponentProps } from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted-foreground/15 data-[state=unchecked]:border-foreground/10 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent shadow-inner transition-all duration-300 ease-out outline-none disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=checked]:shadow-[0_0_10px_var(--accent)_/_0.3]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-white pointer-events-none block size-5 rounded-full shadow-lg ring-0 transition-transform duration-300 ease-out data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
