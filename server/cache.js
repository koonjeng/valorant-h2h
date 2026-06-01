// TTL cache (in-memory + disk) — กัน rate-limit / โดน VLR บล็อก IP + ทำให้เร็ว
//  - in-memory: เร็วสุด
//  - disk: restart แล้วไม่ต้อง scrape ใหม่ (cache อยู่ใน .cache/cache.json)
//  - stale fallback: ถ้า producer ล้มเหลวแต่มีค่าเก่า → คืนค่าเก่า (เว็บไม่พังเวลา upstream ล่ม)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// CACHE_DIR override ได้ (เช่นชี้ไป persistent disk บน Render) — ไม่ตั้งก็ใช้ .cache ปกติ
const DIR = process.env.CACHE_DIR || join(__dirname, '..', '.cache');
const FILE = join(DIR, 'cache.json');

const store = new Map();
const inflight = new Map(); // กัน scrape ซ้ำพร้อมกัน (request เดียวกันมาพร้อมกัน)

// โหลด disk cache ตอนเริ่ม
try {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const [k, v] of Object.entries(raw)) store.set(k, v);
  console.log(`📦 loaded ${store.size} cached entries from disk`);
} catch { /* ยังไม่มีไฟล์ — ปกติ */ }

let saveTimer = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(Object.fromEntries(store)));
    } catch { /* ignore */ }
  }, 1500); // debounce เขียน
}

export function cached(key, ttlMs, producer) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return Promise.resolve(hit.v);

  // ถ้ากำลัง fetch key เดียวกันอยู่ → รอ promise เดิม (กันยิงซ้ำ)
  if (inflight.has(key)) return inflight.get(key);

  const p = Promise.resolve()
    .then(producer)
    .then((v) => {
      store.set(key, { v, t: now });
      persist();
      inflight.delete(key);
      return v;
    })
    .catch((err) => {
      inflight.delete(key);
      if (hit) return hit.v; // stale fallback
      throw err;
    });
  inflight.set(key, p);
  return p;
}
