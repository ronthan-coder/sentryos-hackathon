'use client'

import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from 'react'
import { WindowState } from './types'
import * as Sentry from '@sentry/nextjs'

interface WindowManagerContextType {
  windows: WindowState[]
  openWindow: (window: Omit<WindowState, 'zIndex' | 'isFocused'>) => void
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  focusWindow: (id: string) => void
  updateWindowPosition: (id: string, x: number, y: number) => void
  updateWindowSize: (id: string, width: number, height: number) => void
  topZIndex: number
}

const WindowManagerContext = createContext<WindowManagerContextType | null>(null)

export function useWindowManager() {
  const context = useContext(WindowManagerContext)
  if (!context) {
    throw new Error('useWindowManager must be used within WindowManagerProvider')
  }
  return context
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [topZIndex, setTopZIndex] = useState(100)

  // Track window metrics
  useEffect(() => {
    Sentry.metrics.gauge('window.active.count', windows.length)
    Sentry.metrics.gauge('window.minimized.count', windows.filter(w => w.isMinimized).length)
  }, [windows])

  const openWindow = useCallback((window: Omit<WindowState, 'zIndex' | 'isFocused'>) => {
    Sentry.logger.info('Window opened', {
      window_id: window.id,
      window_title: window.title,
      operation_type: 'open',
    })
    Sentry.metrics.increment('window.opened', {
      window_id: window.id,
    })

    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => {
        const existing = prev.find(w => w.id === window.id)
        if (existing) {
          if (existing.isMinimized) {
            return prev.map(w =>
              w.id === window.id
                ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
                : { ...w, isFocused: false }
            )
          }
          return prev.map(w =>
            w.id === window.id
              ? { ...w, isFocused: true, zIndex: newZ }
              : { ...w, isFocused: false }
          )
        }
        return [
          ...prev.map(w => ({ ...w, isFocused: false })),
          { ...window, zIndex: newZ, isFocused: true }
        ]
      })
      return newZ
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    Sentry.logger.info('Window closed', {
      window_id: id,
      operation_type: 'close',
    })
    Sentry.metrics.increment('window.closed', {
      window_id: id,
    })
    setWindows(prev => prev.filter(w => w.id !== id))
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    Sentry.logger.info('Window minimized', {
      window_id: id,
      operation_type: 'minimize',
    })
    Sentry.metrics.increment('window.minimized', {
      window_id: id,
    })
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
    ))
  }, [])

  const maximizeWindow = useCallback((id: string) => {
    Sentry.logger.info('Window maximize toggled', {
      window_id: id,
      operation_type: 'maximize',
    })
    Sentry.metrics.increment('window.maximized', {
      window_id: id,
    })
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
    ))
  }, [])

  const restoreWindow = useCallback((id: string) => {
    Sentry.logger.info('Window restored', {
      window_id: id,
      operation_type: 'restore',
    })
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const focusWindow = useCallback((id: string) => {
    Sentry.logger.debug('Window focused', {
      window_id: id,
      operation_type: 'focus',
    })
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    Sentry.logger.trace('Window position updated', {
      window_id: id,
      x,
      y,
      operation_type: 'position',
    })
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, x, y } : w
    ))
  }, [])

  const updateWindowSize = useCallback((id: string, width: number, height: number) => {
    Sentry.logger.trace('Window size updated', {
      window_id: id,
      width,
      height,
      operation_type: 'size',
    })
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, width, height } : w
    ))
  }, [])

  return (
    <WindowManagerContext.Provider value={{
      windows,
      openWindow,
      closeWindow,
      minimizeWindow,
      maximizeWindow,
      restoreWindow,
      focusWindow,
      updateWindowPosition,
      updateWindowSize,
      topZIndex
    }}>
      {children}
    </WindowManagerContext.Provider>
  )
}
