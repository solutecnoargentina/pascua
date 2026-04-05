const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = new Database('/opt/solutecno-whatsapp/data.db');
let client;

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get() || {};
  return {
    company_name: row.company_name || 'Solutecno Argentina',
    secretary_name: row.secretary_name || 'Secretaria',
    sales_name: row.sales_name || 'Ventas',
    support_name: row.support_name || 'Soporte',

    sales_triggers: (row.sales_triggers || 'precio,comprar,promo').toLowerCase(),
    support_triggers: (row.support_triggers || 'error,no anda,soporte').toLowerCase(),

    sales_message: row.sales_message || 'Te habla ventas ¿Qué producto te interesa?',
    support_message: row.support_message || 'Te habla soporte ¿Qué problema tenés?',
    secretary_message: row.secretary_message || 'Hola ¿En qué puedo ayudarte?'
  };
}

function match(text, triggers) {
  return triggers.split(',').some(t => text.includes(t.trim()));
}

function start() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'solutecno-worker' }),
    puppeteer: {
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox','--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    console.log("QR generado");
  });

  client.on('ready', () => {
    console.log("WhatsApp conectado OK");
  });

  client.on('message_create', async (msg) => {
    try {
      if (msg.fromMe) return;

    // 🔒 BLOQUEO ESTADOS
    if (msg.from === "status@broadcast") return;
    if (msg.from.includes("broadcast")) return;


      const text = (msg.body || '').toLowerCase();
      const cfg = getConfig();

      let reply;

      if (match(text, cfg.sales_triggers)) {
        reply = `💰 ${cfg.sales_name}: ${cfg.sales_message}`;
        console.log("AGENTE VENTAS");
      } 
      else if (match(text, cfg.support_triggers)) {
        reply = `🔧 ${cfg.support_name}: ${cfg.support_message}`;
        console.log("AGENTE SOPORTE");
      } 
      else {
        reply = `👋 ${cfg.secretary_name}: ${cfg.secretary_message}`;
        console.log("AGENTE SECRETARIA");
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
