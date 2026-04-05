const Database = require('better-sqlite3');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = new Database('/opt/solutecno-whatsapp/data.db');
let client;

function saveLead(phone, name, message) {
  const exists = db.prepare("SELECT * FROM leads WHERE phone=?").get(phone);

  if (!exists) {
    db.prepare("INSERT INTO leads (phone, name, last_message) VALUES (?, ?, ?)")
      .run(phone, name, message);
    console.log("NUEVO LEAD:", phone);
  } else {
    db.prepare("UPDATE leads SET last_message=?, created_at=CURRENT_TIMESTAMP WHERE phone=?")
      .run(message, phone);
  }
}

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get() || {};
  return {
    company_name: row.company_name || 'Solutecno Argentina',
    secretary_name: row.secretary_name || 'Secretaria',

    sales_triggers: (row.sales_triggers || 'precio,comprar').toLowerCase(),
    support_triggers: (row.support_triggers || 'error,no anda').toLowerCase(),

    sales_message: row.sales_message || 'Te paso info de ventas',
    support_message: row.support_message || 'Te ayudo con soporte',
    secretary_message: row.secretary_message || 'Hola ¿en qué puedo ayudarte?'
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

  client.on('ready', () => console.log("WhatsApp OK"));

  client.on('message_create', async (msg) => {
    try {
      if (msg.fromMe) return;

      // 🔒 BLOQUEOS IMPORTANTES
      if (msg.from === "status@broadcast") return;
      if (msg.from.includes("broadcast")) return;

      const text = (msg.body || '').toLowerCase();
      const phone = msg.from;

      saveLead(phone, phone, text);

      const cfg = getConfig();

      let reply;

      if (match(text, cfg.sales_triggers)) {
        console.log("AGENTE: VENTAS");
        reply = `💰 ${cfg.sales_message}`;
      } 
      else if (match(text, cfg.support_triggers)) {
        console.log("AGENTE: SOPORTE");
        reply = `🔧 ${cfg.support_message}`;
      } 
      else {
        console.log("AGENTE: SECRETARIA");
        reply = `👋 ${cfg.secretary_message}`;
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
