import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken, setUserInfo } from '../lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.post<{
        token: string
        user: {
          id: number
          ucode: string
          username: string
          realname: string
          isSuper: boolean
          permissions: string[]
        }
      }>('/auth/login', { username, password })
      setToken(res.data!.token)
      // 緩存用戶信息（用於側邊欄權限過濾）
      setUserInfo({
        id: res.data!.user.id,
        ucode: res.data!.user.ucode,
        username: res.data!.user.username,
        realname: res.data!.user.realname || '',
        isSuper: res.data!.user.isSuper,
        permissions: res.data!.user.permissions || [],
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登錄失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border p-8">
          <h1 className="text-2xl font-bold text-center mb-6">CMS 管理後台</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">用戶名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">密碼</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="******"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? '登錄中...' : '登錄'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
