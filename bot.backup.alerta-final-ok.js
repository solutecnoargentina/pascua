let MI_NUMERO = null;
function limpiarRespuesta(txt){
  if(!txt) return "";

  // eliminar frases de IA
  const prohibidas = [
    "soy una ia",
    "como modelo de lenguaje",
    "no tengo acceso",
    "no puedo acceder",
    "como asistente",
    "no tengo información en tiempo real"
  ];

  let limpio = txt.toLowerCase();

  for(const p of prohibidas){
    if(limpio.includes(p)) return "";
  }

  // cortar si se hace largo
  txt = txt.split("\n")[0];

  return txt.trim();
}

const fetch = require("node-fetch");
const Database = require('better-sqlite3');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = new Database('/opt/solutecno-whatsapp/data.db');

async function askAI(prompt) {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen:latest',
        prompt: prompt,
        stream: false
      })
    });

    const data = await res.json();
    return data.response.substring(0,500) || "No pude responder.";
  } catch (e) {
    return "Error IA";
  }
}

function getConfig() {
  const row = db.prepare('SELECT * FROM config WHERE id = 1').get() || {};
  return {
    ai_enabled: row.ai_enabled == 1,
    ai_prompt: row.ai_prompt || "Sos un asistente profesional argentino.",

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

let client;

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

      // 🔒 BLINDAJE
      if (msg.from === "status@broadcast") return;
      if (msg.from.includes("broadcast")) return;

      const text = (msg.body || '').toLowerCase();
      const cfg = getConfig();

      let reply;

      // 🔥 PRIORIDAD 1: BOT (ventas / soporte)
      if (match(text, cfg.sales_triggers)) {

        // 🔔 ALERTA DE VENTA
        if(MI_NUMERO){
          client.sendMessage(MI_NUMERO, `🔥 LEAD INTERESADO\n\nNumero: ${msg.from}\nMensaje: ${msg.body}`);
        }

        console.log("AGENTE: VENTAS");
        reply = cfg.sales_message;
      } 
      else if (match(text, cfg.support_triggers)) {
        console.log("AGENTE: SOPORTE");
        reply = cfg.support_message;
      } 
      else {
        // 🔥 PRIORIDAD 2: IA
        if (cfg.ai_enabled) {
          console.log("AGENTE: IA");

          const prompt = `${cfg.ai_prompt}\n\nINFORMACIÓN DEL NEGOCIO:\n${cfg.ai_training || ""}\n\nCliente: ${text}`;
          reply = limpiarRespuesta(await askAI(prompt));

        } else {
          console.log("AGENTE: SECRETARIA");
          reply = cfg.secretary_message;
        }
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
