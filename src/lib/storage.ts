/**
 * Local Storage utility to replace GitHub Spark KV
 * Provides a similar API but uses browser localStorage
 */

type StorageListener<T> = (value: T) => void

class LocalStorageManager {
  private listeners = new Map<string, Set<StorageListener<any>>>()

  /**
   * Get a value from localStorage
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    try {
      const item = localStorage.getItem(key)
      if (item === null) return defaultValue
      return JSON.parse(item) as T
    } catch (error) {
      console.error(`Error reading from localStorage (${key}):`, error)
      return defaultValue
    }
  }

  /**
   * Set a value in localStorage
   */
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      this.notifyListeners(key, value)
    } catch (error) {
      console.error(`Error writing to localStorage (${key}):`, error)
    }
  }

  /**
   * Remove a value from localStorage
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
      this.notifyListeners(key, undefined)
    } catch (error) {
      console.error(`Error removing from localStorage (${key}):`, error)
    }
  }

  /**
   * Subscribe to changes for a specific key
   */
  subscribe<T>(key: string, listener: StorageListener<T>): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(listener)

    // Return unsubscribe function
    return () => {
      const keyListeners = this.listeners.get(key)
      if (keyListeners) {
        keyListeners.delete(listener)
        if (keyListeners.size === 0) {
          this.listeners.delete(key)
        }
      }
    }
  }

  /**
   * Notify all listeners for a key
   */
  private notifyListeners<T>(key: string, value: T): void {
    const keyListeners = this.listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach(listener => listener(value))
    }
  }

  /**
   * Clear all storage
   */
  clear(): void {
    localStorage.clear()
    this.listeners.clear()
  }

  /**
   * Get all keys
   */
  getAllKeys(): string[] {
    return Object.keys(localStorage)
  }
}

// Export singleton instance
export const storage = new LocalStorageManager()

/**
 * React hook for using localStorage (similar to useKV)
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    return storage.get(key, defaultValue) ?? defaultValue
  })

  React.useEffect(() => {
    const unsubscribe = storage.subscribe<T>(key, (newValue) => {
      setValue(newValue ?? defaultValue)
    })
    return unsubscribe
  }, [key, defaultValue])

  const setStorageValue = React.useCallback(
    (newValue: T) => {
      storage.set(key, newValue)
      setValue(newValue)
    },
    [key]
  )

  return [value, setStorageValue]
}

// For compatibility with existing code
import * as React from 'react'

export { useLocalStorage as useKV }
