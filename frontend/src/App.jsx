import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Interview from './pages/Interview';
import Analysis from './pages/Analysis';
import Navbar from './pages/Navbar';
import Sidebar from './pages/Sidebar';
import { useAuth } from './context/AuthContext';

function PrivateRoute({ children }) {
  const { token, ready } = useAuth();
  if (!ready) return null;
  return token ? children : <Navigate to="/login" replace />;
}

function Layout({ children }) {
  const { token } = useAuth();
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="flex">
        {token && <Sidebar />}
        <main className="flex-1 p-6 bg-gray-100">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={
          <PrivateRoute><Dashboard /></PrivateRoute>
        } />
        <Route path="/interview/:id" element={
          <PrivateRoute><Interview /></PrivateRoute>
        } />
        <Route path="/analysis/:id" element={
          <PrivateRoute><Analysis /></PrivateRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
