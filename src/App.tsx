import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import AssignerPanelPage from './pages/AssignerPanelPage'
import UserPanelPage from './pages/UserPanelPage'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ width: '100vw', height: '100vh' }}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/assigner" element={<AssignerPanelPage />} />
          <Route path="/user" element={<UserPanelPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}