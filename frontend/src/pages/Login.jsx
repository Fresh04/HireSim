import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // optional - if you don't have it, the code still works

export default function Login() {
  const navigate = useNavigate();
  let auth = null;
  try { auth = useAuth(); } catch (e) { auth = null; }

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // if already logged in, redirect to dashboard
  useEffect(() => {
    const token = auth?.token ?? localStorage.getItem('token');
    if (token) navigate('/dashboard', { replace: true });
  }, [auth, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/login`, { email, password });
      // expected shape: { token, user? }
      const token = res.data?.token;
      const user = res.data?.user || null;

      if (!token) {
        throw new Error('No token returned from server');
      }

      // persist token + username
      localStorage.setItem('token', token);
      if (user && user.name) localStorage.setItem('username', user.name);

      // set axios default header for subsequent requests
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // notify AuthContext if available
      if (auth?.login) {
        try { auth.login(token, user); } catch (e) { /* ignore */ }
      }

      navigate('/dashboard');
    } catch (err) {
      console.error('Login error', err?.response?.data || err.message || err);
      const msg = err?.response?.data?.message || err.message || 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h2 className="text-2xl mb-4 font-semibold">Sign in to HireSim</h2>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 p-2 border rounded"
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 p-2 border rounded"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="mt-4 text-center text-sm">
          New user?{' '}
          <Link to="/register" className="text-blue-600 hover:underline">
            Register here
          </Link>
        </p>
      </form>
    </div>
  );
}
