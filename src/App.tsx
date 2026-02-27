import { useState } from 'react'

function App() {
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1)

  const onToggleTop = async () => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    await window.desktop.setAlwaysOnTop(next)
  }

  const onOpacity = async (value: number) => {
    setOpacity(value)
    await window.desktop.setOpacity(value)
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100">
      <header className="drag-region flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="text-sm font-medium">Interview Copilot</div>
        <div className="no-drag flex gap-2">
          <button
            className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
            onClick={() => window.desktop.minimize()}
            type="button"
          >
            _
          </button>
          <button
            className="rounded bg-red-600 px-2 py-1 text-xs hover:bg-red-500"
            onClick={() => window.desktop.close()}
            type="button"
          >
            X
          </button>
        </div>
      </header>

      <main className="space-y-4 p-4">
        <section className="rounded-lg border border-zinc-800 p-3">
          <p className="mb-2 text-xs text-zinc-400">Window Controls</p>
          <label className="no-drag flex items-center justify-between text-sm">
            <span>Always on top</span>
            <input checked={alwaysOnTop} onChange={onToggleTop} type="checkbox" />
          </label>
          <label className="no-drag mt-3 block text-sm">
            <span className="mb-1 block">
              Opacity (
              {Math.round(opacity * 100)}
              %)
            </span>
            <input
              className="w-full"
              max={1}
              min={0.35}
              onChange={(e) => onOpacity(Number(e.target.value))}
              step={0.01}
              type="range"
              value={opacity}
            />
          </label>
        </section>

        <section className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
          Phase 1 shell complete. Integration panels are next.
        </section>
      </main>
    </div>
  )
}

export default App
