import { useState, useEffect, useRef } from 'react'
import { api, uploadFile } from '../api'
import { Plus, Trash2, Pencil, Upload, X, Check, Mail, Loader2 } from 'lucide-react'

const CATEGORIES = ['Dairy', 'Vegetables', 'Household', 'Personal Care', 'Frozen Food', 'Grocery / Spices', 'Transport', 'Bills', 'Entertainment', 'Health', 'Other']
const CAT_COLORS = { Dairy:'#4f46e5', Vegetables:'#10b981', Household:'#f59e0b', 'Personal Care':'#ec4899', 'Frozen Food':'#06b6d4', 'Grocery / Spices':'#f97316', Transport:'#8b5cf6', Bills:'#ef4444', Entertainment:'#a855f6', Health:'#14b8a6', Other:'#78716c' }

const empty = { description: '', amount: '', category: 'Other', date: new Date().toISOString().split('T')[0], product_name: '', quantity: 1, size: '', mrp: '' }

export default function Expenses({ month, getGmailToken }) {
  const [expenses, setExpenses] = useState([])
  const [form, setForm] = useState({ ...empty })
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [uploadItems, setUploadItems] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [catLoading, setCatLoading] = useState(false)
  const fileRef = useRef()
  // Email sync
  const [syncing, setSyncing] = useState(false)
  const [syncProvider, setSyncProvider] = useState(null)
  const [syncItems, setSyncItems] = useState(null)
  const [syncError, setSyncError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [syncedProviders, setSyncedProviders] = useState([])

  const load = () => api(`/expenses?month=${month}`).then(setExpenses).catch(() => {})
  useEffect(() => { load() }, [month])

  useEffect(() => {
    api('/sync-status').then(d => setSyncedProviders(d.synced || [])).catch(() => {})
  }, [])

  // Smart categorization — auto-classify when product name changes
  const handleProductChange = async (val) => {
    setForm(f => ({ ...f, product_name: val, description: val }))
    if (val.length < 3) return
    setCatLoading(true)
    try {
      const { category } = await api('/categorize', { method: 'POST', body: JSON.stringify({ product_name: val }) })
      setForm(f => ({ ...f, category }))
    } catch {} finally { setCatLoading(false) }
  }

  const save = async (e) => {
    e.preventDefault()
    const body = { ...form, amount: parseFloat(form.amount), mrp: form.mrp ? parseFloat(form.mrp) : parseFloat(form.amount), quantity: parseFloat(form.quantity) || 1 }
    if (editing) {
      await api(`/expenses/${editing}`, { method: 'PUT', body: JSON.stringify(body) })
    } else {
      await api('/expenses', { method: 'POST', body: JSON.stringify(body) })
    }
    setForm({ ...empty }); setEditing(null); setShowForm(false); load()
  }

  const del = async (id) => { await api(`/expenses/${id}`, { method: 'DELETE' }); load() }

  const edit = (exp) => {
    setForm({ description: exp.description, amount: exp.amount, category: exp.category, date: exp.date?.slice(0, 10), product_name: exp.product_name || exp.description, quantity: exp.quantity || 1, size: exp.size || '', mrp: exp.mrp || '' })
    setEditing(exp.id); setShowForm(true)
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const { items } = await uploadFile(file)
      setUploadItems(items.length ? items : null)
      if (!items.length) alert('No items found in file.')
    } catch (err) { alert('Upload failed: ' + err.message) }
    finally { setUploading(false); fileRef.current.value = '' }
  }

  const confirmUpload = async () => {
    await api('/expenses/bulk', { method: 'POST', body: JSON.stringify({ items: uploadItems }) })
    setUploadItems(null); load()
  }

  const syncProvider_ = async (name) => {
    const needsBulk = !syncedProviders.includes(name)
    if (needsBulk) return syncAllMonths(name)
    setSyncing(true); setSyncProvider(name); setSyncError(''); setSyncItems(null); setImportDone(false)
    try {
      const token = await getGmailToken()
      const data = await api(`/sync/${name}`, { method: 'POST', body: JSON.stringify({ gmail_token: token, month }) })
      setSyncItems(data.items || [])
    } catch (err) { setSyncError(err.message || 'Failed to sync') }
    setSyncing(false)
  }

  const importSyncItems = async () => {
    if (!syncItems?.length) return
    setImporting(true)
    try {
      await api('/expenses/bulk', { method: 'POST', body: JSON.stringify({ items: syncItems }) })
      setImportDone(true); setSyncItems(null); load()
    } catch (err) { setSyncError('Import failed: ' + err.message) }
    setImporting(false)
  }

  const syncAllMonths = async (name) => {
    setSyncing(true); setSyncProvider(name); setSyncError(''); setSyncItems(null); setImportDone(false)
    try {
      const token = await getGmailToken()
      const now = new Date()
      const months = []
      for (let y = 2025, m = 1; ; m++) {
        if (m > 12) { m = 1; y++ }
        months.push(`${y}-${String(m).padStart(2, '0')}`)
        if (y === now.getFullYear() && m === now.getMonth() + 1) break
      }
      let totalImported = 0
      for (let i = 0; i < months.length; i++) {
        setBulkProgress({ current: i + 1, total: months.length, month: months[i], imported: totalImported })
        const data = await api(`/sync/${name}`, { method: 'POST', body: JSON.stringify({ gmail_token: token, month: months[i] }) })
        if (data.items?.length) {
          await api('/expenses/bulk', { method: 'POST', body: JSON.stringify({ items: data.items }) })
          totalImported += data.items.length
        }
      }
      setBulkProgress(null); setImportDone(true); load()
      setSyncedProviders(p => [...p, name])
      await api('/sync-status', { method: 'POST', body: JSON.stringify({ provider: name }) })
    } catch (err) { setSyncError(err.message || 'Bulk sync failed') }
    setSyncing(false); setBulkProgress(null)
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg sm:text-xl font-bold text-gray-800">Expenses — {month}</h2>
        <div className="flex gap-2 flex-wrap">
          {[['swiggy', '🍔 Swiggy', 'bg-orange-500 hover:bg-orange-600'], ['zepto', '⚡ Zepto', 'bg-purple-500 hover:bg-purple-600']].map(([key, label, color]) => (
            <button key={key} onClick={() => syncProvider_(key)} disabled={syncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white ${syncing ? 'opacity-50' : color}`}>
              {syncing && syncProvider === key
                ? <><Loader2 size={16} className="animate-spin" />{bulkProgress ? `${bulkProgress.month} (${bulkProgress.current}/${bulkProgress.total})` : 'Syncing...'}</>
                : label}
            </button>
          ))}
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${uploading ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            <Upload size={16} />{uploading ? 'Processing...' : 'Upload Receipt'}
            <input type="file" ref={fileRef} accept="image/*,.pdf,.xlsx,.xls,.csv" onChange={handleUpload} hidden disabled={uploading} />
          </label>
          <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ ...empty }) }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus size={16} />Add Expense
          </button>
        </div>
      </div>

      {/* Upload Preview */}
      {uploadItems && (
        <div className="bg-white rounded-xl p-5 border-2 border-cyan-400 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">📋 Extracted Items ({uploadItems.length})</h3>
            <div className="flex gap-2">
              <button onClick={confirmUpload} className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm"><Check size={14} />Add All</button>
              <button onClick={() => setUploadItems(null)} className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm"><X size={14} />Cancel</button>
            </div>
          </div>
          <div className="space-y-2">
            {uploadItems.map((item, i) => (
              <div key={i} className="flex gap-2 items-center text-sm">
                <input value={item.description} onChange={e => { const u = [...uploadItems]; u[i] = { ...u[i], description: e.target.value }; setUploadItems(u) }}
                  className="flex-2 border rounded-lg px-2 py-1.5" />
                <input type="number" value={item.amount} onChange={e => { const u = [...uploadItems]; u[i] = { ...u[i], amount: parseFloat(e.target.value) || 0 }; setUploadItems(u) }}
                  className="w-20 border rounded-lg px-2 py-1.5" />
                <select value={item.category} onChange={e => { const u = [...uploadItems]; u[i] = { ...u[i], category: e.target.value }; setUploadItems(u) }}
                  className="border rounded-lg px-2 py-1.5">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <button onClick={() => setUploadItems(uploadItems.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><X size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Swiggy Sync Results */}
      {syncError && <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">❌ {syncError}</div>}
      {importDone && <div className="bg-green-50 rounded-xl p-4 text-sm text-green-700">✅ Swiggy orders imported!</div>}
      {bulkProgress && <div className="bg-orange-50 rounded-xl p-4 text-sm text-orange-700">📦 Syncing {bulkProgress.month} ({bulkProgress.current}/{bulkProgress.total}) — {bulkProgress.imported} items imported so far</div>}
      {syncItems && (
        syncItems.length === 0
          ? <div className="bg-yellow-50 rounded-xl p-4 text-sm text-yellow-700">No Swiggy orders found for {month}.</div>
          : <div className="bg-white rounded-xl p-5 border-2 border-orange-400 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">🍔 Swiggy Orders ({syncItems.length}) — ₹{syncItems.reduce((s, i) => s + i.amount, 0).toLocaleString('en-IN')}</h3>
                <div className="flex gap-2">
                  <button onClick={importSyncItems} disabled={importing} className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm">
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{importing ? 'Importing...' : 'Add All'}
                  </button>
                  <button onClick={() => setSyncItems(null)} className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm"><X size={14} />Cancel</button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {syncItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{item.description}</div>
                      <div className="text-xs text-gray-500">{item.date}</div>
                    </div>
                    <div className="text-sm font-semibold text-gray-800">₹{item.amount.toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
            </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <form onSubmit={save} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">{editing ? 'Edit Expense' : 'Add New Expense'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Product Name</label>
              <input value={form.product_name} onChange={e => handleProductChange(e.target.value)} placeholder="e.g. Paneer"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Category {catLoading && '⏳'}</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Price (₹)</label>
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="95"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">MRP (₹)</label>
              <input type="number" step="0.01" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} placeholder="105"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Size</label>
              <input value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} placeholder="500ml"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
              {editing ? 'Update' : 'Add Expense'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null) }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Expense Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="py-3 px-4 text-left text-gray-600">Date</th>
              <th className="py-3 px-4 text-left text-gray-600">Product</th>
              <th className="py-3 px-4 text-left text-gray-600">Category</th>
              <th className="py-3 px-4 text-right text-gray-600">Qty</th>
              <th className="py-3 px-4 text-right text-gray-600">Size</th>
              <th className="py-3 px-4 text-right text-gray-600">Price</th>
              <th className="py-3 px-4 text-right text-gray-600">MRP</th>
              <th className="py-3 px-4 text-right text-gray-600">Discount</th>
              <th className="py-3 px-4 text-center text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => (
              <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-600">{e.date?.slice(0, 10)}</td>
                <td className="py-2.5 px-4 font-medium text-gray-800">{e.product_name || e.description}</td>
                <td className="py-2.5 px-4">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ background: CAT_COLORS[e.category] || '#78716c' }}>{e.category}</span>
                </td>
                <td className="py-2.5 px-4 text-right">{e.quantity || 1}</td>
                <td className="py-2.5 px-4 text-right text-gray-500">{e.size || '—'}</td>
                <td className="py-2.5 px-4 text-right font-medium">₹{Number(e.amount).toLocaleString('en-IN')}</td>
                <td className="py-2.5 px-4 text-right text-gray-500">₹{Number(e.mrp || e.amount).toLocaleString('en-IN')}</td>
                <td className="py-2.5 px-4 text-right text-green-600">₹{(Number(e.mrp || e.amount) - Number(e.amount)).toLocaleString('en-IN')}</td>
                <td className="py-2.5 px-4 text-center">
                  <button onClick={() => edit(e)} className="p-1 text-gray-400 hover:text-indigo-600"><Pencil size={14} /></button>
                  <button onClick={() => del(e.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={5} className="py-3 px-4">Total ({expenses.length} items)</td>
              <td className="py-3 px-4 text-right">₹{total.toLocaleString('en-IN')}</td>
              <td className="py-3 px-4 text-right">₹{expenses.reduce((s, e) => s + Number(e.mrp || e.amount), 0).toLocaleString('en-IN')}</td>
              <td className="py-3 px-4 text-right text-green-600">₹{(expenses.reduce((s, e) => s + Number(e.mrp || e.amount), 0) - total).toLocaleString('en-IN')}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        </div>
        {expenses.length === 0 && <p className="text-center py-10 text-gray-400">No expenses for this month. Add one or upload a receipt!</p>}
      </div>
    </div>
  )
}
