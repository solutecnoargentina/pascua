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
    secretary_name: row.secretary_name || 'Secretaria',
    sales_name: row.sales_name || 'Ventas',
    support_name: row.support_name || 'Soporte',
    sales_triggers: (row.sales_triggers || 'precio,comprar,promo,venta,costo').toLowerCase(),
    support_triggers: (row.support_triggers || 'error,problema,no anda,soporte,ayuda').toLowerCase()
  };
}

function match(text, triggers) {
  const words = triggers.split(',').map(w => w.trim());
  return words.some(w => text.includes(w));
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
    try {
      if (msg.fromMe) return;

      const text = (msg.body || '').toLowerCase();
      console.log("MENSAJE:", text);

      const cfg = getConfig();

      let reply = "";

      if (match(text, cfg.sales_triggers)) {
        reply = `💰 Te habla ${cfg.sales_name} de ${cfg.company_name}.\n\nContame qué producto o servicio te interesa y te paso toda la info.`;
        console.log("AGENTE: VENTAS");
      }
      else if (match(text, cfg.support_triggers)) {
        reply = `🔧 Te habla ${cfg.support_name} de ${cfg.company_name}.\n\nContame qué problema tenés y te ayudo paso a paso.`;
        console.log("AGENTE: SOPORTE");
      }
      else {
        reply = `👋 Hola, soy ${cfg.secretary_name} de ${cfg.company_name}.\n\nPuedo derivarte a:\n• Ventas\n• Soporte\n\n¿En qué puedo ayudarte?`;
        console.log("AGENTE: SECRETARIA");
      }

      await client.sendMessage(msg.from, reply);
      console.log("RESPONDIDO OK");

    } catch (e) {
      console.log("ERROR:", e.message);
    }
  });

  client.initialize();
}

start();
