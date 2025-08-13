// routes/interviews.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const { ObjectId, GridFSBucket } = require('mongodb');
const { Readable } = require('stream');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB cap (adjust as needed)
});

/** ---------------------
 * Helper: build system prompt
 * --------------------- */
function buildSystemPrompt({ company, position, description, requirements, resumeText, numQuestions, difficulty, mode }) {
  return `
You are an expert technical interviewer for the role of ${position} at ${company}.
Job description: ${description}
Requirements: ${requirements || 'None specified'}.
Candidate background: ${resumeText || 'No resume provided'}.
Interview settings: ${numQuestions ? `${numQuestions} questions, ` : ''}${difficulty ? `difficulty=${difficulty}, ` : ''}${mode ? `mode=${mode}` : ''}

Ask one question at a time, wait for the candidate's answer, and allow clarifications.
When ready to move on, ask the next question. If you decide the interview is complete, say "That concludes our interview."
`.trim();
}

/** ---------------------
 * JSON extraction & robust parsing helpers (improved)
 * --------------------- */

/**
 * Attempts to extract a JSON object from free text (various heuristics).
 * Returns parsed object or null.
 */
function extractJsonSubstring(text) {
  if (!text) return null;

  // 1) code fence JSON ```json ... ```
  const codeFenceJson = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceJson && codeFenceJson[1]) {
    try { return JSON.parse(codeFenceJson[1].trim()); } catch (e) { /* continue */ }
  }

  // 2) first {...} .. last } quick attempt
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const cand = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(cand); } catch (e) { /* continue */ }
  }

  // 3) scan for balanced braces and attempt parse for each candidate
  let stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(i);
    if (text[i] === '}') {
      const start = stack.pop();
      if (start !== undefined) {
        const cand = text.slice(start, i + 1);
        try { return JSON.parse(cand); } catch (e) { /* keep scanning */ }
      }
    }
  }

  return null;
}

/**
 * Attempt to repair truncated JSON candidate by removing trailing commas,
 * appending missing braces/brackets, and trying incremental cuts.
 */
function tryRepairJson(candidate) {
  if (!candidate) return null;
  let work = candidate;

  // strip markdown fences
  work = work.replace(/```(?:json)?/gi, '').replace(/```/g, '');

  // remove trailing commas in objects/arrays
  work = work.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  // trim leading non-brace text
  const first = work.indexOf('{');
  if (first > 0) work = work.slice(first);

  // quick parse attempt
  try { return JSON.parse(work); } catch (e) { /* continue */ }

  // count brackets and append closing ones if missing
  const openBrace = (work.match(/{/g) || []).length;
  const closeBrace = (work.match(/}/g) || []).length;
  const openBracket = (work.match(/\[/g) || []).length;
  const closeBracket = (work.match(/]/g) || []).length;

  let repaired = work;
  const addBraces = Math.max(0, openBrace - closeBrace);
  const addBrackets = Math.max(0, openBracket - closeBracket);
  for (let i = 0; i < Math.min(addBraces, 6); i++) repaired += '}';
  for (let i = 0; i < Math.min(addBrackets, 6); i++) repaired += ']';

  // remove odd control chars and try incremental truncation
  repaired = repaired.replace(/[\u0000-\u001F]+/g, '').trim();

  for (let extra = 0; extra <= 5; extra++) {
    try {
      const candidateTry = repaired.slice(0, repaired.length - extra);
      return JSON.parse(candidateTry);
    } catch (e) {
      // continue
    }
  }

  return null;
}

/**
 * Greedy regex-based extraction for common fields (scores, improvements, strengths).
 * Returns an object with { scores, improvements, strengths } (arrays/objects possibly empty).
 */
function extractFieldsGreedy(text) {
  const scores = {};
  const improvements = [];
  const strengths = [];

  if (!text) return { scores, improvements, strengths };
  // try to match key: value pairs that look like scores
  const scorePairs = text.match(/["']?([A-Za-z0-9 \/\(\)-]+?)["']?\s*:\s*("?(\d+|N\/A|N\/A)?"?)/g);
  if (scorePairs) {
    for (const pair of scorePairs) {
      const m = pair.match(/["']?([A-Za-z0-9 \/\(\)-]+?)["']?\s*:\s*("?(\d+|N\/A)?"?)/i);
      if (m) {
        const key = m[1].trim();
        const valRaw = m[3];
        const val = /\d+/.test(valRaw) ? parseInt(valRaw, 10) : valRaw;
        const k = key.toLowerCase();
        if (k.includes('commun')) scores.communication = val;
        else if (k.includes('technical')) scores.technical = val;
        else if (k.includes('problem') || k.includes('solv')) scores.problem = val;
        else if (k.includes('structure') || k.includes('organ')) scores.structure = val;
        else if (k.includes('confidence') || k.includes('presence')) scores.confidence = val;
        else if (k.includes('nonverb')) scores.nonverbal = val;
      }
    }
  }

  // helper to extract bullet/number lists after headings
  function extractListByKey(k) {
    const results = [];

    // JSON-like array e.g., "improvements": ["a","b"]
    const reJsonArr = new RegExp(`"${k}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'i');
    const m = text.match(reJsonArr);
    if (m && m[1]) {
      const raw = m[1];
      const items = raw.split(/,\s*(?=(?:[^"']*"[^"']*")*[^"']*$)/).map(s => s.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(Boolean);
      if (items.length) return items;
    }

    // fallback: heading followed by lines
    const reHeading = new RegExp(`${k}\\s*[:\\-\\n]+([\\s\\S]{0,600})`, 'i');
    const h = text.match(reHeading);
    if (h && h[1]) {
      const block = h[1];
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      for (const ln of lines) {
        const m2 = ln.match(/^[-•\*]\s*(.+)$/) || ln.match(/^\d+[\.\)]\s*(.+)$/) || ln.match(/^"(.+)"$/);
        if (m2) results.push(m2[1].trim());
        else if (ln.length < 200 && ln.endsWith('.')) results.push(ln.replace(/^[\-\d\.\)\s]+/, '').trim());
      }
    }
    return results;
  }

  const imps = extractListByKey('improvements');
  const snts = extractListByKey('strengths');
  if (imps.length) improvements.push(...imps);
  if (snts.length) strengths.push(...snts);

  // as a final fallback, look for a small block after "Improvements" or "Strengths"
  if (improvements.length === 0) {
    const alt = extractListByKey('Improvements');
    if (alt.length) improvements.push(...alt);
  }
  if (strengths.length === 0) {
    const alt2 = extractListByKey('Strengths');
    if (alt2.length) strengths.push(...alt2);
  }

  return { scores, improvements, strengths };
}

/**
 * Attempts robust parsing of an analysis LLM reply.
 * - if JSON found -> return parsed
 * - else attempt repair of truncated JSON
 * - else try greedy regex extraction
 * - else call LLM (formatter prompts) to get strict JSON (1-2 attempts)
 * - final fallback returns safe structure and the raw text
 */
async function robustParseAnalysis(llmText, callGroq) {
  // 1) direct extraction
  const direct = extractJsonSubstring(llmText);
  if (direct) return { analysis: direct, raw: llmText };

  // 2) try to repair truncated JSON
  const firstBrace = llmText.indexOf('{');
  if (firstBrace >= 0) {
    const candidate = llmText.slice(firstBrace);
    const repaired = tryRepairJson(candidate);
    if (repaired) return { analysis: repaired, raw: llmText };
  }

  // 3) greedy extraction
  const greedy = extractFieldsGreedy(llmText);
  const anyGreedy = (greedy && (Object.keys(greedy.scores).length || greedy.improvements.length || greedy.strengths.length));
  if (anyGreedy) {
    const fallback = {
      scores: {
        communication: greedy.scores.communication ?? null,
        technical: greedy.scores.technical ?? null,
        structure: greedy.scores.structure ?? null,
        confidence: greedy.scores.confidence ?? null,
        nonverbal: greedy.scores.nonverbal ?? null
      },
      summary: (llmText.split('\n').slice(0, 3).join(' ')).slice(0, 1000),
      improvements: greedy.improvements || [],
      strengths: greedy.strengths || []
    };
    return { analysis: fallback, raw: llmText };
  }

  // 4) ask LLM to reformat (attempt 1)
  const formatter1 = `
The previous output may contain commentary or broken formatting. PLEASE RETURN A VALID JSON OBJECT ONLY with this schema:

{
  "scores": { "communication": <int|null>, "technical": <int|null>, "structure": <int|null>, "confidence": <int|null>, "nonverbal": <int|null|"N/A"> },
  "summary": "<string up to 300 chars>",
  "improvements": ["string", ...],
  "strengths": ["string", ...]
}

If a field cannot be determined, use null (or "N/A" for nonverbal). Do not add any other fields or text. Here is the original output:
---
${llmText}
---
Return the JSON only.
`;
  try {
    const resp1 = await callGroq([{ role: 'system', content: 'You are a strict JSON formatter.' }, { role: 'user', content: formatter1 }]);
    const parsed1 = extractJsonSubstring(resp1) || tryRepairJson(resp1);
    if (parsed1) return { analysis: parsed1, raw: resp1 };
  } catch (e) { /* continue */ }

  // 5) second formatter attempt (more explicit)
  const formatter2 = `
You will ONLY output valid JSON (no markdown, no commentary). Extract these fields from the input or return null if not found:

{
  "scores": { "communication": <int|null>, "technical": <int|null>, "structure": <int|null>, "confidence": <int|null>, "nonverbal": <int|null|"N/A"> },
  "summary": "<2-3 sentence summary>",
  "improvements": ["1", "2", ...],
  "strengths": ["1", "2", ...]
}

Now reformat the input below into that JSON only:
---
${llmText}
---
Return only the JSON.
`;
  try {
    const resp2 = await callGroq([{ role: 'system', content: 'You are a JSON extraction assistant.' }, { role: 'user', content: formatter2 }]);
    const parsed2 = extractJsonSubstring(resp2) || tryRepairJson(resp2);
    if (parsed2) return { analysis: parsed2, raw: resp2 };
  } catch (e) { /* continue */ }

  // 6) final fallback
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

/** ---------------------
 * Helper: parse numbered/bulleted question lists (fallback)
 * --------------------- */
function parseQuestionsFromText(text) {
  if (!text) return [];
  text = text.replace(/```[\s\S]*?```/g, '').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  let current = '';
  for (const line of lines) {
    if (/^(\d+[\.\)]|\-|\*|\u2022)\s+/.test(line)) {
      if (current) items.push(current.trim());
      current = line.replace(/^(\d+[\.\)]|\-|\*|\u2022)\s+/, '');
    } else if (/^\d+\s+-\s+/.test(line)) {
      if (current) items.push(current.trim());
      current = line.replace(/^\d+\s+-\s+/, '');
    } else {
      current += (current ? ' ' : '') + line;
    }
  }
  if (current) items.push(current.trim());
  return items;
}

/** ---------------------
 * Helper: call Groq (chat completions-compatible endpoint)
 * --------------------- */
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
  const assistantText = choice?.message?.content?.trim() || (choice?.text || '').trim() || '';
  return assistantText;
}

/** ---------------------
 * Routes
 * --------------------- */

/**
 * GET /interviews
 * List interviews for the authenticated user
 */
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

/**
 * POST /interviews
 * Create interview: generate questions (JSON preferred), store questions array and firstQuestion
 */
router.post('/', upload.single('resume'), async (req, res) => {
  try {
    const { company, position, description, requirements, numQuestions, difficulty, mode } = req.body;

    // parse resume text if provided
    let resumeText = '';
    if (req.file && req.file.mimetype === 'application/pdf') {
      try {
        const parsed = await pdfParse(req.file.buffer);
        resumeText = parsed.text.trim();
      } catch (e) {
        console.warn('Failed to parse resume PDF:', e);
      }
    }

    const systemPrompt = buildSystemPrompt({ company, position, description, requirements, resumeText, numQuestions, difficulty, mode });

    const qPrompt = `
You are an expert interviewer generating interview questions for the role ${position} at ${company}.
Generate ${numQuestions || 5} ${difficulty || 'medium'}-difficulty technical interview questions tailored to this role and the job description below.

Return JSON ONLY in this exact format:
{ "questions": ["First question text", "Second question text", "..."] }

Do NOT include any explanations, numbering, commentary, or other fields.
Job description:
${description}

Requirements:
${requirements || 'None specified'}

Candidate background:
${resumeText || 'No resume provided'}
`;

    // call LLM and attempt to parse JSON questions
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: qPrompt }
    ];

    const qReply = await callGroq(messages);
    let parsed = extractJsonSubstring(qReply);
    let questions = [];
    if (parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions.map(q => (typeof q === 'string' ? q.trim() : String(q)));
    } else {
      // fallback: parse free-text lists
      questions = parseQuestionsFromText(qReply);
    }

    // defensive fallback if still empty
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
    return res.json({ interviewId: result.insertedId, firstQuestion });
  } catch (err) {
    console.error('Error creating interview:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to create interview session' });
  }
});

/**
 * POST /interviews/:id/turn
 * Accepts { answer: string } — appends user's answer and returns nextQuestion (from stored questions or LLM)
 */
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

    const userMessage = { role: 'user', content: answer };
    const updatedContext = Array.isArray(interview.context) ? [...interview.context, userMessage] : [userMessage];

    // If pre-generated questions exist, consume deterministically
    if (Array.isArray(interview.questions) && interview.questions.length > 0) {
      const idx = typeof interview.currentQuestionIndex === 'number' ? interview.currentQuestionIndex : 0;
      const nextIndex = idx + 1;

      if (nextIndex < interview.questions.length) {
        const nextQuestion = interview.questions[nextIndex];
        updatedContext.push({ role: 'assistant', content: nextQuestion });

        await interviewsCol.updateOne({ _id }, {
          $set: { context: updatedContext, currentQuestionIndex: nextIndex, updatedAt: new Date() }
        });

        return res.json({ nextQuestion, done: false });
      } else {
        // reached last question -> mark questions_completed (client can call /complete)
        await interviewsCol.updateOne({ _id }, {
          $set: { context: updatedContext, currentQuestionIndex: interview.questions.length - 1, status: 'questions_completed', updatedAt: new Date() }
        });

        return res.json({ nextQuestion: null, done: true });
      }
    }

    // Fallback: call LLM with chat context to generate assistant reply
    const assistantReply = await callGroq(updatedContext);
    updatedContext.push({ role: 'assistant', content: assistantReply });

    await interviewsCol.updateOne({ _id }, { $set: { context: updatedContext, updatedAt: new Date() } });

    const done = /conclud|that concludes|end of interview/i.test(assistantReply);

    return res.json({ nextQuestion: assistantReply, done });
  } catch (err) {
    console.error('Error in /interviews/:id/turn:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to process turn' });
  }
});

/**
 * POST /interviews/:id/complete
 * Accepts transcript (file or field) and optional video file (GridFS).
 * Marks interview completed and stores transcript/video reference.
 */
router.post('/:id/complete', upload.fields([{ name: 'video' }, { name: 'transcript' }]), async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });

    const _id = new ObjectId(interviewId);
    const interviewsCol = global.db.collection('interviews');

    const interview = await interviewsCol.findOne({ _id });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    // determine transcript text
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

    // store video in GridFS if provided
    if (req.files && req.files['video'] && req.files['video'][0]) {
      const videoFile = req.files['video'][0];
      const bucket = new GridFSBucket(global.db, { bucketName: 'interview_videos' });
      const filename = `interview_${interviewId}_${Date.now()}.${(videoFile.mimetype === 'video/webm' ? 'webm' : 'bin')}`;

      const uploadStream = bucket.openUploadStream(filename, {
        contentType: videoFile.mimetype,
        metadata: {
          interviewId: interviewId,
          uploadedBy: req.user?.id || null
        }
      });

      const readable = Readable.from(videoFile.buffer);
      await new Promise((resolve, reject) => {
        readable.pipe(uploadStream)
          .on('error', reject)
          .on('finish', () => {
            updateDoc.$set.videoFileId = uploadStream.id;
            updateDoc.$set.videoFileName = filename;
            resolve();
          });
      });
    }

    await interviewsCol.updateOne({ _id }, updateDoc);
    return res.json({ message: 'Interview completed', interviewId: interviewId });
  } catch (err) {
    console.error('Error in /interviews/:id/complete:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to complete interview' });
  }
});

/**
 * GET /interviews/:id
 * Return full interview session (excluding large resumeText)
 */
router.get('/:id', async (req, res) => {
  try {
    const interviewId = req.params.id;
    if (!ObjectId.isValid(interviewId)) return res.status(400).json({ message: 'Invalid interview id' });

    const _id = new ObjectId(interviewId);
    const interview = await global.db.collection('interviews').findOne({ _id }, { projection: { resumeText: 0 } });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    return res.json(interview);
  } catch (err) {
    console.error('Error in GET /interviews/:id:', err.message || err);
    return res.status(500).json({ message: 'Failed to fetch interview' });
  }
});

/**
 * POST /interviews/:id/analyze
 * Use robustParseAnalysis to extract structured JSON from LLM.
 */
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
You are an experienced technical interviewer and coach. Given the following interview transcript, produce:
1) Numeric scores 1-5 (integers) for: Communication (clarity), Technical Accuracy, Problem Solving / Depth, Structure (how answers are organized), Confidence / Presence, and Nonverbal (if video used — otherwise set N/A).
2) A concise paragraph summary (2-3 sentences).
3) 4 actionable bullet improvements prioritized (what to practice next).
4) 3 strengths observed.

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

    await interviewsCol.updateOne({ _id }, { $set: { analysis, analysisRaw: raw, analysisAt: new Date(), updatedAt: new Date() } });
    return res.json({ analysis });
  } catch (err) {
    console.error('Error in POST /interviews/:id/analyze:', err.response?.data || err.message || err);
    return res.status(500).json({ message: 'Failed to analyze interview' });
  }
});

module.exports = router;
