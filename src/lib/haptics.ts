export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'

class HapticFeedback {
  private isSupported: boolean

  constructor() {
    this.isSupported = 'vibrate' in navigator
  }

  private vibrate(pattern: number | number[]) {
    if (!this.isSupported) return
    
    try {
      navigator.vibrate(pattern)
    } catch (error) {
      console.debug('Vibration failed:', error)
    }
  }

  light() {
    this.vibrate(10)
  }

  medium() {
    this.vibrate(20)
  }

  heavy() {
    this.vibrate(40)
  }

  success() {
    this.vibrate([10, 50, 15])
  }

  warning() {
    this.vibrate([20, 100, 20])
  }

  error() {
    this.vibrate([30, 100, 30, 100, 30])
  }

  selection() {
    this.vibrate(5)
  }

  trigger(pattern: HapticPattern) {
    switch (pattern) {
      case 'light':
        this.light()
        break
      case 'medium':
        this.medium()
        break
      case 'heavy':
        this.heavy()
        break
      case 'success':
        this.success()
        break
      case 'warning':
        this.warning()
        break
      case 'error':
        this.error()
        break
      case 'selection':
        this.selection()
        break
    }
  }

  impact(style: 'light' | 'medium' | 'heavy' = 'medium') {
    this.trigger(style)
  }

  notification(type: 'success' | 'warning' | 'error') {
    this.trigger(type)
  }

  selectionChanged() {
    this.selection()
  }
}

export const haptics = new HapticFeedback()
