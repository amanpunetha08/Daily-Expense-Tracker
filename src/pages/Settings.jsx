import { useState, useEffect } from 'react'
import { api } from '../api'
import { Save, Wallet, Bell, BellOff } from 'lucide-react'

async function getVapidKey() {
  const { publicKey } = await api('/push/vapid-key')
  return publicKey
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export default function Settings({ month }) {
  const [salary, setSalary] = useState('')
  const [budget, setBudget] = useState('')
  const [saved, setSaved] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushSupported] = useState('serviceWorker' in navigator && 'PushManager' in window)
  const [phone, setPhone] = useState('')
  const [whatsappOptin, setWhatsappOptin] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)

  useEffect(() => {
    api(`/budget?month=${month}`).then(b => { setSalary(b.salary || ''); setBudget(b.budget || '') }).catch(() => {})
    api('/notification-settings').then(n => { setPhone(n.phone || ''); setWhatsappOptin(n.whatsapp_optin || false) }).catch(() => {})
    setSaved(false)
    // Check if push is already subscribed
    if (pushSupported) {
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setPushEnabled(!!sub)).catch(() => {})
    }
  }, [month])

  const saveBudget = async (e) => {
    e.preventDefault()
    await api('/budget', { method: 'POST', body: JSON.stringify({ month, salary: parseFloat(salary) || 0, budget: parseFloat(budget) || 0 }) })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const togglePush = async () => {
    setPushLoading(true)
    try {
      if (pushEnabled) {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
        await api('/push/unsubscribe', { method: 'POST' })
        setPushEnabled(false)
      } else {
        await navigator.serviceWorker.register('/sw.js')
        const reg = await navigator.serviceWorker.ready
        const vapidKey = await getVapidKey()
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
        await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
        setPushEnabled(true)
      }
    } catch (err) {
      console.error('Push toggle error:', err)
      alert('Failed to toggle notifications. Make sure you allow notifications in your browser.')
    }
    setPushLoading(false)
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

      {/* Push Notifications */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Bell size={20} className="text-green-600" />
          <h3 className="font-semibold text-gray-800">Daily Reminders</h3>
        </div>
        <p className="text-sm text-gray-500">Get a push notification every morning to remind you to log your expenses.</p>

        {pushSupported ? (
          <>
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                {pushEnabled ? <Bell size={20} className="text-green-500" /> : <BellOff size={20} className="text-gray-400" />}
                <div>
                  <div className="text-sm font-medium text-gray-800">{pushEnabled ? 'Notifications enabled' : 'Notifications disabled'}</div>
                  <div className="text-xs text-gray-500">{pushEnabled ? 'You\'ll get a reminder at 9 AM IST daily' : 'Enable to get daily expense reminders'}</div>
                </div>
              </div>
              <button onClick={togglePush} disabled={pushLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${pushEnabled ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-600 text-white hover:bg-green-700'} ${pushLoading ? 'opacity-50' : ''}`}>
                {pushLoading ? '...' : pushEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
            {pushEnabled && (
              <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700">
                ✅ You're all set! You'll receive a daily reminder to track your expenses. Notifications work even when the app is closed.
              </div>
            )}
          </>
        ) : (
          <div className="bg-yellow-50 rounded-lg p-3 text-sm text-yellow-700">
            ⚠️ Push notifications are not supported in this browser. Try Chrome or Edge on desktop/Android.
          </div>
        )}
      </div>

      {/* WhatsApp Reminders */}
      <form onSubmit={saveNotif} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xl">💬</span>
          <h3 className="font-semibold text-gray-800">WhatsApp Reminders</h3>
        </div>
        <p className="text-sm text-gray-500">Also get reminders on WhatsApp (requires Twilio sandbox setup).</p>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">Phone Number (with country code)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={whatsappOptin} onChange={e => setWhatsappOptin(e.target.checked)} className="w-4 h-4 text-green-600 rounded" />
          <span className="text-sm text-gray-700">Enable WhatsApp reminders</span>
        </label>
        {whatsappOptin && (
          <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700 space-y-1">
            <p>📱 <strong>One-time setup:</strong> Send <strong>"join"</strong> followed by your sandbox code to <strong>+14155238886</strong> on WhatsApp to activate.</p>
          </div>
        )}
        <button type="submit" className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 w-full justify-center">
          <Save size={16} />{notifSaved ? '✓ Saved!' : 'Save WhatsApp Settings'}
        </button>
      </form>

      {/* Swiggy sync moved to Expenses page */}

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-3">How it works</h3>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>📊 Set your monthly salary and budget allocation</li>
          <li>📝 Add expenses manually or upload receipts</li>
          <li>📈 Dashboard shows real-time budget utilization</li>
          <li>🤖 AI generates spending insights and alerts</li>
          <li>📅 Weekly forecast tracks your spending pace</li>
          <li>🔔 Push notifications remind you daily</li>
        </ul>
      </div>
    </div>
  )
}
