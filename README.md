# Valorant H2H — เว็บวิเคราะห์แมตช์ (ข้อมูลจาก VLR.gg)

> 🚀 **Deploy บน Render:** ดูขั้นตอนที่ [DEPLOY.md](DEPLOY.md)

หน้าแรกแสดงแมตช์ที่กำลังจะแข่ง/แข่งสด → คลิกเข้าไปดูวิเคราะห์ H2H ระหว่าง 2 ทีม:
- **ประวัติเจอกันโดยตรง** (head-to-head): อัตราชนะรวม, รายแมป, pistol R1/R13
- **ฟอร์มล่าสุดของแต่ละทีม**: per-map win rate + pistol R1/R13 จากแมตช์ที่จบแล้ว
- สรุป "ทีมที่ได้เปรียบ" (ถ่วงน้ำหนัก ฟอร์ม + pistol + ประวัติเจอกัน)

## โครงสร้าง

```
ai-trade/
├── server/              # Node backend (proxy + scraper VLR.gg) — กัน CORS, มี cache
│   ├── server.js        # express: /api/upcoming /live /results /h2h + เสิร์ฟหน้าเว็บ
│   ├── vlr.js           # ดึง upcoming/live/results จาก vlrggapi
│   ├── scraper.js       # scrape หน้า match + team ของ vlr.gg (รายแมป + round)
│   ├── analyze.js       # คำนวณ form + head-to-head
│   ├── cache.js         # in-memory TTL cache
│   └── package.json
└── public/
    └── index.html       # หน้าเว็บไฟล์เดียว (vanilla HTML/JS — ไม่ต้อง build)
```

## วิธีรัน (ไม่ต้อง build)

```
cd server
npm install
npm start
```

แล้วเปิด **http://localhost:3000** (backend เสิร์ฟหน้าเว็บให้เลย — same origin จึงไม่ติด CORS)

## ที่มาของข้อมูล
- **upcoming / live / results**: vlrggapi (https://vlrggapi.vercel.app) ← wrapper ของ vlr.gg
- **per-map / pistol R1-R13 / head-to-head**: scrape หน้า match + team ของ vlr.gg โดยตรง
  - คลิกแมตช์ที่จะแข่ง → ระบบไปดึง **ประวัติแมตช์ที่จบแล้ว** ของทั้ง 2 ทีมมาคำนวณ
  - ถ้า scrape ไม่สำเร็จ/ทีมไม่มีประวัติพอ → fallback เป็น mock (มี badge เตือนในหน้าเว็บ)

## ⚠️ ข้อจำกัด / หมายเหตุ
- vlr.gg ไม่มี official API — ใช้ scraping ถ้า vlr.gg เปลี่ยน HTML ต้องแก้ selector ใน `scraper.js`
- การดึง H2H ครั้งแรกจะช้า (scrape หลายหน้า) ครั้งต่อไปเร็วเพราะมี cache (10 นาที)
- pistol round = Round 1 (pistol ครึ่งแรก) และ Round 13 (pistol ครึ่งหลัง)
- "ทีมที่ได้เปรียบ" เป็นการประเมินเชิงสถิติ ไม่ใช่ผลทำนายที่แม่นยำ
- ไม่มีข้อมูล live in-game score ของเกมทั่วไป (Riot ไม่เปิด) — live = ผลจาก pro match บน vlr.gg

## ปรับแต่งได้
- น้ำหนักสูตร "ได้เปรียบ": แก้ฟังก์ชัน `favored()` ใน `public/index.html`
- จำนวนแมตช์ย้อนหลังที่ดึงต่อทีม: พารามิเตอร์ `limit` ใน `teamRecentMatches()` (`scraper.js`)
- ระยะ cache: ตัวเลข ms ใน `cache.js` / แต่ละฟังก์ชันของ `vlr.js`, `scraper.js`
