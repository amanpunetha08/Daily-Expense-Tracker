import { useState, useEffect } from 'react'
import { api } from '../api'
import { Save, Wallet, Bell } from 'lucide-react'

export default function Settings({ month }) {
  const [salary, setSalary] = useState('')
  const [budget, setBudget] = useState('')
  const [saved, setSaved] = useState(false)
  const [phone, setPhone] = useState('')
  const [whatsappOptin, setWhatsappOptin] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)

  useEffect(() => {
    api(`/budget?month=${month}`).then(b => { setSalary(b.salary || ''); setBudget(b.budget || '') }).catch(() => {})
    api('/notification-settings').then(n => { setPhone(n.phone || ''); setWhatsappOptin(n.whatsapp_optin || false) }).catch(() => {})
    setSaved(false)
  }, [month])

  const saveBudget = async (e) => {
    e.preventDefault()
    await api('/budget', { method: 'POST', body: JSON.stringify({ month, salary: parseFloat(salary) || 0, budget: parseFloat(budget) || 0 }) })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const saveNotif = async (e) => {
    e.preventDefault()
    await api('/notification-settings', { method: 'POST', body: JSON.stringify({ phone: phone || null, whatsapp_optin: whatsappOptin }) })
    setNotifSaved(true); setTimeout(() => setNotifSaved(false), 2000)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Settings — {month}</h2>

      {/* Budget */}
      <form onSubmit={saveBudget} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Wallet size={20} className="text-indigo-600" />
          <h3 className="font-semibold text-gray-800">Monthly Budget</h3>
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">Monthly Salary (₹)</label>
          <input type="number" value={salary} onChange={e => setSalary(e.target.value)} placeholder="50000" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">Budget Allocation (₹)</label>
          <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="5000" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
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

      {/* WhatsApp Notifications */}
      <form onSubmit={saveNotif} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Bell size={20} className="text-green-600" />
          <h3 className="font-semibold text-gray-800">WhatsApp Reminders</h3>
        </div>
        <p className="text-sm text-gray-500">Get a daily WhatsApp reminder to log your expenses.</p>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Phone Number (with country code)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
          <p className="text-xs text-gray-400 mt-1">Include country code, e.g. +91 for India</p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={whatsappOptin} onChange={e => setWhatsappOptin(e.target.checked)}
            className="w-4 h-4 text-green-600 rounded" />
          <span className="text-sm text-gray-700">Enable daily WhatsApp reminders</span>
        </label>

        {whatsappOptin && (
          <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700 space-y-1">
            <p>📱 <strong>Important:</strong> To receive messages, you must first join the Twilio sandbox:</p>
            <p>Send <strong>"join <code>your-sandbox-code</code>"</strong> to <strong>+14155238886</strong> on WhatsApp.</p>
            <p className="text-xs text-green-600">You'll receive reminders every morning at 9 AM IST.</p>
          </div>
        )}

        <button type="submit" className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 w-full justify-center">
          <Save size={16} />{notifSaved ? '✓ Saved!' : 'Save Notification Settings'}
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
          <li>📱 WhatsApp reminders keep you on track daily</li>
        </ul>
      </div>
    </div>
  )
}
