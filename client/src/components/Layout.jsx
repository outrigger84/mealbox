import { NavLink } from 'react-router-dom'
import { Home, Package, CalendarDays, Settings2, UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export default function Layout({ children }) {
  return (
    <div className="flex flex-col min-h-screen bg-background md:flex-row">
      <aside className="hidden md:flex md:flex-col md:w-56 bg-slate-900 text-slate-100 shrink-0">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-700">
          <UtensilsCrossed className="w-6 h-6 text-orange-400" />
          <span className="font-semibold text-base tracking-tight">Mealbox</span>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-orange-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="flex md:hidden items-center gap-2 px-4 py-3 border-b bg-white shrink-0">
        <UtensilsCrossed className="w-5 h-5 text-orange-600" />
        <span className="font-semibold text-sm">Mealbox</span>
      </header>

      <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">
        {children}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 flex md:hidden bg-white border-t">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium',
              isActive ? 'text-orange-600' : 'text-slate-500'
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
