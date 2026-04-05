const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = 3000;
const db = new Database('/opt/solutecno-whatsapp/data.db');

app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT DEFAULT 'Solutecno Argentina',
  secretary_name TEXT DEFAULT 'Secretaria',
  secretary_personality TEXT DEFAULT 'Sos una secretaria cordial, breve y profesional.',
  secretary_knowledge TEXT DEFAULT 'Tu función es recibir, ordenar y derivar.',
  sales_name TEXT DEFAULT 'Ventas',
  sales_personality TEXT DEFAULT 'Sos un agente de ventas claro, amable y persuasivo.',
  sales_knowledge TEXT DEFAULT 'Ofrecemos soluciones tecnológicas, bots, automatización y soporte.',
  support_name TEXT DEFAULT 'Soporte',
  support_personality TEXT DEFAULT 'Sos soporte técnico paciente, claro y resolutivo.',
  support_knowledge TEXT DEFAULT 'Ayudás con problemas técnicos, configuración y seguimiento.',
  sales_triggers TEXT DEFAULT 'precio,presupuesto,comprar,venta,promo,promoción,costo',
  support_triggers TEXT DEFAULT 'error,falla,no anda,problema,soporte,técnico,ayuda',
  block_groups INTEGER DEFAULT 1,
  block_newsletters INTEGER DEFAULT 1,
  block_status INTEGER DEFAULT 1,
  block_from_me INTEGER DEFAULT 1,
  anti_old_messages INTEGER DEFAULT 1,
  default_reply_enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

const exists = db.prepare('SELECT id FROM config WHERE id = 1').get();
if (!exists) {
  db.prepare(`
    INSERT INTO config (
      id, company_name,
      secretary_name, secretary_personality, secretary_knowledge,
      sales_name, sales_personality, sales_knowledge,
      support_name, support_personality, support_knowledge,
      sales_triggers, support_triggers,
      block_groups, block_newsletters, block_status, block_from_me,
      anti_old_messages, default_reply_enabled
    ) VALUES (
      1, 'Solutecno Argentina',
      'Secretaria', 'Sos una secretaria cordial, breve y profesional.', 'Tu función es recibir, ordenar y derivar.',
      'Ventas', 'Sos un agente de ventas claro, amable y persuasivo.', 'Ofrecemos soluciones tecnológicas, bots, automatización y soporte.',
      'Soporte', 'Sos soporte técnico paciente, claro y resolutivo.', 'Ayudás con problemas técnicos, configuración y seguimiento.',
      'precio,presupuesto,comprar,venta,promo,promoción,costo',
      'error,falla,no anda,problema,soporte,técnico,ayuda',
      1, 1, 1, 1, 1, 1
    )
  `).run();
}

function getConfig() {
  return db.prepare('SELECT * FROM config WHERE id = 1').get();
}

function updateConfig(data) {
  const current = getConfig();
  const next = {
    ...current,
    ...data,
    block_groups: data.block_groups ? 1 : 0,
    block_newsletters: data.block_newsletters ? 1 : 0,
    block_status: data.block_status ? 1 : 0,
    block_from_me: data.block_from_me ? 1 : 0,
    anti_old_messages: data.anti_old_messages ? 1 : 0,
    default_reply_enabled: data.default_reply_enabled ? 1 : 0
  };

  db.prepare(`
    UPDATE config SET
      company_name = @company_name,
      secretary_name = @secretary_name,
      secretary_personality = @secretary_personality,
      secretary_knowledge = @secretary_knowledge,
      sales_name = @sales_name,
      sales_personality = @sales_personality,
      sales_knowledge = @sales_knowledge,
      support_name = @support_name,
      support_personality = @support_personality,
      support_knowledge = @support_knowledge,
      sales_triggers = @sales_triggers,
      support_triggers = @support_triggers,
      block_groups = @block_groups,
      block_newsletters = @block_newsletters,
      block_status = @block_status,
      block_from_me = @block_from_me,
      anti_old_messages = @anti_old_messages,
      default_reply_enabled = @default_reply_enabled,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(next);

  return getConfig();
}

function saveMessage({ chat_id, contact_name, phone, direction, body }) {
  db.prepare(`
    INSERT INTO messages (chat_id, contact_name, phone, direction, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(chat_id || '', contact_name || '', phone || '', direction || '', body || '');
}

let currentQrText = null;
let currentQrDataUrl = null;
let isReady = false;
let clientInfo = null;
const bootUnix = Math.floor(Date.now() / 1000);

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'solutecno'
  }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});

function textIncludesAny(text, csvWords) {
  const words = (csvWords || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

  const t = (text || '').toLowerCase();
  return words.some(w => t.includes(w));
}

function buildSecretaryReply(cfg, contactName) {
  return `Hola${contactName ? ' ' + contactName : ''}, gracias por comunicarte con ${cfg.company_name}.

Soy ${cfg.secretary_name}. ¿En qué puedo ayudarte?

Puedo derivarte a:
- Ventas
- Soporte técnico`;
}

function buildSalesReply(cfg) {
  return `Hola, te habla ${cfg.sales_name} de ${cfg.company_name}.

${cfg.sales_personality}

Información útil:
${cfg.sales_knowledge}

Si querés, contame qué necesitás y te paso una respuesta más precisa.`;
}

function buildSupportReply(cfg) {
  return `Hola, te habla ${cfg.support_name} de ${cfg.company_name}.

${cfg.support_personality}

Información útil:
${cfg.support_knowledge}

Describime tu problema y te ayudo paso a paso.`;
}

async function refreshQr(qr) {
  currentQrText = qr;
  currentQrDataUrl = await QRCode.toDataURL(qr);
}

function isAllowedServer(chatIdServer) {
  return chatIdServer === 'c.us';
}

client.on('qr', async (qr) => {
  console.log('QR generado. Escanealo con WhatsApp.');
  qrcodeTerminal.generate(qr, { small: true });
  await refreshQr(qr);
  isReady = false;
});

client.on('authenticated', () => {
  console.log('WhatsApp autenticado.');
});

client.on('ready', async () => {
  console.log('WhatsApp listo.');
  isReady = true;
  currentQrText = null;
  currentQrDataUrl = null;
  try {
    clientInfo = await client.getState();
  } catch {
    clientInfo = 'READY';
  }
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp desconectado:', reason);
  isReady = false;
  clientInfo = null;
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
    if (!isAllowedServer(server)) {
      if (cfg.block_groups && chat?.isGroup) return;
      if (cfg.block_newsletters && server === 'newsletter') return;
      if (cfg.block_status && server === 'status') return;
      return;
    }

    if (cfg.block_groups && chat?.isGroup) return;

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
    if (!cfg.default_reply_enabled) return;

    let reply = '';

    if (textIncludesAny(body, cfg.sales_triggers)) {
      reply = buildSalesReply(cfg);
    } else if (textIncludesAny(body, cfg.support_triggers)) {
      reply = buildSupportReply(cfg);
    } else {
      reply = buildSecretaryReply(cfg, contactName);
    }

    await msg.reply(reply);

    saveMessage({
      chat_id: msg.from,
      contact_name: contactName,
      phone,
      direction: 'out',
      body: reply
    });

  } catch (err) {
    console.error('Error procesando mensaje:', err.message);
  }
});

app.get('/api/status', async (req, res) => {
  res.json({
    ok: true,
    ready: isReady,
    state: clientInfo,
    qrAvailable: !!currentQrDataUrl
  });
});

app.get('/api/qr', async (req, res) => {
  if (!currentQrDataUrl) {
    return res.status(404).send('QR no disponible todavía. Esperá unos segundos y volvé a abrir.');
  }

  const html = `
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
      <img src="${currentQrDataUrl}" alt="QR WhatsApp" />
    </div>
  </body>
  </html>`;
  res.send(html);
});

app.get('/api/config', (req, res) => {
  res.json({ ok: true, config: getConfig() });
});

app.post('/api/config', (req, res) => {
  const saved = updateConfig(req.body || {});
  res.json({ ok: true, config: saved });
});

app.get('/api/messages', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM messages
    ORDER BY id DESC
    LIMIT 100
  `).all();

  res.json({ ok: true, messages: rows });
});

app.post('/api/restart-whatsapp', async (req, res) => {
  try {
    await client.destroy();
  } catch {}
  setTimeout(() => {
    client.initialize().catch(err => {
      console.error('Error re-inicializando WhatsApp:', err.message);
    });
  }, 2000);

  res.json({ ok: true, message: 'Reinicio solicitado' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Servidor iniciado en http://0.0.0.0:${PORT}`);
  try {
    await client.initialize();
  } catch (err) {
    console.error('Error iniciando WhatsApp:', err.message);
  }
});
