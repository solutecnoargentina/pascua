const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;
const DB_PATH = '/opt/solutecno-whatsapp/data.db';
const RUNTIME_DIR = '/opt/solutecno-whatsapp/runtime';
const db = new Database(DB_PATH);

app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      contact_name TEXT,
      phone TEXT,
      direction TEXT,
      body TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const row = db.prepare('SELECT id FROM config WHERE id = 1').get();
  if (!row) {
    db.prepare('INSERT INTO config (id) VALUES (1)').run();
  }
}

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get();
  return row || { id: 1 };
}

function saveConfigGeneric(payload) {
  const columns = db.prepare("PRAGMA table_info(config)").all().map(c => c.name);
  const allowed = columns.filter(c => c !== 'id');
  const keys = Object.keys(payload || {}).filter(k => allowed.includes(k));

  if (!keys.length) return getConfig();

  const setClause = keys.map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE config SET ${setClause} WHERE id = 1`);
  stmt.run(payload);

  return getConfig();
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextSafe(file, fallback = '') {
  try {
    if (!fs.existsSync(file)) return fallback;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

ensureTables();

app.get('/api/config', (req, res) => {
  res.json({ ok: true, config: getConfig() });
});

app.post('/api/config', (req, res) => {
  const config = saveConfigGeneric(req.body || {});
  res.json({ ok: true, config });
});

app.get('/api/messages', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM messages
    ORDER BY id DESC
    LIMIT 100
  `).all();

  res.json({ ok: true, messages: rows });
});

app.get('/api/status', (req, res) => {
  const status = readJsonSafe(path.join(RUNTIME_DIR, 'status.json'), {
    ready: false,
    state: 'STOPPED',
    worker: false
  });

  res.json({
    ok: true,
    ready: !!status.ready,
    state: status.state || 'UNKNOWN',
    qrAvailable: !!readTextSafe(path.join(RUNTIME_DIR, 'qr.txt')),
    worker: !!status.worker,
    lastMessageAt: status.lastMessageAt || null
  });
});

app.get('/api/qr', (req, res) => {
  const qrDataUrl = readTextSafe(path.join(RUNTIME_DIR, 'qr.txt'));
  if (!qrDataUrl) {
    return res.status(404).send('QR no disponible todavía. Esperá unos segundos y volvé a abrir.');
  }

  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>QR WhatsApp - Solutecno Argentina</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font-family: Arial, sans-serif; background:#111; color:#fff; text-align:center; padding:20px; }
        img { max-width: 360px; width: 100%; background:#fff; padding:15px; border-radius:12px; }
        .box { max-width:420px; margin:0 auto; background:#1e1e1e; padding:20px; border-radius:16px; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>QR WhatsApp</h2>
        <p>Escaneá este QR desde el teléfono que va a usar el bot.</p>
        <img src="${qrDataUrl}" alt="QR WhatsApp" />
      </div>
    </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard/API listo en puerto ${PORT}`);
});

app.get('/api/leads', (req, res) => {
  const db = require('better-sqlite3')('/opt/solutecno-whatsapp/data.db');
  const rows = db.prepare("SELECT * FROM leads ORDER BY id DESC").all();
  res.json(rows);
});

// 🔥 FIX CONFIG (NO BORRAR DATOS EXISTENTES)
app.post('/api/config', (req, res) => {
  const db = require('better-sqlite3')('/opt/solutecno-whatsapp/data.db');

  const current = db.prepare("SELECT * FROM config WHERE id=1").get() || {};

  const updated = {
    ...current,
    ...req.body
  };

  const fields = Object.keys(updated)
    .filter(k => k !== 'id')
    .map(k => `${k} = @${k}`)
    .join(', ');

  db.prepare(`UPDATE config SET ${fields} WHERE id=1`).run(updated);

  res.json({ ok: true });
});

