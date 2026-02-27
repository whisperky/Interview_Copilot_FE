import { useMemo, useState } from 'react'
import { runProtocolSelfTest } from './lib/contracts/selfTest'

function App() {
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1)
  const hasDesktopApi = typeof window !== 'undefined' && typeof window.desktop !== 'undefined'
  const testResults = useMemo(() => runProtocolSelfTest(), [])
  const passedCount = testResults.filter((test) => test.ok).length

  const onToggleTop = async () => {
    if (!hasDesktopApi) return
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    await window.desktop.setAlwaysOnTop(next)
  }

  const onOpacity = async (value: number) => {
    if (!hasDesktopApi) return
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
            disabled={!hasDesktopApi}
            onClick={() => window.desktop.minimize()}
            type="button"
          >
            _
          </button>
          <button
            className="rounded bg-red-600 px-2 py-1 text-xs hover:bg-red-500"
            disabled={!hasDesktopApi}
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
            <input checked={alwaysOnTop} disabled={!hasDesktopApi} onChange={onToggleTop} type="checkbox" />
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
              disabled={!hasDesktopApi}
              onChange={(e) => onOpacity(Number(e.target.value))}
              step={0.01}
              type="range"
              value={opacity}
            />
          </label>
          {!hasDesktopApi && (
            <p className="mt-2 text-xs text-amber-300">
              Electron preload API is unavailable. Run with `npm run dev` to use window controls.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-zinc-400">Phase 2: Contract Self-Check</p>
            <p className="rounded bg-zinc-800 px-2 py-1">
              {passedCount}/{testResults.length} passed
            </p>
          </div>
          <ul className="space-y-1">
            {testResults.map((test) => (
              <li key={test.name}>
                <span className={test.ok ? 'text-emerald-300' : 'text-red-300'}>
                  {test.ok ? 'PASS' : 'FAIL'}
                </span>
                {' '}
                {test.name}
                <span className="text-zinc-500">
                  {' '}
                  - {test.details}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

export default App
