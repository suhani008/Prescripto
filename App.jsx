import React from 'react'
import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Doctors from './pages/Doctors'
import About from './pages/About'
import Contact from './pages/Contact'
import MyProfile from './pages/MyProfile'
import Login from './pages/Login'
import MyAppoinments from './pages/MyAppoinments'
import Appoinments from './pages/Appoinments'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import PaymentSuccess from './pages/PaymentSuccess'

function App() {
  return (
    <div className='mx-4 sm:mx-[10%]'>
      <Navbar />
      <Routes>
        {/* Main Pages */}
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        
        {/* Authentication */}
        <Route path="/login" element={<Login />} />
        
        {/* Doctors Routes */}
        <Route path="/doctors" element={<Doctors />} />
        <Route path="/doctors/:speciality" element={<Doctors />} />
        
        {/* User Profile & Appointments - Fixed spelling consistency */}
        <Route path="/my-profile" element={<MyProfile />} />
        <Route path="/my-appointments" element={<MyAppoinments />} />
        <Route path="/my-appoinments" element={<MyAppoinments />} />
        <Route path="/appointments/:docId" element={<Appoinments />} />
        <Route path="/appoinments/:docId" element={<Appoinments />} />
        
        {/* Payment Success Route */}
        <Route path="/payment-success" element={<PaymentSuccess />} />
        
        {/* Catch-all route for 404 */}
        <Route path="*" element={<div className="text-center py-20">Page Not Found</div>} />
      </Routes>
      <Footer />
    </div>
  )
}

export default App
