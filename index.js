// Multi-gateway payment bot. Telegram long-polling, runs on Render.
// Env: BOT_TOKEN (required). Optional: TEMPLATE_DIR with bKash.png/Nagad.png/Rocket.png.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Jimp = require('jimp');
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('[boot] BOT_TOKEN missing. Set it in Render env vars.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const TEMPLATE_DIR = process.env.TEMPLATE_DIR || path.join(__dirname, 'templates');
const GATEWAYS = {
  bkash: { label: 'bKash', file: 'bkash.png', color: '#e2136e' },
  nagad: { label: 'Nagad', file: 'nagad.png', color: '#ee1c25' },
  rocket: { label: 'Rocket', file: 'rocket.png', color: '#8a2be2' },
};

// Per-chat conversation state.
const sessions = new Map();

const WARNING =
  '⚠️ *Warning Notice*\n\n' +
  'If someone uses this bot for bad purposes, our team takes no responsibility. ' +
  'It has been created only for educational purposes. Please do not use it for bad purposes.\n\n' +
  'Select your preferred payment method from below:';

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 bKash', callback_data: 'gw:bkash' }],
        [{ text: '🟠 Nagad', callback_data: 'gw:nagad' }],
        [{ text: '🚀 Rocket', callback_data: 'gw:rocket' }],
      ],
    },
  };
}

function askAmount(chatId) {
  return bot.sendMessage(chatId, 'Now send the amount.\n\nExample: `5000` or `1900`');
}

function askReceiver(chatId) {
  return bot.sendMessage(chatId, '✅ Okay! Now enter the receiver number:\n\nExample: `01770785037`');
}

function genTxId(gateway) {
  const alnum = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const len = gateway === 'rocket' ? 10 : 9;
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alnum[bytes[i] % alnum.length];
  return out;
}

function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time12 = `${((d.getHours() + 11) % 12) + 1}:${pad(d.getMinutes())}`;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return { time: `${time12}${ampm.toLowerCase()}`, date };
}

// --- Receipt rendering with Jimp ----------------------------------------------
const LAYOUTS = {
  bkash: {
    fields: [
      { key: 'number', x: 180, y: 220, size: 36 },
      { key: 'amount', x: 180, y: 560, size: 40 },
      { key: 'time', x: 180, y: 380, size: 30 },
      { key: 'txid', x: 380, y: 320, size: 26 },
    ],
  },
  nagad: {
    fields: [
      { key: 'number', x: 300, y: 360, size: 34 },
      { key: 'amount', x: 380, y: 500, size: 36 },
      { key: 'time', x: 380, y: 570, size: 28 },
      { key: 'txid', x: 380, y: 430, size: 24 },
    ],
  },
  rocket: {
    fields: [
      { key: 'number', x: 420, y: 300, size: 30 },
      { key: 'amount', x: 420, y: 390, size: 32 },
      { key: 'time', x: 420, y: 450, size: 24 },
      { key: 'txid', x: 420, y: 340, size: 22 },
    ],
  },
};

async function renderReceipt(gateway, data) {
  const tpl = GATEWAYS[gateway];
  const tplPath = path.join(TEMPLATE_DIR, tpl.file);
  
  if (!fs.existsSync(tplPath)) {
    throw new Error(`Template not found: ${tplPath}`);
  }

  // Load font. Jimp needs a .fnt file. 
  // Use a standard Jimp font for simplicity.
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  const image = await Jimp.read(tplPath);
  
  const layout = LAYOUTS[gateway];
  
  for (const field of layout.fields) {
    const val = String(data[field.key] ?? '');
    // Draw text at the specified coordinates
    image.print(
      font,
      field.x,
      field.y - field.size, // Adjust Y because Jimp draws from top-left
      val
    );
  }

  return await image.getBufferAsync(Jimp.MIME_PNG);
}

// --- Bot flow ----------------------------------------------------------------
bot.onText(/^\/start$/, (msg) => {
  const chatId = msg.chat.id;
  sessions.set(chatId, { step: 'choose_gateway' });
  bot.sendMessage(chatId, WARNING, {
    parse_mode: 'Markdown',
    ...mainMenu(),
  });
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data || '';
  if (data.startsWith('gw:')) {
    const gateway = data.slice(3);
    if (!GATEWAYS[gateway]) return bot.answerCallbackQuery(q.id, { text: 'Unknown gateway' });
    sessions.set(chatId, { step: 'await_number', gateway });
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(
      chatId,
      `Selected: *${GATEWAYS[gateway].label}*\n\n⚠️ Do not use it for bad purposes. If you use it for bad purposes, we or our team will not be responsible.\n\nSend your number. Example: \`01770785036\``,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  
  const session = sessions.get(chatId);
  if (!session) return;

  if (session.step === 'await_number') {
    if (!/^01\d{9}$/.test(text)) {
      return bot.sendMessage(chatId, '❌ Invalid number. Send 11-digit BD number, e.g. `01770785036`.', { parse_mode: 'Markdown' });
    }
    session.number = text;
    session.step = 'await_amount';
    sessions.set(chatId, session);
    return askAmount(chatId);
  }

  if (session.step === 'await_amount') {
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ Invalid amount. Send a number, e.g. `5000`.', { parse_mode: 'Markdown' });
    }
    session.amount = amount;
    session.step = 'await_receiver';
    sessions.set(chatId, session);
    return askReceiver(chatId);
  }

  if (session.step === 'await_receiver') {
    if (!/^01\d{9}$/.test(text)) {
      return bot.sendMessage(chatId, '❌ Invalid receiver number. Send 11-digit BD number.', { parse_mode: 'Markdown' });
    }
    session.receiver = text;
    session.step = 'done';
    session.txid = genTxId(session.gateway);
    const t = nowParts();
    session.time = t.time;
    session.date = t.date;
    sessions.set(chatId, session);

    try {
      const pngBuffer = await renderReceipt(session.gateway, {
        number: session.receiver,
        amount: session.amount.toFixed(2),
        time: `${session.time} ${session.date}`,
        txid: session.txid,
      });
      
      await bot.sendPhoto(chatId, pngBuffer, {
        caption:
          `✅ ${GATEWAYS[session.gateway].label} receipt generated.\n` +
          `Number: ${session.receiver}\nAmount: ৳${session.amount}\nTxID: ${session.txid}\n` +
          `Time: ${session.time} ${session.date}\n\n` +
          `This is a generated demo. Not a real transaction.`,
      });
    } catch (e) {
      console.error('[render]', e);
      await bot.sendMessage(
        chatId,
        `⚠️ Template missing or render failed: ${e.message}\n\nDrop \`${GATEWAYS[session.gateway].file}\` into the templates folder and adjust LAYOUTS coordinates in index.js.`
      );
    }
    sessions.delete(chatId);
  }
});

bot.on('polling_error', (e) => console.error('[polling]', e.message));

console.log('[boot] EH Munna 👿@#9002111185000# roost online. polling...');
