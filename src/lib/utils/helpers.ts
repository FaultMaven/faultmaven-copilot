// src/lib/utils/helpers.ts
// Legacy utilities - log function preserved for backward compatibility

/* eslint-disable no-console, no-restricted-syntax */

import { browser } from 'wxt/browser';

/**
 * Logs a message with a timestamp and optional context.
 * @param {string} message - The message to log.
 * @param {string} [context] - Additional context for the log (e.g., the script name).
 */
export function log(message: string, context?: string): void {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${context ? `[${context}] ` : ""}${message}`
  console.log(logMessage)
}

/**
 * Fetches data from an API and returns the parsed JSON response.
 * @param {string} url - The API endpoint to fetch data from.
 * @param {RequestInit} [options] - Optional fetch options (e.g., method, headers, body).
 * @returns {Promise<any>} - The parsed JSON response.
 */
export async function fetchData<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      ...options
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return (await response.json()) as T
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Error fetching data from ${url}: ${errorMessage}`, "helpers.ts")
    throw new Error(errorMessage)
  }
}

/**
 * Injects a content script into the specified tab.
 * @param {number} tabId - The ID of the tab to inject the script into.
 * @param {string} filePath - The path to the content script file.
 * @param {string} [url] - The URL of the tab (for logging purposes).
 */
export function injectContentScript(tabId: number, filePath: string, url?: string): void {
  browser.scripting.executeScript({
    target: { tabId },
    files: [filePath]
  }).then(() => {
    log(`Content script successfully injected into: ${url || tabId}`, "helpers.ts")
  }).catch((error) => {
    log(`Error injecting content script: ${error.message}`, "helpers.ts")
  });
}

/**
 * Sends a message to a content script in the specified tab.
 * @param {number} tabId - The ID of the tab to send the message to.
 * @param {Object} message - The message to send.
 * @returns {Promise<any>} - The response from the content script.
 */
export async function sendMessageToContentScript(tabId: number, message: any): Promise<any> {
  try {
    const response = await browser.tabs.sendMessage(tabId, message)
    log(`Message sent to content script in tab ${tabId}: ${JSON.stringify(message)}`, "helpers.ts")
    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Error sending message to content script: ${errorMessage}`, "helpers.ts")
    throw new Error(errorMessage)
  }
}

/**
 * Checks if a URL is valid and starts with "http" or "https".
 * @param {string} url - The URL to validate.
 * @returns {boolean} - True if the URL is valid, false otherwise.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol.startsWith("http")
  } catch (error) {
    return false
  }
}

/**
 * Debounces a function to limit how often it can be called.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The delay in milliseconds.
 * @returns {Function} - The debounced function.
 */
export function debounce(func: (...args: any[]) => void, delay: number): (...args: any[]) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function (this: any, ...args: any[]): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args)
      timeoutId = null
    }, delay)
  }
}
