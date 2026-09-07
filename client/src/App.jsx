import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Deliveries from './pages/Deliveries'
import Inventory from './pages/Inventory'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
