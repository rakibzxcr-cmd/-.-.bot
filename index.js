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

// Helper for Bangla/English date and time
function getDateTime() {
  const d = new Date();
  // Convert to Bangladesh Time (UTC+6)
  d.setHours(d.getHours() + 6); 
  
  const pad = (n) => String(n).padStart(2, '0');
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  
  const timeStr = `${pad(h12)}:${pad(d.getMinutes())}${ampm.toLowerCase()}`;
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

// --- HTML Generators ---

const baseCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap');
  body { margin: 0; padding: 0; font-family: 'Hind Siliguri', sans-serif; background: #f0f0f0; display: flex; justify-content: center; }
  .container { width: 400px; background: #fff; min-height: 800px; position: relative; }
`;

function htmlBkash(data) {
  return `
    <html><head><style>${baseCSS}
      .header { background: #e2136e; color: white; padding: 20px; font-size: 20px; font-weight: 600; }
      .content { padding: 20px; }
      .success-text { color: #008000; font-weight: 700; font-size: 18px; margin-bottom: 20px; text-align: center; }
      .number-row { display: flex; align-items: center; margin-bottom: 20px; }
      .circle { width: 50px; height: 50px; background: #d1a3d6; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; margin-right: 15px; }
      .number-box h2 { margin: 0; font-size: 22px; color: #333; }
      .number-box p { margin: 0; font-size: 14px; color: #888; }
      .grid { border-top: 1px solid #ddd; border-left: 1px solid #ddd; margin-top: 20px; }
      .row { display: flex; border-bottom: 1px solid #ddd; }
      .col { flex: 1; padding: 15px; border-right: 1px solid #ddd; }
      .label { font-size: 14px; color: #666; margin-bottom: 5px; }
      .value { font-size: 18px; color: #333; font-weight: 600; }
      .amount { color: #e2136e; font-weight: 700; }
      .bottom { background: #e2136e; color: white; padding: 15px; text-align: center; font-size: 18px; position: absolute; bottom: 0; width: 100%; box-sizing: border-box; }
    </style></head><body>
      <div class="container">
        <div class="header">বিকাশ</div>
        <div class="content">
          <div class="success-text">আপনার সেন্ড মানি সফল হয়েছে</div>
          <div class="number-row">
            <div class="circle">0</div>
            <div class="number-box">
              <h2>${data.receiver}</h2>
              <p>${data.receiver}</p>
            </div>
          </div>
          <div class="grid">
            <div class="row">
              <div class="col"><div class="label">সময়</div><div class="value">${data.timeStr} ${data.dateStr}</div></div>
              <div class="col"><div class="label">ট্রানজেকশন আইডি</div><div class="value" style="font-size:14px">${data.txid}</div></div>
            </div>
            <div class="row">
              <div class="col"><div class="label">সর্বমোট</div><div class="value amount">৳${data.amount}</div></div>
              <div class="col"><div class="label">নতুন ব্যালেন্স</div><div class="value">*******</div></div>
            </div>
          </div>
          <div style="text-align: center; margin-top: 30px; color: #e2136e; font-weight: 600;">বিকাশ রিওয়ার্ড পয়েন্ট</div>
        </div>
        <div class="bottom">হোম-এ ফিরে যাই &rarr;</div>
      </div>
    </body></html>
  `;
}

function htmlNagad(data) {
  return `
    <html><head><style>${baseCSS}
      .header { background: #ee1c25; padding: 40px 20px; text-align: center; }
      .check-circle { width: 80px; height: 80px; border: 4px solid #ff9900; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
      .check { color: #ee1c25; font-size: 40px; font-weight: bold; }
      .content { padding: 20px; }
      .title { color: #ee1c25; font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 5px; }
      .num { text-align: center; font-size: 18px; color: #333; margin-bottom: 30px; }
      .list { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
      .list .lbl { color: #ee1c25; }
      .list .val { color: #333; font-weight: 600; }
      .btn { background: #ee1c25; color: white; text-align: center; padding: 15px; border-radius: 25px; margin-top: 30px; font-weight: 600; }
    </style></head><body>
      <div class="container">
        <div class="header">
          <div class="check-circle"><span class="check">&check;</span></div>
        </div>
        <div class="content">
          <div class="title">সেন্ড মানি সফল</div>
          <div class="num">${data.receiver}</div>
          
          <div class="list"><span class="lbl">ট্রানজেকশন আইডি</span><span class="val">${data.txid}</span></div>
          <div class="list"><span class="lbl">পরিমাণ</span><span class="val">${data.amount}.00 টাকা</span></div>
          <div class="list"><span class="lbl">খরচ</span><span class="val">0 টাকা</span></div>
          <div class="list"><span class="lbl">সর্বমোট</span><span class="val">${data.amount}.00 টাকা</span></div>
          <div class="list"><span class="lbl">সময়</span><span class="val">${data.dateStr} ${data.timeStr}</span></div>

          <div class="btn">হোম এ ফিরে যান</div>
        </div>
      </div>
    </body></html>
  `;
}

function htmlRocket(data) {
  return `
    <html><head><style>${baseCSS}
      .header { background: #8a2be2; color: white; padding: 20px; font-size: 20px; text-align: center; }
      .content { padding: 20px; }
      .logo { text-align: center; margin-bottom: 20px; color: #8a2be2; font-size: 24px; font-weight: bold; }
      .title { text-align: center; font-size: 18px; color: #333; margin-bottom: 20px; }
      .section-title { font-weight: 700; color: #333; margin: 15px 0 10px 0; border-top: 1px solid #ccc; padding-top: 15px; }
      .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; }
      .row span:first-child { color: #555; }
      .row span:last-child { font-weight: 600; color: #222; }
      .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
      .buttons { display: flex; gap: 10px; margin-top: 20px; }
      .btn { flex: 1; background: #8a2be2; color: white; text-align: center; padding: 12px; border-radius: 20px; font-weight: bold; }
    </style></head><body>
      <div class="container">
        <div class="header">Receipt</div>
        <div class="content">
          <div class="logo">ROCKET</div>
          <div class="title">Send Money</div>
          
          <div class="section-title">Transaction Information:</div>
          <div class="row"><span>Transaction ID</span><span>${data.txid}</span></div>
          <div class="row"><span>Transaction Date</span><span>${data.fullDate} ${data.timeStr}</span></div>
          <div class="row"><span>Transaction Amount</span><span>${data.amount}.00</span></div>
          <div class="row"><span>Fee Amount</span><span>0.00</span></div>
          
          <div class="section-title">Other Information:</div>
          <div class="row"><span>Sender A/C No.</span><span>${data.sender}</span></div>
          <div class="row"><span>Receiver A/C No.</span><span>${data.receiver}</span></div>
          
          <div class="footer">This receipt generated electronically.</div>
          
          <div class="buttons">
            <div class="btn">SAVE</div>
            <div class="btn">SHARE</div>
          </div>
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
  await page.setViewport({ width: 400, height: 800, deviceScaleFactor: 2 }); // High res
  
  let html = '';
  if (gateway === 'bkash') html = htmlBkash(data);
  else if (gateway === 'nagad') html = htmlNagad(data);
  else if (gateway === 'rocket') html = htmlRocket(data);

  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  // Small delay to ensure fonts load
  await new Promise(r => setTimeout(r, 1000)); 

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
    await bot.sendMessage(chatId, `আপনি ${gwName} নির্বাচন করেছেন।\n\nঅনুগ্রহ করে আপনার নম্বর দিন (উদাহরণ: 01712345678):`);
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
console.log('[boot] Roost online. HTML rendering active.');
