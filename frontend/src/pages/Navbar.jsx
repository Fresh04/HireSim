import React from 'react';

export default function Navbar() {
  const Link = ({ to, children, className, ...props }) => (
    <a href={to} className={className} {...props}>{children}</a>
  );
  
  const navigate = (path) => {
    window.location.href = path;
  };

  let auth = null;
  try { 
    auth = { token: null, user: null, logout: null };
  } catch (e) { 
    auth = null; 
  }

  const token = auth?.token ?? localStorage.getItem('token');
  const user = auth?.user ?? (localStorage.getItem('username') ? { name: localStorage.getItem('username') } : null);

  function goHomeOrDashboard() {
    if (token) navigate('/dashboard');
    else navigate('/');
  }

  function handleLogout() {
    if (auth?.logout) {
      auth.logout();
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
    }
    localStorage.setItem('hiresim_logout', Date.now());
    navigate('/');
  }

  return (
    <nav className="w-full bg-gray-900/95 backdrop-blur-lg border-b border-gray-700/50 shadow-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button 
              onClick={goHomeOrDashboard} 
              className="group flex items-center gap-3 hover:scale-105 transition-all duration-300"
            >
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300">
                <div className="w-6 h-6 bg-gray-900 rounded-md flex items-center justify-center">
                  <div className="w-4 h-4 bg-gradient-to-r from-blue-400 to-purple-500 rounded-sm"></div>
                </div>
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                HireSim
              </span>
            </button>
            
            <div className="hidden lg:block">
              <span className="text-sm font-medium text-gray-300 px-4 py-2 bg-gray-800/80 rounded-full backdrop-blur-sm border border-gray-700/50">
                Practice technical interviews with AI
              </span>
            </div>
          </div>

          <div className="flex items-center">
            {!token ? (
              <div className="flex items-center gap-3">
                <Link 
                  to="/login" 
                  className="text-sm font-medium text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-800/80 hover:text-gray-100 transition-all duration-200 hover:scale-105"
                >
                  Login
                </Link>
                <Link 
                  to="/register" 
                  className="group relative text-sm font-medium text-white px-6 py-2 rounded-lg overflow-hidden transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300 group-hover:from-blue-600 group-hover:to-purple-700"></div>
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 blur opacity-50 group-hover:opacity-75 transition-opacity duration-300"></div>
                  <span className="relative">Sign up</span>
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-3">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-medium text-sm">
                    {(user?.name ?? 'U')[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-300">
                    Hi, {user?.name ?? 'User'}
                  </span>
                </div>
                
                <button 
                  onClick={handleLogout} 
                  className="group text-sm font-medium text-gray-300 px-4 py-2 rounded-lg border border-gray-600 hover:bg-red-900/30 hover:border-red-500 hover:text-red-400 transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  <span className="flex items-center gap-2">
                    Logout
                    <svg 
                      className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}