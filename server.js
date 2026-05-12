import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Shared AI helper
async function aiComplete(systemPrompt, userPrompt, maxTokens = 1024) {
  const key = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No API key configured. Set GROQ_API_KEY or OPENAI_API_KEY env var.');
  
  const baseUrl = process.env.GROQ_API_KEY 
    ? 'https://api.groq.com/openai/v1' 
    : 'https://api.openai.com/v1';
  const model = process.env.MODEL || (process.env.GROQ_API_KEY ? 'mixtral-8x7b-32768' : 'gpt-4o-mini');
  
  console.log(`[AI] Calling ${baseUrl} with model ${model}`);
  
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.7,
      max_tokens: maxTokens
    })
  });
  
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[AI ERROR] Status ${res.status}: ${errBody}`);
    throw new Error(`AI API error ${res.status}: ${errBody.slice(0, 200)}`);
  }
  
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

function parseJSONArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found');
  return JSON.parse(match[0]);
}

// --- PROJECT ROUTES ---

// Day 5: Portfolio Roaster
const rateLimit = new Map();
app.post('/portfolio-roaster/api/roast', async (req, res) => {
  try {
    const ip = req.ip;
    if (rateLimit.get(ip) > Date.now() - 60000) return res.status(429).json({ error: 'Rate limited. 1 request per minute.' });
    rateLimit.set(ip, Date.now());
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const fetchMod = await import('node-fetch');
    const html = await (await fetchMod.default(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 })).text();
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
    const result = await aiComplete(
      'You are a brutally honest portfolio reviewer. Return JSON: { "overall_score": number 0-100, "roast_summary": "string", "sections": [{"name":"Design","score":0-100,"roast":"string","fix":"string"},{"name":"Content","score":0-100,"roast":"string","fix":"string"},{"name":"UX","score":0-100,"roast":"string","fix":"string"},{"name":"Mobile","score":0-100,"roast":"string","fix":"string"},{"name":"CTA","score":0-100,"roast":"string","fix":"string"}] }',
      `Roast this portfolio. Page content: ${text}`, 800
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[portfolio-roaster] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 6: Regex Tester (AI explain)
app.post('/regex-tester/api/explain', async (req, res) => {
  try {
    const { regex } = req.body;
    const result = await aiComplete(
      'Explain this regex in plain English. Cover: what it does overall, what each part means, edge cases it misses, and a one-line code comment.',
      `Regex: ${regex}`, 500
    );
    res.json({ explanation: result });
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 7: Cold Email
app.post('/cold-email/api/personalize', async (req, res) => {
  try {
    const { prospect, sender, tone } = req.body;
    const result = await aiComplete(
      `Generate 2 cold email variants as JSON: { "variant1": {"subject":"","body":""}, "variant2": {"subject":"","body":""} }. Tone: ${tone || 'conversational'}. Hyper-personalized first line, concise value prop, social proof, low-friction CTA.`,
      `Prospect: ${JSON.stringify(prospect)}. Sender: ${JSON.stringify(sender)}`, 800
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 8: Code Review
app.post('/code-review/api/review', async (req, res) => {
  try {
    const { code, language } = req.body;
    const truncated = (code || '').slice(0, 8000);
    const result = await aiComplete(
      `Review this ${language || 'code'}. Return JSON: { "summary":"", "score": 0-100, "issues": [{"line":0,"severity":"critical|warning|suggestion","category":"bug|security|performance|style","description":"","fix":""}], "positives":[""] }`,
      truncated, 1024
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 9: SQL Explainer
app.post('/sql-explainer/api/explain', async (req, res) => {
  try {
    const { sql, dialect } = req.body;
    const result = await aiComplete(
      `Explain this ${dialect || 'SQL'} query. Return JSON: { "summary":"", "steps":[{"step":1,"clause":"","explanation":""}], "performance_notes":[""], "issues":[""], "optimized_version":"" }`,
      sql, 1024
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 10: Salary Negotiation
app.post('/salary-negotiation/api/script', async (req, res) => {
  try {
    const data = req.body;
    const result = await aiComplete(
      'Generate a salary negotiation script. Return JSON: { "opening":"", "anchor":"", "objection_best_offer":"", "objection_need_time":"", "closing":"", "email_draft":"" }',
      JSON.stringify(data), 1024
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 11: Interview Questions
app.post('/interview-questions/api/generate', async (req, res) => {
  try {
    const { jd, level, type, company, count } = req.body;
    const result = await aiComplete(
      `Generate ${count || 10} interview questions. Return JSON array: [{"question":"","type":"","difficulty":"","what_it_tests":"","good_answer_signals":[""],"red_flags":[""],"follow_ups":[""]}]`,
      `JD: ${(jd || '').slice(0, 3000)}. Level: ${level}. Type: ${type}. Company: ${company}`, 2048
    );
    res.json(parseJSONArray(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 12: README Generator
app.post('/readme-generator/api/generate', async (req, res) => {
  try {
    const { input, githubUrl } = req.body;
    let context = input || '';
    if (githubUrl) {
      const fetchMod = await import('node-fetch');
      const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        const [, owner, repo] = match;
        const tree = await (await fetchMod.default(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`)).json();
        context = `Repo: ${owner}/${repo}\nFiles:\n${(tree.tree || []).slice(0, 80).map(f => f.path).join('\n')}`;
      }
    }
    const result = await aiComplete(
      'Generate a complete README.md in Markdown format. Include: title, description, features, tech stack, installation, usage, environment variables, and license.',
      context, 2048
    );
    res.json({ readme: result });
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 13: Standup Generator
app.post('/standup-generator/api/standup', async (req, res) => {
  try {
    const { yesterday, today, blockers, team } = req.body;
    const result = await aiComplete(
      'Generate 3 standup format variants as JSON: { "async":"(Slack-ready with emoji)", "verbose":"(meeting-ready full sentences)", "minimal":"(3 bullets max)" }',
      `Yesterday: ${yesterday}. Today: ${today}. Blockers: ${blockers || 'None'}. Team: ${team || ''}`, 600
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 14: Tech Stack Detector (no AI)
app.post('/tech-stack-detector/api/detect', async (req, res) => {
  try {
    const { url } = req.body;
    const fetchMod = await import('node-fetch');
    const response = await fetchMod.default(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, redirect: 'follow', timeout: 10000 });
    const headers = Object.fromEntries(response.headers.entries());
    const html = await response.text();
    const { load } = await import('cheerio');
    const $ = load(html);
    const techs = [];
    const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get().join(' ');
    const links = $('link[href]').map((_, el) => $(el).attr('href')).get().join(' ');
    const meta = $('meta[name="generator"]').attr('content') || '';
    // Detection rules
    if (scripts.includes('react') || html.includes('__NEXT_DATA__')) techs.push({ category: 'Frontend', name: 'React', confidence: 'definite', evidence: 'React scripts detected' });
    if (html.includes('__NEXT_DATA__') || html.includes('_next/')) techs.push({ category: 'Frontend', name: 'Next.js', confidence: 'definite', evidence: '__NEXT_DATA__ or _next/ paths' });
    if (scripts.includes('vue') || html.includes('__vue')) techs.push({ category: 'Frontend', name: 'Vue.js', confidence: 'definite', evidence: 'Vue scripts detected' });
    if (scripts.includes('angular') || html.includes('ng-')) techs.push({ category: 'Frontend', name: 'Angular', confidence: 'likely', evidence: 'Angular patterns found' });
    if (links.includes('tailwind') || html.includes('tailwind')) techs.push({ category: 'CSS', name: 'Tailwind CSS', confidence: 'likely', evidence: 'Tailwind classes/CDN' });
    if (links.includes('bootstrap') || scripts.includes('bootstrap')) techs.push({ category: 'CSS', name: 'Bootstrap', confidence: 'definite', evidence: 'Bootstrap CDN' });
    if (headers['x-powered-by']?.includes('Express')) techs.push({ category: 'Backend', name: 'Express.js', confidence: 'definite', evidence: 'X-Powered-By header' });
    if (headers['server']?.includes('nginx')) techs.push({ category: 'Hosting', name: 'Nginx', confidence: 'definite', evidence: 'Server header' });
    if (headers['cf-ray']) techs.push({ category: 'CDN', name: 'Cloudflare', confidence: 'definite', evidence: 'CF-Ray header' });
    if (headers['x-vercel-id'] || headers['server']?.includes('Vercel')) techs.push({ category: 'Hosting', name: 'Vercel', confidence: 'definite', evidence: 'Vercel headers' });
    if (scripts.includes('gtag') || scripts.includes('google-analytics')) techs.push({ category: 'Analytics', name: 'Google Analytics', confidence: 'definite', evidence: 'GA script' });
    if (meta.includes('WordPress')) techs.push({ category: 'Backend', name: 'WordPress', confidence: 'definite', evidence: 'Generator meta tag' });
    if (scripts.includes('jquery') || scripts.includes('jQuery')) techs.push({ category: 'Frontend', name: 'jQuery', confidence: 'definite', evidence: 'jQuery script' });
    res.json({ techs, headers });
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 15: Dev Excuse
app.post('/dev-excuse/api/excuse', async (req, res) => {
  try {
    const { situation, seriousness } = req.body;
    const result = await aiComplete(
      `Generate a developer excuse. Seriousness: ${seriousness}/5 (1=absurd, 5=plausible). Return JSON: { "excuse":"", "technical_jargon_version":"", "blame_target":"", "confidence_level":"", "supporting_evidence":[""] }`,
      `Situation: ${situation}`, 400
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 18: Startup Validator
app.post('/startup-validator/api/validate', async (req, res) => {
  try {
    const { idea } = req.body;
    const result = await aiComplete(
      'Validate this startup idea. Return JSON: { "score_overall":0-100, "dimensions":[{"name":"Market Size","score":1-10,"analysis":"","risks":[""],"questions":[""]}], "competitors":[{"name":"","similarity":""}], "target_persona":"", "mvp_scope":"", "verdict":"Pursue|Pivot|Park", "verdict_reasoning":"" }',
      idea, 1500
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

app.post('/startup-validator/api/stress-test', async (req, res) => {
  try {
    const { idea } = req.body;
    const result = await aiComplete(
      'You are a skeptical VC investor. Ask 5 brutal questions about this startup idea. Return JSON: { "questions":[""] }',
      idea, 500
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Day 20: Dev Jokes
app.post('/dev-jokes/api/joke', async (req, res) => {
  try {
    const { category, nerdLevel } = req.body;
    const result = await aiComplete(
      `Generate a dev joke. Category: ${category}. Nerd level: ${nerdLevel}/5. Return JSON: { "setup":"", "punchline":"", "explanation":{"what_makes_it_funny":"","technical_concept":"","who_gets_it":""}, "nerd_level_actual":1-5, "tags":[""] }`,
      'Generate one joke.', 300
    );
    res.json(parseJSON(result));
  } catch (e) { console.error(`[API ERROR] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// Serve each project's static files
const projects = ['portfolio-roaster','regex-tester','cold-email','code-review','sql-explainer',
  'salary-negotiation','interview-questions','readme-generator','standup-generator',
  'tech-stack-detector','dev-excuse','startup-validator','dev-jokes'];

projects.forEach(p => {
  app.use(`/${p}`, express.static(path.join(__dirname, 'projects', p)));
});

// Fallback for SPA-style project pages
projects.forEach(p => {
  app.get(`/${p}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'projects', p, 'index.html'));
  });
});

// Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`21-Day Builds running on http://localhost:${PORT}`);
  console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓ set (' + process.env.GROQ_API_KEY.slice(0,8) + '...)' : '✗ not set'}`);
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✓ set' : '✗ not set'}`);
});
