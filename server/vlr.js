// ดึงรายการแมตช์จาก vlrggapi (unofficial wrapper ของ vlr.gg)
//  - มี timeout กันค้าง + retry เพราะ vlrggapi (server คนอื่น) บางครั้งช้า/ล่ม
import { cached } from './cache.js';

const API = 'https://vlrggapi.vercel.app';

async function getJson(url, { timeoutMs = 6000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (valorant-h2h-app)', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`vlrggapi ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? new Error(`vlrggapi timeout (${timeoutMs}ms)`) : e;
      // backoff สั้นๆ ก่อน retry
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

// แมตช์ที่กำลังจะแข่ง — cache 60s
export function upcoming() {
  return cached('upcoming', 60_000, async () => {
    const data = await getJson(`${API}/match?q=upcoming`);
    return normalizeMatches(data);
  });
}

// แมตช์สด — cache 20s
export function live() {
  return cached('live', 20_000, async () => {
    const data = await getJson(`${API}/match?q=live_score`);
    return normalizeMatches(data);
  });
}

// ผลล่าสุด — cache 120s
export function results() {
  return cached('results', 120_000, async () => {
    const data = await getJson(`${API}/match?q=results`);
    return normalizeMatches(data);
  });
}

// vlrggapi คืนรูปแบบ { data: { status, segments: [...] } }
function normalizeMatches(data) {
  const segments = data?.data?.segments ?? [];
  return segments.map((s) => ({
    team1: s.team1 ?? s.team_1 ?? '',
    team2: s.team2 ?? s.team_2 ?? '',
    score1: s.score1 ?? s.team1_score ?? null,
    score2: s.score2 ?? s.team2_score ?? null,
    flag1: s.flag1 ?? '',
    flag2: s.flag2 ?? '',
    timeUntil: s.time_until_match ?? s.unix_timestamp ?? '',
    matchSeries: s.match_series ?? '',
    matchEvent: s.match_event ?? s.tournament_name ?? '',
    matchPage: s.match_page ?? s.match_link ?? '', // path เช่น /123456/...
    status: s.time_until_match ? 'upcoming' : (s.current_map ? 'live' : 'upcoming'),
    currentMap: s.current_map ?? '',
  }));
}
