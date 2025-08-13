import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // optional

export default function Register() {
  const navigate = useNavigate();
  let auth = null;
  try { auth = useAuth(); } catch (e) { auth = null; }

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // redirect already-logged-in users
  useEffect(() => {
    const token = auth?.token ?? localStorage.getItem('token');
    if (token) navigate('/dashboard', { replace: true });
  }, [auth, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { name, email, password };
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/register`, payload);
      // expected shape: { token, user? }
      const token = res.data?.token;
      const user = res.data?.user || { name };

      if (!token) {
        throw new Error('No token returned from server');
      }

      // persist token and username
      localStorage.setItem('token', token);
      if (user && user.name) localStorage.setItem('username', user.name);

      // set axios default header for subsequent requests
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // notify AuthContext if available
      if (auth?.login) {
        try { auth.login(token, user); } catch (e) { /* ignore */ }
      }

      // auto-redirect to dashboard after signup
      navigate('/dashboard');
    } catch (err) {
      console.error('Register error', err?.response?.data || err.message || err);
      const msg = err?.response?.data?.message || err.message || 'Registration failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h2 className="text-2xl mb-4 font-semibold">Create your HireSim account</h2>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <input
          type="text"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mb-3 p-2 border rounded"
          required
        />

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
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 p-2 border rounded"
          minLength={6}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white p-2 rounded hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <p className="mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
