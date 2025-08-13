// src/components/Navbar.jsx
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // adjust path if different

export default function Navbar() {
  const navigate = useNavigate();
  // useAuth should provide { token, user, logout } or similar. If not present, we fallback to localStorage.
  let auth = null;
  try { auth = useAuth(); } catch (e) { auth = null; }

  const token = auth?.token ?? localStorage.getItem('token');
  const user = auth?.user ?? (localStorage.getItem('username') ? { name: localStorage.getItem('username') } : null);

  function goHomeOrDashboard() {
    if (token) navigate('/dashboard');
    else navigate('/');
  }

  function handleLogout() {
    // Prefer auth.logout if available
    if (auth?.logout) {
      auth.logout();
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
    }
    // notify other tabs
    localStorage.setItem('hiresim_logout', Date.now());
    navigate('/');
  }

  return (
    <nav className="w-full bg-white border-b shadow-sm">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={goHomeOrDashboard} className="text-xl font-bold text-indigo-600 hover:opacity-90">
            HireSim
          </button>
          {/* optionally small tagline */}
          <div className="text-sm text-gray-500 hidden sm:block">Practice technical interviews with AI</div>
        </div>

        <div>
          {!token ? (
            <div className="flex items-center gap-3">
              <Link to="/login" className="text-sm px-3 py-1 rounded hover:bg-gray-100">Login</Link>
              <Link to="/register" className="text-sm bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700">Sign up</Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700 hidden sm:inline">Hi, {user?.name ?? 'User'}</span>
              <button onClick={handleLogout} className="text-sm px-3 py-1 rounded border hover:bg-gray-50">Logout</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
