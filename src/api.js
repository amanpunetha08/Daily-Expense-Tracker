const API = import.meta.env.DEV ? 'http://localhost:8000/api' : '/api'

let _token = null
export const setToken = (t) => { _token = t }
export const getToken = () => _token

export async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}`, ...opts.headers }
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function uploadFile(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${_token}` },
    body: fd
  })
  if (!res.ok) throw new Error(`Upload ${res.status}`)
  return res.json()
}
