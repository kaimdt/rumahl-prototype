// Tauri-compatible API wrapper
// This module provides fetch functionality that works in both browser and Tauri contexts

export const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080'

// In Tauri, we can use fetch directly as it's available in the webview
// No special adaptation needed - fetch works natively in Tauri v2
export const tauriFetch = fetch

// Helper to get base URL
export function getApiBase() {
  return API_BASE
}
