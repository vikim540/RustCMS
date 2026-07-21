import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { LoadingState } from '../components/StateDisplay'

interface StorageConfig {
  storage_type: string
  s3_endpoint: string
  s3_access_key: string
  s3_secret_key: string
  s3_bucket: string
  s3_region: string
  s3_public_url: string
}

export default function Storage() {
  const [config, setConfig] = useState<StorageConfig>({
    storage_type: 's3',
    s3_endpoint: '',
    s3_access_key: '',
    s3_secret_key: '',
    s3_bucket: '',
    s3_region: 'auto',
    s3_public_url: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ ok: boolean; msg: string; url?: string } | null>(null)

  useEffect(() => {
    api
      .get<StorageConfig>('/admin/storage/config')
      .then((res) => {
        const d = res.data as StorageConfig
        if (d) setConfig(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/admin/storage/config', config)
      setTestResult({ ok: true, msg: '配置已保存' })
    } catch {
      setTestResult({ ok: false, msg: '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 測試連接返回 connected + endpoint + bucket（均為後端回顯的實際配置）
      const res = await api.post<{ connected: boolean; endpoint?: string; bucket?: string }>('/admin/storage/test')
      if (res.code === 0) {
        const d = res.data
        setTestResult({
          ok: true,
          msg: `連接成功！Endpoint: ${d?.endpoint ?? '(未知)'}, Bucket: ${d?.bucket ?? '(未知)'}`,
        })
      } else {
        setTestResult({ ok: false, msg: res.msg || '連接失敗' })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '連接失敗'
      setTestResult({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('cms_token')
      const resp = await fetch(
        `${import.meta.env.VITE_API_BASE || '/api/v1'}/admin/storage/upload`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      )
      const json = await resp.json()
      if (json.code === 0) {
        setUploadResult({ ok: true, msg: '上傳成功', url: json.data.url })
      } else {
        setUploadResult({ ok: false, msg: json.msg || '上傳失敗' })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '上傳失敗'
      setUploadResult({ ok: false, msg })
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState text="載入中..." />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">存儲設置</h1>
      <p className="text-sm text-muted-foreground mb-6">
        配置 S3 兼容存儲 (Cloudflare R2 / AWS S3 / MinIO 等)
      </p>

      {/* R2 快速配置提示 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-blue-500 mt-0.5 shrink-0">☁️</span>
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">Cloudflare R2 配置指南</p>
            <p className="text-blue-700 mb-2">
              在 Cloudflare Dashboard → R2 → 管理 API 中創建 API Token，然後填入以下信息：
            </p>
            <ul className="text-blue-700 space-y-0.5 ml-4 text-xs">
              <li>• <b>端點</b>: <code>https://{'<account_id>'}.r2.cloudflarestorage.com</code></li>
              <li>• <b>區域</b>: auto</li>
              <li>• <b>Access Key</b>: R2 API Token 的 Access Key ID</li>
              <li>• <b>Secret Key</b>: R2 API Token 的 Secret Access Key</li>
              <li>• <b>Bucket</b>: 在 R2 中創建的存儲桶名稱</li>
              <li>• <b>公共 URL</b>: R2 自定義域名或 r2.dev 子域名</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 配置表單 */}
      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">存儲類型</label>
          <select
            value={config.storage_type}
            onChange={(e) => setConfig({ ...config, storage_type: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            <option value="s3">S3 兼容存儲</option>
            <option value="r2">Cloudflare R2</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            S3 端點 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={config.s3_endpoint}
            onChange={(e) => setConfig({ ...config, s3_endpoint: e.target.value })}
            placeholder="https://xxx.r2.cloudflarestorage.com"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Access Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={config.s3_access_key}
              onChange={(e) => setConfig({ ...config, s3_access_key: e.target.value })}
              placeholder="Access Key ID"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Secret Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={config.s3_secret_key}
              onChange={(e) => setConfig({ ...config, s3_secret_key: e.target.value })}
              placeholder="Secret Access Key"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Bucket <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={config.s3_bucket}
              onChange={(e) => setConfig({ ...config, s3_bucket: e.target.value })}
              placeholder="my-bucket"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">區域</label>
            <input
              type="text"
              value={config.s3_region}
              onChange={(e) => setConfig({ ...config, s3_region: e.target.value })}
              placeholder="auto"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">公共訪問 URL</label>
          <input
            type="text"
            value={config.s3_public_url}
            onChange={(e) => setConfig({ ...config, s3_public_url: e.target.value })}
            placeholder="https://cdn.example.com 或 https://pub-xxx.r2.dev"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            文件上傳後返回的公共 URL 前綴，用於前端直接訪問
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <span className="animate-spin inline-block">🔄</span> : <span>💾</span>}
            保存配置
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? <span className="animate-spin inline-block">🔄</span> : <span>🧪</span>}
            測試連接
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-md p-3 text-sm ${
              testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {testResult.msg}
          </div>
        )}
      </div>

      {/* 文件上傳測試 */}
      <div className="bg-white rounded-lg border p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>💾</span>
          文件上傳測試
        </h2>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-200 cursor-pointer">
            {uploading ? <span className="animate-spin inline-block">🔄</span> : <span>📤</span>}
            選擇文件
            <input type="file" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
        {uploadResult && (
          <div className={`mt-3 rounded-md p-3 text-sm ${uploadResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {uploadResult.msg}
            {uploadResult.url && (
              <div className="mt-2">
                <a href={uploadResult.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                  {uploadResult.url}
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
