import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as vlr from './vlr.js';
import { analyzeH2H } from './analyze.js';
import { scrapeScoreboard } from './scoreboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
// เสิร์ฟหน้าเว็บไฟล์เดียวจาก ../public  → เปิด http://localhost:3000
app.use(express.static(join(__dirname, '..', 'public')));

const ok = (res) => (data) => res.json(data);
const fail = (res) => (err) => res.status(500).json({ error: String(err && err.message || err) });

// วินิจฉัย: ลองดึง vlr.gg ตรงๆ จาก server นี้ (เปิดบน Render เพื่อเช็คว่าโดนบล็อกไหม)
app.get('/api/diag', async (req, res) => {
  const out = { node: process.version, mem: process.memoryUsage().rss };
  try {
    const t = Date.now();
    const r = await fetch('https://www.vlr.gg/681336/loud-vs-sentinels-esports-world-cup-2026-americas-qualifier-stage-2-lr2', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
    });
    const body = await r.text();
    out.vlrStatus = r.status;
    out.vlrMs = Date.now() - t;
    out.vlrBytes = body.length;
    out.looksBlocked = /cloudflare|captcha|attention required|access denied/i.test(body.slice(0, 3000));
  } catch (e) {
    out.vlrError = String(e && e.message || e);
  }
  res.json(out);
});

app.get('/api/upcoming', (req, res) => vlr.upcoming().then(ok(res)).catch(fail(res)));
app.get('/api/live', (req, res) => vlr.live().then(ok(res)).catch(fail(res)));
app.get('/api/results', (req, res) => vlr.results().then(ok(res)).catch(fail(res)));

// วิเคราะห์ H2H — /api/h2h?path=681338/...&team1=LOUD&team2=NRG
app.get('/api/h2h', (req, res) => {
  const { path = '', team1 = 'Team A', team2 = 'Team B', events = '' } = req.query;
  const eventFilter = events ? String(events).split('|').filter(Boolean) : null;
  analyzeH2H(String(path), String(team1), String(team2), eventFilter).then(ok(res)).catch(fail(res));
});

// scoreboard เต็มของแมตช์ — /api/scoreboard?path=681338/...
app.get('/api/scoreboard', (req, res) => {
  const { path = '' } = req.query;
  scrapeScoreboard(String(path)).then(ok(res)).catch(fail(res));
});

// กัน process ตายจาก error ที่ไม่ได้ดัก (ทำให้ Render ไม่ crash → ไม่ 502)
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
