# Deploy บน Render

เว็บนี้ต้อง host แบบ **Node web service** (ไม่ใช่ static) เพราะ backend ต้อง scrape vlr.gg ฝั่ง server
ไฟล์ที่เกี่ยวข้องเตรียมไว้ให้แล้ว: `render.yaml`, `server/package.json` (มี `engines.node`), `.gitignore`

---

## ขั้นตอนที่ 1 — push โค้ดขึ้น GitHub

โปรเจกต์ commit ไว้ใน git แล้ว (branch `main`) เหลือแค่สร้าง repo บน GitHub แล้ว push

1. ไปที่ https://github.com/new → สร้าง repo เปล่า เช่น `valorant-h2h`
   - **อย่า** ติ๊ก "Add README/.gitignore" (เพราะเรามีแล้ว)
2. คัดลอกคำสั่งจากหน้า GitHub มารัน ในโฟลเดอร์โปรเจกต์ (`valorant-h2h/`):

```bash
git remote add origin https://github.com/<ชื่อคุณ>/valorant-h2h.git
git push -u origin main
```

> ถ้า push แล้วถาม login: ใช้ **Personal Access Token** แทน password
> (GitHub → Settings → Developer settings → Personal access tokens → ติ๊ก `repo`)

---

## ขั้นตอนที่ 2 — deploy บน Render

### วิธี A: Blueprint (ง่ายสุด — ใช้ `render.yaml` อัตโนมัติ)
1. ไปที่ https://dashboard.render.com → **New** → **Blueprint**
2. เชื่อม GitHub แล้วเลือก repo `valorant-h2h`
3. Render อ่าน `render.yaml` เอง → กด **Apply** → รอ build เสร็จ (~2-3 นาที)

### วิธี B: ตั้งเอง (ถ้าไม่ใช้ Blueprint)
1. **New** → **Web Service** → เลือก repo
2. ตั้งค่า:
   | ช่อง | ค่า |
   |---|---|
   | Root Directory | `server` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |
3. กด **Create Web Service**

---

## เสร็จแล้ว
- Render จะให้ URL เช่น `https://valorant-h2h.onrender.com`
- เปิด URL นั้นได้เลย — frontend ยิง API แบบ same-origin จึงทำงานทันที ไม่ต้องตั้งค่าเพิ่ม
- ทุกครั้งที่ push ขึ้น `main` → Render deploy ใหม่อัตโนมัติ (`autoDeploy: true`)

## ข้อควรรู้ (Free tier)
- **Sleep หลังไม่มีคนใช้ ~15 นาที** → ครั้งแรกที่เปิดหลัง sleep จะช้า ~30-50 วิ (server ตื่น) จากนั้นปกติ
- **Disk เป็น ephemeral** → cache (`.cache/`) หายเมื่อ restart/deploy ใหม่ — ไม่พัง แค่ครั้งแรกหลัง deploy จะ scrape ใหม่
  - ถ้าอยากให้ cache อยู่ถาวร: เพิ่ม Persistent Disk แล้วตั้ง env `CACHE_DIR=/var/data` (โค้ดรองรับแล้ว) — แต่ free tier ไม่มี disk
- vlrggapi/vlr.gg เป็นบริการของคนอื่น — ถ้าเขาล่ม เว็บเราจะดึงข้อมูลไม่ได้ชั่วคราว (มี stale-cache ช่วยบางส่วน)
