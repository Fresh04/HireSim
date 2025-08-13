// src/pages/Interview.jsx
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export default function Interview() {
  const { id: interviewId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navFirstQuestion = location.state?.firstQuestion || null;

  // interview state
  const [interviewMeta, setInterviewMeta] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(navFirstQuestion);
  const [history, setHistory] = useState([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [stagedAnswer, setStagedAnswer] = useState('');
  const [done, setDone] = useState(false);

  // media refs
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // speech recognition
  const recognitionRef = useRef(null);
  const supportsSTT = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  // helper for auth header
  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Fetch interview; if already completed -> redirect to analysis
  useEffect(() => {
    let mounted = true;
    async function fetchInterview() {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}`, {
          headers: getAuthHeaders()
        });
        if (!mounted) return;
        const doc = res.data;
        setInterviewMeta(doc);

        // if completed or questions completed redirect to analysis
        if (doc.status && doc.status !== 'in_progress') {
          // go to analysis; replace to avoid back to interview
          navigate(`/analysis/${interviewId}`, { replace: true });
          return;
        }

        // set history from context
        const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
        setHistory(ctx.map(c => ({ role: c.role, text: c.content })));

        // pick current question from saved questions + index, fallback to last assistant message
        if (Array.isArray(doc.questions) && typeof doc.currentQuestionIndex === 'number') {
          const q = doc.questions[doc.currentQuestionIndex] || null;
          setCurrentQuestion(q);
        } else {
          const lastAssistant = (doc.context || []).slice().reverse().find(c => c.role === 'assistant');
          setCurrentQuestion(lastAssistant ? lastAssistant.content : navFirstQuestion);
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
    fetchInterview();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  // Setup SpeechRecognition (no media request)
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
        console.error('Recognition error', err);
        setStatusMsg('Speech recognition error');
        try { recog.stop(); } catch {}
        setIsListening(false);
      };

      recognitionRef.current = recog;
    } catch (err) {
      console.warn('SpeechRecognition init failed', err);
      setStatusMsg('Speech recognition unavailable');
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, [supportsSTT]);

  // TTS helper
  const speak = (text, onEnd) => {
    if (!text) { onEnd?.(); return; }
    if (!window.speechSynthesis) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => onEnd?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  // Request media on-demand (only when starting interview)
  async function ensureMediaStream() {
    if (mediaStreamRef.current) return mediaStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      return stream;
    } catch (err) {
      console.warn('getUserMedia failed', err);
      throw new Error('Camera/microphone permission denied');
    }
  }

  // start recording
  async function startRecording() {
    try {
      const stream = await ensureMediaStream();
      recordedChunksRef.current = [];
      let options = { mimeType: 'video/webm; codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm; codecs=vp8,opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'video/webm' };
      }
      const mr = new MediaRecorder(stream, options);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunksRef.current.push(e.data); };
      mr.onstop = () => setStatusMsg('Recording stopped');
      mr.start(1000);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setStatusMsg('Recording...');
    } catch (err) {
      console.error('startRecording error', err);
      setStatusMsg(err.message || 'Could not start recording');
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setIsRecording(false);
  }

  // mic control (SpeechRecognition)
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

  // submit answer
  const submitAnswer = async (explicitText) => {
    if (isSubmitting) return;
    const answerText = (typeof explicitText === 'string' && explicitText.trim()) ? explicitText.trim() : stagedAnswer.trim();
    if (!answerText) { setStatusMsg('No answer to submit'); return; }

    setIsSubmitting(true);
    setStatusMsg('Submitting answer...');
    try {
      setHistory(prev => [...prev, { role: 'user', text: answerText }]);
      setStagedAnswer('');
      setInterimTranscript('');

      const res = await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/turn`, { answer: answerText }, {
        headers: getAuthHeaders()
      });

      const { nextQuestion, done: finished } = res.data;

      if (nextQuestion) {
        setHistory(prev => [...prev, { role: 'assistant', text: nextQuestion }]);
        setCurrentQuestion(nextQuestion);
        speak(nextQuestion, () => {
          if (isListening) {
            try { recognitionRef.current?.stop(); } catch {}
            try { recognitionRef.current?.start(); } catch {}
          }
        });
      } else if (finished) {
        setDone(true);
        // finalize - navigate replace so back doesn't go back into interview
        await finalizeInterview(true);
      } else {
        setStatusMsg('No next question returned');
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

  const handleSkip = async () => {
    stopListening();
    setStatusMsg('Skipping...');
    try {
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/turn`, { answer: '__skip__' }, {
        headers: getAuthHeaders()
      });
      const { nextQuestion, done: finished } = res.data;
      if (nextQuestion) {
        setHistory(prev => [...prev, { role: 'assistant', text: nextQuestion }]);
        setCurrentQuestion(nextQuestion);
        speak(nextQuestion, () => { if (isListening) { try { recognitionRef.current?.start(); } catch {} } });
      } else if (finished) {
        setDone(true);
        await finalizeInterview(true);
      }
    } catch (err) {
      console.error('skip err', err);
      setStatusMsg('Failed to skip');
    }
  };

  const handleRepeat = () => {
    if (!currentQuestion) return;
    speak(currentQuestion, () => { if (isListening) try { recognitionRef.current?.start(); } catch {} });
  };

  // finalize upload: if replaceNav true do navigate replace (no back)
  const finalizeInterview = async (replaceNav = false) => {
    setStatusMsg('Finalizing interview — uploading media...');
    if (isRecording) stopRecording();
    if (isListening) stopListening();

    const transcriptText = history.map(h => `${h.role === 'assistant' ? 'Interviewer' : 'You'}: ${h.text}`).join('\n\n');
    const videoBlob = recordedChunksRef.current.length ? new Blob(recordedChunksRef.current, { type: 'video/webm' }) : null;
    const form = new FormData();
    form.append('transcript', new Blob([transcriptText], { type: 'text/plain' }), 'transcript.txt');
    if (videoBlob) form.append('video', videoBlob, 'interview.webm');

    try {
      const token = localStorage.getItem('token');
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' };
      await axios.post(`${import.meta.env.VITE_API_URL}/interviews/${interviewId}/complete`, form, { headers });

      // notify sidebar refresh
      localStorage.setItem('hiresim_refresh', Date.now());

      setStatusMsg('Uploaded. Redirecting to analysis...');
      // replace nav so back does not return to interview page
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

  // ensure cleanup of media on unmount
  useEffect(() => {
    return () => {
      // stop media tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') handleRepeat();
      if (e.key === 's' || e.key === 'S') handleSkip();
      if (e.code === 'Space') {
        e.preventDefault();
        if (isListening) stopListening();
        else startListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isListening, currentQuestion]);

  // Start interview (request media, then record & speak question)
  const handleStartActions = async () => {
    // request media and start recording only when user starts
    await startRecording();
    // start STT if supported
    if (supportsSTT && !isListening) startListening();
    if (currentQuestion) {
      speak(currentQuestion, () => setStatusMsg('Waiting for your response...'));
    } else {
      setStatusMsg('No question loaded');
    }
  };

  const progress = (interviewMeta && interviewMeta.numQuestions) ? `${(history.filter(h=>h.role==='assistant').length)}/${interviewMeta.numQuestions}` : null;

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-3 gap-6">
        {/* Main */}
        <div className="col-span-2 bg-white rounded shadow p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Live Interview</h1>
              <div className="text-sm text-gray-500 mt-1">{interviewMeta?.position ? `${interviewMeta.position} @ ${interviewMeta.company}` : 'Interview session'}</div>
            </div>
            <div className="text-right">
              {progress && <div className="text-sm text-gray-600">Progress: {progress}</div>}
              <div className="text-xs text-gray-400 mt-1">{statusMsg}</div>
            </div>
          </div>

          <div className="mt-6 p-4 border rounded bg-gray-50 min-h-[120px]">
            <div className="text-xs text-gray-500 mb-2">Current question</div>
            <div className="text-lg font-medium">{currentQuestion || 'Loading question...'}</div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={handleStartActions} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">
              Start Interview
            </button>

            <button onClick={handleRepeat} className="bg-white border px-3 py-2 rounded hover:bg-gray-50">Repeat</button>
            <button onClick={handleSkip} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-2 rounded">Skip</button>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => { if (isRecording) stopRecording(); else startRecording(); }}
                className={`px-3 py-2 rounded ${isRecording ? 'bg-red-500 text-white' : 'bg-gray-200'}`}
              >
                {isRecording ? 'Stop Recording' : 'Record'}
              </button>

              <button
                onClick={() => { if (isListening) stopListening(); else startListening(); }}
                className={`px-3 py-2 rounded ${isListening ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
              >
                {isListening ? 'Stop Mic' : 'Start Mic'}
              </button>
            </div>
          </div>

          {/* Staged answer */}
          <div className="mt-4">
            <div className="text-sm text-gray-500 mb-2">Answer (staged)</div>
            <div className="p-3 border rounded bg-white min-h-[80px]">
              <div className="min-h-[40px]">
                <div className="whitespace-pre-wrap">{stagedAnswer}</div>
                {interimTranscript && <div className="text-sm text-gray-400 mt-1 italic">({interimTranscript})</div>}
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={() => submitAnswer()} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
                  {isSubmitting ? 'Submitting…' : 'Submit Answer'}
                </button>
                <button onClick={() => { setStagedAnswer(''); setInterimTranscript(''); }} className="px-3 py-2 rounded bg-gray-200">Clear</button>
                <div className="ml-auto text-sm text-gray-500">Tip: press <strong>Space</strong> to toggle mic</div>
              </div>
            </div>
          </div>

          {/* Transcript */}
          <div className="mt-6">
            <div className="text-sm text-gray-500 mb-2">Transcript</div>
            <div className="max-h-64 overflow-y-auto p-3 border rounded bg-gray-50">
              {history.length === 0 && <div className="text-sm text-gray-400">No conversation yet.</div>}
              {history.map((h, i) => (
                <div key={i} className={`mb-3 ${h.role === 'assistant' ? 'text-left' : 'text-right'}`}>
                  <div className={`inline-block p-2 rounded ${h.role === 'assistant' ? 'bg-white' : 'bg-blue-100'}`}>{h.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="bg-white rounded shadow p-4 flex flex-col items-center">
          <video ref={videoRef} autoPlay muted playsInline className="w-full rounded bg-black" style={{ aspectRatio: '3/4', objectFit: 'cover' }} />
          <div className="w-full mt-3 flex gap-2">
            <button onClick={() => {
              if (recordedChunksRef.current.length) {
                const url = URL.createObjectURL(new Blob(recordedChunksRef.current));
                window.open(url, '_blank');
              } else {
                setStatusMsg('No recording yet');
              }
            }} className="flex-1 px-3 py-2 bg-gray-200 rounded">Preview Recording</button>

            <button onClick={() => finalizeInterview(true)} className="flex-1 px-3 py-2 bg-red-600 text-white rounded">End & Upload</button>
          </div>

          <div className="mt-4 w-full text-sm text-gray-600">
            <div><strong>Status:</strong> {statusMsg}</div>
            <div className="mt-2"><strong>Mic:</strong> {isListening ? 'On' : 'Off'} • <strong>Recording:</strong> {isRecording ? 'On' : 'Off'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
