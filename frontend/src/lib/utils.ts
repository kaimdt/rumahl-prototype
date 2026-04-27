import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type ModalSize = 'default' | 'wide' | 'full' | 'auto'

/** Returns the Tailwind max-width class for a given modal size preference */
export function getModalSizeClass(size?: string): string {
  switch (size) {
    case 'wide':  return 'sm:max-w-[640px]'
    case 'full':  return 'sm:max-w-[90vw]'
    case 'auto':  return 'sm:max-w-fit'
    default:      return 'sm:max-w-[425px]'
  }
}
