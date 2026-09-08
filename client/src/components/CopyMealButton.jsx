import { useState } from 'react'
import { Clipboard, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

// For pasting into MyFitnessPal's food search/log.
export default function CopyMealButton({ name, className }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(`Simmer - ${name}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={cn('flex items-center justify-center w-9 h-9 rounded-full bg-muted text-muted-foreground shrink-0', className)}
      aria-label="Copy for MyFitnessPal"
    >
      {copied ? <ClipboardCheck className="w-4 h-4 text-emerald-600" /> : <Clipboard className="w-4 h-4" />}
    </button>
  )
}
