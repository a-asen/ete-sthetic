import { useEffect, useRef, useState } from 'react'

interface Props {
  // Source image as a data: URL or http(s):// URL (anything an
  // `<img>` can load). The parent reads the file via FileReader and
  // passes the resulting `data:` URL.
  imageUrl: string
  // Called with the cropped square as a `data:image/jpeg;base64,...` URL
  // (256×256, 0.85 quality). Parent stores it on the vCard's `photo`.
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}

// Output dimensions for the cropped image — small enough to round-trip
// through etebase without bloating the vCard payload, large enough that
// the existing 36px avatar isn't pixellated at HiDPI.
const OUTPUT_SIZE = 256
// On-screen square crop preview. The same `scale` + `offsetX/Y`
// transform applied here is replayed at OUTPUT_SIZE on confirm — so
// what the user sees inside the green box is exactly what gets saved.
const PREVIEW_SIZE = 280
const MIN_SCALE = 0.2
const MAX_SCALE = 6

export function PhotoCropModal({ imageUrl, onConfirm, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  // Transform applied to the source image when drawing into the
  // preview canvas. (0,0) = the image's top-left aligns with the crop
  // square's top-left. We pan in preview-pixel units and the same
  // numbers carry through at the OUTPUT_SIZE scale on confirm.
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  // Load the image once. On load, compute the initial fit: the
  // image's shortest side fills the crop square (centred). This is
  // the "iPhone Photos crop" default — the user usually just wants
  // to confirm.
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      const minSide = Math.min(img.naturalWidth, img.naturalHeight)
      const initialScale = PREVIEW_SIZE / minSide
      const scaledW = img.naturalWidth * initialScale
      const scaledH = img.naturalHeight * initialScale
      setScale(initialScale)
      setOffset({
        x: (PREVIEW_SIZE - scaledW) / 2,
        y: (PREVIEW_SIZE - scaledH) / 2,
      })
      setImgLoaded(true)
    }
    img.onerror = () => {
      setImgLoaded(false)
    }
    img.src = imageUrl
  }, [imageUrl])

  // Re-render the preview canvas whenever the transform changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgLoaded) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    ctx.drawImage(
      img,
      offset.x,
      offset.y,
      img.naturalWidth * scale,
      img.naturalHeight * scale,
    )
  }, [scale, offset, imgLoaded])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current
    if (!start) return
    setOffset({ x: e.clientX - start.x, y: e.clientY - start.y })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    // Zoom toward the cursor so the point under the pointer stays
    // anchored — way more natural than zooming from the centre.
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor))
    if (nextScale === scale) return
    // Image point under the cursor (in source-image coords) stays
    // fixed: (cx - offsetX)/scale = (cx - nextOffsetX)/nextScale
    const ix = (cx - offset.x) / scale
    const iy = (cy - offset.y) / scale
    setScale(nextScale)
    setOffset({ x: cx - ix * nextScale, y: cy - iy * nextScale })
  }

  const onZoomSlider = (next: number) => {
    const img = imgRef.current
    if (!img) return
    const cx = PREVIEW_SIZE / 2
    const cy = PREVIEW_SIZE / 2
    const ix = (cx - offset.x) / scale
    const iy = (cy - offset.y) / scale
    setScale(next)
    setOffset({ x: cx - ix * next, y: cy - iy * next })
  }

  const confirm = () => {
    const img = imgRef.current
    if (!img) return
    // The preview canvas already shows what we want — scale the
    // transform up to OUTPUT_SIZE and replay it onto an offscreen
    // canvas so the JPEG output matches the preview exactly.
    const out = document.createElement('canvas')
    out.width = OUTPUT_SIZE
    out.height = OUTPUT_SIZE
    const ctx = out.getContext('2d')
    if (!ctx) return
    const k = OUTPUT_SIZE / PREVIEW_SIZE
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    ctx.drawImage(
      img,
      offset.x * k,
      offset.y * k,
      img.naturalWidth * scale * k,
      img.naturalHeight * scale * k,
    )
    const dataUrl = out.toDataURL('image/jpeg', 0.85)
    onConfirm(dataUrl)
  }

  // Esc cancels, Enter confirms.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // confirm closes over current scale/offset — re-bind whenever those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, offset, imgLoaded])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop photo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="flex flex-col items-stretch overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">Crop photo</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              className="block cursor-grab touch-none rounded-md bg-black active:cursor-grabbing"
            />
            {/* Subtle ring to mark the crop square. The canvas itself
                IS the crop square, but the outline gives it visual
                weight. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-accent/70"
            />
            {!imgLoaded && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-faint">
                Loading…
              </div>
            )}
          </div>
          <div className="flex w-full items-center gap-2 text-xs text-text-muted">
            <span aria-hidden>−</span>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.01}
              value={scale}
              onChange={(e) => onZoomSlider(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 accent-current"
            />
            <span aria-hidden>+</span>
          </div>
          <p className="text-[11px] text-text-faint">
            Drag to pan · Scroll or use the slider to zoom
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!imgLoaded}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Use photo
          </button>
        </div>
      </div>
    </div>
  )
}
