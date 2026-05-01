import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { OAuth2Client } from 'google-auth-library'
import multer from 'multer'
import XLSX from 'xlsx'
import fs from 'fs'

const app = express()
const gClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } })

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

const CATEGORIES = ['Dairy', 'Vegetables', 'Household', 'Personal Care', 'Frozen Food', 'Grocery / Spices', 'Transport', 'Bills', 'Entertainment', 'Health', 'Other']

// ─── Auth middleware ───
async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    const ticket = await gClient.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID })
    const { sub, email, name, picture } = ticket.getPayload()
    await pool.query(
      `INSERT INTO users (google_id, email, name, picture) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET email=$2, name=$3, picture=$4`,
      [sub, email, name, picture]
    )
    req.user = { google_id: sub, email, name, picture }
    next()
  } catch (err) {
    console.error('Auth failed:', err.message)
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ─── Groq LLM helper ───
async function groq(messages, maxTokens = 1000) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages, temperature: 0, max_tokens: maxTokens })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.choices[0].message.content
}

function parseJSON(text) {
  const m = text.match(/[\[{][\s\S]*[\]}]/)
  return m ? JSON.parse(m[0]) : null
}

// ─── Auth endpoint ───
app.post('/api/auth', auth, (req, res) => res.json(req.user))

// ─── EXPENSES CRUD ───
app.get('/api/expenses', auth, async (req, res) => {
  const { month } = req.query // format: 2026-04
  let q = 'SELECT * FROM expenses WHERE user_id=$1'
  const params = [req.user.google_id]
  if (month) { q += ` AND TO_CHAR(date, 'YYYY-MM')=$2`; params.push(month) }
  q += ' ORDER BY date DESC, id DESC'
  const { rows } = await pool.query(q, params)
  res.json(rows)
})

app.post('/api/expenses', auth, async (req, res) => {
  const { description, amount, category, date, product_name, quantity, size, mrp } = req.body
  const discount = mrp ? (mrp - amount) : 0
  const { rows } = await pool.query(
    `INSERT INTO expenses (user_id, description, amount, category, date, product_name, quantity, size, mrp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.user.google_id, description, amount, category, date, product_name || description, quantity || 1, size || null, mrp || amount]
  )
  res.json(rows[0])
})

app.put('/api/expenses/:id', auth, async (req, res) => {
  const { description, amount, category, date, product_name, quantity, size, mrp } = req.body
  const { rows } = await pool.query(
    `UPDATE expenses SET description=$1, amount=$2, category=$3, date=$4, product_name=$5, quantity=$6, size=$7, mrp=$8
     WHERE id=$9 AND user_id=$10 RETURNING *`,
    [description, amount, category, date, product_name || description, quantity || 1, size, mrp || amount, req.params.id, req.user.google_id]
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

app.delete('/api/expenses/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.google_id])
  res.json({ ok: true })
})

app.post('/api/expenses/bulk', auth, async (req, res) => {
  const { items } = req.body
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items' })
  const results = []
  for (const e of items) {
    const { rows } = await pool.query(
      `INSERT INTO expenses (user_id, description, amount, category, date, product_name, quantity, size, mrp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.google_id, e.description, e.amount, e.category, e.date, e.product_name || e.description, e.quantity || 1, e.size || null, e.mrp || e.amount]
    )
    results.push(rows[0])
  }
  res.json(results)
})

// ─── BUDGET ───
app.get('/api/budget', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const { rows } = await pool.query('SELECT * FROM budgets WHERE user_id=$1 AND month=$2', [req.user.google_id, month])
  res.json(rows[0] || { salary: 0, budget: 0, month })
})

app.post('/api/budget', auth, async (req, res) => {
  const { month, salary, budget } = req.body
  const { rows } = await pool.query(
    `INSERT INTO budgets (user_id, month, salary, budget) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, month) DO UPDATE SET salary=$3, budget=$4 RETURNING *`,
    [req.user.google_id, month, salary, budget]
  )
  res.json(rows[0])
})

// ─── DASHBOARD AGGREGATION ───
app.get('/api/dashboard', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const uid = req.user.google_id

  // Budget
  const budgetRes = await pool.query('SELECT * FROM budgets WHERE user_id=$1 AND month=$2', [uid, month])
  const budget = budgetRes.rows[0] || { salary: 0, budget: 0 }

  // Expenses for month
  const expRes = await pool.query(
    `SELECT * FROM expenses WHERE user_id=$1 AND TO_CHAR(date, 'YYYY-MM')=$2 ORDER BY date`, [uid, month]
  )
  const expenses = expRes.rows

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalMRP = expenses.reduce((s, e) => s + Number(e.mrp || e.amount), 0)
  const totalDiscount = totalMRP - totalSpent
  const remaining = Number(budget.budget) - totalSpent
  const utilization = budget.budget > 0 ? (totalSpent / Number(budget.budget)) * 100 : 0

  // Category breakdown
  const catMap = {}
  expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount) })
  const categories = Object.entries(catMap)
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100, percent: totalSpent > 0 ? Math.round((total / totalSpent) * 10000) / 100 : 0 }))
    .sort((a, b) => b.total - a.total)

  // Top 5 items
  const top5 = [...expenses].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5)
    .map(e => ({ product_name: e.product_name || e.description, category: e.category, amount: Number(e.amount) }))

  // Weekly forecast
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const today = new Date()
  const weeks = []
  let weekStart = 1
  let weekNum = 1
  while (weekStart <= daysInMonth) {
    const weekEnd = Math.min(weekStart + 6, daysInMonth)
    const startDate = `${month}-${String(weekStart).padStart(2, '0')}`
    const endDate = `${month}-${String(weekEnd).padStart(2, '0')}`
    const weekExpenses = expenses.filter(e => {
      const d = Number(e.date.toString().slice(8, 10) || new Date(e.date).getDate())
      return d >= weekStart && d <= weekEnd
    })
    const actual = weekExpenses.reduce((s, e) => s + Number(e.amount), 0)

    // Forecast: average daily spend from past data * 7
    const pastDays = expenses.filter(e => new Date(e.date) < new Date(startDate))
    const daysSoFar = Math.max(new Date(startDate).getDate() - 1, 1)
    const pastTotal = pastDays.reduce((s, e) => s + Number(e.amount), 0)
    const avgDaily = pastTotal > 0 ? pastTotal / daysSoFar : (Number(budget.budget) / daysInMonth)
    const forecast = Math.round(avgDaily * (weekEnd - weekStart + 1))

    const weekEndDate = new Date(year, mon - 1, weekEnd)
    let status = 'upcoming'
    if (weekEndDate < today) status = 'covered'
    else if (new Date(year, mon - 1, weekStart) <= today) status = 'in_progress'

    weeks.push({
      week: weekNum, startDate, endDate,
      dateRange: `${getMonthName(mon)} ${weekStart} – ${getMonthName(mon)} ${weekEnd}`,
      forecast, actual: Math.round(actual), variance: Math.round(actual - forecast), status
    })
    weekStart = weekEnd + 1
    weekNum++
  }

  // Next week prediction based on weighted moving average of completed weeks
  const completedWeeks = weeks.filter(w => w.status === 'covered' && w.actual > 0)
  let nextWeekPrediction = null
  const nextWeek = weeks.find(w => w.status === 'upcoming') || weeks.find(w => w.status === 'in_progress')
  if (completedWeeks.length > 0 && nextWeek) {
    // Weighted average: recent weeks count more (weights: 1, 2, 3...)
    let weightedSum = 0, weightTotal = 0
    completedWeeks.forEach((w, i) => {
      const weight = i + 1
      weightedSum += w.actual * weight
      weightTotal += weight
    })
    const predicted = Math.round(weightedSum / weightTotal)
    const trend = completedWeeks.length >= 2
      ? completedWeeks[completedWeeks.length - 1].actual - completedWeeks[completedWeeks.length - 2].actual
      : 0
    const endOfMonthProjection = Math.round(totalSpent + predicted * weeks.filter(w => w.status !== 'covered').length)
    const topCatNextWeek = categories[0]?.category || 'N/A'

    nextWeekPrediction = {
      week: nextWeek.week,
      dateRange: nextWeek.dateRange,
      predicted,
      trend: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
      trendAmount: Math.abs(Math.round(trend)),
      endOfMonthProjection,
      willExceedBudget: Number(budget.budget) > 0 && endOfMonthProjection > Number(budget.budget),
      overBy: Math.max(0, Math.round(endOfMonthProjection - Number(budget.budget))),
      topCategory: topCatNextWeek,
      basedOnWeeks: completedWeeks.length
    }
  }

  res.json({
    budget: { salary: Number(budget.salary), budget: Number(budget.budget) },
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalMRP: Math.round(totalMRP * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    utilization: Math.round(utilization * 100) / 100,
    categories, top5, weeks, nextWeekPrediction,
    expenseCount: expenses.length
  })
})

function getMonthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
}

// ─── AI INSIGHTS ───
app.get('/api/insights', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const uid = req.user.google_id

  const budgetRes = await pool.query('SELECT * FROM budgets WHERE user_id=$1 AND month=$2', [uid, month])
  const budget = budgetRes.rows[0] || { salary: 0, budget: 0 }

  const expRes = await pool.query(
    `SELECT category, SUM(amount) as total FROM expenses WHERE user_id=$1 AND TO_CHAR(date, 'YYYY-MM')=$2 GROUP BY category ORDER BY total DESC`,
    [uid, month]
  )
  const totalSpent = expRes.rows.reduce((s, r) => s + Number(r.total), 0)
  const breakdown = expRes.rows.map(r => `${r.category}: ₹${Number(r.total).toFixed(0)}`).join(', ')

  try {
    const raw = await groq([
      { role: 'system', content: `You are a concise Indian personal finance advisor. Given monthly spending data, return a JSON array of 4-6 insights. Each: {"type":"spending"|"alert"|"saving"|"forecast","icon":"📊"|"⚠️"|"💡"|"📈","title":"short title","text":"1-2 sentence insight"}. Return ONLY JSON array.` },
      { role: 'user', content: `Monthly budget: ₹${budget.budget}, Salary: ₹${budget.salary}, Total spent: ₹${totalSpent.toFixed(0)}, Remaining: ₹${(Number(budget.budget) - totalSpent).toFixed(0)}, Utilization: ${budget.budget > 0 ? ((totalSpent / Number(budget.budget)) * 100).toFixed(1) : 0}%\nBreakdown: ${breakdown}` }
    ])
    const insights = parseJSON(raw) || []
    res.json({ insights })
  } catch (err) {
    console.error('AI insights error:', err.message)
    res.json({ insights: [{ type: 'spending', icon: '📊', title: 'Budget Status', text: `You have spent ₹${totalSpent.toFixed(0)} of ₹${budget.budget} budget (${budget.budget > 0 ? ((totalSpent / Number(budget.budget)) * 100).toFixed(1) : 0}% utilized).` }] })
  }
})

// ─── SMART CATEGORIZATION ───
app.post('/api/categorize', auth, async (req, res) => {
  const { product_name } = req.body
  if (!product_name) return res.json({ category: 'Other' })
  try {
    const raw = await groq([
      { role: 'system', content: `Categorize this Indian product into exactly one category. Categories: ${CATEGORIES.join(', ')}. Return ONLY the category name, nothing else.` },
      { role: 'user', content: product_name }
    ], 20)
    const cat = raw.trim()
    res.json({ category: CATEGORIES.includes(cat) ? cat : 'Other' })
  } catch {
    res.json({ category: 'Other' })
  }
})

// ─── UPLOAD (Groq vision for images, pdfjs for PDF, xlsx for Excel) ───
const EXTRACT_PROMPT = `Extract all purchased items from this receipt/invoice/bill. For each item return:
- description: item name (short, clean)
- amount: final price paid (number)
- category: one of ${CATEGORIES.join(', ')}
- quantity: number (default 1)
- size: weight/volume if visible (e.g. "500ml", "1kg")
- mrp: original MRP if visible, else same as amount

Return ONLY a JSON array. Example:
[{"description":"Paneer","amount":95,"category":"Dairy","quantity":1,"size":"200g","mrp":105}]
Skip delivery/handling charges, taxes, totals.`

app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const { path: fp, mimetype, originalname } = req.file
  try {
    let items = []
    if (mimetype.startsWith('image/')) {
      const b64 = fs.readFileSync(fp, { encoding: 'base64' })
      const raw = await groq([{ role: 'user', content: [
        { type: 'text', text: EXTRACT_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimetype};base64,${b64}` } }
      ]}], 2000)
      items = parseJSON(raw) || []
    } else if (mimetype === 'application/pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const buf = fs.readFileSync(fp)
      const doc = await getDocument({ data: new Uint8Array(buf) }).promise
      let text = ''
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i)
        const c = await pg.getTextContent()
        text += c.items.map(x => x.str).join(' ') + '\n'
      }
      const raw = await groq([{ role: 'user', content: EXTRACT_PROMPT + '\n\nReceipt text:\n' + text.slice(0, 4000) }], 2000)
      items = parseJSON(raw) || []
    } else if (originalname.match(/\.(xlsx?|csv)$/i)) {
      const wb = XLSX.readFile(fp)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      items = rows.map(r => {
        const desc = r.description || r.Description || r.item || r.Item || r['Product Name'] || Object.values(r)[0]
        const amt = r.amount || r.Amount || r.price || r.Price || r.total || r.Total || Object.values(r)[1]
        if (!desc || !amt) return null
        return { description: String(desc), amount: parseFloat(String(amt).replace(/[₹,]/g, '')) || 0, category: r.category || r.Category || 'Other', quantity: r.quantity || r.Quantity || 1, size: r.size || r.Size || '', mrp: r.mrp || r.MRP || amt }
      }).filter(Boolean)
    }
    const today = new Date().toISOString().split('T')[0]
    items = items.filter(i => i.description && i.amount > 0).map(i => ({
      ...i, date: today,
      category: CATEGORIES.includes(i.category) ? i.category : 'Other',
      mrp: i.mrp || i.amount, quantity: i.quantity || 1
    }))
    res.json({ items })
  } catch (err) {
    console.error('Upload error:', err.message)
    res.status(500).json({ error: 'Failed to parse: ' + err.message })
  } finally { fs.unlink(fp, () => {}) }
})

// ─── EMAIL SYNC (Swiggy, Zepto) ───
const SYNC_PROVIDERS = {
  swiggy: { from: 'noreply@swiggy.in', label: 'Swiggy' },
  zepto: { from: 'noreply@zeptonow.com', label: 'Zepto' },
}

async function gmailFetch(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `Gmail API ${res.status}`)
  return data
}

function findPdfAttachment(payload) {
  const parts = payload.parts || []
  for (const part of parts) {
    if (part.filename?.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) return { id: part.body.attachmentId, name: part.filename }
    if (part.parts) { const found = findPdfAttachment(part); if (found) return found }
  }
  return null
}

async function parsePdfBuffer(buf) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i)
    const c = await pg.getTextContent()
    text += c.items.map(x => x.str).join(' ') + '\n'
  }
  return text
}

app.post('/api/sync/:provider', auth, async (req, res) => {
  const provider = SYNC_PROVIDERS[req.params.provider]
  if (!provider) return res.status(400).json({ error: 'Unknown provider' })
  const { gmail_token, month } = req.body
  if (!gmail_token) return res.status(400).json({ error: 'Gmail token required' })

  const [year, mon] = (month || new Date().toISOString().slice(0, 7)).split('-')
  const after = `${year}/${mon}/01`
  const lastDay = new Date(Number(year), Number(mon), 0).getDate()
  const before = `${year}/${mon}/${lastDay}`

  try {
    const query = `from:${provider.from} has:attachment filename:pdf after:${after} before:${before}`
    const listData = await gmailFetch(gmail_token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`)

    if (!listData.messages?.length) return res.json({ items: [], message: `No ${provider.label} invoices found` })

    const items = []
    for (const msg of listData.messages) {
      try {
        const detail = await gmailFetch(gmail_token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`)
        const headers = detail.payload?.headers || []
        const dateHeader = headers.find(h => h.name.toLowerCase() === 'date')?.value || ''
        const emailDate = dateHeader ? new Date(dateHeader).toISOString().split('T')[0] : `${year}-${mon}-01`

        const pdf = findPdfAttachment(detail.payload)
        if (!pdf) continue

        const attData = await gmailFetch(gmail_token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${pdf.id}`)
        const pdfBuf = Buffer.from(attData.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        const text = await parsePdfBuffer(pdfBuf)
        const raw = await groq([{ role: 'user', content: EXTRACT_PROMPT + '\n\nReceipt text:\n' + text.slice(0, 4000) }], 2000)
        const parsed = parseJSON(raw) || []

        for (const item of parsed) {
          if (!item.description || !item.amount || item.amount <= 0) continue
          items.push({ ...item, date: emailDate, category: CATEGORIES.includes(item.category) ? item.category : 'Other', mrp: item.mrp || item.amount, quantity: item.quantity || 1, email_id: msg.id })
        }
      } catch (e) { console.error(`${provider.label} parse error:`, e.message) }
    }
    res.json({ items, total: items.length })
  } catch (err) {
    console.error(`${provider.label} sync error:`, err.message)
    res.status(500).json({ error: 'Failed to fetch emails: ' + err.message })
  }
})

app.get('/api/sync-status', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT synced_providers FROM users WHERE google_id=$1', [req.user.google_id])
  res.json({ synced: rows[0]?.synced_providers || [] })
})

app.post('/api/sync-status', auth, async (req, res) => {
  const { provider } = req.body
  await pool.query(`UPDATE users SET synced_providers = array_append(COALESCE(synced_providers, '{}'), $1) WHERE google_id=$2 AND NOT ($1 = ANY(COALESCE(synced_providers, '{}')))`, [provider, req.user.google_id])
  res.json({ ok: true })
})

app.get('/api/notification-settings', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT phone, whatsapp_optin FROM users WHERE google_id=$1', [req.user.google_id])
  res.json(rows[0] || { phone: null, whatsapp_optin: false })
})

app.post('/api/notification-settings', auth, async (req, res) => {
  const { phone, whatsapp_optin } = req.body
  await pool.query('UPDATE users SET phone=$1, whatsapp_optin=$2 WHERE google_id=$3', [phone || null, !!whatsapp_optin, req.user.google_id])
  res.json({ ok: true })
})

app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

app.post('/api/push/subscribe', auth, async (req, res) => {
  const { subscription } = req.body
  if (!subscription) return res.status(400).json({ error: 'No subscription' })
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)
     ON CONFLICT (user_id, subscription) DO NOTHING`,
    [req.user.google_id, JSON.stringify(subscription)]
  )
  res.json({ ok: true })
})

app.post('/api/push/unsubscribe', auth, async (req, res) => {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1', [req.user.google_id])
  res.json({ ok: true })
})

app.listen(process.env.PORT || 3001, async () => {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS synced_providers TEXT[] DEFAULT '{}'`).catch(() => {})
  console.log(`Server on port ${process.env.PORT || 3001}`)
})
