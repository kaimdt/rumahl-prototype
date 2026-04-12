// Tauri-compatible API wrapper
// This module provides fetch functionality that works in both browser and Tauri contexts

// Re-export from canonical source
export { getApiBase } from '@/lib/apiBase'
import { getApiBase } from '@/lib/apiBase'

export const API_BASE = getApiBase()

// In Tauri, we can use fetch directly as it's available in the webview
// No special adaptation needed - fetch works natively in Tauri v2
export const tauriFetch = fetch
