require('dotenv').config();
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('[boot] BOT_TOKEN missing.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const sessions = new Map();

// Helper to generate TxID
function genTxId(gateway) {
  const alnum = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const len = gateway === 'rocket' ? 10 : 9;
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alnum[bytes[i] % alnum.length];
  return out;
}

// Helper for date and time (BD Time)
function getDateTime() {
  const d = new Date();
  d.setHours(d.getHours() + 6); 
  
  const pad = (n) => String(n).padStart(2, '0');
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h12 = hours % 12 || 12;
  
  const timeStr = `${pad(h12)}:${pad(d.getMinutes())}${ampm}`;
  const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  const fullDate = `${pad(d.getDate())}-${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()}-${String(d.getFullYear()).slice(2)}`;
  
  const banglaMonths = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
  const banglaMonth = banglaMonths[d.getMonth()];
  
  return { timeStr, dateStr, fullDate, banglaMonth };
}

const WARNING = 
  "⚠️ *সতর্কতা*\n\n" +
  "যদি কেউ এই বটটি খারাপ উদ্দেশ্যে ব্যবহার করে, আমাদের দল দায়ী থাকবে না। " +
  "এটি শুধুমাত্র শিক্ষামূলক উদ্দেশ্যে তৈরি করা হয়েছে।\n\n" +
  "নিচ থেকে আপনার পেমেন্ট পদ্ধতি নির্বাচন করুন:";

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 বিকাশ (bKash)', callback_data: 'gw:bkash' }],
        [{ text: '🟠 নগদ (Nagad)', callback_data: 'gw:nagad' }],
        [{ text: '🚀 রকেট (Rocket)', callback_data: 'gw:rocket' }],
      ],
    },
  };
}

// --- Exact HTML Templates ---

const baseCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Hind Siliguri', sans-serif; background: #fff; width: 400px; }
  .container { width: 100%; min-height: 800px; position: relative; }
`;

function htmlBkash(data) {
  return `
    <html><head><style>${baseCSS}
      .header-text { text-align: center; margin: 30px 0; font-weight: 600; font-size: 18px; }
      .header-text span.green { color: #009639; }
      .header-text span.magenta { color: #e2136e; }
      .check-circle { display: inline-block; width: 24px; height: 24px; border: 2px solid #009639; border-radius: 50%; color: #009639; text-align: center; line-height: 20px; margin-left: 10px; vertical-align: middle; font-weight: bold; }
      
      .number-row { display: flex; justify-content: center; align-items: center; margin-bottom: 30px; padding: 0 20px; gap: 15px; }
      .circle { width: 60px; height: 60px; background: #d8b4e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #7b3d8a; font-size: 30px; font-weight: 500; }
      .number-box h2 { font-size: 20px; color: #333; font-weight: 600; line-height: 1.2; }
      .number-box p { font-size: 16px; color: #888; }
      .call-btn { border: 1px solid #e2136e; color: #e2136e; padding: 5px 15px; border-radius: 5px; font-size: 14px; font-weight: 600; margin-left: auto; }
      
      .grid { border-top: 1px solid #eee; border-left: 1px solid #eee; margin: 0 20px; }
      .row { display: flex; border-bottom: 1px solid #eee; }
      .col { flex: 1; padding: 15px; border-right: 1px solid #eee; }
      .label { font-size: 14px; color: #666; margin-bottom: 5px; }
      .value { font-size: 18px; color: #333; font-weight: 600; }
      .amount { font-size: 20px; font-weight: 700; }
      .amount .currency { font-size: 16px; font-weight: 400; }
      
      .reward-section { text-align: center; margin-top: 30px; padding: 0 20px; }
      .reward-icon { width: 40px; height: 40px; background: #e2136e; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 20px; margin-bottom: 10px; }
      .reward-text { color: #333; font-size: 16px; margin-bottom: 5px; }
      .reward-text b { font-size: 18px; }
      .reward-link { color: #e2136e; font-size: 14px; }
      
      .bottom { background: #e2136e; color: white; padding: 15px 20px; position: absolute; bottom: 0; width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 18px; font-weight: 600; }
    </style></head><body>
      <div class="container">
        <div class="header-text">
          আপনার <span class="magenta">সেন্ড মানি</span> <span class="green">সফল হয়েছে</span>
          <div class="check-circle">✓</div>
        </div>
        
        <div class="number-row">
          <div class="circle">0</div>
          <div class="number-box">
            <h2>${data.receiver}</h2>
            <p>${data.receiver}</p>
          </div>
          <div class="call-btn">☎ কল</div>
        </div>
        
        <div class="grid">
          <div class="row">
            <div class="col"><div class="label">সময়</div><div class="value">${data.timeStr} ${data.dateStr}</div></div>
            <div class="col"><div class="label">ট্রানজেকশন আইডি</div><div class="value" style="font-size:15px">${data.txid} <span style="color:#e2136e;font-size:18px">⧉</span></div></div>
          </div>
          <div class="row">
            <div class="col"><div class="label">সর্বমোট</div><div class="value amount"><span class="currency">৳</span>${data.amount}.00</div><div style="font-size:12px;color:#aaa;">৳${Number(data.amount)+5} &nbsp; + ৳5</div></div>
            <div class="col"><div class="label">নতুন ব্যালেন্স</div><div class="value">******** <span style="color:#e2136e;font-size:18px">👁</span></div></div>
          </div>
          <div class="row">
            <div class="col" style="flex:100%"><div class="label" style="margin:0">রেফারেন্স</div></div>
          </div>
        </div>
        
        <div class="reward-section">
          <div class="reward-icon">★</div>
          <div class="reward-text">আপনি অর্জন করছেন<br><b>বিকাশ রিওয়ার্ড পয়েন্ট</b></div>
          <div class="reward-link">পয়েন্ট ব্যবহার করতে <u>বিকাশ রিওয়ার্ডস</u> চেক করুন!</div>
        </div>
        
        <div class="bottom">হোম-এ ফিরে যাই <span>&rarr;</span></div>
      </div>
    </body></html>
  `;
}

function htmlNagad(data) {
  return `
    <html><head><style>${baseCSS}
      .container { padding: 40px 20px; }
      .top-icon { width: 80px; height: 80px; border: 4px solid #ff9900; border-radius: 50%; margin: 0 auto 20px auto; display: flex; align-items: center; justify-content: center; }
      .top-icon .check { color: #ee1c25; font-size: 40px; font-weight: bold; transform: rotate(45deg); }
      
      .title { color: #ee1c25; font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 5px; }
      .num { text-align: center; font-size: 18px; color: #333; margin-bottom: 40px; }
      
      .list { display: flex; justify-content: space-between; padding: 12px 0; font-size: 16px; }
      .list .lbl { color: #ee1c25; font-weight: 500; }
      .list .val { color: #333; font-weight: 600; }
      
      .divider { border-top: 1px solid #eee; margin: 20px 0; }
      
      .buttons { display: flex; justify-content: space-around; padding: 10px 0; }
      .btn-icon { color: #ee1c25; font-size: 16px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
      
      .home-btn { background: #ee1c25; color: white; text-align: center; padding: 15px; border-radius: 30px; margin-top: 40px; font-weight: 600; font-size: 16px; }
    </style></head><body>
      <div class="container">
        <div class="top-icon"><span class="check">✓</span></div>
        <div class="title">সেন্ড মানি সফল</div>
        <div class="num">${data.receiver}</div>
        
        <div class="list"><span class="lbl">ট্রানজেকশন আইডি</span><span class="val">${data.txid}</span></div>
        <div class="list"><span class="lbl">পরিমাণ</span><span class="val">${data.amount}.00 টাকা</span></div>
        <div class="list"><span class="lbl">খরচ</span><span class="val">0.00 টাকা</span></div>
        <div class="list"><span class="lbl">সর্বমোট</span><span class="val">${data.amount}.00 টাকা</span></div>
        <div class="list"><span class="lbl">সময়</span><span class="val">${data.dateStr} ${data.timeStr}</span></div>
        
        <div class="divider"></div>
        
        <div class="buttons">
          <div class="btn-icon">📞 কল</div>
          <div class="btn-icon">✉️ মেসেজ</div>
        </div>
        
        <div class="home-btn">হোম এ ফিরে যান</div>
      </div>
    </body></html>
  `;
}

function htmlRocket(data) {
  return `
    <html><head><style>${baseCSS}
      .header { background: #8a2be2; color: white; padding: 20px; font-size: 20px; font-weight: 500; display: flex; align-items: center; gap: 15px; }
      .card { margin: 20px; padding: 30px 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); border: 1px solid #eee; }
      
      .logo { text-align: center; margin-bottom: 10px; }
      .logo img { height: 40px; }
      .title { text-align: center; font-size: 20px; color: #333; font-weight: 500; margin-bottom: 30px; }
      
      .section-title { font-weight: 600; font-size: 18px; color: #333; margin: 20px 0 15px 0; }
      .row { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 16px; }
      .row span:first-child { color: #555; }
      .row span:last-child { font-weight: 500; color: #222; }
      
      .divider { border-top: 1px solid #ddd; margin: 20px 0; }
      
      .footer { text-align: center; color: #888; font-size: 13px; margin-top: 30px; margin-bottom: 30px; }
      
      .buttons { display: flex; gap: 15px; margin-top: 20px; }
      .btn { flex: 1; background: #8a2be2; color: white; text-align: center; padding: 12px; border-radius: 25px; font-weight: 600; font-size: 16px; }
    </style></head><body>
      <div class="header"><span>&larr;</span> Receipt</div>
      
      <div class="card">
        <div class="logo">
           <!-- Simple text logo to avoid missing images -->
           <div style="color:#8a2be2; font-size:24px; font-weight:bold;">ROCKET</div>
        </div>
        <div class="title">Send Money</div>
        
        <div class="section-title">Transaction Information:</div>
        <div class="row"><span>Transaction ID</span><span>${data.txid}</span></div>
        <div class="row"><span>Transaction Date</span><span>${data.fullDate} ${data.timeStr}</span></div>
        <div class="row"><span>Transaction Amount</span><span>${data.amount}.00</span></div>
        <div class="row"><span>Fee Amount</span><span>0.00</span></div>
        
        <div class="section-title">Other Information:</div>
        <div class="row"><span>Sender A/C No.</span><span>${data.sender}</span></div>
        <div class="row"><span>Receiver A/C No.</span><span>${data.receiver}</span></div>
        <div class="row"><span>Reference</span><span>NA</span></div>
        
        <div class="footer">This receipt generated electronically.</div>
        
        <div class="divider"></div>
        
        <div class="buttons">
          <div class="btn">SAVE</div>
          <div class="btn">SHARE</div>
        </div>
      </div>
    </body></html>
  `;
}

// --- Puppeteer Setup ---
let browser;

async function initBrowser() {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: 'new'
  });
}
initBrowser();

async function generateImage(gateway, data) {
  const page = await browser.newPage();
  // Set width to match a mobile screen, high device scale factor for crisp text
  await page.setViewport({ width: 400, height: 850, deviceScaleFactor: 3 }); 
  
  let html = '';
  if (gateway === 'bkash') html = htmlBkash(data);
  else if (gateway === 'nagad') html = htmlNagad(data);
  else if (gateway === 'rocket') html = htmlRocket(data);

  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  // Wait for Google Fonts to load
  await new Promise(r => setTimeout(r, 1500)); 

  const buffer = await page.screenshot({ fullPage: true });
  await page.close();
  return buffer;
}

// --- Bot Flow ---
bot.onText(/^\/start$/, (msg) => {
  const chatId = msg.chat.id;
  sessions.set(chatId, { step: 'choose_gateway' });
  bot.sendMessage(chatId, WARNING, { parse_mode: 'Markdown', ...mainMenu() });
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data || '';
  if (data.startsWith('gw:')) {
    const gateway = data.slice(3);
    sessions.set(chatId, { step: 'await_number', gateway });
    await bot.answerCallbackQuery(q.id);
    
    let gwName = gateway === 'bkash' ? 'বিকাশ' : gateway === 'nagad' ? 'নগদ' : 'রকেট';
    await bot.sendMessage(chatId, `আপনি ${gwName} নির্বাচন করেছেন।\n\nঅনুগ্রহ করে নম্বর দিন (উদাহরণ: 01712345678):`);
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
      return bot.sendMessage(chatId, '❌ ভুল নম্বর। ১১ ডিজিটের নম্বর দিন (উদাহরণ: 01712345678)।');
    }
    session.number = text;
    session.step = 'await_amount';
    sessions.set(chatId, session);
    return bot.sendMessage(chatId, 'টাকার পরিমাণ লিখুন (উদাহরণ: 1500):');
  }

  if (session.step === 'await_amount') {
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ ভুল পরিমাণ। সংখ্যা দিন (উদাহরণ: 500)।');
    }
    session.amount = amount;
    
    if (session.gateway === 'rocket') {
      session.step = 'await_receiver';
      sessions.set(chatId, session);
      return bot.sendMessage(chatId, '✅ ঠিক আছে! এখন রিসিভার নম্বরটি দিন (যাকে টাকা পাঠাচ্ছেন):');
    } else {
      session.step = 'done';
      sessions.set(chatId, session);
      return finalizeReceipt(chatId, session);
    }
  }

  if (session.step === 'await_receiver') {
    if (!/^01\d{9}$/.test(text)) {
      return bot.sendMessage(chatId, '❌ ভুল রিসিভার নম্বর। ১১ ডিজিটের নম্বর দিন।');
    }
    session.receiver = text;
    session.step = 'done';
    sessions.set(chatId, session);
    return finalizeReceipt(chatId, session);
  }
});

async function finalizeReceipt(chatId, session) {
  await bot.sendMessage(chatId, '⏳ আপনার রসিদ তৈরি হচ্ছে...');
  
  const now = getDateTime();
  session.txid = genTxId(session.gateway);
  
  // Map data based on gateway
  const data = {
    sender: session.number,
    // For bKash/Nagad, the receiver is usually the number you entered. 
    // For Rocket, it asks for a specific receiver number.
    receiver: session.gateway === 'rocket' ? session.receiver : session.number, 
    amount: session.amount,
    txid: session.txid,
    timeStr: now.timeStr,
    dateStr: now.dateStr,
    fullDate: now.fullDate
  };

  try {
    const imageBuffer = await generateImage(session.gateway, data);
    await bot.sendPhoto(chatId, imageBuffer, {
      caption: `✅ রসিদ সফলভাবে তৈরি হয়েছে।\nট্রানজেকশন আইডি: ${session.txid}`
    });
  } catch (err) {
    console.error('[render]', err);
    await bot.sendMessage(chatId, '❌ রসিদ তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
  }
  
  sessions.delete(chatId);
}

bot.on('polling_error', (e) => console.error('[polling]', e.message));
console.log('[boot] Roost online. Pixel-perfect HTML rendering active.');
