// Anonymous usage counts with PostHog: which pages people open, and how big the shoots are.
// No cookies or local storage, no session replay, no autocapture, and never a photo, file name or
// anything from the analysis. Events go to /ingest on this site (see netlify.toml), and the
// no-external build never loads outside scripts, so the strict Content-Security-Policy still holds.
import posthog from 'posthog-js/dist/module.no-external'

// The project key is a public, write-only key that is meant to ship in browser code.
const KEY = import.meta.env.VITE_POSTHOG_KEY ?? 'phc_rbY43DGyamjDENAT29x6QMnqd5Jmb9a9VkpZEppAbLRE'

let ready = false

export function initAnalytics(): void {
  if (ready || !import.meta.env.PROD || !KEY || navigator.webdriver) return
  posthog.init(KEY, {
    api_host: '/ingest',
    persistence: 'memory',
    person_profiles: 'never',
    autocapture: false,
    capture_pageview: 'history_change',
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_flags: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_external_dependency_loading: true,
    ip: false,
    property_denylist: ['$referrer', '$initial_referrer'],
  })
  ready = true
}

type Events = {
  shoot_culled: { photos: number; failed: number; moments: number; sample: boolean; seconds: number }
  shoot_exported: { job: 'ratings' | 'copy' | 'zip'; photos: number; ok: boolean }
}

export function track<E extends keyof Events>(event: E, props: Events[E]): void {
  if (!ready) return
  try {
    posthog.capture(event, props)
  } catch {
    // Analytics must never break the app.
  }
}

/** Rounds counts so events describe the size of a shoot, not the exact shoot. */
export function bucket(n: number): number {
  if (n < 10) return n
  if (n < 100) return Math.round(n / 10) * 10
  return Math.round(n / 100) * 100
}
