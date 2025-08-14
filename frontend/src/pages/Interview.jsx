import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export default function Interview() {
  const { id: interviewId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navFirstQuestion = location.state?.firstQuestion || null;

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

  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const recognitionRef = useRef(null);
  const supportsSTT = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

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

        if (doc.status && doc.status !== 'in_progress') {
          navigate(`/analysis/${interviewId}`, { replace: true });
          return;
        }

        const ctx = Array.isArray(doc.context) ? doc.context.filter(c => c.role === 'assistant' || c.role === 'user') : [];
        setHistory(ctx.map(c => ({ role: c.role, text: c.content })));

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
  }, [interviewId]);

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

  const speak = (text, onEnd) => {
    if (!text) { onEnd?.(); return; }
    if (!window.speechSynthesis) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => onEnd?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

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

  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      const isEditable = active && (
        tag === 'input' ||
        tag === 'textarea' ||
        active.isContentEditable === true
      );
      if (isEditable) {
        return;
      }

      const k = e.key?.toLowerCase?.();

      if (k === 'r') {
        e.preventDefault();
        handleRepeat();
        return;
      }
      if (k === 's') {
        e.preventDefault();
        handleSkip();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (isListening) stopListening();
        else startListening();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isListening, currentQuestion]);


  const handleStartActions = async () => {
    await startRecording();
    if (supportsSTT && !isListening) startListening();
    if (currentQuestion) {
      speak(currentQuestion, () => setStatusMsg('Waiting for your response...'));
    } else {
      setStatusMsg('No question loaded');
    }
  };

  const progress = (interviewMeta && interviewMeta.numQuestions) ? `${(history.filter(h=>h.role==='assistant').length)}/${interviewMeta.numQuestions}` : null;

  const onStagedKeyDown = (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if ((isMac && e.metaKey && e.key === 'Enter') || (!isMac && e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      submitAnswer();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Live Interview</h1>
              <div className="text-sm text-gray-400 mt-1">
                {interviewMeta?.position ? `${interviewMeta.position} @ ${interviewMeta.company}` : 'Interview session'}
              </div>
            </div>
            <div className="text-right">
              {progress && <div className="text-sm text-gray-300">Progress: {progress}</div>}
              <div className="text-xs text-gray-500 mt-1">{statusMsg}</div>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-gray-700/50 border border-gray-600 min-h-[120px]">
            <div className="text-xs text-gray-400 mb-2">Current question</div>
            <div className="text-lg font-medium text-white">
              {currentQuestion || 'Loading question...'}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleStartActions}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition"
            >
              Start Interview
            </button>

            <button
              onClick={handleRepeat}
              className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg transition"
            >
              Repeat
            </button>

            <button
              onClick={handleSkip}
              className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded-lg transition"
            >
              Skip
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => { if (isRecording) stopRecording(); else startRecording(); }}
                className={`px-3 py-2 rounded-lg transition ${isRecording ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {isRecording ? 'Stop Recording' : 'Record'}
              </button>

              <button
                onClick={() => { if (isListening) stopListening(); else startListening(); }}
                className={`px-3 py-2 rounded-lg transition ${isListening ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
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
              className="w-full p-3 rounded-lg bg-gray-700/50 border border-gray-600 text-white min-h-[100px] resize-y"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => submitAnswer()}
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {isSubmitting ? 'Submitting…' : 'Submit Answer'}
              </button>

              <button
                onClick={() => { setStagedAnswer(''); setInterimTranscript(''); }}
                className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
              >
                Clear
              </button>

              {interimTranscript && (
                <button
                  onClick={() => setStagedAnswer(prev => (prev ? prev + ' ' : '') + interimTranscript)}
                  className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
                >
                  Apply interim
                </button>
              )}

              <div className="ml-auto text-sm text-gray-500">
                Tip: press <strong className="text-gray-300">Ctrl/Cmd+Enter</strong> to submit
              </div>
            </div>
          </div>

        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-700 flex flex-col">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full rounded-lg bg-black"
            style={{ aspectRatio: '3/4', objectFit: 'cover' }}
          />

          <div className="w-full mt-3 flex gap-2">
            <button
              onClick={() => {
                if (recordedChunksRef.current.length) {
                  const url = URL.createObjectURL(new Blob(recordedChunksRef.current));
                  window.open(url, '_blank');
                } else {
                  setStatusMsg('No recording yet');
                }
              }}
              className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
            >
              Preview Recording
            </button>

            <button
              onClick={() => finalizeInterview(true)}
              className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
            >
              End & Upload
            </button>
          </div>

          <div className="mt-4 w-full text-sm text-gray-400">
            <div><strong className="text-gray-300">Status:</strong> {statusMsg}</div>
            <div className="mt-2">
              <strong className="text-gray-300">Mic:</strong> {isListening ? 'On' : 'Off'} •
              <strong className="text-gray-300"> Recording:</strong> {isRecording ? 'On' : 'Off'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
