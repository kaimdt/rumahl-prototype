import { ComponentProps } from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-accent/20 data-[state=on]:text-accent data-[state=on]:border-accent/30 data-[state=on]:shadow-[0_0_10px_var(--accent)_/_0.15] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 outline-none aria-invalid:ring-destructive/20 aria-invalid:border-destructive whitespace-nowrap backdrop-blur-md",
  {
    variants: {
      variant: {
        default: "bg-transparent hover:bg-accent/10 hover:text-accent",
        outline:
          "border border-foreground/15 bg-background/40 shadow-sm hover:bg-accent/15 hover:text-accent-foreground hover:border-accent/30",
      },
      size: {
        default: "h-9 px-3 min-w-9",
        sm: "h-8 px-2 min-w-8 rounded-lg",
        lg: "h-10 px-4 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
