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
  }, [location.pathname]);

  return (
    <>
      <aside className="hidden lg:block lg:w-64 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:pt-6 bg-gray-800 border-r border-gray-700 scrollbar-dark" aria-label="Sidebar">
        <div className="px-4 pb-6">
          <Link
            to="/dashboard"
            className="block w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm text-center"
          >
            + New Interview
          </Link>
        </div>

        <div className="px-2 pb-6 space-y-1">
          {items.length === 0 && (
            <div className="text-sm text-gray-400 px-2 py-3 text-center">No interviews yet</div>
          )}

          {items.map(i => {
            const isCompleted = i.status && i.status !== 'in_progress';
            const to = isCompleted ? `/analysis/${i._id}` : `/interview/${i._id}`;

            return (
              <Link
                key={i._id}
                to={to}
                className={`block py-2.5 px-3 rounded-md transition-colors ${
                  isCompleted
                    ? 'hover:bg-gray-700/50 border-l-4 border-blue-500'
                    : 'hover:bg-gray-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-gray-100">
                      {i.position} @ {i.company}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(i.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {isCompleted ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400">
                      Completed
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900/30 text-blue-400">
                      In Progress
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Mobile / small screens: compact top bar with horizontally scrollable list */}
      <div className="lg:hidden fixed left-0 right-0 top-0 z-40 bg-gray-800 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-3 py-2 flex items-center gap-3 overflow-x-auto">
          <Link
            to="/dashboard"
            className="flex-shrink-0 py-1 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
          >
            + New
          </Link>

          {items.length === 0 ? (
            <div className="text-sm text-gray-300 whitespace-nowrap">No interviews</div>
          ) : (
            items.map(i => {
              const isCompleted = i.status && i.status !== 'in_progress';
              const to = isCompleted ? `/analysis/${i._id}` : `/interview/${i._id}`;
              return (
                <Link
                  key={i._id}
                  to={to}
                  className={`flex-shrink-0 py-1 px-3 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isCompleted ? 'bg-green-900/20 text-green-300' : 'bg-gray-700 text-gray-200'
                  }`}
                >
                  {i.position} @{i.company}
                </Link>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
