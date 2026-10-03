/** A signal that counts its live 'abort' listeners. */
export function countingSignal() {
  const controller = new AbortController()
  const signal = controller.signal
  const live = new Set<unknown>()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = ((type: string, listener: any, options?: any) => {
    if (type === 'abort') live.add(listener)
    add(type, listener, options)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((type: string, listener: any, options?: any) => {
    if (type === 'abort') live.delete(listener)
    remove(type, listener, options)
  }) as typeof signal.removeEventListener
  return { controller, signal, listeners: () => live.size }
}
