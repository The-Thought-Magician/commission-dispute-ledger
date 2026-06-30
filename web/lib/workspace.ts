'use client'

// Active-workspace persistence shared across dashboard pages.
// The whole product is workspace-scoped, so we remember the caller's
// last-selected workspace in localStorage and expose tiny helpers.

const KEY = 'cdl_active_workspace'

export function getActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setActiveWorkspaceId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(KEY, id)
    else window.localStorage.removeItem(KEY)
    window.dispatchEvent(new CustomEvent('cdl:workspace-changed', { detail: id }))
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}
