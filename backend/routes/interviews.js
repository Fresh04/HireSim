const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const { ObjectId, GridFSBucket } = require('mongodb');
const { Readable } = require('stream');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});

function buildSystemPrompt({ company, position, description, requirements, resumeText, numQuestions, difficulty, mode }) {
  return `
You are an expert technical interviewer for the role of ${position || 'the role'} at ${company || 'the company'}.
Job description: ${description || 'N/A'}
Requirements: ${requirements || 'None specified'}.
Candidate background: ${resumeText ? resumeText.slice(0, 2000) : 'No resume provided'}.
Interview settings: ${numQuestions ? `${numQuestions} questions, ` : ''}${difficulty ? `difficulty=${difficulty}, ` : ''}${mode ? `mode=${mode}, ` : ''}

Important constraints for every assistant message:
- Ask one question at a time and wait for the candidate's answer before moving on.
- Avoid asking the candidate to draw diagrams, open images, or produce long runnable code blocks.
- If code is needed, request a short pseudocode sketch and allow verbal explanation (no long full programs).
- Keep follow-ups short and focused (one sentence).
- Be polite and professional.

When appropriate, provide small clarifications, probing follow-ups, or the next question.
`.trim();
}


function extractJsonSubstring(text) {
  if (!text || typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch (e) {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const cand = text.slice(first, last + 1);
    try { return JSON.parse(cand); } catch (e) {}
  }
  let stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(i);
    if (text[i] === '}') {
      const start = stack.pop();
      if (start !== undefined) {
        const cand = text.slice(start, i + 1);
        try { return JSON.parse(cand); } catch (e) {}
      }
    }
  }
  return null;
}

function tryRepairJson(candidate) {
  if (!candidate) return null;
  let s = candidate.replace(/```(?:json)?/g, '').replace(/```\s*/g, '');
  s = s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  const first = s.indexOf('{');
  if (first > 0) s = s.slice(first);
  try { return JSON.parse(s); } catch (e) {}
  for (let cut = 0; cut < 6; cut++) {
    try {
      const part = s.slice(0, s.length - cut);
      return JSON.parse(part);
    } catch (e) {}
  }
  return null;
}

function parseQuestionsFromText(text) {
  if (!text) return [];
  text = text.replace(/```[\s\S]*?```/g, '').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  let cur = '';
  for (const l of lines) {
    if (/^(\d+[\.\)]|\-|\*|\u2022)\s+/.test(l)) {
      if (cur) items.push(cur.trim());
      cur = l.replace(/^(\d+[\.\)]|\-|\*|\u2022)\s+/, '');
    } else {
      cur += (cur ? ' ' : '') + l;
    }
  }
  if (cur) items.push(cur.trim());
  return items;
}


async function callGroq(messages) {
  const url = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const model = process.env.GROQ_MODEL;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !model) throw new Error('Missing GROQ_API_KEY or GROQ_MODEL in env');

  const payload = {
    model,
    messages,
    temperature: Number(process.env.GROQ_TEMPERATURE || 0.7),
    max_tokens: Number(process.env.GROQ_MAX_TOKENS || 512)
  };

  const resp = await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    timeout: Number(process.env.GROQ_TIMEOUT_MS || 60_000)
  });

  const choice = resp.data?.choices?.[0] || {};
  const assistantText = (choice?.message?.content || choice?.text || '').trim();
  return assistantText;
}

router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const interviews = await global.db.collection('interviews')
      .find({ userId })
      .project({ company: 1, position: 1, status: 1, createdAt: 1, updatedAt: 1 })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json(interviews);
  } catch (err) {
    console.error('Error in GET /interviews:', err);
    return res.status(500).json({ message: 'Failed to list interviews' });
  }
});

router.post('/', upload.single('resume'), async (req, res) => {
  try {
    const { company, position, description, requirements, numQuestions, difficulty, mode } = req.body;

    let resumeText = '';
    if (req.file && req.file.mimetype === 'application/pdf') {
      try {
        const parsed = await pdfParse(req.file.buffer);
        resumeText = (parsed && parsed.text) ? parsed.text.trim() : '';
      } catch (e) {
        console.warn('Failed to parse resume PDF:', e);
      }
    }

    const systemPrompt = buildSystemPrompt({ company, position, description, requirements, resumeText, numQuestions, difficulty, mode });

    const qPrompt = `
You are an expert interviewer generating interview questions for the role ${position || ''} at ${company || ''}.
You have to ask ${numQuestions || 5} ${difficulty || 'medium'}-difficulty technical interview questions tailored to this role and the job description below.

Constraints:
- DO NOT request drawings, diagrams, or ask the candidate to write long runnable code.
- If code is needed, ask for short pseudocode or a verbal explanation.
Return JSON only in exact format:
{ "questions": ["First question text", "Second question text", ...] }

Job description:
${description || ''}

Requirements:
${requirements || 'None specified'}

Candidate background:
${resumeText ? resumeText.slice(0,2000) : 'No resume provided'}

Get started with the interview now.
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: qPrompt }
    ];

    const qReply = await callGroq(messages);
    let parsed = extractJsonSubstring(qReply);
    let questions = [];
    if (parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions.map(q => typeof q === 'string' ? q.trim() : String(q));
    } else {
      questions = parseQuestionsFromText(qReply);
    }

    if (!questions || questions.length === 0) {
      questions = [
        'Explain a commonly used data structure and where you would use it.',
        'Describe a time you debugged a hard problem — how did you approach it?'
      ];
    }

    const firstQuestion = questions[0];

    const doc = {
      userId: req.user.id,
      company,
      position,
      description,
      requirements,
      numQuestions: numQuestions ? Number(numQuestions) : questions.length,
      difficulty,
      mode,
      resumeText,
      questions,
      currentQuestionIndex: 0,
      context: [
        { role: 'system', content: systemPrompt },
        { role: 'assistant', content: firstQuestion }
      ],
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await global.db.collection('interviews').insertOne(doc);
    return res.json({ interviewId: result.insertedId, assistant: firstQuestion });
  } catch (err) {
    console.error('Error creating interview:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to create interview session' });
  }
});
router.post('/:id/turn', async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });

    const { answer } = req.body;
    if (typeof answer !== 'string') return res.status(400).json({ message: 'Answer is required (string)' });

    const _id = new ObjectId(interviewId);
    const interviewsCol = global.db.collection('interviews');

    const interview = await interviewsCol.findOne({ _id });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });
    if (interview.status === 'completed') return res.status(400).json({ message: 'Interview already completed' });

    const persistContext = async (newContext, extra = {}) => {
      await interviewsCol.updateOne({ _id }, { $set: { context: newContext, updatedAt: new Date(), ...extra }});
      return await interviewsCol.findOne({ _id }, { projection: { resumeText: 0 }});
    };

    const lc = answer.trim().toLowerCase();
    const isStart = answer === '__start__';
    const isSkip = answer === '__skip__';

    const clarificationTriggers = [
      'what', 'could you', 'can you', 'please repeat', 'again', "i didn't", 'clarify', 'explain', 'repeat', 'say again', 'did you mean', '?'
    ];
    const isClarification = !isSkip && !isStart && (lc.endsWith('?') || clarificationTriggers.some(t => lc.startsWith(t) || lc.includes(t)));

    const context = Array.isArray(interview.context) ? [...interview.context] : [];

    if (isStart) {
      const lastAssistant = (context.slice().reverse().find(c => c.role === 'assistant'));
      if (lastAssistant && lastAssistant.content) {
        const updated = await persistContext(context);
        return res.json({ assistant: lastAssistant.content, nextQuestion: lastAssistant.content, followUp: null, done: false, interview: updated });
      }

      const systemPrompt = (context && context[0] && context[0].content) ? context[0].content : `You are an expert technical interviewer.`;
      const startMsg = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Begin the interview now. Ask the first question. Remember: do not ask the candidate to draw diagrams or write long runnable code. Keep questions answerable verbally.` }
      ];

      const assistantReply = await callGroq(startMsg);
      context.push({ role: 'assistant', content: assistantReply });
      const updatedInterview = await persistContext(context);
      return res.json({ assistant: assistantReply, nextQuestion: assistantReply, followUp: null, done: false, interview: updatedInterview });
    }

    if (isSkip) {
      context.push({ role: 'user', content: answer });

      if (Array.isArray(interview.questions) && interview.questions.length > 0) {
        const idx = typeof interview.currentQuestionIndex === 'number' ? interview.currentQuestionIndex : -1;
        const nextIndex = idx + 1;
        if (nextIndex < interview.questions.length) {
          const nextQuestion = interview.questions[nextIndex];
          context.push({ role: 'assistant', content: nextQuestion });
          const updatedInterview = await persistContext(context, { currentQuestionIndex: nextIndex });
          return res.json({ assistant: nextQuestion, nextQuestion, followUp: null, done: false, interview: updatedInterview });
        } else {
          const updatedInterview = await persistContext(context, { currentQuestionIndex: interview.questions.length - 1, status: 'questions_completed' });
          return res.json({ assistant: null, nextQuestion: null, followUp: null, done: true, interview: updatedInterview });
        }
      }

      const assistantReply = await callGroq(context);
      context.push({ role: 'assistant', content: assistantReply });
      const updatedInterview = await persistContext(context);
      const done = /conclud|that concludes|end of interview/i.test(assistantReply);
      return res.json({ assistant: assistantReply, nextQuestion: assistantReply, followUp: null, done, interview: updatedInterview });
    }

    if (isClarification) {
      context.push({ role: 'user', content: answer });
      const clarifierSystem = (context && context[0] && context[0].content) ? context[0].content : `You are an expert technical interviewer.`;
      const messages = [
        { role: 'system', content: clarifierSystem },
        { role: 'user', content: `The candidate asked: "${answer}". As the interviewer, respond briefly (1-2 sentences) clarifying or restating the question. Do NOT advance to the next interview question.` }
      ];
      const assistantReply = await callGroq(messages);
      context.push({ role: 'assistant', content: assistantReply });
      const updatedInterview = await persistContext(context);
      return res.json({ assistant: assistantReply, nextQuestion: null, followUp: assistantReply, done: false, interview: updatedInterview });
    }

    context.push({ role: 'user', content: answer });

    const systemPrompt = (context && context[0] && context[0].content) ? context[0].content : `You are an expert technical interviewer for the role ${interview.position || ''}.`;

    const decisionPrompt = `
You are the interviewer. The candidate has just answered the previous question.
Decide whether to:
- ask a brief probing follow-up question (one sentence) OR
- proceed to the next pre-generated question (if available) OR
- end the interview.

Return STRICT JSON ONLY in one of these three forms:

1) Ask follow-up:
{ "action": "ask", "text": "<one-sentence follow-up question>" }

2) Proceed:
{ "action": "proceed" }

3) End:
{ "action": "end" }

Base your decision on the candidate's answer and whether a technical probing/follow-up would be valuable. If you ask a follow-up, keep it short and concrete. Do NOT include other keys or text.
`;

    const decisionMessages = [
      { role: 'system', content: systemPrompt },
      ...context.slice(-12),
      { role: 'user', content: decisionPrompt }
    ];

    let decisionText = '';
    try {
      decisionText = await callGroq(decisionMessages);
    } catch (e) {
      console.warn('Decision LLM failed:', e);
    }

    let decision = extractJsonSubstring(decisionText) || tryRepairJson(decisionText);
    if (!decision) {
      if (answer.trim().length < 30) decision = { action: 'ask', text: 'Could you expand on that a bit more — what was your thought process?' };
      else decision = { action: 'proceed' };
    }

    if (decision.action === 'ask' && decision.text) {
      const followUp = decision.text.trim();
      context.push({ role: 'assistant', content: followUp });
      const updatedInterview = await persistContext(context);
      return res.json({ assistant: followUp, nextQuestion: null, followUp, done: false, interview: updatedInterview });
    }

    if (decision.action === 'end') {
      const updatedInterview = await persistContext(context, { status: 'questions_completed' });
      return res.json({ assistant: null, nextQuestion: null, followUp: null, done: true, interview: updatedInterview });
    }

    if (Array.isArray(interview.questions) && interview.questions.length > 0) {
      const idx = typeof interview.currentQuestionIndex === 'number' ? interview.currentQuestionIndex : -1;
      const nextIndex = idx + 1;
      if (nextIndex < interview.questions.length) {
        const nextQuestion = interview.questions[nextIndex];
        context.push({ role: 'assistant', content: nextQuestion });
        const updatedInterview = await persistContext(context, { currentQuestionIndex: nextIndex });
        return res.json({ assistant: nextQuestion, nextQuestion, followUp: null, done: false, interview: updatedInterview });
      } else {
        const updatedInterview = await persistContext(context, { currentQuestionIndex: interview.questions.length - 1, status: 'questions_completed' });
        return res.json({ assistant: null, nextQuestion: null, followUp: null, done: true, interview: updatedInterview });
      }
    }

    const assistantReply = await callGroq(context);
    context.push({ role: 'assistant', content: assistantReply });
    const updatedInterview = await persistContext(context);
    const done = /conclud|that concludes|end of interview/i.test(assistantReply);
    return res.json({ assistant: assistantReply, nextQuestion: assistantReply, followUp: null, done, interview: updatedInterview });

  } catch (err) {
    console.error('Error in POST /interviews/:id/turn:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to process turn' });
  }
});

router.post('/:id/complete', upload.fields([{ name: 'video' }, { name: 'transcript' }]), async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });

    const _id = new ObjectId(interviewId);
    const interviewsCol = global.db.collection('interviews');

    const interview = await interviewsCol.findOne({ _id });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    let transcriptText = '';
    if (req.files && req.files['transcript'] && req.files['transcript'][0]) {
      transcriptText = req.files['transcript'][0].buffer.toString('utf-8');
    } else if (req.body && req.body.transcriptText) {
      transcriptText = req.body.transcriptText;
    } else if (req.body && req.body.transcript) {
      transcriptText = req.body.transcript;
    }

    const updateDoc = {
      $set: {
        transcript: transcriptText,
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date()
      }
    };

    if (req.files && req.files['video'] && req.files['video'][0]) {
      const videoFile = req.files['video'][0];
      const bucket = new GridFSBucket(global.db, { bucketName: 'interview_videos' });
      const filename = `interview_${interviewId}_${Date.now()}.${videoFile.mimetype === 'video/webm' ? 'webm' : 'bin'}`;

      const uploadStream = bucket.openUploadStream(filename, {
        contentType: videoFile.mimetype,
        metadata: { interviewId, uploadedBy: req.user?.id || null }
      });

      const readable = Readable.from(videoFile.buffer);
      await new Promise((resolve, reject) => {
        readable.pipe(uploadStream).on('error', reject).on('finish', () => {
          updateDoc.$set.videoFileId = uploadStream.id;
          updateDoc.$set.videoFileName = filename;
          resolve();
        });
      });
    }

    await interviewsCol.updateOne({ _id }, updateDoc);
    const updatedInterview = await interviewsCol.findOne({ _id }, { projection: { resumeText: 0 }});
    return res.json({ message: 'Interview completed', interviewId, interview: updatedInterview });
  } catch (err) {
    console.error('Error in POST /interviews/:id/complete:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to complete interview' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });
    const _id = new ObjectId(interviewId);
    const interview = await global.db.collection('interviews').findOne({ _id }, { projection: { resumeText: 0 }});
    if (!interview) return res.status(404).json({ message: 'Interview not found' });
    return res.json(interview);
  } catch (err) {
    console.error('Error in GET /interviews/:id:', err.message || err);
    return res.status(500).json({ message: 'Failed to fetch interview' });
  }
});

async function robustParseAnalysis(llmText, callFn) {
  const direct = extractJsonSubstring(llmText);
  if (direct) return { analysis: direct, raw: llmText };

  const formatter = `
The previous output may contain commentary. Reformat the content into strict JSON ONLY matching this schema:

{
  "scores": {
    "communication": <int|null>,
    "technical": <int|null>,
    "structure": <int|null>,
    "confidence": <int|null>,
    "nonverbal": <int|null|"N/A">
  },
  "summary": "<1-3 sentence summary>",
  "improvements": ["actionable item 1", "item 2", ...],
  "strengths": ["strength 1", "strength 2"]
}

Return JSON only. Here is the original output:
---
${llmText}
---
Return the JSON only.
`;
  try {
    const resp = await callFn([{ role: 'system', content: 'You are a strict JSON formatter.' }, { role: 'user', content: formatter }]);
    const parsed = extractJsonSubstring(resp) || tryRepairJson(resp);
    if (parsed) return { analysis: parsed, raw: resp };
  } catch (e) { }

  return {
    analysis: {
      scores: { communication: null, technical: null, structure: null, confidence: null, nonverbal: null },
      summary: llmText.slice(0, 1000),
      improvements: ['Could not parse structured analysis — inspect raw output.'],
      strengths: []
    },
    raw: llmText
  };
}

router.post('/:id/analyze', async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });
    const _id = new ObjectId(interviewId);
    const interviewsCol = global.db.collection('interviews');
    const interview = await interviewsCol.findOne({ _id });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    if (!interview.transcript && (!interview.context || interview.context.length === 0)) {
      return res.status(400).json({ message: 'No transcript or context to analyze' });
    }

    const transcriptText = interview.transcript || interview.context.map(c => `${c.role.toUpperCase()}: ${c.content}`).join('\n');
    const resumeSummary = interview.resumeText ? `Candidate resume summary:\n${interview.resumeText}\n\n` : '';

    const analysisPrompt = `
You are an experienced technical interviewer and coach. Given the interview transcript below, produce:
1) Numeric scores 1-5 (integers) for: Communication (clarity), Technical Accuracy, Problem Solving / Depth, Structure, Confidence / Presence, Nonverbal (if video used else "N/A").
2) A concise 2-3 sentence summary.
3) Four prioritized, actionable improvements.
4) Three strengths.

Return JSON ONLY with keys: scores, summary, improvements, strengths.

${resumeSummary}
Transcript:
${transcriptText}
`;

    const messages = [
      { role: 'system', content: 'You are an expert technical interviewer and coach.' },
      { role: 'user', content: analysisPrompt }
    ];

    const llmText = await callGroq(messages);
    const { analysis, raw } = await robustParseAnalysis(llmText, callGroq);

    await interviewsCol.updateOne({ _id }, { $set: { analysis, analysisRaw: raw, analysisAt: new Date(), updatedAt: new Date() }});
    return res.json({ analysis });
  } catch (err) {
    console.error('Error in POST /interviews/:id/analyze:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to analyze interview' });
  }
});

module.exports = router;
