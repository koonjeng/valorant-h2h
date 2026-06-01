// วิเคราะห์ H2H ของ 2 ทีมจากหน้าแมตช์ (upcoming) ของ vlr.gg
//  1) form  = ฟอร์มล่าสุดของแต่ละทีม (per-map win rate + pistol R1/R13) จากแมตช์ที่จบแล้ว
//  2) h2h   = ประวัติเจอกันโดยตรงของ 2 ทีมนี้
import { matchTeams, teamRecentMatches, scrapeMatch } from './scraper.js';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ทีมชื่อ name อยู่ side ไหนของแมตช์ (1 ซ้าย / 2 ขวา)
function sideOf(name, teams) {
  if (!teams || teams.length < 2) return null;
  const n = norm(name);
  const a = norm(teams[0]);
  const b = norm(teams[1]);
  if (n && (a === n || a.includes(n) || n.includes(a))) return 1;
  if (n && (b === n || b.includes(n) || n.includes(b))) return 2;
  return null;
}

// ฟอร์มของทีมเดียว จากชุดแมตช์ที่ scrape มา
function buildForm(name, matches) {
  const perMap = {};
  let mapsPlayed = 0, mapWins = 0;
  let r1W = 0, r1P = 0, r13W = 0, r13P = 0;

  for (const match of matches) {
    const side = sideOf(name, match.teams) || 1; // mock จะ fallback เป็น side1
    for (const m of match.maps) {
      const my = side === 1 ? m.score1 : m.score2;
      const opp = side === 1 ? m.score2 : m.score1;
      mapsPlayed++;
      const won = my > opp;
      if (won) mapWins++;
      perMap[m.name] ??= { played: 0, won: 0 };
      perMap[m.name].played++;
      if (won) perMap[m.name].won++;

      const r1 = m.rounds.find((r) => r.n === 1);
      const r13 = m.rounds.find((r) => r.n === 13);
      if (r1) { r1P++; if (r1.winner === side) r1W++; }
      if (r13) { r13P++; if (r13.winner === side) r13W++; }
    }
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return {
    name,
    mapsPlayed,
    mapWins,
    mapWinRate: pct(mapWins, mapsPlayed),
    pistol: {
      r1Rate: pct(r1W, r1P),
      r13Rate: pct(r13W, r13P),
      overallRate: pct(r1W + r13W, r1P + r13P),
    },
    maps: Object.entries(perMap)
      .map(([map, v]) => ({ map, played: v.played, won: v.won, winRate: pct(v.won, v.played) }))
      .sort((a, b) => b.played - a.played),
  };
}

// ประวัติเจอกันตรงๆ จากแมตช์ของทีม 1 ที่มีคู่แข่งเป็นทีม 2
function buildH2H(name1, name2, matches) {
  const perMap = {};
  let t1Maps = 0, t2Maps = 0, meetings = 0;
  let r1a = 0, r13a = 0, r1b = 0, r13b = 0;

  for (const match of matches) {
    const s1 = sideOf(name1, match.teams);
    const s2 = sideOf(name2, match.teams);
    if (!s1 || !s2 || s1 === s2) continue; // ไม่ใช่แมตช์ที่ 2 ทีมนี้เจอกัน
    meetings++;
    for (const m of match.maps) {
      const a = s1 === 1 ? m.score1 : m.score2;
      const b = s1 === 1 ? m.score2 : m.score1;
      a > b ? t1Maps++ : t2Maps++;
      perMap[m.name] ??= { t1: 0, t2: 0 };
      a > b ? perMap[m.name].t1++ : perMap[m.name].t2++;

      const r1 = m.rounds.find((r) => r.n === 1);
      const r13 = m.rounds.find((r) => r.n === 13);
      if (r1) (r1.winner === s1 ? r1a++ : r1b++);
      if (r13) (r13.winner === s1 ? r13a++ : r13b++);
    }
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const totalMaps = t1Maps + t2Maps;
  const pist = r1a + r13a + r1b + r13b;
  return {
    meetings,
    team1MapWins: t1Maps,
    team2MapWins: t2Maps,
    team1WinRate: pct(t1Maps, totalMaps),
    team2WinRate: pct(t2Maps, totalMaps),
    pistol: {
      team1: { r1: r1a, r13: r13a },
      team2: { r1: r1b, r13: r13b },
      team1Rate: pct(r1a + r13a, pist),
      team2Rate: pct(r1b + r13b, pist),
    },
    maps: Object.entries(perMap).map(([map, v]) => ({
      map,
      team1Wins: v.t1,
      team2Wins: v.t2,
      team1WinRate: pct(v.t1, v.t1 + v.t2),
    })),
  };
}

export async function analyzeH2H(matchPath, fb1 = 'Team A', fb2 = 'Team B', eventFilter = null) {
  let teams = [];
  try { teams = await matchTeams(matchPath); } catch { /* ignore */ }

  let name1 = teams[0]?.name || fb1;
  let name2 = teams[1]?.name || fb2;
  let source = 'scraped';

  // ดึงแมตช์ล่าสุดของแต่ละทีม (5 พอสำหรับสถิติ + มีตัวเลือกรายการ — เร็วขึ้น)
  let pathsA = [], pathsB = [];
  if (teams[0] && teams[1]) {
    try {
      [pathsA, pathsB] = await Promise.all([
        teamRecentMatches(teams[0].id, teams[0].slug, 5),
        teamRecentMatches(teams[1].id, teams[1].slug, 5),
      ]);
    } catch { /* ignore */ }
  }

  // ถ้าไม่มี path จริง → mock
  if (pathsA.length === 0) { pathsA = mockPaths(name1, 6); source = 'mock'; }
  if (pathsB.length === 0) { pathsB = mockPaths(name2, 6); source = 'mock'; }

  let [matchesA, matchesB] = await Promise.all([
    Promise.all(pathsA.map(scrapeMatch)),
    Promise.all(pathsB.map(scrapeMatch)),
  ]);
  if (matchesA[0]?.source === 'mock' || matchesB[0]?.source === 'mock') source = 'mock';

  // รายการทั้งหมดที่พบ (ไว้ให้ frontend ทำตัวกรอง) + จำนวนแมตช์ต่อรายการ
  const eventCounts = {};
  for (const m of [...matchesA, ...matchesB]) {
    const e = m.event || 'อื่นๆ';
    eventCounts[e] = (eventCounts[e] || 0) + 1;
  }
  const availableEvents = Object.entries(eventCounts)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count);

  // กรองตามรายการที่เลือก (ถ้ามี)
  let filtered = false;
  if (Array.isArray(eventFilter) && eventFilter.length) {
    const allow = new Set(eventFilter);
    const fa = matchesA.filter((m) => allow.has(m.event || 'อื่นๆ'));
    const fb = matchesB.filter((m) => allow.has(m.event || 'อื่นๆ'));
    // กันกรณีกรองจนไม่เหลือข้อมูล — ถ้าเหลืออย่างน้อยฝั่งละ 1 ค่อยใช้
    if (fa.length) { matchesA = fa; filtered = true; }
    if (fb.length) { matchesB = fb; filtered = true; }
  }

  const formTeam1 = buildForm(name1, matchesA);
  const formTeam2 = buildForm(name2, matchesB);
  const allMeet = [...matchesA, ...matchesB];
  const h2h = buildH2H(name1, name2, allMeet);

  return {
    matchPath,
    source,
    team1: { name: name1 },
    team2: { name: name2 },
    availableEvents,
    selectedEvents: Array.isArray(eventFilter) ? eventFilter : null,
    filtered,
    form: { team1: formTeam1, team2: formTeam2 },
    h2h,
  };
}

function mockPaths(name, n) {
  return Array.from({ length: n }, (_, i) => `/mock-${norm(name)}-${i}`);
}
