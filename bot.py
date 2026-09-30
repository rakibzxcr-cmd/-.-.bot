import os
from telegram import (
    Update,
    InlineKeyboardMarkup,
    InlineKeyboardButton
)

from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters
)

# =========================================
# SETTINGS
# =========================================

BOT_TOKEN = os.environ.get("TOKEN")

ADMIN_ID = int(os.environ.get("ADMIN_ID", 8294558143))

CHANNEL_CHAT = "@rakibfxatrading"

CHANNEL_LINK = "https://t.me/+SFHN6mzE-ag1NTI1"

VIP_CHANNEL_LINK = "https://t.me/+659xT9qgOV45ZDI9"

SUPPORT_LINK = "https://call.whatsapp.com/video/5to4Ew6cMwgxPYr5Av7vbA"

EXNESS_LINK = "https://one.exnessonelink.com/a/x4akjzo76c"

MAIN_IMAGE_URL = "https://hc1.checker.in/file2link/photos/file_615888.jpg/file_615888.jpg"

# =========================================
# HELPER
# =========================================

async def check_user_joined(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> bool:
    try:
        member = await context.bot.get_chat_member(chat_id=CHANNEL_CHAT, user_id=user_id)
        if member.status in ["creator", "administrator", "member"]:
            return True
        return False
    except Exception as e:
        print(f"Chat Member Check Error: {e}")
        return False

# =========================================
# BUTTONS
# =========================================

force_join_buttons = InlineKeyboardMarkup([
    [InlineKeyboardButton("📢 আমাদের চ্যানেলে জয়েন করুন", url=CHANNEL_LINK)],
    [InlineKeyboardButton("✅ ভেরিফাই করুন", callback_data="verify_join")]
])

back_to_main = InlineKeyboardMarkup([
    [InlineKeyboardButton("🏠 মেইন মেনু", callback_data="main_menu")]
])

main_buttons = InlineKeyboardMarkup([
    [InlineKeyboardButton("📘 নতুনদের জন্য গাইড", callback_data="new_guide")],
    [InlineKeyboardButton("🟢 Account করেছি", callback_data="account_done")],
    [InlineKeyboardButton("🔴 Account করিনি", callback_data="account_not")],
    [InlineKeyboardButton("👨‍💻 Support", url=SUPPORT_LINK)]
])

guide_buttons = InlineKeyboardMarkup([
    [InlineKeyboardButton("1️⃣ Account করতে চাই", callback_data="account_create")],
    [InlineKeyboardButton("2️⃣ KYC গাইড", callback_data="kyc_guide")],
    [InlineKeyboardButton("3️⃣ Deposit গাইড", callback_data="deposit_guide")],
    [InlineKeyboardButton("4️⃣ Exness ID কোথায়?", callback_data="id_where")],
    [InlineKeyboardButton("5️⃣ ID সাবমিট করুন", callback_data="submit_id")],
    [InlineKeyboardButton("🏠 মেইন মেনু", callback_data="main_menu")]
])

# =========================================
# MAIN MENU TEXT
# =========================================

MAIN_MENU_TEXT = """
আসসালামু আলাইকুম!🫡

👋 𝐅𝐗.𝐀 𝐓𝐫𝐚𝐝𝐢𝐧𝐠 𝐙𝐨𝐧𝐞 কপি ট্রেড প্রোগ্রামে স্বাগতম

আপনি একদম নতুন হন অথবা আগে থেকেই EXNESS ACCOUNT করে থাকেন—
এই Bot আপনাকে ধাপে ধাপে গাইড করবে ✅

━━━━━━━━━━━━━━━━━━━

📌 Copy Trade শুরু করতে যা যা লাগবে:

✅ আমাদের LINK দিয়ে EXNESS ACCOUNT রেজিস্ট্রেশন করা থাকতে হবে

✅ EXNESS অ্যাকাউন্ট ভেরিফিকেশন কমপ্লিট হতে হবে / KYC verification complete

✅ রিয়েল অ্যাকাউন্ট এবং ডিপোজিট করেছেন এমন অ্যাকাউন্ট হতে হবে

━━━━━━━━━━━━━━━━━━━

নিচের Menu থেকে আপনার বর্তমান অবস্থান সিলেক্ট করুন 👇
"""

# =========================================
# START
# =========================================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["waiting_for_id"] = False
    user_id = update.effective_user.id

    is_joined = await check_user_joined(user_id, context)

    if not is_joined:
        join_msg = (
            "আসসালামু আলাইকুম! 🌸\n\n"
            "𝐅𝐗.𝐀 𝐓𝐫𝐚𝐝𝐢𝐧𝐠 𝐙𝐨𝐧𝐞 প্রোগ্রামে আপনাকে স্বাগতম।\n\n"
            "বটটি ব্যবহার করতে আপনাকে অবশ্যই আমাদের চ্যানেলে জয়েন করতে হবে। "
            "নিচের বাটনে চাপ দিয়ে জয়েন করার পর 'ভেরিফাই করুন' এ ক্লিক করুন।"
        )
        await update.message.reply_text(join_msg, reply_markup=force_join_buttons)
        return

    await update.message.reply_photo(
        photo=MAIN_IMAGE_URL,
        caption=MAIN_MENU_TEXT,
        reply_markup=main_buttons
    )

# =========================================
# BUTTON HANDLER
# =========================================

async def buttons(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data
    user_id = query.from_user.id

    if data == "verify_join":
        is_joined = await check_user_joined(user_id, context)
        if is_joined:
            await query.answer("✅ আপনার ভেরিফিকেশন সফল হয়েছে!", show_alert=False)
            await query.message.delete()
            await query.message.reply_photo(
                photo=MAIN_IMAGE_URL,
                caption=MAIN_MENU_TEXT,
                reply_markup=main_buttons
            )
        else:
            await query.answer("❌ আপনি এখনো চ্যানেলে জয়েন করেননি!", show_alert=True)
        return

    await query.answer()

    if not await check_user_joined(user_id, context):
        await query.message.reply_text(
            "⚠️ বট ব্যবহার করতে আপনাকে প্রথমে আমাদের চ্যানেলে জয়েন হতে হবে!",
            reply_markup=force_join_buttons
        )
        return

    if data == "main_menu":
        context.user_data["waiting_for_id"] = False
        await query.message.delete()
        await query.message.reply_photo(
            photo=MAIN_IMAGE_URL,
            caption=MAIN_MENU_TEXT,
            reply_markup=main_buttons
        )

    elif data == "new_guide":
        msg = """
📘 নতুনদের জন্য গাইড

1️⃣ অবশ্যই আমাদের Link থেকে একটি EXNESS ACCOUNT Registration করুন
2️⃣ Account Verification / KYC Complete করুন
3️⃣ একটি Real Trading Account Open করুন
4️⃣ Real Account এ Deposit করুন
5️⃣ Deposit করার পরে ২৪ ঘন্টা অপেক্ষা করুন
6️⃣ আবার Bot এ এসে "🟢 Account করেছি" Button এ Click করুন
7️⃣ এরপর Chat Box এ আপনার Exness ID টি Send করুন
8️⃣ Account Verify হলে VIP Channel এর Join Link পাবেন ✅

━━━━━━━━━━━━━━

❗ অবশ্যই আমাদের Link থেকে Account Open করতে হবে
❗ Real Account এ Deposit না থাকলে Join হতে সমস্যা হতে পারে
"""
        await query.message.reply_text(msg, reply_markup=guide_buttons)

    elif data == "account_create":
        msg = f"""
📌 EXNESS Account Opening Guide

📌 Official Registration Link 👇
{EXNESS_LINK}

1️⃣ Link এ Click করুন
2️⃣ Email অথবা Phone Number দিয়ে Registration করুন
3️⃣ Strong Password দিন
4️⃣ Country Select করুন
5️⃣ Registration Complete করুন

━━━━━━━━━━━━━━
✅ Email Verify করুন
✅ Personal Area Setup করুন
✅ Real Trading Account Create করুন

❗ অবশ্যই আমাদের Official Link ব্যবহার করতে হবে
❗ Fake Information ব্যবহার করবেন না

✅ এরপর "KYC গাইড" Button এ Click করুন
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "kyc_guide":
        msg = """
🪪 EXNESS KYC Verification Guide

📌 KYC Verification এর জন্য যা লাগবে:
✅ NID / Passport / Driving License
✅ সঠিক নাম ও জন্মতারিখ
✅ Address Information
✅ Face Verification

📌 Step-by-Step:
1️⃣ Exness Account এ Login করুন
2️⃣ Profile / Personal Area তে যান
3️⃣ "Verify Account" এ Click করুন
4️⃣ সঠিক Information দিন
5️⃣ NID / Passport এর Front + Back Upload করুন
6️⃣ Face Verification Complete করুন
7️⃣ Address Verification (প্রয়োজনে)

⏳ Verification Complete হতে সময় লাগে
❗ KYC Complete না থাকলে Delay হবে

✅ KYC হলে "Deposit গাইড" এ যান
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "deposit_guide":
        msg = """
💰 EXNESS Deposit Guide

📌 Deposit করার আগে:
✅ Account Fully Verified
✅ Real Trading Account Open
✅ নিজের Payment Method ব্যবহার করুন

📌 Binance Pay দিয়ে Deposit:
1️⃣ Exness এ Login করুন
2️⃣ Deposit → Binance Pay
3️⃣ Trading Account Select করুন
4️⃣ Amount দিন
5️⃣ Binance Pay ID / QR ব্যবহার করুন
6️⃣ Binance App এ Payment Complete করুন
7️⃣ Security Verification Complete করুন

📌 কয়েক মিনিটেই Balance Add হয় ✅

⏳ Deposit হলে ২৪ ঘন্টা অপেক্ষা করুন
তারপর "🟢 Account করেছি" তে Click করুন
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "id_where":
        msg = """
🆔 Exness ID কোথায় দেখবেন?

1️⃣ Exness App Open করুন
2️⃣ Profile / Personal Area তে যান
3️⃣ Trading Account এ Click করুন
4️⃣ MT4 / MT5 Login ID দেখতে পাবেন ✅

📌 সাধারণত ৬-৮ সংখ্যার হয়
📌 শুধু Number ID Submit করবেন
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "submit_id":
        context.user_data["waiting_for_id"] = True
        msg = """
📝 আপনার Exness ID Submit করুন

📌 শুধু সংখ্যার ID পাঠান

উদাহরণ:
12345678

⚠️ ভুল বা Fake ID দিলে Access বাতিল হবে
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "account_done":
        context.user_data["waiting_for_id"] = True
        msg = """
🟢 আপনি Account করেছেন

এখন আপনার Exness ID টি Send করুন 👇

📌 Example:
12345678

✅ আমাদের Team আপনার Account Verify করবে
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data == "account_not":
        msg = f"""
❌ এখনো Account করেননি

Copy Trade Access পেতে হলে:
✅ EXNESS Account Open করুন
✅ KYC Complete করুন
✅ Real Account এ Deposit করুন

📌 Official Link 👇
{EXNESS_LINK}

✅ শুরু করতে "📘 নতুনদের জন্য গাইড" Button এ Click করুন
"""
        await query.message.reply_text(msg, reply_markup=back_to_main)

    elif data.startswith("accept_"):
        user_id = int(data.split("_")[1])
        msg = f"""
🎉 অভিনন্দন!

আপনার Account Successfully Approved হয়েছে ✅

📢 Official VIP Channel এ Join করুন 👇
{VIP_CHANNEL_LINK}

✅ দ্রুত আপনাকে Copy Trade System এ যুক্ত করা হবে
"""
        await context.bot.send_message(chat_id=user_id, text=msg, reply_markup=back_to_main)
        await query.edit_message_text("✅ User Approved")

    elif data.startswith("reject_"):
        user_id = int(data.split("_")[1])
        msg = f"""
❌ আপনার Account Verify হয়নি

কারণ: আপনার Account আমাদের Link এর Under এ পাওয়া যায়নি

✅ নতুন করে Account করুন:
{EXNESS_LINK}

📌 Registration + Verification Complete করে আবার /start দিন
"""
        await context.bot.send_message(chat_id=user_id, text=msg, reply_markup=back_to_main)
        await query.edit_message_text("❌ User Rejected")

# =========================================
# RECEIVE MESSAGE
# =========================================

async def receive_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message:
        return

    user_id = update.effective_user.id

    if not await check_user_joined(user_id, context):
        await update.message.reply_text(
            "⚠️ বটটি ব্যবহার করতে চ্যানেলে জয়েন করুন!",
            reply_markup=force_join_buttons
        )
        return

    if context.user_data.get("waiting_for_id"):
        exness_id = update.message.text.strip()
        user = update.effective_user

        admin_buttons = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ ACCEPT", callback_data=f"accept_{user.id}"),
                InlineKeyboardButton("❌ REJECT", callback_data=f"reject_{user.id}")
            ]
        ])

        username = user.username if user.username else "No Username"

        admin_text = f"""
📥 নতুন ID সাবমিট এসেছে

━━━━━━━━━━━━━━
👤 USER: @{username}
🆔 Telegram ID: {user.id}
📌 EXNESS ID: {exness_id}
━━━━━━━━━━━━━━

🔗 Account অবশ্যই এই Link এর Under এ হতে হবে:
{EXNESS_LINK}
"""

        await context.bot.send_message(
            chat_id=ADMIN_ID,
            text=admin_text,
            reply_markup=admin_buttons
        )

        await update.message.reply_text(
            """
✅ আপনার ID Successfully Submit হয়েছে

📌 আমাদের Team আপনার Account Verify করছে

⏳ কিছু সময় অপেক্ষা করুন
""",
            reply_markup=back_to_main
        )

        context.user_data["waiting_for_id"] = False

    else:
        await update.message.reply_photo(
            photo=MAIN_IMAGE_URL,
            caption=MAIN_MENU_TEXT,
            reply_markup=main_buttons
        )

# =========================================
# ERROR HANDLER
# =========================================

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    print("ERROR:", context.error)

# =========================================
# RUN
# =========================================

app = Application.builder().token(BOT_TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(buttons))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, receive_message))
app.add_error_handler(error_handler)

print("====================================")
print("🤖 FX.A TRADING ZONE BOT RUNNING...")
print("====================================")

app.run_polling()
