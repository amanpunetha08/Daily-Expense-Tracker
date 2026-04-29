import { useState, useEffect } from 'react'
import { api } from '../api'
import { Save, Wallet } from 'lucide-react'

export default function Settings({ month }) {
  const [salary, setSalary] = useState('')
  const [budget, setBudget] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api(`/budget?month=${month}`).then(b => {
      setSalary(b.salary || '')
      setBudget(b.budget || '')
    }).catch(() => {})
    setSaved(false)
  }, [month])

  const save = async (e) => {
    e.preventDefault()
    await api('/budget', { method: 'POST', body: JSON.stringify({ month, salary: parseFloat(salary) || 0, budget: parseFloat(budget) || 0 }) })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Budget Settings — {month}</h2>

      <form onSubmit={save} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Wallet size={20} className="text-indigo-600" />
          <h3 className="font-semibold text-gray-800">Monthly Budget</h3>
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Monthly Salary (₹)</label>
          <input type="number" value={salary} onChange={e => setSalary(e.target.value)} placeholder="50000"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Budget Allocation (₹)</label>
          <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="5000"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
          <p className="text-xs text-gray-400 mt-1">How much you plan to spend this month</p>
        </div>

        {salary && budget && (
          <div className="bg-indigo-50 rounded-lg p-3 text-sm text-indigo-700">
            Budget is <strong>{((parseFloat(budget) / parseFloat(salary)) * 100).toFixed(1)}%</strong> of your salary.
            Saving target: <strong>₹{(parseFloat(salary) - parseFloat(budget)).toLocaleString('en-IN')}</strong>
          </div>
        )}

        <button type="submit" className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 w-full justify-center">
          <Save size={16} />{saved ? '✓ Saved!' : 'Save Budget'}
        </button>
      </form>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-3">How it works</h3>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>📊 Set your monthly salary and budget allocation</li>
          <li>📝 Add expenses manually or upload receipts</li>
          <li>📈 Dashboard shows real-time budget utilization</li>
          <li>🤖 AI generates spending insights and alerts</li>
          <li>📅 Weekly forecast tracks your spending pace</li>
        </ul>
      </div>
    </div>
  )
}
