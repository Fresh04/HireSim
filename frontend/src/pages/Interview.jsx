// src/pages/Interview.jsx
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export default function Interview() {
  const { id: interviewId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navFirstQuestion = location.state?.firstQuestion || null;

  const [interviewMeta, setInterviewMeta] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [history, setHistory] = useState([]); // { role:'assistant'|'user', text }
  const [statusMsg, setStatusMsg] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [stagedAnswer, setStagedAnswer] = useState('');
  const [isInterviewRunning, setIsInterviewRunning] = useState(false);
  const [done, setDone] = useState(false);

  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recognitionRef = useRef(null);

  const supportsSTT = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Try to pick assistant text from a server response (multiple shapes)
  function extractAssistantText(respData) {
    if (!respData) return null;
    if (typeof respData.assistant === 'string' && respData.assistant.trim()) return respData.assistant.trim();
    if (typeof respData.nextQuestion === 'string' && respData.nextQuestion.trim()) return respData.nextQuestion.trim();
    if (typeof respData.followUp === 'string' && respData.followUp.trim()) return respData.followUp.trim();
    if (typeof respData.reply === 'string' && respData.reply.trim()) return respData.reply.trim();
    if (respData.interview && Array.isArray(respData.interview.context)) {
      const lastAssistant = respData.interview.context.slice().reverse().find(c => c.role === 'assistant');
      if (lastAssistant && lastAssistant.content) return lastAssistant.content;
    }
    if (respData.choices && Array.isArray(respData.choices) && respData.choices[0]) {
      const c = respData.choices[0];
      if (c.message && c.message.content) return c.message.content.trim();
      if (c.text) return String(c.text).trim();
    }
    if (typeof respData === 'string') return respData.trim();
    return null;
  }

  // load interview doc (but DO NOT derive a pre-generated question list into UI)
  useEffect(() => {
    let mounted = true;
    async function loadInterview() {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}`, {
          headers: getAuthHeaders()
        });
        if (!mounted) return;
        const doc = res.data;
        setInterviewMeta(doc);

        if (doc.status && doc.status !== 'in_progress') {
          // Completed -> go to analysis
          navigate(`/analysis/${interviewId}`, { replace: true });
          return;
        }

        // build transcript from context (assistant & user only)
        const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
        setHistory(ctx.map(c => ({ role: c.role, text: c.content })));

        // choose current question: prefer the last assistant message in context,
        // fallback to navFirstQuestion (if page was navigated with it)
        const lastAssistant = (doc.context || []).slice().reverse().find(c => c.role === 'assistant');
        if (lastAssistant && lastAssistant.content) {
          setCurrentQuestion(lastAssistant.content);
        } else if (navFirstQuestion) {
          // we will still call backend on Start to get truly live first question,
          // but show navFirstQuestion as hint if present
          setCurrentQuestion(navFirstQuestion);
        } else {
          setCurrentQuestion(null);
        }
      } catch (err) {
        console.error('Failed to load interview', err?.response?.data || err.message || err);
        if (err?.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
        } else {
          setStatusMsg('Failed to load interview data');
        }
      }
    }
    loadInterview();
    return () => { mounted = false; };
  }, [interviewId]);

  // Setup speech recognition once
  useEffect(() => {
    if (!supportsSTT) return;
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';

      recog.onresult = (e) => {
        let interim = '';
        let finals = [];
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals.push(r[0].transcript.trim());
          else interim += r[0].transcript;
        }
        if (finals.length) {
          setStagedAnswer(prev => (prev ? prev + ' ' : '') + finals.join(' '));
          setInterimTranscript('');
        } else {
          setInterimTranscript(interim);
        }
      };

      recog.onerror = (err) => {
        console.warn('STT error', err);
        setStatusMsg('Speech recognition error');
        try { recog.stop(); } catch {}
        setIsListening(false);
      };

      recognitionRef.current = recog;
    } catch (e) {
      console.warn('SpeechRecognition init failed', e);
      setStatusMsg('Speech recognition unavailable');
    }

    return () => {
      try { recognitionRef.current?.stop?.(); } catch {}
    };
  }, [supportsSTT]);

  // TTS
  const speak = (text, onEnd) => {
    if (!text) { onEnd?.(); return; }
    if (!window.speechSynthesis) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => onEnd?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  // media helpers (camera + mic preview only, no recording)
  async function ensureMediaStream() {
    if (mediaStreamRef.current) return mediaStreamRef.current;
    try {
      // request both video + audio so user sees webcam and mic permission together
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      return stream;
    } catch (err) {
      console.warn('getUserMedia failed', err);
      throw new Error('Camera/microphone permission denied');
    }
  }

  function stopMediaStream() {
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      } catch (e) { /* ignore */ }
      if (videoRef.current) {
        try { videoRef.current.srcObject = null; } catch (e) {}
      }
      mediaStreamRef.current = null;
    }
  }

  const startListening = () => {
    if (!recognitionRef.current) { setStatusMsg('STT not available'); return; }
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setStatusMsg('Listening...');
    } catch (err) {
      console.error('startListening err', err);
      setStatusMsg('Could not start STT');
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsListening(false);
    setInterimTranscript('');
    setStatusMsg('Mic stopped');
  };

  // Toggle interview: start/stop. On start we ask backend to START if necessary
  const handleToggleInterview = async () => {
    if (!isInterviewRunning) {
      // Start interview: open camera preview (no recording) and start STT if available
      try {
        await ensureMediaStream();
      } catch (e) {
        // permission denied or failed — still allow interview via typed answers
        console.warn('Camera preview unavailable', e);
      }

      if (supportsSTT) {
        try { startListening(); } catch (e) {}
      }

      setIsInterviewRunning(true);
      setStatusMsg('Interview running');

      // If there's no assistant message loaded, request the backend to begin
      if (!currentQuestion) {
        try {
          // Special server signal: "__start__" — backend should respond with assistant text
          const res = await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/turn`, { answer: '__start__' }, {
            headers: getAuthHeaders()
          });

          const assistantText = extractAssistantText(res.data);
          if (assistantText) {
            setHistory(prev => [...prev, { role: 'assistant', text: assistantText }]);
            setCurrentQuestion(assistantText);
            speak(assistantText, () => setStatusMsg('Waiting for your response...'));
          } else {
            // fallback: fetch interview doc and sync
            const refreshed = await axios.get(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}`, { headers: getAuthHeaders() });
            const doc = refreshed.data;
            const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
            setHistory(ctx.map(c => ({ role: c.role, text: c.content })));
            const lastAssistant = (doc.context || []).slice().reverse().find(c => c.role === 'assistant');
            if (lastAssistant) {
              setCurrentQuestion(lastAssistant.content);
              speak(lastAssistant.content, () => setStatusMsg('Waiting for your response...'));
            } else {
              setStatusMsg('No question from server');
            }
          }
        } catch (err) {
          console.error('Start request failed', err?.response?.data || err.message || err);
          setStatusMsg('Failed to start interview (server error)');
        }
      } else {
        // we already have a current question - speak it
        speak(currentQuestion, () => setStatusMsg('Waiting for your response...'));
      }
    } else {
      // Stop interview: stop listening and camera preview
      if (isListening) stopListening();
      stopMediaStream();
      setIsInterviewRunning(false);
      setStatusMsg('Interview stopped');
    }
  };

  // Submit answer: sends answer to backend; backend returns assistant reply (follow-up or next question) or done
  const submitAnswer = async (explicitText) => {
    if (isSubmitting) return;
    const answerText = (typeof explicitText === 'string' && explicitText.trim()) ? explicitText.trim() : stagedAnswer.trim();
    if (!answerText) { setStatusMsg('No answer to submit'); return; }

    setIsSubmitting(true);
    setStatusMsg('Submitting answer...');
    try {
      // append user to local transcript immediately
      setHistory(prev => [...prev, { role: 'user', text: answerText }]);
      setStagedAnswer('');
      setInterimTranscript('');

      const res = await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/turn`, { answer: answerText }, {
        headers: getAuthHeaders()
      });

      const assistantText = extractAssistantText(res.data);
      const finished = !!res.data?.done;

      if (assistantText) {
        setHistory(prev => [...prev, { role: 'assistant', text: assistantText }]);
        setCurrentQuestion(assistantText);
        setStatusMsg('Received reply');
        speak(assistantText, () => {
          if (isInterviewRunning && supportsSTT) {
            try { recognitionRef.current?.stop(); } catch {}
            try { recognitionRef.current?.start(); } catch {}
          }
        });
      } else if (res.data && res.data.interview) {
        // fallback: sync from returned interview doc
        const doc = res.data.interview;
        const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
        setHistory(ctx.map(c => ({ role: c.role, text: c.content })));
        const lastAssistant = (doc.context || []).slice().reverse().find(c => c.role === 'assistant');
        if (lastAssistant) {
          setCurrentQuestion(lastAssistant.content);
          setStatusMsg('Synced with server');
          speak(lastAssistant.content, () => {});
        }
      } else {
        setStatusMsg('No reply received from server');
      }

      if (finished) {
        setDone(true);
        setStatusMsg('Interviewer indicated the interview is complete. Click End & Upload to finish.');
        if (isListening) stopListening();
        stopMediaStream();
        setIsInterviewRunning(false);
      }
    } catch (err) {
      console.error('submitAnswer err', err?.response?.data || err.message || err);
      setStatusMsg('Failed to submit answer');
      if (err?.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/login');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Skip - explicit skip action
  const handleSkip = async () => {
    stopListening();
    setStatusMsg('Skipping...');
    try {
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/turn`, { answer: '__skip__' }, {
        headers: getAuthHeaders()
      });
      const assistantText = extractAssistantText(res.data);
      const finished = !!res.data?.done;
      if (assistantText) {
        setHistory(prev => [...prev, { role: 'assistant', text: assistantText }]);
        setCurrentQuestion(assistantText);
        speak(assistantText, () => {
          if (isInterviewRunning && supportsSTT) try { recognitionRef.current?.start(); } catch {}
        });
        setStatusMsg('Skipped to next question');
      } else if (res.data && res.data.interview) {
        const doc = res.data.interview;
        const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
        setHistory(ctx.map(c => ({ role: c.role, text: c.content })));
        const lastAssistant = (doc.context || []).slice().reverse().find(c => c.role === 'assistant');
        if (lastAssistant) {
          setCurrentQuestion(lastAssistant.content);
        }
        setStatusMsg('Synced with server after skip');
      } else {
        setStatusMsg('No reply after skip');
      }

      if (finished) {
        setDone(true);
        setStatusMsg('Interviewer indicated the interview is complete.');
        if (isListening) stopListening();
        stopMediaStream();
        setIsInterviewRunning(false);
      }
    } catch (err) {
      console.error('skip err', err);
      setStatusMsg('Failed to skip');
    }
  };

  // Repeat current question
  const handleRepeat = () => {
    if (!currentQuestion) return;
    speak(currentQuestion, () => {
      if (isInterviewRunning && supportsSTT) try { recognitionRef.current?.start(); } catch {}
    });
  };

  // Finalize interview and upload transcript (no video)
  const finalizeInterview = async (replaceNav = false) => {
    setStatusMsg('Finalizing interview — uploading transcript...');
    if (isListening) stopListening();
    stopMediaStream();
    setIsInterviewRunning(false);

    const transcriptText = history.map(h => `${h.role === 'assistant' ? 'Interviewer' : 'You'}: ${h.text}`).join('\n\n');
    const form = new FormData();
    form.append('transcript', new Blob([transcriptText], { type: 'text/plain' }), 'transcript.txt');

    try {
      const token = localStorage.getItem('token');
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' };
      await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/complete`, form, { headers });

      localStorage.setItem('hiresim_refresh', Date.now());
      setStatusMsg('Uploaded. Redirecting to analysis...');
      if (replaceNav) navigate(`/analysis/${interviewId}`, { replace: true });
      else navigate(`/analysis/${interviewId}`);
    } catch (err) {
      console.error('finalize upload error', err?.response?.data || err);
      setStatusMsg('Failed to upload interview');
      if (err?.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/login');
      }
    }
  };

  // Download transcript locally
  const downloadTranscript = () => {
    const transcriptText = history.map(h => `${h.role === 'assistant' ? 'Interviewer' : 'You'}: ${h.text}`).join('\n\n');
    const blob = new Blob([transcriptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${interviewId || 'session'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Apply interim transcript into staged answer
  const applyInterim = () => {
    if (!interimTranscript) return;
    setStagedAnswer(prev => (prev ? prev + ' ' : '') + interimTranscript);
    setInterimTranscript('');
  };

  // Ctrl/Cmd+Enter handler
  const onStagedKeyDown = (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if ((isMac && e.metaKey && e.key === 'Enter') || (!isMac && e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      submitAnswer();
    }
  };

  // cleanup
  useEffect(() => {
    return () => {
      stopMediaStream();
      try { recognitionRef.current?.stop(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard shortcuts (global) — ignore when typing
  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      const isEditable = active && (tag === 'input' || tag === 'textarea' || active.isContentEditable === true);
      if (isEditable) return;

      const k = e.key?.toLowerCase?.();
      if (k === 'r') { e.preventDefault(); handleRepeat(); return; }
      if (k === 's') { e.preventDefault(); handleSkip(); return; }
      if (e.code === 'Space') {
        e.preventDefault();
        if (isListening) stopListening();
        else startListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isListening, currentQuestion]);

  // UI
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Live Interview</h1>
              <div className="text-sm text-gray-400 mt-1">
                {interviewMeta?.position ? `${interviewMeta.position} @ ${interviewMeta.company}` : 'Interview session'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mt-1">{statusMsg}</div>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-gray-700/50 border border-gray-600 min-h-[140px]">
            <div className="text-xs text-gray-400 mb-2">Current question</div>
            <div className="text-lg font-medium text-white">
              {currentQuestion || 'Click Start Interview to begin.'}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleToggleInterview}
              className={`text-white px-4 py-2 rounded-lg transition ${isInterviewRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
            >
              {isInterviewRunning ? 'Stop Interview' : 'Start Interview'}
            </button>

            <button onClick={handleRepeat} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg transition">Repeat</button>
            <button onClick={handleSkip} className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded-lg transition">Skip</button>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => { if (isListening) stopListening(); else startListening(); }}
                className={`px-3 py-2 rounded-lg transition ${isListening ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {isListening ? 'Stop Mic' : 'Start Mic'}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm text-gray-400 mb-2">Answer (edit before submitting)</div>

            <textarea
              value={stagedAnswer}
              onChange={(e) => setStagedAnswer(e.target.value)}
              onKeyDown={onStagedKeyDown}
              placeholder={interimTranscript ? `Interim: ${interimTranscript}` : 'Type or speak your answer here...'}
              className="w-full p-3 rounded-lg bg-gray-700/50 border border-gray-600 text-white min-h-[110px] resize-y"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => submitAnswer()} disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50">
                {isSubmitting ? 'Submitting…' : 'Submit Answer'}
              </button>

              <button onClick={() => { setStagedAnswer(''); setInterimTranscript(''); }} className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Clear</button>

              {interimTranscript && (
                <button onClick={applyInterim} className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Apply interim</button>
              )}

              <div className="ml-auto text-sm text-gray-500">Tip: press <strong className="text-gray-300">Ctrl/Cmd+Enter</strong> to submit</div>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-sm text-gray-400 mb-2">Transcript</div>
            <div className="max-h-72 overflow-y-auto p-3 rounded-lg bg-gray-700/50 border border-gray-600 scrollbar-dark">
              {history.length === 0 && <div className="text-sm text-gray-400">No conversation yet</div>}
              {history.map((h, i) => (
                <div key={i} className={`mb-3 ${h.role === 'assistant' ? 'text-left' : 'text-right'}`}>
                  <div className={`inline-block p-2 rounded-lg max-w-[80%] ${h.role === 'assistant' ? 'bg-gray-600 text-white' : 'bg-blue-600 text-white'}`}>
                    {h.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: camera / controls */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-700 flex flex-col">
          <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-black" style={{ aspectRatio: '3/4', objectFit: 'cover' }} />

          <div className="w-full mt-3 flex gap-2">
            <button onClick={downloadTranscript} className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition">Download Transcript</button>

            <button onClick={() => finalizeInterview(true)} className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition">End & Upload</button>
          </div>

          <div className="mt-4 w-full text-sm text-gray-400">
            <div><strong className="text-gray-300">Status:</strong> {statusMsg}</div>
            <div className="mt-2">
              <strong className="text-gray-300">Mic:</strong> {isListening ? 'On' : 'Off'}
            </div>
            <div className="mt-2 text-xs text-gray-400">
              Camera is used only as a live preview and is not recorded or uploaded.
            </div>
            {done && <div className="mt-2 text-yellow-300">Interviewer indicated the interview is complete.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
