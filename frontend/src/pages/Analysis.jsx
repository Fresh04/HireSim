import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeScores(rawScores) {
  const empty = { communication: null, technical: null, structure: null, confidence: null, nonverbal: null };
  if (!rawScores || typeof rawScores !== 'object') return empty;

  const keys = Object.keys(rawScores);
  const find = (...fragments) => {
    for (const k of keys) {
      const low = k.toLowerCase();
      for (const frag of fragments) {
        if (low.includes(frag.toLowerCase().replace(/\s+/g, ''))) {
          return rawScores[k];
        }
      }
    }
    return null;
  };

  const result = {
    communication: find('communication', 'clarity') ?? rawScores.communication ?? null,
    technical: find('technical', 'technicalaccuracy', 'technical accuracy', 'technical_accuracy') ?? rawScores.technical ?? null,
    structure: find('structure', 'organized', 'organization') ?? rawScores.structure ?? null,
    confidence: find('confidence', 'presence') ?? rawScores.confidence ?? null,
    nonverbal: find('nonverbal', 'non-verbal', 'non verbal') ?? rawScores.nonverbal ?? null,
  };

  Object.entries(result).forEach(([k, v]) => {
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) result[k] = parseInt(v.trim(), 10);
  });

  return result;
}

export default function Analysis() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [interview, setInterview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/interviews/${id}`, {
          headers: getAuthHeaders()
        });
        if (!mounted) return;
        setInterview(res.data);
      } catch (err) {
        console.error('Failed to load interview:', err?.response?.data || err.message || err);
        if (err?.response?.status === 401) {
          localStorage.removeItem('token');
          localStorage.setItem('hiresim_logout', Date.now());
          navigate('/login');
          return;
        }
        setError('Failed to load interview data.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [id, navigate]);

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${id}/analyze`, {}, {
        headers: getAuthHeaders()
      });

      const res = await axios.get(`${import.meta.env.VITE_API_URL}/interviews/${id}`, {
        headers: getAuthHeaders()
      });
      setInterview(res.data);

      localStorage.setItem('hiresim_refresh', Date.now());
    } catch (err) {
      console.error('Analysis failed:', err?.response?.data || err.message || err);
      if (err?.response?.status === 401) {
        localStorage.removeItem('token');
        localStorage.setItem('hiresim_logout', Date.now());
        navigate('/login');
        return;
      }
      setError('Analysis failed — try again later.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="p-6">Loading analysis…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!interview) return <div className="p-6">Interview not found.</div>;

  const analysis = interview.analysis || null;
  const normalized = normalizeScores((analysis && analysis.scores) || {});

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded shadow">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Interview Analysis</h1>
        <div className="text-sm text-gray-500">{interview.position} @ {interview.company}</div>
      </div>

      {!analysis ? (
        <div className="space-y-4">
          <p className="text-gray-600">No analysis available yet for this interview.</p>
          <div className="flex gap-2">
            <button onClick={runAnalysis} disabled={running} className="bg-blue-600 text-white px-4 py-2 rounded">
              {running ? 'Running analysis…' : 'Run Analysis'}
            </button>
            <button onClick={() => navigate(`/interview/${id}`)} className="px-4 py-2 rounded border">Back to Interview</button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-medium mb-3">Scores</h2>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Communication</div>
              <div className="text-lg font-bold">{normalized.communication ?? 'N/A'}</div>
            </div>

            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Technical</div>
              <div className="text-lg font-bold">{normalized.technical ?? 'N/A'}</div>
            </div>

            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Structure</div>
              <div className="text-lg font-bold">{normalized.structure ?? 'N/A'}</div>
            </div>

            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Confidence / Presence</div>
              <div className="text-lg font-bold">{normalized.confidence ?? 'N/A'}</div>
            </div>

            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Nonverbal</div>
              <div className="text-lg font-bold">{normalized.nonverbal ?? 'N/A'}</div>
            </div>

            <div className="p-3 border rounded">
              <div className="text-sm text-gray-500">Overall</div>
              <div className="text-lg font-bold">
                {
                  (() => {
                    const vals = [normalized.communication, normalized.technical, normalized.structure, normalized.confidence]
                      .filter(v => typeof v === 'number');
                    if (vals.length === 0) return 'N/A';
                    const avg = Math.round((vals.reduce((a,b)=>a+b,0) / vals.length) * 10) / 10;
                    return avg;
                  })()
                }
              </div>
            </div>
          </div>

          <h2 className="text-xl font-medium mb-2">Summary</h2>
          <p className="mb-4 text-gray-700">{analysis.summary || 'No summary provided.'}</p>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Strengths</h3>
              {Array.isArray(analysis.strengths) && analysis.strengths.length > 0 ? (
                <ul className="list-disc list-inside text-gray-700">
                  {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              ) : (
                <div className="text-gray-500">No strengths listed.</div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Improvements</h3>
              {Array.isArray(analysis.improvements) && analysis.improvements.length > 0 ? (
                <ol className="list-decimal list-inside text-gray-700">
                  {analysis.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
                </ol>
              ) : (
                <div className="text-gray-500">No improvements listed.</div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => navigate(`/interview/${id}`)} className="px-4 py-2 rounded border">Back to Interview</button>
            <button onClick={runAnalysis} disabled={running} className="bg-blue-600 text-white px-4 py-2 rounded">
              {running ? 'Re-running…' : 'Re-run Analysis'}
            </button>
            <button onClick={() => {
              const blob = new Blob([JSON.stringify(interview.analysisRaw || interview.analysis || {}, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }} className="px-4 py-2 rounded border">View raw output</button>
          </div>
        </>
      )}
    </div>
  );
}
