import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SHARED AI HELPER ---
async function aiComplete(systemPrompt, userPrompt, maxTokens = 1024) {
  const key = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No API key. Set GROQ_API_KEY or OPENAI_API_KEY.');
  const baseUrl = process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
  const model = process.env.MODEL || (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
  console.log(`[AI] ${model} | tokens:${maxTokens}`);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.7, max_tokens: maxTokens })
  });
  if (!res.ok) { const err = await res.text(); console.error(`[AI ERROR] ${res.status}: ${err.slice(0,300)}`); throw new Error(`AI error ${res.status}`); }
  const data = await res.json();
  return data.choices[0].message.content;
}

function extractJSON(text) {
  // Try to find JSON object or array in the response
  try { return JSON.parse(text); } catch {}
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) try { return JSON.parse(objMatch[0]); } catch {}
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) try { return JSON.parse(arrMatch[0]); } catch {}
  throw new Error('Could not parse AI response as JSON');
}

// --- RESUME SCANNER ---
app.post('/resume-scanner/api/scan', async (req, res) => {
  try {
    const { text, role } = req.body;
    if (!text || text.length < 50) return res.status(400).json({ error: 'Resume text too short (min 50 chars)' });
    if (!role) return res.status(400).json({ error: 'Target role required' });
    const result = await aiComplete(
      `You are an expert ATS recruiter. Evaluate this resume against the role: "${role}". Return ONLY valid JSON: {"atsScore":0-100,"missingKeywords":["keywords the resume should have for this role"],"weakActionVerbs":["weak verbs found that should be replaced"],"formattingIssues":["structural problems"],"sectionBreakdown":{"Summary":"feedback","Experience":"feedback","Skills":"feedback","Education":"feedback"},"prioritizedFixes":["top 5 immediate actions to improve"]}`,
      text.slice(0, 6000), 1024);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[resume-scanner] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- PORTFOLIO ROASTER ---
const rateLimit = new Map();
app.post('/portfolio-roaster/api/roast', async (req, res) => {
  try {
    const ip = req.ip;
    if (rateLimit.get(ip) > Date.now() - 60000) return res.status(429).json({ error: 'Rate limited. Wait 1 minute.' });
    rateLimit.set(ip, Date.now());
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const fetchMod = await import('node-fetch');
    const resp = await fetchMod.default(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000 });
    const html = await resp.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] || '';
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const isSPA = html.includes('gatsby') || html.includes('__NEXT_DATA__') || html.includes('_app') || html.includes('react');
    const context = `URL: ${url}\nTitle: ${title}\nMeta: ${metaDesc}\nSPA: ${isSPA}\nContent: ${text || '(JS-rendered)'}`;
    const result = await aiComplete(
      'You are a portfolio reviewer. If SPA, evaluate based on meta/structure. Return ONLY valid JSON: {"overall_score":0-100,"roast_summary":"","sections":[{"name":"Design","score":0-100,"roast":"","fix":""},{"name":"Content","score":0-100,"roast":"","fix":""},{"name":"UX","score":0-100,"roast":"","fix":""},{"name":"Mobile","score":0-100,"roast":"","fix":""},{"name":"CTA","score":0-100,"roast":"","fix":""}]}',
      context, 800);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[portfolio-roaster] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- CODE REVIEW BOT (FIXED JSON PARSE) ---
app.post('/code-review/api/review', async (req, res) => {
  try {
    const { code, language } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    const truncated = code.slice(0, 8000);
    const result = await aiComplete(
      `You are a senior code reviewer. Review this ${language || 'code'}. Return ONLY valid JSON (no markdown, no backticks): {"summary":"brief summary","score":0-100,"issues":[{"line":1,"severity":"critical|warning|suggestion","category":"bug|security|performance|style","description":"what is wrong","fix":"how to fix"}],"positives":["good things about the code"]}`,
      `\`\`\`${language || ''}\n${truncated}\n\`\`\``, 1024);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[code-review] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- SQL EXPLAINER ---
app.post('/sql-explainer/api/explain', async (req, res) => {
  try {
    const { sql, dialect } = req.body;
    if (!sql) return res.status(400).json({ error: 'SQL query required' });
    const result = await aiComplete(
      `Explain this ${dialect || 'SQL'} query. Return ONLY valid JSON: {"summary":"one line plain English","steps":[{"step":1,"clause":"the SQL clause","explanation":"what it does"}],"performance_notes":["tips"],"issues":["potential problems"],"optimized_version":"improved SQL or null if already optimal"}`,
      sql, 1024);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[sql-explainer] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- COLD EMAIL (ENHANCED) ---
app.post('/cold-email/api/personalize', async (req, res) => {
  try {
    const { prospect, sender, tone } = req.body;
    const result = await aiComplete(
      `Generate 2 cold email variants. Tone: ${tone || 'conversational'}. Each must have: hyper-personalized opening referencing prospect's specific context, concise value prop, one line of social proof, low-friction CTA. Return ONLY valid JSON: {"variant1":{"subject":"","body":"","word_count":0},"variant2":{"subject":"","body":"","word_count":0},"tips":["improvement suggestions"]}`,
      `Prospect: ${JSON.stringify(prospect)}. Sender: ${JSON.stringify(sender)}`, 800);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[cold-email] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- TECH STACK DETECTOR (NO AI) ---
app.post('/tech-stack-detector/api/detect', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const fetchMod = await import('node-fetch');
    const response = await fetchMod.default(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, redirect: 'follow', timeout: 10000 });
    const headers = Object.fromEntries(response.headers.entries());
    const html = await response.text();
    const { load } = await import('cheerio');
    const $ = load(html);
    const scripts = $('script[src]').map((_, el) => $(el).attr('src') || '').get().join(' ');
    const links = $('link[href]').map((_, el) => $(el).attr('href') || '').get().join(' ');
    const meta = $('meta[name="generator"]').attr('content') || '';
    const techs = [];
    if (scripts.includes('react') || html.includes('__NEXT_DATA__') || html.includes('_reactRoot')) techs.push({ category: 'Frontend', name: 'React', confidence: 'definite', evidence: 'React detected in scripts/DOM' });
    if (html.includes('__NEXT_DATA__') || html.includes('_next/')) techs.push({ category: 'Framework', name: 'Next.js', confidence: 'definite', evidence: '__NEXT_DATA__ or _next/ paths' });
    if (html.includes('gatsby') || html.includes('___gatsby')) techs.push({ category: 'Framework', name: 'Gatsby', confidence: 'definite', evidence: 'Gatsby markers in HTML' });
    if (scripts.includes('vue') || html.includes('__vue')) techs.push({ category: 'Frontend', name: 'Vue.js', confidence: 'definite', evidence: 'Vue detected' });
    if (scripts.includes('angular') || html.includes('ng-app')) techs.push({ category: 'Frontend', name: 'Angular', confidence: 'likely', evidence: 'Angular patterns' });
    if (links.includes('tailwind') || html.match(/class="[^"]*\b(flex|grid|px-|py-|bg-|text-)\b/)) techs.push({ category: 'CSS', name: 'Tailwind CSS', confidence: 'likely', evidence: 'Utility classes detected' });
    if (links.includes('bootstrap') || scripts.includes('bootstrap')) techs.push({ category: 'CSS', name: 'Bootstrap', confidence: 'definite', evidence: 'Bootstrap CDN' });
    if (headers['x-powered-by']?.includes('Express')) techs.push({ category: 'Backend', name: 'Express.js', confidence: 'definite', evidence: 'X-Powered-By header' });
    if (headers['server']?.includes('nginx')) techs.push({ category: 'Server', name: 'Nginx', confidence: 'definite', evidence: 'Server header' });
    if (headers['cf-ray']) techs.push({ category: 'CDN', name: 'Cloudflare', confidence: 'definite', evidence: 'CF-Ray header' });
    if (headers['x-vercel-id'] || headers['server']?.includes('Vercel')) techs.push({ category: 'Hosting', name: 'Vercel', confidence: 'definite', evidence: 'Vercel headers' });
    if (scripts.includes('gtag') || scripts.includes('google-analytics') || scripts.includes('googletagmanager')) techs.push({ category: 'Analytics', name: 'Google Analytics', confidence: 'definite', evidence: 'GA/GTM script' });
    if (meta.includes('WordPress')) techs.push({ category: 'CMS', name: 'WordPress', confidence: 'definite', evidence: 'Generator meta' });
    if (scripts.includes('jquery')) techs.push({ category: 'Frontend', name: 'jQuery', confidence: 'definite', evidence: 'jQuery script' });
    if (html.includes('shopify') || scripts.includes('shopify')) techs.push({ category: 'Platform', name: 'Shopify', confidence: 'definite', evidence: 'Shopify markers' });
    res.json({ techs, headers });
  } catch (e) { console.error(`[tech-stack] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- SPAM MAIL DETECTOR ---
app.post('/spam-detector/api/analyze', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails) return res.status(400).json({ error: 'Email content required' });
    const result = await aiComplete(
      'Analyze these emails for spam. For each, return spam score 0-100 and reasons. Return ONLY valid JSON: {"results":[{"subject":"extracted subject","sender":"extracted sender","score":0-100,"verdict":"spam|suspicious|safe","reasons":["reason1"]}]}',
      emails.slice(0, 6000), 1024);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[spam-detector] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- URL SHORTENER ---
const urlStore = new Map();
const clickStore = new Map();
import { parse as parseUA } from 'ua-parser-js';

app.post('/url-shortener/api/shorten', (req, res) => {
  try {
    const { url, alias } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const code = alias || Math.random().toString(36).slice(2, 8);
    if (urlStore.has(code)) return res.status(409).json({ error: 'Alias taken' });
    urlStore.set(code, { url, created: Date.now() });
    clickStore.set(code, []);
    res.json({ code, shortUrl: `/s/${code}` });
  } catch (e) { console.error(`[url-shortener] ${e.message}`); res.status(500).json({ error: e.message }); }
});

app.get('/url-shortener/api/urls', (req, res) => {
  const urls = [];
  urlStore.forEach((v, code) => urls.push({ code, ...v, clicks: (clickStore.get(code) || []).length }));
  res.json(urls);
});

app.get('/url-shortener/api/urls/:code/stats', (req, res) => {
  const clicks = clickStore.get(req.params.code) || [];
  const data = urlStore.get(req.params.code);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ ...data, code: req.params.code, clicks: clicks.length, details: clicks.slice(-100) });
});

app.get('/s/:code', (req, res) => {
  const data = urlStore.get(req.params.code);
  if (!data) return res.status(404).send('Not found');
  const ua = req.headers['user-agent'] || '';
  const click = { ts: Date.now(), referrer: req.headers.referer || '', ua, lang: req.headers['accept-language']?.split(',')[0] || '', ip: req.ip };
  clickStore.get(req.params.code)?.push(click);
  res.redirect(301, data.url);
});

// --- API HEALTH DASHBOARD ---
const monitors = new Map();
let monitorId = 0;

app.post('/api-health/api/monitors', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const id = ++monitorId;
  monitors.set(id, { id, url, name: name || url, history: [], status: 'unknown', lastCheck: null });
  res.json({ id });
});

app.get('/api-health/api/monitors', (req, res) => {
  res.json([...monitors.values()]);
});

app.post('/api-health/api/monitors/check', async (req, res) => {
  await checkAllMonitors();
  res.json([...monitors.values()]);
});

app.delete('/api-health/api/monitors/:id', (req, res) => {
  monitors.delete(parseInt(req.params.id));
  res.json({ ok: true });
});

async function checkAllMonitors() {
  for (const [id, mon] of monitors) {
    try {
      const start = Date.now();
      const resp = await fetch(mon.url, { signal: AbortSignal.timeout(10000) });
      const ms = Date.now() - start;
      const entry = { ts: Date.now(), ms, status: resp.status };
      mon.history.push(entry);
      if (mon.history.length > 20) mon.history.shift();
      mon.status = resp.ok ? (ms > 3000 ? 'slow' : 'up') : 'down';
      mon.lastCheck = Date.now();
      mon.responseTime = ms;
    } catch { mon.status = 'down'; mon.lastCheck = Date.now(); mon.history.push({ ts: Date.now(), ms: 0, status: 0 }); }
  }
}
setInterval(checkAllMonitors, 30000);

// --- BUNDLE SIZE ANALYZER ---
app.post('/bundle-analyzer/api/analyze', async (req, res) => {
  try {
    const { packageJson } = req.body;
    const pkg = typeof packageJson === 'string' ? JSON.parse(packageJson) : packageJson;
    const deps = { ...pkg.dependencies };
    const results = [];
    const fetchMod = await import('node-fetch');
    for (const [name, version] of Object.entries(deps)) {
      try {
        const r = await fetchMod.default(`https://bundlephobia.com/api/size?package=${name}@${version.replace(/[\^~]/,'')}`, { timeout: 5000 });
        if (r.ok) { const d = await r.json(); results.push({ name, version, size: d.size, gzip: d.gzip, description: d.description || '' }); }
        else results.push({ name, version, size: null, gzip: null, description: 'Size unavailable' });
      } catch { results.push({ name, version, size: null, gzip: null, description: 'Fetch failed' }); }
    }
    res.json({ dependencies: results, total: results.reduce((a, r) => a + (r.gzip || 0), 0), count: results.length });
  } catch (e) { console.error(`[bundle-analyzer] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- WEBHOOK TESTER ---
const webhookEndpoints = new Map();

app.post('/webhook-tester/api/endpoints', (req, res) => {
  const id = Math.random().toString(36).slice(2, 10);
  webhookEndpoints.set(id, []);
  res.json({ id, url: `/hook/${id}` });
});

app.get('/webhook-tester/api/endpoints/:id/requests', (req, res) => {
  const reqs = webhookEndpoints.get(req.params.id);
  if (!reqs) return res.status(404).json({ error: 'Endpoint not found' });
  res.json(reqs);
});

app.delete('/webhook-tester/api/endpoints/:id', (req, res) => {
  webhookEndpoints.delete(req.params.id);
  res.json({ ok: true });
});

app.all('/hook/:id', (req, res) => {
  const reqs = webhookEndpoints.get(req.params.id);
  if (!reqs) return res.status(404).json({ error: 'Endpoint not found' });
  reqs.unshift({ method: req.method, headers: req.headers, body: req.body, query: req.query, ip: req.ip, ts: Date.now() });
  if (reqs.length > 50) reqs.pop();
  res.json({ ok: true });
});

// --- HTTP HEADER ANALYZER ---
app.post('/http-headers/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const fetchMod = await import('node-fetch');
    const resp = await fetchMod.default(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', timeout: 10000 });
    const headers = Object.fromEntries(resp.headers.entries());
    const checks = [
      { header: 'strict-transport-security', name: 'HSTS', weight: 15, risk: 'Man-in-the-middle attacks', rec: 'max-age=31536000; includeSubDomains' },
      { header: 'content-security-policy', name: 'CSP', weight: 20, risk: 'XSS attacks', rec: "default-src 'self'" },
      { header: 'x-content-type-options', name: 'X-Content-Type-Options', weight: 10, risk: 'MIME sniffing', rec: 'nosniff' },
      { header: 'x-frame-options', name: 'X-Frame-Options', weight: 10, risk: 'Clickjacking', rec: 'DENY' },
      { header: 'referrer-policy', name: 'Referrer-Policy', weight: 10, risk: 'Information leakage', rec: 'strict-origin-when-cross-origin' },
      { header: 'permissions-policy', name: 'Permissions-Policy', weight: 10, risk: 'Feature abuse', rec: 'camera=(), microphone=(), geolocation=()' },
      { header: 'cross-origin-opener-policy', name: 'COOP', weight: 10, risk: 'Cross-origin attacks', rec: 'same-origin' },
      { header: 'cross-origin-resource-policy', name: 'CORP', weight: 10, risk: 'Resource leaks', rec: 'same-origin' },
    ];
    let score = 0;
    const findings = checks.map(c => {
      const present = !!headers[c.header];
      if (present) score += c.weight;
      return { header: c.name, present, value: headers[c.header] || null, risk: c.risk, recommendation: c.rec };
    });
    const grades = ['F','F','D','D','C','C','B','B','A','A','A+'];
    const grade = grades[Math.min(Math.floor(score / 10), 10)];
    res.json({ grade, score, findings, headers, server: headers['server'] || 'Unknown' });
  } catch (e) { console.error(`[http-headers] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- INTERVIEW QUESTIONS (FIXED - TECHNICAL ONLY) ---
app.post('/interview-questions/api/generate', async (req, res) => {
  try {
    const { jd, level, round, count } = req.body;
    if (!jd) return res.status(400).json({ error: 'Job description required' });
    const result = await aiComplete(
      `Generate ${count || 10} TECHNICAL interview questions for a ${level || 'Mid'}-level candidate, ${round || 'Technical Screening'} round. ONLY technical questions: system design, coding, architecture, debugging, performance, security, databases, APIs. NO behavioral, NO HR, NO strengths/weaknesses. Each question must reference specific technologies from the JD. Return ONLY valid JSON array: [{"question":"","difficulty":"Easy|Medium|Hard","category":"System Design|Coding|Architecture|DevOps|Database|API Design|Security","evaluates":"what this tests","strong_signals":["good answer indicators"],"red_flags":["bad answer indicators"],"follow_ups":["follow up questions"]}]`,
      `Job Description:\n${jd.slice(0, 3000)}`, 2048);
    res.json(extractJSON(result));
  } catch (e) { console.error(`[interview-questions] ${e.message}`); res.status(500).json({ error: e.message }); }
});

// --- SERVE PROJECT STATIC FILES ---
const projectDirs = ['resume-scanner','portfolio-roaster','code-review','sql-explainer','cold-email','tech-stack-detector',
  'spam-detector','url-shortener','api-health','bundle-analyzer','webhook-tester','http-headers','interview-questions'];

projectDirs.forEach(p => {
  app.use(`/${p}`, express.static(path.join(__dirname, 'projects', p)));
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, 'projects', p, 'index.html')));
});

// Homepage
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=== 21-Day Builds ===`);
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓' : '✗'}`);
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✓' : '✗'}\n`);
});
