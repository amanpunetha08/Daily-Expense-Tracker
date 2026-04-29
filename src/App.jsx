import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import './App.css'

const API = 'http://localhost:3001/api'
const CLIENT_ID = '1047002583869-88qg66d397r239kmj6ffr1gfgqjg4vc6.apps.googleusercontent.com'
const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Other']
const COLORS = { Food:'#ff6b6b', Transport:'#4ecdc4', Shopping:'#45b7d1', Bills:'#f9ca24', Entertainment:'#a55eea', Health:'#26de81', Other:'#778ca3' }

async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...opts.headers } })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [form, setForm] = useState({ description:'', amount:'', category:'Food', date:new Date().toISOString().split('T')[0] })
  const [filter, setFilter] = useState('All')
  const loginRef = useRef()

  // Store login handler in ref so Google callback always gets latest
  loginRef.current = async (response) => {
    const idToken = response.credential
    try {
      const userData = await api('/auth', idToken, { method:'POST' })
      setToken(idToken)
      setUser(userData)
    } catch (err) {
      console.error('Login failed:', err)
    }
  }

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (res) => loginRef.current(res),
      })
      window.google.accounts.id.renderButton(document.getElementById('g-btn'), { theme:'outline', size:'large', width:300 })
    }
    document.body.appendChild(script)
  }, [])

  const loadExpenses = useCallback(async () => {
    if (!token) return
    try {
      const data = await api('/expenses', token)
      setExpenses(Array.isArray(data) ? data : [])
    } catch { setExpenses([]) }
  }, [token])

  useEffect(() => { loadExpenses() }, [loadExpenses])

  const addExpense = async (e) => {
    e.preventDefault()
    if (!form.description || !form.amount) return
    await api('/expenses', token, { method:'POST', body:JSON.stringify({ ...form, amount:parseFloat(form.amount) }) })
    setForm({ description:'', amount:'', category:'Food', date:new Date().toISOString().split('T')[0] })
    loadExpenses()
  }

  const deleteExpense = async (id) => {
    await api(`/expenses/${id}`, token, { method:'DELETE' })
    loadExpenses()
  }

  const logout = () => { setUser(null); setToken(null); setExpenses([]) }

  const filtered = filter === 'All' ? expenses : expenses.filter(e => e.category === filter)

  const analysis = useMemo(() => {
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
    const byCategory = {}
    CATEGORIES.forEach(c => { byCategory[c] = 0 })
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount) })
    const today = new Date().toISOString().split('T')[0]
    const todayTotal = expenses.filter(e => e.date === today).reduce((s, e) => s + Number(e.amount), 0)
    return { total, byCategory, todayTotal }
  }, [expenses])

  const maxCat = Math.max(...Object.values(analysis.byCategory), 1)

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>💰 Daily Expense Tracker</h1>
          <p>Sign in to track your expenses</p>
          <div id="g-btn"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>💰 Daily Expense Tracker</h1>
        <div className="user-info">
          <img src={user.picture} alt="" className="avatar" referrerPolicy="no-referrer" />
          <span>{user.name}</span>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat-card"><span className="stat-label">Today</span><span className="stat-value">₹{analysis.todayTotal.toFixed(2)}</span></div>
        <div className="stat-card"><span className="stat-label">Total</span><span className="stat-value">₹{analysis.total.toFixed(2)}</span></div>
        <div className="stat-card"><span className="stat-label">Entries</span><span className="stat-value">{expenses.length}</span></div>
      </div>

      <div className="layout">
        <div className="panel">
          <h2>Add Expense</h2>
          <form onSubmit={addExpense}>
            <input type="text" placeholder="Description" value={form.description} onChange={e => setForm({...form, description:e.target.value})} required />
            <input type="number" placeholder="Amount (₹)" step="0.01" min="0" value={form.amount} onChange={e => setForm({...form, amount:e.target.value})} required />
            <select value={form.category} onChange={e => setForm({...form, category:e.target.value})}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="date" value={form.date} onChange={e => setForm({...form, date:e.target.value})} />
            <button type="submit">Add Expense</button>
          </form>
          <h2>Category Breakdown</h2>
          <div className="chart">
            {CATEGORIES.map(c => (
              <div key={c} className="bar-row">
                <span className="bar-label">{c}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width:`${(analysis.byCategory[c]/maxCat)*100}%`, background:COLORS[c] }} /></div>
                <span className="bar-value">₹{analysis.byCategory[c].toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="list-header">
            <h2>Expenses</h2>
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option>All</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="expense-list">
            {filtered.length === 0 && <p className="empty">No expenses yet</p>}
            {filtered.map(e => (
              <div key={e.id} className="expense-item">
                <span className="cat-badge" style={{ background:COLORS[e.category] }}>{e.category}</span>
                <div className="expense-info"><strong>{e.description}</strong><small>{e.date}</small></div>
                <span className="expense-amount">₹{Number(e.amount).toFixed(2)}</span>
                <button className="del-btn" onClick={() => deleteExpense(e.id)} aria-label={`Delete ${e.description}`}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
