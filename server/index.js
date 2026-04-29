import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { OAuth2Client } from 'google-auth-library'

const app = express()
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

// Middleware: verify Google token
async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID })
    const { sub, email, name, picture } = ticket.getPayload()
    // Upsert user
    await pool.query(
      `INSERT INTO users (google_id, email, name, picture) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET email=$2, name=$3, picture=$4`,
      [sub, email, name, picture]
    )
    req.user = { google_id: sub, email, name, picture }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Auth: verify token and return user
app.post('/api/auth', auth, (req, res) => res.json(req.user))

// Get expenses
app.get('/api/expenses', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM expenses WHERE user_id=$1 ORDER BY date DESC, id DESC', [req.user.google_id]
  )
  res.json(rows)
})

// Add expense
app.post('/api/expenses', auth, async (req, res) => {
  const { description, amount, category, date } = req.body
  const { rows } = await pool.query(
    'INSERT INTO expenses (user_id, description, amount, category, date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.google_id, description, amount, category, date]
  )
  res.json(rows[0])
})

// Delete expense
app.delete('/api/expenses/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.google_id])
  res.json({ ok: true })
})

app.listen(process.env.PORT || 3001, () => console.log(`Server running on port ${process.env.PORT || 3001}`))
