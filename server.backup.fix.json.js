const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = 3000;
const db = new Database('/opt/solutecno-whatsapp/data.db');

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let client;
let isReady = false;
let qrData = null;

function initDB() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY,
    company_name TEXT,
    secretary_name TEXT,
    secretary_personality TEXT
  )
  `);

  const row = db.prepare("SELECT * FROM config WHERE id=1").get();
  if (!row) {
    db.prepare("INSERT INTO config (id, company_name, secretary_name, secretary_personality) VALUES (1,'Solutecno Argentina','Secretaria','Profesional')").run();
  }
}

function getConfig() {
  return db.prepare("SELECT * FROM config WHERE id=1").get();
}

function saveConfig(data) {
  db.prepare(`
    UPDATE config SET
    company_name=?,
    secretary_name=?,
    secretary_personality=?
    WHERE id=1
  `).run(data.company_name, data.secretary_name, data.secretary_personality);
}

function startWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'solutecno' }),
    puppeteer: {
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox','--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    qrData = await QRCode.toDataURL(qr);
    isReady = false;
    console.log("QR generado");
  });

  client.on('ready', () => {
    isReady = true;
    qrData = null;
    console.log("WhatsApp conectado");
  });

  client.on('disconnected', () => {
    console.log("Reconectando...");
    setTimeout(startWhatsApp, 5000);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;

    const chat = await msg.getChat();
    if (chat.isGroup) return;
    if (chat.id.server !== 'c.us') return;

    const cfg = getConfig();

    const reply = `Hola, soy ${cfg.secretary_name} de ${cfg.company_name}. ¿En qué puedo ayudarte?`;

    await msg.reply(reply);
  });

  client.initialize();
}

app.get('/api/qr', (req, res) => {
  if (!qrData) return res.send("QR no disponible");
  res.send(`<img src="${qrData}" width="300">`);
});

app.get('/api/status', (req, res) => {
  res.json({ ready: isReady });
});

app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("Servidor listo");
  initDB();
  startWhatsApp();
});
