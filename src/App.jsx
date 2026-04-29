import { useState, useEffect, useRef } from 'react'
import { api, setToken } from './api'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import { LayoutDashboard, Receipt, Settings as SettingsIcon, LogOut } from 'lucide-react'
import './index.css'

const CLIENT_ID = '1047002583869-88qg66d397r239kmj6ffr1gfgqjg4vc6.apps.googleusercontent.com'
const SESSION_KEY = 'expense_session'
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24 hours

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const { user, token, lastActive } = JSON.parse(raw)
    if (Date.now() - lastActive > SESSION_TTL) { localStorage.removeItem(SESSION_KEY); return null }
    setToken(token)
    return user
  } catch { return null }
}

function saveSession(user, token) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token, lastActive: Date.now() }))
}

function clearSession() { localStorage.removeItem(SESSION_KEY) }

function touchSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    data.lastActive = Date.now()
    localStorage.setItem(SESSION_KEY, JSON.stringify(data))
  } catch {}
}

export default function App() {
  const [user, setUser] = useState(() => loadSession())
  const [page, setPage] = useState('dashboard')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const loginRef = useRef()

  // Touch session on any user activity
  useEffect(() => {
    const touch = () => touchSession()
    window.addEventListener('click', touch)
    window.addEventListener('keydown', touch)
    return () => { window.removeEventListener('click', touch); window.removeEventListener('keydown', touch) }
  }, [])

  loginRef.current = async (response) => {
    try {
      setToken(response.credential)
      const u = await api('/auth', { method: 'POST' })
      setUser(u)
      saveSession(u, response.credential)
    } catch (e) { console.error('Login failed:', e) }
  }

  useEffect(() => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => {
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => loginRef.current(r) })
      window.google.accounts.id.renderButton(document.getElementById('g-btn'), { theme: 'outline', size: 'large', width: 300 })
    }
    document.body.appendChild(s)
  }, [])

  const logout = () => { setUser(null); setToken(null); clearSession() }

  if (!user) return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md">
        <div className="text-5xl mb-4">💰</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Expense Intelligence</h1>
        <p className="text-gray-500 mb-6">Track, analyze, and optimize your spending</p>
        <div id="g-btn" className="flex justify-center"></div>
      </div>
    </div>
  )

  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-3 sm:px-6 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <h1 className="text-base sm:text-lg font-bold text-indigo-600">💰 <span className="hidden sm:inline">Expense Intelligence</span><span className="sm:hidden">ExpenseIQ</span></h1>
          <div className="flex items-center gap-2 sm:gap-4">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm w-32 sm:w-auto" />
            <img src={user.picture} alt="" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full" referrerPolicy="no-referrer" />
            <span className="text-sm text-gray-700 hidden md:inline">{user.name}</span>
            <button onClick={logout} className="p-1.5 text-gray-400 hover:text-red-500"><LogOut size={16} /></button>
          </div>
        </div>
        {/* Nav — bottom row on mobile */}
        <nav className="flex gap-1 mt-2 sm:mt-0 overflow-x-auto">
          {nav.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${page === n.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <n.icon size={14} />{n.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Page content */}
      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        {page === 'dashboard' && <Dashboard month={month} />}
        {page === 'expenses' && <Expenses month={month} />}
        {page === 'settings' && <Settings month={month} />}
      </main>
    </div>
  )
}
