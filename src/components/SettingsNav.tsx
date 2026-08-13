// Shared building blocks for the drill-down settings popovers
// (tasks / contacts / calendar). Each popover holds its own `pane`
// state machine; these helpers render the root nav rows and the
// per-pane back-button header.

// Drill-in entry in the root navigator. Mirrors the SettingsSection
// header look (uppercase label + chevron) but the click drills *in*
// rather than collapses.
export function NavRow({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text transition-colors hover:bg-surface-2"
    >
      <span>{label}</span>
      <span aria-hidden className="text-[10px] text-text-faint">
        ▸
      </span>
    </button>
  )
}

// Header strip rendered at the top of every drilled-in pane. Left
// side is a back button (◂ Settings) that returns to the root; right
// side carries the pane's own title.
export function PaneHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-2 pb-1.5 pt-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        aria-label="Back to settings"
      >
        <span aria-hidden>◂</span>
        <span>Settings</span>
      </button>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        {title}
      </p>
    </div>
  )
}
