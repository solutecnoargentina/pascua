const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const DB_PATH = '/opt/solutecno-whatsapp/data.db';
const RUNTIME_DIR = '/opt/solutecno-whatsapp/runtime';
const AUTH_DIR = '/opt/solutecno-whatsapp/.wwebjs_auth_worker';

const db = new Database(DB_PATH);
const bootUnix = Math.floor(Date.now() / 1000);

let client = null;

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

function writeStatus(data) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNTIME_DIR, 'status.json'),
    JSON.stringify({ worker: true, ...data }, null, 2)
  );
}

function writeQr(dataUrl) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, 'qr.txt'), dataUrl || '');
}

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get() || {};
  return {
    company_name: row.company_name || 'Solutecno Argentina',
    secretary_name: row.secretary_name || 'Secretaria',
    block_groups: Number(row.block_groups ?? 1),
    block_newsletters: Number(row.block_newsletters ?? 1),
    block_status: Number(row.block_status ?? 1),
    block_from_me: Number(row.block_from_me ?? 1),
    anti_old_messages: Number(row.anti_old_messages ?? 1),
    default_reply_enabled: Number(row.default_reply_enabled ?? 1)
  };
}

function saveMessage({ chat_id, contact_name, phone, direction, body }) {
  db.prepare(`
    INSERT INTO messages (chat_id, contact_name, phone, direction, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(chat_id || '', contact_name || '', phone || '', direction || '', body || '');
}

function findChromiumPath() {
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  ensureTables();

  const chromiumPath = findChromiumPath();
  if (!chromiumPath) {
    console.error('No encontré chromium/chromium-browser');
    writeStatus({ ready: false, state: 'NO_CHROMIUM' });
    process.exit(1);
  }

  writeStatus({ ready: false, state: 'STARTING' });

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'solutecno-worker',
      dataPath: AUTH_DIR
    }),
    puppeteer: {
      headless: true,
      executablePath: chromiumPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    }
  });

  client.on('qr', async (qr) => {
    const dataUrl = await QRCode.toDataURL(qr);
    writeQr(dataUrl);
    writeStatus({ ready: false, state: 'QR' });
    console.log('QR generado');
  });

  client.on('authenticated', () => {
    console.log('WhatsApp autenticado');
    writeStatus({ ready: false, state: 'AUTHENTICATED' });
  });

  client.on('ready', () => {
    writeQr('');
    writeStatus({ ready: true, state: 'READY' });
    console.log('WhatsApp conectado OK');
  });

  client.on('disconnected', (reason) => {
    writeStatus({ ready: false, state: `DISCONNECTED:${reason}` });
    console.log('Desconectado:', reason);
  });

  client.on('message', async (msg) => {
    try {
      const cfg = getConfig();

      if (cfg.block_from_me && msg.fromMe) return;

      if (cfg.anti_old_messages) {
        const msgUnix = Number(msg.timestamp || 0);
        if (msgUnix && msgUnix < (bootUnix - 15)) return;
      }

      const chat = await msg.getChat();
      const contact = await msg.getContact();
      const server = chat?.id?.server || '';

      if (cfg.block_groups && chat?.isGroup) return;
      if (cfg.block_newsletters && server === 'newsletter') return;
      if (cfg.block_status && server === 'status') return;
      if (server !== 'c.us') return;
      if (!cfg.default_reply_enabled) return;

      const body = (msg.body || '').trim();
      const phone = (contact?.number || '').trim();
      const contactName = contact?.pushname || contact?.name || '';

      saveMessage({
        chat_id: msg.from,
        contact_name: contactName,
        phone,
        direction: 'in',
        body
      });

      if (!body) return;

      const reply = `Hola, soy ${cfg.secretary_name} de ${cfg.company_name}. ¿En qué puedo ayudarte?`;

      await msg.reply(reply);

      saveMessage({
        chat_id: msg.from,
        contact_name: contactName,
        phone,
        direction: 'out',
        body: reply
      });

      writeStatus({
        ready: true,
        state: 'READY',
        lastMessageAt: new Date().toISOString()
      });

      console.log('RESPONDIDO:', body);
    } catch (e) {
      console.error('Error mensaje:', e.message);
    }
  });

  client.initialize().catch((err) => {
    console.error('Error inicializando:', err.message);
    writeStatus({ ready: false, state: `INIT_ERROR:${err.message}` });
    process.exit(1);
  });
}

main();
