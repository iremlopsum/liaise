// The browser, OS and device as categories. The raw User-Agent never leaves the page.
import type { Browser, Os, Device } from './schema'

export const BOT = /bot|crawl|spider|slurp|headless|lighthouse/i

export function browserOf(ua: string): Browser {
  if (/Edg\//.test(ua)) return 'edge'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other'
}
export function osOf(ua: string): Os {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux|CrOS/.test(ua)) return 'linux'
  return 'other'
}
/** iPadOS sends a Mac User-Agent: a touch screen says it's a tablet. */
export function deviceOf(width: number, ua: string, touch: boolean): Device {
  if (/iPad|Tablet/.test(ua) || (touch && /Macintosh/.test(ua))) return 'tablet'
  if (/Mobi|iPhone/.test(ua) || width < 600) return 'phone'
  if (touch && width < 1100) return 'tablet'
  return 'desktop'
}
