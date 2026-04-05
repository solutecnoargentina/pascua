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

let client = null;
let isReady = false;
let qrData = null;

function getConfig() {
  return db.prepare("SELECT * FROM config WHERE id=1").get();
}

async function startWhatsApp() {
  if (client) {
    console.log("Cliente ya iniciado, evitando duplicado");
    return;
  }

  console.log("Iniciando WhatsApp...");

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
    console.log("QR generado");
  });

  client.on('ready', () => {
    isReady = true;
    qrData = null;
    console.log("WhatsApp conectado");
  });

  client.on('disconnected', async (reason) => {
    console.log("Desconectado:", reason);
    isReady = false;

    try {
      await client.destroy();
    } catch {}

    client = null;

    console.log("Reiniciando limpio en 5 segundos...");
    setTimeout(startWhatsApp, 5000);
  });

  client.on('message', async (msg) => {
    try {
      if (msg.fromMe) return;

      const chat = await msg.getChat();
      if (chat.isGroup) return;
      if (chat.id.server !== 'c.us') return;

      const cfg = getConfig();

      const reply = `Hola, soy ${cfg.secretary_name} de ${cfg.company_name}. ¿En qué puedo ayudarte?`;

      await msg.reply(reply);

      console.log("RESPONDIDO:", msg.body);
    } catch (e) {
      console.log("Error mensaje:", e.message);
    }
  });

  client.initialize().catch(err => {
    console.log("Error inicializando:", err.message);
    client = null;
  });
}

app.get('/api/qr', (req, res) => {
  if (!qrData) return res.send("QR no disponible");
  res.send(`<img src="${qrData}" width="300">`);
});

app.get('/api/status', (req, res) => {
  res.json({ ready: isReady });
});

app.get('/api/config', (req, res) => {
  res.json({ ok: true, config: getConfig() });
});

app.post('/api/config', (req, res) => {
  const data = req.body;

  db.prepare(`
    UPDATE config SET
    company_name=?,
    secretary_name=?,
    secretary_personality=?
    WHERE id=1
  `).run(data.company_name, data.secretary_name, data.secretary_personality);

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("Servidor listo");
  startWhatsApp();
});
