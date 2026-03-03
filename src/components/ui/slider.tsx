"use client"

import { ComponentProps, useMemo } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col py-2",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "bg-foreground/8 relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5 shadow-inner"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "bg-gradient-to-r from-accent via-accent/95 to-accent/90 absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full shadow-sm"
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="block size-6 shrink-0 rounded-full border border-foreground/10 bg-gradient-to-b from-card to-card/95 shadow-[0_2px_8px_rgba(0,0,0,0.15),0_0_0_0.5px_rgba(255,255,255,0.1)_inset,0_1px_2px_rgba(255,255,255,0.2)_inset] backdrop-blur-xl transition-all hover:scale-110 hover:shadow-[0_4px_12px_rgba(0,0,0,0.2),0_0_0_0.5px_rgba(255,255,255,0.15)_inset,0_1px_3px_rgba(255,255,255,0.25)_inset] focus-visible:scale-110 focus-visible:shadow-[0_4px_12px_rgba(0,0,0,0.2),0_0_0_3px_oklch(from_var(--accent)_l_c_h_/_0.3)] focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 active:scale-95"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
