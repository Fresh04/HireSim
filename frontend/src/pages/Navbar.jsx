import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

function parseJwtPayload(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {

  }
  const uname = localStorage.getItem('username') || localStorage.getItem('name');
  if (uname) return { username: uname };
  const token = localStorage.getItem('token');
  if (token) {
    const payload = parseJwtPayload(token);
    if (payload) {
      return { username: payload.username || payload.name || payload.preferred_username || payload.given_name || null };
    }
  }
  return null;
}

export default function Navbar() {
  const navigate = useNavigate();

  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => readStoredUser());

  useEffect(() => {
    function onStorage(e) {
      if (!e) return;
      if (e.key === 'user' || e.key === 'username' || e.key === 'token' || e.key === 'hiresim_logout') {
        setToken(localStorage.getItem('token'));
        setUser(readStoredUser());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const goHomeOrDashboard = useCallback(() => {
    if (localStorage.getItem('token')) navigate('/dashboard');
    else navigate('/');
  }, [navigate]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('username');
    localStorage.removeItem('name');
    localStorage.setItem('hiresim_logout', Date.now());
    setToken(null);
    setUser(null);
    navigate('/');
  }, [navigate]);

  const displayName = (user && (user.username || user.name || user.fullName || user.email)) || 'User';
  const avatarLetter = (displayName && displayName.charAt(0).toUpperCase()) || 'U';

  return (
    <nav className="bg-gray-800 border-b border-gray-700/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex justify-between items-center">
          <button 
            onClick={goHomeOrDashboard}
            className="flex items-center space-x-3 group focus:outline-none"
            aria-label="HireSim Home"
          >
            <div className="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center transition-all group-hover:bg-gray-600 border border-gray-600/50">
              <span className="font-medium text-blue-400">HS</span>
            </div>
            <span className="text-xl font-semibold text-gray-100">HireSim</span>
          </button>

          {!token ? (
            <div className="flex space-x-4 items-center">
              <Link to="/login" className="text-gray-300 hover:text-white px-4 py-2 rounded-lg transition">Login</Link>
              <Link to="/register" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition shadow-md">Get Started</Link>
            </div>
          ) : (
            <div className="flex items-center space-x-6">
              <div className="hidden md:flex items-center space-x-3">
                <div className="w-9 h-9 bg-blue-600/20 rounded-full flex items-center justify-center border border-blue-500/30">
                  <span className="text-blue-400 font-medium">{avatarLetter}</span>
                </div>
                <span className="text-gray-300 font-medium">Hi, {displayName}</span>
              </div>

              <button 
                onClick={handleLogout}
                className="text-gray-300 hover:text-white px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500 transition flex items-center space-x-2"
              >
                <span>Logout</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
