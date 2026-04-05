const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const DB_PATH = '/opt/solutecno-whatsapp/data.db';
const RUNTIME_DIR = '/opt/solutecno-whatsapp/runtime';
const AUTH_DIR = '/opt/solutecno-whatsapp/.wwebjs_auth_worker';

const db = new Database(DB_PATH);

let client = null;

function writeQr(dataUrl) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, 'qr.txt'), dataUrl || '');
}

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get() || {};
  return {
    company_name: row.company_name || 'Solutecno Argentina',
    secretary_name: row.secretary_name || 'Secretaria'
  };
}

function start() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'solutecno-worker',
      dataPath: AUTH_DIR
    }),
    puppeteer: {
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox','--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    const dataUrl = await QRCode.toDataURL(qr);
    writeQr(dataUrl);
    console.log("QR generado");
  });

  client.on('ready', () => {
    console.log("WhatsApp conectado OK");
  });

  client.on('message_create', async (msg) => {
    console.log("MENSAJE DETECTADO:", msg.body);
    console.log("FROM:", msg.from);
    console.log("FROM ME:", msg.fromMe);

    try {
      // ignorar solo mensajes propios
      if (msg.fromMe) return;

      const cfg = getConfig();

      const reply = `Hola, soy ${cfg.secretary_name} de ${cfg.company_name}. ¿En qué puedo ayudarte?`;

      // 🔥 RESPUESTA DIRECTA SIN getChat()
      await client.sendMessage(msg.from, reply);

      console.log("RESPONDIDO OK");

    } catch (e) {
      console.log("ERROR:", e.message);
    }
  });

  client.initialize();
}

start();
