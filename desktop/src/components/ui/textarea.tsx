import { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input/50 placeholder:text-muted-foreground bg-background/50 backdrop-blur-xl flex field-sizing-content min-h-20 w-full rounded-xl border px-4 py-3 text-base shadow-sm transition-all duration-300 outline-none focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:shadow-lg hover:border-foreground/20 hover:bg-background/70 disabled:cursor-not-allowed disabled:opacity-40 md:text-sm",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
