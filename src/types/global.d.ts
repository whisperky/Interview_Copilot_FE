export {}

declare global {
  interface DesktopAudioChunk {
    payload: string
    byteLength: number
    sequence: number
    sampleRate: number
    mode: string
  }

  interface DesktopAudioStatus {
    mode: string
    sampleRate: number
    chunkMs: number
    warning?: string
    ok?: boolean
  }

  interface Window {
    desktop: {
      setAlwaysOnTop: (value: boolean) => Promise<boolean>
      setOpacity: (value: number) => Promise<number | false>
      minimize: () => Promise<boolean>
      close: () => Promise<boolean>
      startAudioStream: () => Promise<DesktopAudioStatus>
      stopAudioStream: () => Promise<DesktopAudioStatus>
      getAudioStatus: () => Promise<DesktopAudioStatus>
      onAudioChunk: (callback: (chunk: DesktopAudioChunk) => void) => () => void
    }
  }
}
