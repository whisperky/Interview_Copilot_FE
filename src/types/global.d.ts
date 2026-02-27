export {}

declare global {
  interface Window {
    desktop: {
      setAlwaysOnTop: (value: boolean) => Promise<boolean>
      setOpacity: (value: number) => Promise<number | false>
      minimize: () => Promise<boolean>
      close: () => Promise<boolean>
    }
  }
}
