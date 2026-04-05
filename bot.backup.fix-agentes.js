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
    sales_triggers: (row.sales_triggers || '').toLowerCase(),
    support_triggers: (row.support_triggers || '').toLowerCase(),
    sales_message: row.sales_message || '',
    support_message: row.support_message || '',
    secretary_message: row.secretary_message || ''
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
    if (msg.fromMe) return;

    const text = (msg.body || '').toLowerCase();
    const phone = msg.from;
    const name = phone;

    // 🔥 GUARDAR LEAD
    saveLead(phone, name, text);

    const cfg = getConfig();

    let reply;

    if (match(text, cfg.sales_triggers)) {
      reply = cfg.sales_message;
    } else if (match(text, cfg.support_triggers)) {
      reply = cfg.support_message;
    } else {
      reply = cfg.secretary_message;
    }

    await client.sendMessage(msg.from, reply);
  });

  client.initialize();
}

start();
