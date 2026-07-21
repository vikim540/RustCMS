import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { LoadingState, EmptyState } from '../components/StateDisplay'
import { formatDate } from '../lib/utils'

/** 備份文件數據結構 */
interface BackupFile {
  filename: string
  size: number
  date: string
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 取得 API 基礎路徑 */
function getApiBase(): string {
  return import.meta.env.VITE_API_BASE || '/api/v1'
}

/** 取得 JWT token */
function getToken(): string | null {
  return localStorage.getItem('cms_token')
}

export default function DatabasePage() {
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [actionFile, setActionFile] = useState<string | null>(null)

  /** 載入備份列表 */
  const fetchBackups = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<BackupFile[]>('/admin/database/backups')
      setBackups(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBackups()
  }, [fetchBackups])

  /** 建立備份 */
  const handleCreateBackup = async () => {
    setCreating(true)
    setError('')
    try {
      await api.post('/admin/database/backup', {})
      await fetchBackups()
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立備份失敗')
    } finally {
      setCreating(false)
    }
  }

  /** 下載備份 */
  const handleDownload = async (filename: string) => {
    setActionFile(filename)
    try {
      // 嘗試通過 fetch 取得 blob 並觸發下載
      const response = await fetch(
        `${getApiBase()}/admin/database/backups/${encodeURIComponent(filename)}`,
        {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        },
      )
      if (!response.ok) {
        throw new Error(`下載失敗: ${response.status}`)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '下載失敗')
    } finally {
      setActionFile(null)
    }
  }

  /** 刪除備份 */
  const handleDelete = async (filename: string) => {
    if (!window.confirm(`確定要刪除備份文件「${filename}」嗎?`)) return
    setActionFile(filename)
    try {
      await api.del(`/admin/database/backups/${encodeURIComponent(filename)}`)
      await fetchBackups()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionFile(null)
    }
  }

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-xl">🗄️</span>
            資料庫管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">管理資料庫備份文件，可建立、下載或刪除備份</p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity text-sm"
        >
          {creating ? <span className="animate-spin inline-block">🔄</span> : <span>➕</span>}
          {creating ? '備份中...' : '建立備份'}
        </button>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 加載中 */}
      {loading && (
        <LoadingState text="載入中..." />
      )}

      {/* 空狀態 */}
      {!loading && backups.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">💾</span>
          <p className="mb-3">尚未有任何備份文件</p>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity text-sm"
          >
            {creating ? <span className="animate-spin inline-block">🔄</span> : <span>➕</span>}
            建立第一個備份
          </button>
        </div>
      )}

      {/* 備份列表 */}
      {!loading && backups.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">文件名</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">大小</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">建立時間</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((file) => (
                  <tr
                    key={file.filename}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground shrink-0">📄</span>
                        <span className="font-mono text-xs">{file.filename}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatSize(file.size)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(file.date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownload(file.filename)}
                          disabled={actionFile === file.filename}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                          title="下載"
                        >
                          <span className="text-sm">📥</span>
                          下載
                        </button>
                        <button
                          onClick={() => handleDelete(file.filename)}
                          disabled={actionFile === file.filename}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="刪除"
                        >
                          <span className="text-sm">🗑️</span>
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
