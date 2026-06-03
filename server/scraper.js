// Scraper หน้า vlr.gg
//  - scrapeMatch: ดึงรายแมป + ผล round ของ 1 แมตช์ (สำหรับ pistol R1/R13)
//  - matchTeams: ดึง id/ชื่อ 2 ทีม จากหน้าแมตช์
//  - teamRecentMatches: ดึง path แมตช์ที่จบแล้วของทีม (ฟอร์มล่าสุด)
//
// ⚠️ vlr.gg ไม่มี official API — parse HTML ถ้าเว็บเปลี่ยนต้องแก้ selector
//    ถ้า scrape ไม่สำเร็จจะ fallback เป็น mock เพื่อให้ UI รันต่อได้
import { load } from 'cheerio';
import { cached } from './cache.js';

const BASE = 'https://www.vlr.gg';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function toUrl(path) {
  if (path.startsWith('http')) return path;
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

// map แบบจำกัด concurrency — กัน RAM หมด (OOM) บน Render free (512MB)
// ยิงพร้อมกันแค่ `limit` ตัว แทนที่จะ 10 หน้าพร้อมกัน
export async function pMap(items, fn, limit = 2) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getHtml(path, timeoutMs = Number(process.env.VLR_TIMEOUT || 7000)) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(toUrl(path), {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`vlr.gg ${res.status} for ${toUrl(path)}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** ดึง id + ชื่อ ของ 2 ทีม จากหน้าแมตช์ */
export async function matchTeams(matchPath) {
  return cached(`teams:${matchPath}`, 600_000, async () => {
    const $ = load(await getHtml(matchPath));
    const out = [];
    $('a.match-header-link').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/team\/(\d+)\/([^/]+)/);
      const name = $(el).find('.wf-title-med').first().text().trim();
      if (m) out.push({ id: m[1], slug: m[2], name: name || m[2] });
    });
    return out.slice(0, 2);
  });
}

/** ดึง path แมตช์ที่จบแล้วของทีม (ใหม่ → เก่า) — 1 แมตช์ต่อ 1 path (ไม่ซ้ำ) */
export async function teamRecentMatches(teamId, slug, limit = 6) {
  return cached(`teammatches:${teamId}:${limit}`, 600_000, async () => {
    const $ = load(await getHtml(`/team/matches/${teamId}/${slug}/?group=completed`));
    // ตัด query (?game=...) ออก แล้วเก็บเฉพาะ match path หลัก dedup ตาม match ID
    const seen = new Set();
    const paths = [];
    const add = (href) => {
      if (!href) return;
      const clean = href.split('?')[0].split('#')[0]; // ตัด ?game= / #
      const m = clean.match(/^\/(\d{4,})\//);          // /<matchId>/...
      if (!m) return;
      if (seen.has(m[1])) return;                      // ซ้ำแมตช์เดิม → ข้าม
      seen.add(m[1]);
      paths.push(clean);
    };
    $('a.m-item, a.wf-card.m-item, a.fc-flex').each((_, el) => add($(el).attr('href')));
    // เผื่อ selector ไม่ตรง — กวาด a ทุกตัวที่ลิงก์ไปหน้าแมตช์
    if (paths.length === 0) {
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href.includes('/team/')) add(href);
      });
    }
    return paths.slice(0, limit);
  });
}

/**
 * Scrape 1 แมตช์ → { teams:[name1,name2], maps:[{name,score1,score2,rounds:[{n,winner}]}] }
 * winner = 1|2 (ทีมซ้าย/ขวา)
 */
export async function scrapeMatch(matchPath) {
  return cached(`match:${matchPath}`, 600_000, async () => {
    try {
      if (!matchPath || matchPath.startsWith('/mock')) throw new Error('no real path');
      const $ = load(await getHtml(matchPath));

      const teams = $('.match-header-link .wf-title-med')
        .map((_, el) => $(el).text().trim())
        .get()
        .slice(0, 2);

      // ชื่อรายการ (event/tournament) ของแมตช์นี้
      const event =
        $('.match-header-event div[style*="font-weight"]').first().text().trim() ||
        $('.match-header-event-series').first().text().trim() ||
        $('.match-header-event div').first().text().trim() ||
        '';

      const maps = [];
      $('.vm-stats-game').each((_, el) => {
        const gameId = $(el).attr('data-game-id');
        if (!gameId || gameId === 'all') return;

        const name = $(el)
          .find('.map > div > span')
          .first()
          .clone()
          .children()
          .remove()
          .end()
          .text()
          .trim();
        if (!name || /tbd/i.test(name)) return; // ข้ามแมปที่ยังไม่แข่ง

        const scores = $(el)
          .find('.vm-stats-game-header .score')
          .map((__, s) => parseInt($(s).text().trim(), 10))
          .get();
        if (scores.length < 2 || Number.isNaN(scores[0])) return;

        const rounds = [];
        $(el)
          .find('.vlr-rounds-row-col')
          .each((__, col) => {
            const num = parseInt($(col).find('.rnd-num').text().trim(), 10);
            if (!num) return;
            let winner = null;
            $(col).find('.rnd-sq').each((idx, sq) => {
              if ($(sq).hasClass('mod-win')) winner = idx === 0 ? 1 : 2;
            });
            if (winner) rounds.push({ n: num, winner });
          });

        maps.push({ name, score1: scores[0], score2: scores[1], rounds });
      });

      if (maps.length === 0) throw new Error('no completed maps');
      return { teams, event, maps, source: 'scraped' };
    } catch (err) {
      return { ...mockMatch(matchPath || ''), source: 'mock', error: String(err) };
    }
  });
}

/** mock 1 แมตช์ เผื่อ scrape ไม่ได้ */
function mockMatch(seed = '') {
  const pool = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Sunset', 'Split', 'Icebox'];
  const rng = mulberry32(hash(seed) || 7);
  const n = 2 + Math.floor(rng() * 2);
  const maps = [];
  for (let i = 0; i < n; i++) {
    const rounds = [];
    let s1 = 0, s2 = 0;
    for (let r = 1; r <= 24 && s1 < 13 && s2 < 13; r++) {
      const w = rng() < 0.52 ? 1 : 2;
      w === 1 ? s1++ : s2++;
      rounds.push({ n: r, winner: w });
    }
    maps.push({ name: pool[(hash(seed) + i) % pool.length], score1: s1, score2: s2, rounds });
  }
  const events = ['Masters London 2026', 'Champions 2025', 'VCT Pacific 2026'];
  return { teams: ['Team A', 'Team B'], event: events[hash(seed) % events.length], maps };
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
