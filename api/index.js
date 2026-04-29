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
const upload = multer({ dest: '/tmp/', limits: { fileSize: 10 * 1024 * 1024 } })

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

const CATEGORIES = ['Dairy', 'Vegetables', 'Household', 'Personal Care', 'Frozen Food', 'Grocery / Spices', 'Transport', 'Bills', 'Entertainment', 'Health', 'Other']

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

function getMonthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
}

app.post('/api/auth', auth, (req, res) => res.json(req.user))

app.get('/api/expenses', auth, async (req, res) => {
  const { month } = req.query
  let q = 'SELECT * FROM expenses WHERE user_id=$1'
  const params = [req.user.google_id]
  if (month) { q += ` AND TO_CHAR(date, 'YYYY-MM')=$2`; params.push(month) }
  q += ' ORDER BY date DESC, id DESC'
  const { rows } = await pool.query(q, params)
  res.json(rows)
})

app.post('/api/expenses', auth, async (req, res) => {
  const { description, amount, category, date, product_name, quantity, size, mrp } = req.body
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

app.get('/api/dashboard', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const uid = req.user.google_id
  const budgetRes = await pool.query('SELECT * FROM budgets WHERE user_id=$1 AND month=$2', [uid, month])
  const budget = budgetRes.rows[0] || { salary: 0, budget: 0 }
  const expRes = await pool.query(`SELECT * FROM expenses WHERE user_id=$1 AND TO_CHAR(date, 'YYYY-MM')=$2 ORDER BY date`, [uid, month])
  const expenses = expRes.rows

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalMRP = expenses.reduce((s, e) => s + Number(e.mrp || e.amount), 0)
  const totalDiscount = totalMRP - totalSpent
  const remaining = Number(budget.budget) - totalSpent
  const utilization = budget.budget > 0 ? (totalSpent / Number(budget.budget)) * 100 : 0

  const catMap = {}
  expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount) })
  const categories = Object.entries(catMap).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100, percent: totalSpent > 0 ? Math.round((total / totalSpent) * 10000) / 100 : 0 })).sort((a, b) => b.total - a.total)

  const top5 = [...expenses].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5).map(e => ({ product_name: e.product_name || e.description, category: e.category, amount: Number(e.amount) }))

  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const today = new Date()
  const weeks = []
  let weekStart = 1, weekNum = 1
  while (weekStart <= daysInMonth) {
    const weekEnd = Math.min(weekStart + 6, daysInMonth)
    const startDate = `${month}-${String(weekStart).padStart(2, '0')}`
    const weekExpenses = expenses.filter(e => { const d = Number(e.date.toString().slice(8, 10) || new Date(e.date).getDate()); return d >= weekStart && d <= weekEnd })
    const actual = weekExpenses.reduce((s, e) => s + Number(e.amount), 0)
    const pastDays = expenses.filter(e => new Date(e.date) < new Date(startDate))
    const daysSoFar = Math.max(new Date(startDate).getDate() - 1, 1)
    const pastTotal = pastDays.reduce((s, e) => s + Number(e.amount), 0)
    const avgDaily = pastTotal > 0 ? pastTotal / daysSoFar : (Number(budget.budget) / daysInMonth)
    const forecast = Math.round(avgDaily * (weekEnd - weekStart + 1))
    const weekEndDate = new Date(year, mon - 1, weekEnd)
    let status = 'upcoming'
    if (weekEndDate < today) status = 'covered'
    else if (new Date(year, mon - 1, weekStart) <= today) status = 'in_progress'
    weeks.push({ week: weekNum, startDate, dateRange: `${getMonthName(mon)} ${weekStart} – ${getMonthName(mon)} ${weekEnd}`, forecast, actual: Math.round(actual), variance: Math.round(actual - forecast), status })
    weekStart = weekEnd + 1; weekNum++
  }

  const completedWeeks = weeks.filter(w => w.status === 'covered' && w.actual > 0)
  let nextWeekPrediction = null
  const nextWeek = weeks.find(w => w.status === 'upcoming') || weeks.find(w => w.status === 'in_progress')
  if (completedWeeks.length > 0 && nextWeek) {
    let weightedSum = 0, weightTotal = 0
    completedWeeks.forEach((w, i) => { const wt = i + 1; weightedSum += w.actual * wt; weightTotal += wt })
    const predicted = Math.round(weightedSum / weightTotal)
    const trend = completedWeeks.length >= 2 ? completedWeeks[completedWeeks.length - 1].actual - completedWeeks[completedWeeks.length - 2].actual : 0
    const endOfMonthProjection = Math.round(totalSpent + predicted * weeks.filter(w => w.status !== 'covered').length)
    nextWeekPrediction = { week: nextWeek.week, dateRange: nextWeek.dateRange, predicted, trend: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable', trendAmount: Math.abs(Math.round(trend)), endOfMonthProjection, willExceedBudget: Number(budget.budget) > 0 && endOfMonthProjection > Number(budget.budget), overBy: Math.max(0, Math.round(endOfMonthProjection - Number(budget.budget))), topCategory: categories[0]?.category || 'N/A', basedOnWeeks: completedWeeks.length }
  }

  res.json({ budget: { salary: Number(budget.salary), budget: Number(budget.budget) }, totalSpent: Math.round(totalSpent * 100) / 100, totalMRP: Math.round(totalMRP * 100) / 100, totalDiscount: Math.round(totalDiscount * 100) / 100, remaining: Math.round(remaining * 100) / 100, utilization: Math.round(utilization * 100) / 100, categories, top5, weeks, nextWeekPrediction, expenseCount: expenses.length })
})

app.get('/api/insights', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const uid = req.user.google_id
  const budgetRes = await pool.query('SELECT * FROM budgets WHERE user_id=$1 AND month=$2', [uid, month])
  const budget = budgetRes.rows[0] || { salary: 0, budget: 0 }
  const expRes = await pool.query(`SELECT category, SUM(amount) as total FROM expenses WHERE user_id=$1 AND TO_CHAR(date, 'YYYY-MM')=$2 GROUP BY category ORDER BY total DESC`, [uid, month])
  const totalSpent = expRes.rows.reduce((s, r) => s + Number(r.total), 0)
  const breakdown = expRes.rows.map(r => `${r.category}: ₹${Number(r.total).toFixed(0)}`).join(', ')
  try {
    const raw = await groq([
      { role: 'system', content: `You are a concise Indian personal finance advisor. Given monthly spending data, return a JSON array of 4-6 insights. Each: {"type":"spending"|"alert"|"saving"|"forecast","icon":"📊"|"⚠️"|"💡"|"📈","title":"short title","text":"1-2 sentence insight"}. Return ONLY JSON array.` },
      { role: 'user', content: `Monthly budget: ₹${budget.budget}, Salary: ₹${budget.salary}, Total spent: ₹${totalSpent.toFixed(0)}, Remaining: ₹${(Number(budget.budget) - totalSpent).toFixed(0)}, Utilization: ${budget.budget > 0 ? ((totalSpent / Number(budget.budget)) * 100).toFixed(1) : 0}%\nBreakdown: ${breakdown}` }
    ])
    res.json({ insights: parseJSON(raw) || [] })
  } catch (err) {
    res.json({ insights: [{ type: 'spending', icon: '📊', title: 'Budget Status', text: `You have spent ₹${totalSpent.toFixed(0)} of ₹${budget.budget} budget.` }] })
  }
})

app.post('/api/categorize', auth, async (req, res) => {
  const { product_name } = req.body
  if (!product_name) return res.json({ category: 'Other' })
  try {
    const raw = await groq([
      { role: 'system', content: `Categorize this Indian product into exactly one category. Categories: ${CATEGORIES.join(', ')}. Return ONLY the category name.` },
      { role: 'user', content: product_name }
    ], 20)
    const cat = raw.trim()
    res.json({ category: CATEGORIES.includes(cat) ? cat : 'Other' })
  } catch { res.json({ category: 'Other' }) }
})

const EXTRACT_PROMPT = `Extract all purchased items from this receipt/invoice/bill. For each item return:
- description: item name (short, clean)
- amount: final price paid (number)
- category: one of ${CATEGORIES.join(', ')}
- quantity: number (default 1)
- size: weight/volume if visible (e.g. "500ml", "1kg")
- mrp: original MRP if visible, else same as amount
Return ONLY a JSON array. Skip delivery/handling charges, taxes, totals.`

app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const { path: fp, mimetype, originalname } = req.file
  try {
    let items = []
    if (mimetype.startsWith('image/')) {
      const b64 = fs.readFileSync(fp, { encoding: 'base64' })
      const raw = await groq([{ role: 'user', content: [{ type: 'text', text: EXTRACT_PROMPT }, { type: 'image_url', image_url: { url: `data:${mimetype};base64,${b64}` } }] }], 2000)
      items = parseJSON(raw) || []
    } else if (mimetype === 'application/pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const buf = fs.readFileSync(fp)
      const doc = await getDocument({ data: new Uint8Array(buf) }).promise
      let text = ''
      for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const c = await pg.getTextContent(); text += c.items.map(x => x.str).join(' ') + '\n' }
      const raw = await groq([{ role: 'user', content: EXTRACT_PROMPT + '\n\nReceipt text:\n' + text.slice(0, 4000) }], 2000)
      items = parseJSON(raw) || []
    } else if (originalname.match(/\.(xlsx?|csv)$/i)) {
      const wb = XLSX.readFile(fp)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      items = rows.map(r => { const desc = r.description || r.Description || r.item || r.Item || r['Product Name'] || Object.values(r)[0]; const amt = r.amount || r.Amount || r.price || r.Price || Object.values(r)[1]; if (!desc || !amt) return null; return { description: String(desc), amount: parseFloat(String(amt).replace(/[₹,]/g, '')) || 0, category: r.category || r.Category || 'Other', quantity: r.quantity || 1, size: r.size || '', mrp: r.mrp || amt } }).filter(Boolean)
    }
    const today = new Date().toISOString().split('T')[0]
    items = items.filter(i => i.description && i.amount > 0).map(i => ({ ...i, date: today, category: CATEGORIES.includes(i.category) ? i.category : 'Other', mrp: i.mrp || i.amount, quantity: i.quantity || 1 }))
    res.json({ items })
  } catch (err) { res.status(500).json({ error: 'Failed to parse: ' + err.message }) }
  finally { fs.unlink(fp, () => {}) }
})

// ─── WHATSAPP NOTIFICATION SETTINGS ───
app.get('/api/notification-settings', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT phone, whatsapp_optin FROM users WHERE google_id=$1', [req.user.google_id])
  res.json(rows[0] || { phone: null, whatsapp_optin: false })
})

app.post('/api/notification-settings', auth, async (req, res) => {
  const { phone, whatsapp_optin } = req.body
  await pool.query('UPDATE users SET phone=$1, whatsapp_optin=$2 WHERE google_id=$3', [phone || null, !!whatsapp_optin, req.user.google_id])
  res.json({ ok: true })
})

// ─── CRON: Send WhatsApp reminders ───
app.get('/api/cron/whatsapp-reminder', async (req, res) => {
  // Verify cron secret to prevent unauthorized calls
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const twilio = (await import('twilio')).default
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const { rows: users } = await pool.query('SELECT name, phone FROM users WHERE whatsapp_optin=true AND phone IS NOT NULL')
    const appUrl = process.env.APP_URL || 'https://daily-expense-tracker-six-omega.vercel.app'
    let sent = 0
    for (const user of users) {
      try {
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_FROM,
          to: `whatsapp:${user.phone}`,
          body: `Hey ${user.name || 'there'}! 👋 Don't forget to log today's expenses. Track your spending here: ${appUrl}`
        })
        sent++
      } catch (err) { console.error(`Failed to send to ${user.phone}:`, err.message) }
    }
    res.json({ sent, total: users.length })
  } catch (err) {
    console.error('Cron error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default app
