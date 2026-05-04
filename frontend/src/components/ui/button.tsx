import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-300 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:bg-primary/85 hover:scale-[1.02] active:scale-[0.98] backdrop-blur-sm",
        destructive:
          "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/10 hover:shadow-destructive/20 hover:bg-destructive/85 hover:scale-[1.02] active:scale-[0.98] backdrop-blur-sm",
        outline:
          "border border-foreground/15 bg-background/60 backdrop-blur-xl text-foreground shadow-sm hover:bg-accent/15 hover:text-accent-foreground hover:border-accent/40 hover:scale-[1.02] active:scale-[0.98]",
        secondary:
          "bg-secondary/70 backdrop-blur-md text-secondary-foreground shadow-sm hover:bg-secondary hover:scale-[1.02] active:scale-[0.98]",
        ghost:
          "hover:bg-accent/15 hover:text-accent-foreground hover:scale-[1.02] active:scale-[0.98]",
        glass:
          "glass-card text-foreground shadow-lg hover:shadow-xl hover:border-foreground/20 hover:scale-[1.02] active:scale-[0.98]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-5 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-xl px-7 has-[>svg]:px-5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
