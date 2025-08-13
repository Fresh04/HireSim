// src/components/Sidebar.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function Sidebar() {
  const [items, setItems] = useState([]);
  const location = useLocation();
  const navigate = useNavigate();

  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function load() {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/interviews`, {
        headers: getAuthHeaders()
      });
      setItems(res.data || []);
    } catch (err) {
      console.error('Failed to load interview history', err);
      if (err?.response?.status === 401) {
        localStorage.removeItem('token');
        localStorage.setItem('hiresim_logout', Date.now());
        navigate('/login');
      }
    }
  }

  useEffect(() => {
    load();
    function onStorage(e) {
      if (e.key === 'hiresim_refresh') {
        load();
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <aside className="w-64 bg-white border-r p-3 overflow-y-auto">
      <div className="mb-4">
        <Link to="/dashboard" className="block py-2 px-2 rounded hover:bg-gray-100 font-semibold">+ New Interview</Link>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <div className="text-sm text-gray-400 px-2">No interviews yet.</div>}
        {items.map(i => {
          const isCompleted = i.status && i.status !== 'in_progress';
          const to = isCompleted ? `/analysis/${i._id}` : `/interview/${i._id}`;
          return (
            <Link key={i._id} to={to} className="block py-2 px-2 rounded hover:bg-gray-50">
              <div className="text-sm font-medium">{i.position} @ {i.company}</div>
              <div className="text-xs text-gray-500">{new Date(i.createdAt).toLocaleString()}</div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
