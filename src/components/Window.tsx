import { useRef } from 'react'
import { useOS, type AppId } from '../store/os'

const MENU_H = 28
const DOCK_H = 84

type Props = { id: AppId; title: string; children: React.ReactNode; dark?: boolean; toolbar?: React.ReactNode }

export function Window({ id, title, children, dark, toolbar }: Props) {
  const win = useOS((s) => s.windows[id])!
  const focused = useOS((s) => s.focused === id)
  const { focus, closeApp, minimize, toggleMax, setRect } = useOS.getState()
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const rect = win.maximized
    ? { left: 0, top: MENU_H, width: window.innerWidth, height: window.innerHeight - MENU_H - DOCK_H }
    : { left: win.x, top: win.y, width: win.w, height: win.h }

  const onDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.traffic, button, input')) return
    if (win.maximized) return
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const x = Math.min(window.innerWidth - 80, Math.max(-win.w + 120, e.clientX - drag.current.dx))
    const y = Math.min(window.innerHeight - 60, Math.max(MENU_H, e.clientY - drag.current.dy))
    setRect(id, { x, y })
  }
  const onDragEnd = () => (drag.current = null)

  const onResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, w: win.w, h: win.h }
    const move = (ev: PointerEvent) =>
      setRect(id, { w: Math.max(320, start.w + ev.clientX - start.x), h: Math.max(200, start.h + ev.clientY - start.y) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`window ${dark ? 'dark' : ''} ${focused ? 'focused' : ''} ${win.maximized ? 'max' : ''}`}
      style={{ ...rect, zIndex: win.z, display: win.minimized ? 'none' : undefined }}
      onPointerDown={() => focus(id)}
    >
      <div className="titlebar" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onDoubleClick={() => toggleMax(id)}>
        <div className="traffic">
          <button className="tl close" aria-label="Fechar" onClick={() => closeApp(id)}>
            <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
          </button>
          <button className="tl min" aria-label="Minimizar" onClick={() => minimize(id)}>
            <svg viewBox="0 0 10 10"><path d="M2.5 5h5" /></svg>
          </button>
          <button className="tl zoom" aria-label="Maximizar" onClick={() => toggleMax(id)}>
            <svg viewBox="0 0 10 10"><path d="M3 7V3.6L6.4 7zM7 3v3.4L3.6 3z" className="fill" /></svg>
          </button>
        </div>
        <div className="title">{title}</div>
        {toolbar}
      </div>
      <div className="content">{children}</div>
      {!win.maximized && <div className="resize" onPointerDown={onResizeStart} />}
    </div>
  )
}
