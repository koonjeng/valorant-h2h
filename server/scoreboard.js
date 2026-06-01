// Scrape "match detail scoreboard" จากหน้าแมตช์ vlr.gg
//  - tab Overview: ตารางสถิติผู้เล่น (R/ACS/K/D/A/+-/KAST/ADR/HS%/FK/FD) ต่อแมป
//  - map selector: ทุกแมปในแมตช์ + "All Maps"
//  - round-by-round: ผลแต่ละรอบ + ฝั่งที่ชนะ
//  - tab Economy / Performance: ดึงเท่าที่หน้า HTML มี (บางแมตช์ไม่มีข้อมูล)
//
// ⚠️ vlr.gg ไม่มี official API — parse HTML ถ้าเว็บเปลี่ยน selector ต้องแก้
import { load } from 'cheerio';
import { cached } from './cache.js';

const BASE = 'https://www.vlr.gg';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function toUrl(path) {
  if (path.startsWith('http')) return path;
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}
async function getHtml(path) {
  const res = await fetch(toUrl(path), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`vlr.gg ${res.status} for ${toUrl(path)}`);
  return res.text();
}

// ดึงค่าสถิติแบบ "ทั้งเกม" จาก cell (.side.mod-both) + ฝั่ง attack/defense
function cellStats($, td) {
  const pick = (cls) => $(td).find(`.side.mod-${cls}`).first().text().trim();
  return { both: pick('both'), t: pick('t'), ct: pick('ct') };
}

function parsePlayerRow($, tr) {
  const tds = $(tr).find('td');
  if (tds.length < 12) return null;
  const nameCell = $(tds[0]);
  const name = nameCell.find('.text-of').first().text().trim();
  if (!name) return null;
  const team = nameCell.find('.ge-text-light').first().text().trim();
  const agent = $(tds[1]).find('img').attr('title') || '';
  const g = (i) => cellStats($, tds[i]).both;
  return {
    name,
    team,
    agent,
    r: g(2),     // Rating 2.0
    acs: g(3),   // Average Combat Score
    k: g(4),
    d: g(5),
    a: g(6),
    pm: g(7),    // +/-
    kast: g(8),
    adr: g(9),
    hs: g(10),   // HS%
    fk: g(11),   // First Kills
    fd: g(12),   // First Deaths
  };
}

function parseRounds($, game) {
  const rounds = [];
  $(game)
    .find('.vlr-rounds-row-col')
    .each((_, col) => {
      const num = parseInt($(col).find('.rnd-num').text().trim(), 10);
      if (!num) return;
      let winner = null;
      let how = null; // วิธีจบรอบ (elim/defuse/boom/time) จากชื่อไฟล์ไอคอน
      $(col)
        .find('.rnd-sq')
        .each((idx, sq) => {
          if ($(sq).hasClass('mod-win')) {
            winner = idx === 0 ? 1 : 2;
            const img = $(sq).find('img').attr('src') || '';
            const m = img.match(/\/([a-z]+)\.webp/i) || img.match(/([a-z-]+)\.png/i);
            how = m ? m[1] : null;
          }
        });
      if (winner) rounds.push({ n: num, winner, how });
    });
  return rounds;
}

export async function scrapeScoreboard(matchPath) {
  return cached(`scoreboard:${matchPath}`, 120_000, async () => {
    try {
      const $ = load(await getHtml(matchPath));

      const teams = $('.match-header-link .wf-title-med')
        .map((_, el) => $(el).text().trim())
        .get()
        .slice(0, 2);
      const event = $('.match-header-event div[style] div').first().text().trim()
        || $('.match-header-event-series').text().trim();
      const status = $('.match-header-vs-note').first().text().trim(); // final / live / Upcoming
      const headScores = $('.match-header-vs .match-header-vs-score .js-spoiler')
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      const maps = [];
      $('.vm-stats-game').each((_, el) => {
        const gameId = $(el).attr('data-game-id');
        const name = $(el)
          .find('.map span')
          .first()
          .clone()
          .children()
          .remove()
          .end()
          .text()
          .trim();
        const scores = $(el)
          .find('.vm-stats-game-header .score')
          .map((__, s) => $(s).text().trim())
          .get();

        // players: 2 ตาราง (ทีมละตาราง) — ใช้ loop เพราะ cheerio .map().get() แบน array
        const tables = $(el).find('table.wf-table-inset');
        const teamPlayers = [];
        tables.each((__, tbl) => {
          const players = [];
          $(tbl)
            .find('tbody tr')
            .each((___, tr) => {
              const p = parsePlayerRow($, tr);
              if (p) players.push(p);
            });
          teamPlayers.push(players);
        });

        const isAll = gameId === 'all';
        maps.push({
          gameId,
          name: isAll ? 'All Maps' : name || 'TBD',
          isAll,
          score1: scores[0] ?? null,
          score2: scores[1] ?? null,
          team1Players: teamPlayers[0] || [],
          team2Players: teamPlayers[1] || [],
          rounds: isAll ? [] : parseRounds($, el),
        });
      });

      const hasData = maps.some((m) => m.team1Players.some((p) => p.acs));
      return { teams, event, status, headScores, maps, source: hasData ? 'scraped' : 'empty' };
    } catch (err) {
      return { error: String(err), source: 'error', teams: [], maps: [] };
    }
  });
}
