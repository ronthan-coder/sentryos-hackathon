'use client'

import { useRef } from 'react'
import { FileText, Folder, Terminal, Settings, MessageCircle, Car } from 'lucide-react'

interface DesktopIconProps {
  id: string
  label: string
  icon: 'file' | 'folder' | 'terminal' | 'settings' | 'document' | 'chat' | 'car'
  onDoubleClick: () => void
  selected?: boolean
  onSelect?: () => void
}

const iconMap = {
  file: FileText,
  folder: Folder,
  terminal: Terminal,
  settings: Settings,
  document: FileText,
  chat: MessageCircle,
  car: Car,
}

export function DesktopIcon({ label, icon, onDoubleClick, selected, onSelect }: DesktopIconProps) {
  const IconComponent = iconMap[icon] || FileText
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const clickCountRef = useRef(0)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    clickCountRef.current += 1
    
    if (clickCountRef.current === 1) {
      // First click - wait to see if there's a second click
      clickTimeoutRef.current = setTimeout(() => {
        // Single click - just select
        if (clickCountRef.current === 1) {
          onSelect?.()
        }
        clickCountRef.current = 0
      }, 250)
    } else if (clickCountRef.current === 2) {
      // Double click detected
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
      }
      clickCountRef.current = 0
      onSelect?.() // Also select on double click
      onDoubleClick()
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex flex-col items-center gap-1 p-2 rounded transition-colors w-20 group cursor-default select-none ${
        selected ? 'bg-[#7553ff]/20 ring-1 ring-[#7553ff]/50' : 'hover:bg-white/5'
      }`}
    >
      <div className={`p-2 rounded transition-colors ${
        selected ? 'bg-[#7553ff]/30' : 'bg-[#2a2438]/50 group-hover:bg-[#2a2438]'
      }`}>
        <IconComponent className="w-8 h-8 text-[#7553ff]" />
      </div>
      <span className="text-xs text-center text-[#e8e4f0]/80 break-words w-full leading-tight">
        {label}
      </span>
    </div>
  )
}
