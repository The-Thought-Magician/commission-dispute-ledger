'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'

export type PaletteRoute = { label: string; href: string; group: string }

export default function CommandPalette({ routes }: { routes: PaletteRoute[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const groups = Array.from(new Set(routes.map((r) => r.group)))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-400 hover:border-fuchsia-500/40 hover:text-slate-200"
        aria-label="Open command palette"
      >
        <span>Jump to…</span>
        <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
          ⌘K
        </kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 pt-24" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <Command label="Command palette" shouldFilter>
              <Command.Input
                autoFocus
                placeholder="Search routes…"
                className="w-full border-b border-slate-800 bg-transparent px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
              <Command.List className="max-h-96 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">No matches.</Command.Empty>
                {groups.map((group) => (
                  <Command.Group key={group} heading={group} className="mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-slate-500">
                    {routes
                      .filter((r) => r.group === group)
                      .map((r) => (
                        <Command.Item
                          key={r.href}
                          value={`${r.label} ${r.href}`}
                          onSelect={() => {
                            setOpen(false)
                            router.push(r.href)
                          }}
                          className="cursor-pointer rounded-lg px-3 py-2 text-sm text-slate-200 aria-selected:bg-fuchsia-500/15 aria-selected:text-fuchsia-300"
                        >
                          {r.label}
                        </Command.Item>
                      ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  )
}
