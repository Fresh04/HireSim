import React, { useEffect, useState, useRef } from 'react';
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

function buildTranscriptText(interview) {
  if (!interview) return '';
  if (interview.transcript && interview.transcript.trim()) return interview.transcript.trim();

  const ctx = Array.isArray(interview.context) ? interview.context : [];
  if (ctx.length === 0) return '';

  return ctx.map(m => {
    const who = m.role === 'assistant' ? 'Interviewer' : (m.role === 'user' ? 'You' : m.role);
    return `${who}: ${m.content}`;
  }).join('\n\n');
}

function buildTranscriptMessages(interview) {
  if (!interview) return [];

  if (Array.isArray(interview.context) && interview.context.length > 1) {
    const ctx = interview.context.slice(1);
    return ctx
      .filter(m => m && m.content)
      .map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : m.role)),
        text: m.content,
        ts: m.ts || m.time || m.createdAt || null
      }));
  }

  if (!interview.context || interview.context.length <= 1) {
    const raw = interview.transcript && interview.transcript.trim() ? interview.transcript.trim() : '';
    if (!raw) return [];

    const blocks = raw.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    const msgs = blocks.map(b => {
      const m = b.match(/^([A-Za-z ]{2,20})\s*:\s*(.*)$/s);
      if (m) {
        const speaker = m[1].toLowerCase();
        const rest = m[2].trim();
        if (speaker.includes('interview')) return { role: 'assistant', text: rest, ts: null };
        if (speaker === 'you' || speaker.includes('candidate')) return { role: 'user', text: rest, ts: null };
        return { role: 'other', text: b, ts: null };
      }
      // no speaker prefix — return as 'other'
      return { role: 'other', text: b, ts: null };
    });
    return msgs;
  }

  return [];
}

export default function Analysis() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [interview, setInterview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [transcriptText, setTranscriptText] = useState('');
  const [messages, setMessages] = useState([]);
  const [viewRawContext, setViewRawContext] = useState(false);
  const chatRef = useRef(null);

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
        const t = buildTranscriptText(res.data);
        setTranscriptText(t);
        const msgs = buildTranscriptMessages(res.data);
        setMessages(msgs);
        setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }), 80);
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
      const t = buildTranscriptText(res.data);
      setTranscriptText(t);
      const msgs = buildTranscriptMessages(res.data);
      setMessages(msgs);

      localStorage.setItem('hiresim_refresh', Date.now());
      setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }), 80);
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

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText || '');
      alert('Transcript copied to clipboard');
    } catch (e) {
      console.error('Copy failed', e);
      alert('Copy failed — please select and copy manually');
    }
  };

  const handleDownloadTranscript = () => {
    const blob = new Blob([transcriptText || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderBubble = (msg, idx) => {
    const isAssistant = msg.role === 'assistant';
    const isUser = msg.role === 'user';
    const tsString = msg.ts ? new Date(msg.ts).toLocaleString() : null;
    const assistantBubbleClass = 'inline-block max-w-[78%] p-3 rounded-lg break-words bg-gray-700/70 text-white';
    const userBubbleClass = 'inline-block max-w-[68%] p-3 rounded-lg break-words bg-blue-600 text-white';
    
    if (isAssistant) {
      return (
        <div key={idx} className="flex justify-start items-end gap-3 mb-3">
          <div className="flex items-end">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-600 text-white font-semibold">I</div>
          </div>
          <div>
            <div className={assistantBubbleClass}>
              <div className="whitespace-pre-wrap">{msg.text}</div>
            </div>
            {tsString && <div className="text-xs text-gray-400 mt-1">{tsString}</div>}
          </div>
        </div>
      );
    }
    
    if (isUser) {
      return (
        <div key={idx} className="flex justify-end items-end mb-3">
          <div className="text-right">
            <div className={userBubbleClass} style={{ borderBottomRightRadius: '6px' }}>
              <div className="whitespace-pre-wrap">{msg.text}</div>
            </div>
            {tsString && <div className="text-xs text-gray-400 mt-1 text-right">{tsString}</div>}
          </div>
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-500 text-white font-semibold ml-3 flex-shrink-0">U</div>
        </div>
      );
    }
    
    return (
      <div key={idx} className="flex justify-start items-end gap-3 mb-3">
        <div className="flex items-end">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-500 text-white font-semibold">?</div>
        </div>
        <div>
          <div className="inline-block max-w-[78%] p-3 rounded-lg break-words bg-gray-700/70 text-white">
            <div className="whitespace-pre-wrap">{msg.text}</div>
          </div>
          {tsString && <div className="text-xs text-gray-400 mt-1">{tsString}</div>}
        </div>
      </div>
    );
  };



  if (loading) return <div className="p-6">Loading analysis…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!interview) return <div className="p-6">Interview not found.</div>;

  const analysis = interview.analysis || null;
  const normalized = normalizeScores((analysis && analysis.scores) || {});

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-800 rounded-lg shadow-lg border border-gray-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white">Interview Analysis</h1>
        <div className="text-sm text-gray-400 mt-1 md:mt-0">
          {interview.position} @ {interview.company}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-white">Transcript (Chat view)</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setViewRawContext(v => !v);
                const msgs = buildTranscriptMessages(interview);
                setMessages(msgs);
                const t = buildTranscriptText(interview);
                setTranscriptText(t);
                setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }), 80);
              }}
              className="px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-700/80"
            >
              {viewRawContext ? 'Show Chat View' : 'Show Context View'}
            </button>

            <button onClick={handleCopyTranscript} className="px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-700/80">
              Copy
            </button>
            <button onClick={handleDownloadTranscript} className="px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-700/80">
              Download
            </button>
          </div>
        </div>

        <div className="mb-3 text-sm text-gray-400">
          {interview.transcript ? 'Transcript stored from the interview (or reconstructed from uploaded transcript).' : 'No stored transcript; this is reconstructed from the chat/context.'}
        </div>

        <div ref={chatRef} className="max-h-72 overflow-y-auto p-4 rounded-lg bg-gray-700/50 border border-gray-600 scrollbar-dark">
          {messages.length === 0 ? (
            <div className="text-gray-400">No transcript available.</div>
          ) : (
            <div className="space-y-2">
              {messages.map((m, i) => renderBubble(m, i))}
            </div>
          )}
        </div>
      </div>

      {!analysis ? (
        <div className="space-y-4">
          <p className="text-gray-400">No analysis available yet for this interview.</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={runAnalysis}
              disabled={running}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              {running ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Running analysis...
                </span>
              ) : 'Run Analysis'}
            </button>

            <button onClick={() => navigate(`/interview/${id}`)} className="px-4 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition text-white">
              Back to Interview
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-medium mb-4 text-white">Scores</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {[
              { label: "Communication", value: normalized.communication },
              { label: "Technical", value: normalized.technical },
              { label: "Structure", value: normalized.structure },
              { label: "Confidence / Presence", value: normalized.confidence },
              { label: "Nonverbal", value: normalized.nonverbal },
              {
                label: "Overall",
                value: (() => {
                  const vals = [normalized.communication, normalized.technical, normalized.structure, normalized.confidence]
                    .filter(v => typeof v === 'number');
                  if (vals.length === 0) return 'N/A';
                  const avg = Math.round((vals.reduce((a,b)=>a+b,0) / vals.length) * 10) / 10;
                  return avg;
                })()
              }
            ].map((metric, index) => (
              <div key={index} className="p-4 rounded-lg bg-gray-700/50 border border-gray-600 hover:bg-gray-700 transition">
                <div className="text-sm text-gray-400">{metric.label}</div>
                <div className="text-xl font-bold text-white mt-1">
                  {metric.value ?? 'N/A'}
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-medium mb-3 text-white">Summary</h2>
          <div className="mb-6 p-4 rounded-lg bg-gray-700/50 border border-gray-600">
            <p className="text-gray-300">{analysis.summary || 'No summary provided.'}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="p-4 rounded-lg bg-gray-700/50 border border-gray-600">
              <h3 className="text-lg font-medium mb-3 text-white">Strengths</h3>
              {Array.isArray(analysis.strengths) && analysis.strengths.length > 0 ? (
                <ul className="space-y-2">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="flex items-start">
                      <span className="text-green-400 mr-2">✓</span>
                      <span className="text-gray-300">{s}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500">No strengths listed.</div>
              )}
            </div>

            <div className="p-4 rounded-lg bg-gray-700/50 border border-gray-600">
              <h3 className="text-lg font-medium mb-3 text-white">Improvements</h3>
              {Array.isArray(analysis.improvements) && analysis.improvements.length > 0 ? (
                <ol className="space-y-2">
                  {analysis.improvements.map((imp, i) => (
                    <li key={i} className="flex items-start">
                      <span className="text-yellow-400 mr-2">•</span>
                      <span className="text-gray-300">{imp}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-gray-500">No improvements listed.</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate(`/interview/${id}`)} className="px-4 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition text-white">
              Back to Interview
            </button>
            <button onClick={runAnalysis} disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50">
              {running ? 'Re-running...' : 'Re-run Analysis'}
            </button>
            <button onClick={() => {
              const blob = new Blob([JSON.stringify(interview.analysisRaw || interview.analysis || {}, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }} className="px-4 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition text-white">
              View Raw Output
            </button>
          </div>
        </>
      )}
    </div>
  );
}
