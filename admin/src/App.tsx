import { Routes, Route, Navigate } from 'react-router-dom'
import { getToken, getUserInfo } from './lib/api'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contents from './pages/Contents'
import ContentEdit from './pages/ContentEdit'
import Categories from './pages/Categories'
import Singles from './pages/Singles'
import SingleEdit from './pages/SingleEdit'
import Links from './pages/Links'
import Slides from './pages/Slides'
import Tags from './pages/Tags'
import Messages from './pages/Messages'
import SiteInfo from './pages/SiteInfo'
import Company from './pages/Company'
import Settings from './pages/Settings'
import Storage from './pages/Storage'
import MediaLibrary from './pages/MediaLibrary'
import Models from './pages/Models'
import ExtFields from './pages/ExtFields'
import Trash from './pages/Trash'
import Users from './pages/Users'
import Roles from './pages/Roles'
import Menus from './pages/Menus'
import Logs from './pages/Logs'
import Database from './pages/Database'

/** 路由守衛:未登錄跳轉到登錄頁 */
function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 權限守衛：檢查用戶是否有指定 mcode 權限，無權限顯示提示頁 */
function RequirePermission({
  mcode,
  children,
}: {
  mcode: string | string[]
  children: React.ReactNode
}) {
  const user = getUserInfo()
  // 超管放行
  if (user?.isSuper) return <>{children}</>
  // 檢查權限
  const codes = Array.isArray(mcode) ? mcode : [mcode]
  const hasPermission = user?.permissions?.some((p) => codes.includes(p))
  if (!hasPermission) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <span className="text-6xl mb-4">🔒</span>
        <h2 className="text-xl font-bold text-slate-700 mb-2">無權限訪問</h2>
        <p className="text-sm text-slate-500">
          當前角色沒有此功能的訪問權限，請聯繫管理員開通。
        </p>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="contents" element={<RequirePermission mcode="M201"><Contents /></RequirePermission>} />
        <Route path="contents/new" element={<RequirePermission mcode="M201"><ContentEdit /></RequirePermission>} />
        <Route path="contents/:id" element={<RequirePermission mcode="M201"><ContentEdit /></RequirePermission>} />
        <Route path="categories" element={<RequirePermission mcode="M202"><Categories /></RequirePermission>} />
        <Route path="singles" element={<RequirePermission mcode="M203"><Singles /></RequirePermission>} />
        <Route path="singles/new" element={<RequirePermission mcode="M203"><SingleEdit /></RequirePermission>} />
        <Route path="singles/:id" element={<RequirePermission mcode="M203"><SingleEdit /></RequirePermission>} />
        <Route path="links" element={<RequirePermission mcode="M401"><Links /></RequirePermission>} />
        <Route path="slides" element={<RequirePermission mcode="M402"><Slides /></RequirePermission>} />
        <Route path="tags" element={<RequirePermission mcode="M403"><Tags /></RequirePermission>} />
        <Route path="messages" element={<RequirePermission mcode="M204"><Messages /></RequirePermission>} />
        <Route path="site" element={<RequirePermission mcode="M501"><SiteInfo /></RequirePermission>} />
        <Route path="company" element={<RequirePermission mcode="M502"><Company /></RequirePermission>} />
        <Route path="media" element={<RequirePermission mcode="M301"><MediaLibrary /></RequirePermission>} />
        <Route path="settings" element={<RequirePermission mcode="M503"><Settings /></RequirePermission>} />
        <Route path="models" element={<RequirePermission mcode="M207"><Models /></RequirePermission>} />
        <Route path="extfields" element={<RequirePermission mcode="M206"><ExtFields /></RequirePermission>} />
        <Route path="trash" element={<RequirePermission mcode="M208"><Trash /></RequirePermission>} />
        {/* 以下為超管專用路由，無 mcode 映射，僅超管可訪問 */}
        <Route path="storage" element={<RequirePermission mcode="__super__"><Storage /></RequirePermission>} />
        <Route path="users" element={<RequirePermission mcode="M504"><Users /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission mcode="M505"><Roles /></RequirePermission>} />
        <Route path="menus" element={<RequirePermission mcode="M506"><Menus /></RequirePermission>} />
        <Route path="logs" element={<RequirePermission mcode="M507"><Logs /></RequirePermission>} />
        <Route path="database" element={<RequirePermission mcode="__super__"><Database /></RequirePermission>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
