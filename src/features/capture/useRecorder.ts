import { useCallback, useRef, useState } from 'react'
import { encodeWav16k } from './wav'

export type RecState = 'idle' | 'starting' | 'recording' | 'denied' | 'unsupported' | 'error'
const MAX_SECONDS = 60

export interface Recording {
  base64: string
  seconds: number
}

/**
 * Microphone capture -> 16 kHz mono 16-bit WAV (base64). WAV is used because
 * it is a lossless, widely supported audio input for Gemini.
 */
export function useRecorder() {
  const [state, setState] = useState<RecState>('idle')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const startRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const wantStop = useRef(false)
  const resolver = useRef<((v: Recording | null) => void) | null>(null)
  const busy = useRef(false)

  const cleanup = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    void ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current = null
  }

  const finish = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) {
      wantStop.current = true // still starting: stop as soon as it is up
      return
    }
    const rate = ctx.sampleRate
    const chunks = chunksRef.current
    const dur = (performance.now() - startRef.current) / 1000
    cleanup()
    busy.current = false
    setLevel(0)
    setState('idle')
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const merged = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      merged.set(c, off)
      off += c.length
    }
    const out = total > rate * 0.5 ? { base64: encodeWav16k(merged, rate), seconds: dur } : null
    resolver.current?.(out)
    resolver.current = null
  }, [])

  const start = useCallback(async () => {
    if (busy.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setState('unsupported')
      return
    }
    busy.current = true
    wantStop.current = false
    setError(null)
    setState('starting')
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const ctx = new AudioContext()
      await ctx.audioWorklet.addModule('/pcm-worklet.js')
      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pcm-capture')
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        chunksRef.current.push(e.data)
        let sum = 0
        for (let i = 0; i < e.data.length; i++) sum += e.data[i] * e.data[i]
        setLevel(Math.min(1, Math.sqrt(sum / e.data.length) * 6))
        setSeconds((performance.now() - startRef.current) / 1000)
      }
      src.connect(node)
      ctxRef.current = ctx
      startRef.current = performance.now()
      setSeconds(0)
      setState('recording')
      timerRef.current = window.setTimeout(finish, MAX_SECONDS * 1000)
      if (wantStop.current) finish()
    } catch (e) {
      cleanup()
      busy.current = false
      const name = (e as DOMException).name
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied')
      else {
        setState('error')
        setError((e as Error).message)
      }
      resolver.current?.(null)
      resolver.current = null
    }
  }, [finish])

  /** Stop and resolve with the recording (null if shorter than 0.5 s). */
  const stop = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        if (!busy.current) return resolve(null)
        resolver.current = resolve
        finish()
      }),
    [finish],
  )

  return { state, level, seconds, error, start, stop, maxSeconds: MAX_SECONDS }
}
