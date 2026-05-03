import { useState, useEffect, useRef } from 'react'
import { api, setToken } from './api'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import { LayoutDashboard, Receipt, Settings as SettingsIcon, LogOut, Loader2 } from 'lucide-react'
import './index.css'

const CLIENT_ID = '1047002583869-88qg66d397r239kmj6ffr1gfgqjg4vc6.apps.googleusercontent.com'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const SESSION_KEY = 'expense_session'
const SESSION_TTL = 24 * 60 * 60 * 1000

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
function saveSession(user, token) { localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token, lastActive: Date.now() })) }
function clearSession() { localStorage.removeItem(SESSION_KEY) }
function touchSession() {
  try { const d = JSON.parse(localStorage.getItem(SESSION_KEY)); if (d) { d.lastActive = Date.now(); localStorage.setItem(SESSION_KEY, JSON.stringify(d)) } } catch {}
}

export default function App() {
  const [user, setUser] = useState(() => loadSession())
  const [page, setPage] = useState('dashboard')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)
  const [authMode, setAuthMode] = useState('login') // login | register
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const loginRef = useRef()
  const gmailTokenClientRef = useRef(null)
  const gmailTokenCache = useRef(null)

  // Gmail token (cached after first consent)
  const getGmailToken = () => {
    if (gmailTokenCache.current) return Promise.resolve(gmailTokenCache.current)
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error('Google OAuth2 not loaded'))
      if (!gmailTokenClientRef.current) {
        gmailTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: GMAIL_SCOPE,
          callback: (resp) => {
            if (resp.error) return gmailTokenClientRef._reject(resp.error)
            gmailTokenCache.current = resp.access_token
            gmailTokenClientRef._resolve(resp.access_token)
          }
        })
      }
      gmailTokenClientRef._resolve = resolve
      gmailTokenClientRef._reject = reject
      gmailTokenClientRef.current.requestAccessToken()
    })
  }

  useEffect(() => {
    const touch = () => touchSession()
    window.addEventListener('click', touch)
    window.addEventListener('keydown', touch)
    return () => { window.removeEventListener('click', touch); window.removeEventListener('keydown', touch) }
  }, [])

  loginRef.current = async (response) => {
    setLoggingIn(true)
    setLoginError('')
    try {
      setToken(response.credential)
      const u = await api('/auth', { method: 'POST' })
      saveSession(u, response.credential)
      setUser(u)
    } catch (e) {
      setLoginError('Sign-in failed. Please try again.')
      setToken(null)
    }
    setLoggingIn(false)
  }

  useEffect(() => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => {
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => loginRef.current(r) })
      setGsiReady(true)
    }
    document.body.appendChild(s)
  }, [])

  // Re-render Google button whenever login screen is shown
  useEffect(() => {
    if (!user && gsiReady) {
      setTimeout(() => {
        const el = document.getElementById('g-btn')
        if (el) window.google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', width: 300, text: 'continue_with', shape: 'pill' })
      }, 50)
    }
  }, [user, gsiReady])

  const logout = () => { setUser(null); setToken(null); clearSession() }

  const handleEmailAuth = async (e) => {
    e.preventDefault()
    setLoggingIn(true); setLoginError('')
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login'
      const body = authMode === 'register' ? { email, password, name } : { email, password }
      const res = await fetch(`${import.meta.env.DEV ? 'http://localhost:8000/api' : 'https://daily-expense-backend-4clh.onrender.com/api'}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Auth failed')
      setToken(data.token)
      saveSession(data, data.token)
      setUser(data)
    } catch (err) { setLoginError(err.message) }
    setLoggingIn(false)
  }

  // ─── Login screen ───
  if (!user) return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 sm:p-10 rounded-2xl shadow-xl text-center max-w-sm w-full">
        <div className="text-5xl mb-3">💰</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Expense Intelligence</h1>
        <p className="text-gray-400 text-sm mb-6">Track, analyze, and optimize your spending</p>

        {loggingIn && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={32} className="animate-spin text-indigo-500" />
            <p className="text-sm text-gray-500">Signing you in...</p>
          </div>
        )}

        <div className={loggingIn ? 'hidden' : ''}>
          {/* Email/Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3 text-left mb-5">
            {authMode === 'register' && (
              <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            )}
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit"
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
              {authMode === 'register' ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-gray-400 mb-1">
            {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setLoginError('') }}
              className="text-indigo-600 font-medium hover:underline">
              {authMode === 'login' ? 'Sign Up' : 'Sign In'}
            </button>
          </p>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or continue with</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Google */}
          <div id="g-btn" className="flex justify-center"></div>
          {!gsiReady && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 size={16} className="animate-spin text-gray-300" />
              <span className="text-xs text-gray-400">Loading Google...</span>
            </div>
          )}
        </div>

        {loginError && <div className="mt-4 bg-red-50 text-red-600 text-sm rounded-lg p-3">{loginError}</div>}
      </div>
    </div>
  )

  // ─── Main app ───
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
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
        <nav className="flex gap-1 mt-2 sm:mt-0 overflow-x-auto">
          {nav.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${page === n.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <n.icon size={14} />{n.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        {page === 'dashboard' && <Dashboard month={month} />}
        {page === 'expenses' && <Expenses month={month} getGmailToken={getGmailToken} />}
        {page === 'settings' && <Settings month={month} />}
      </main>
    </div>
  )
}
