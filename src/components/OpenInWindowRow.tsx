import { useState } from 'react'
import { openModuleWindow } from '../services/moduleWindow'

// "Open <module> in a new window" row, shared by the three module
// settings popovers. Fires the openModuleWindow Rust command, which
// creates (or focuses) a single-module OS window. See moduleWindow.ts
// for the cross-window model. Surfaces a transient error string inline
// if the command rejects.
//
// `module` is the module to pop out; `label` is the full button label
// (e.g. "Open Tasks in new window").
export function OpenInWindowRow({
  module,
  label,
}: {
  module: 'tasks' | 'calendar' | 'contacts'
  label: string
}) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => {
          setErr(null)
          openModuleWindow(module).catch((e: unknown) => {
            setErr(e instanceof Error ? e.message : String(e))
          })
        }}
        className="block w-full rounded-md border border-border px-3 py-1.5 text-left text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        {label}
      </button>
      {err && (
        <p className="mt-1 text-[10px] text-danger">{err}</p>
      )}
    </div>
  )
}