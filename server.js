// server.js
// سرور Express که هم سایت نوا موبایل را سرو می‌کند و هم درخواست‌های چت را
// به Groq API می‌فرستد. کلید API فقط اینجا (سمت سرور) استفاده می‌شود.

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const products = require('./products.json');

const app = express();
app.use(cors());
// حجم بالاتر برای body لازم است چون عکس‌های base64 می‌توانند حجیم باشند
app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// مدل متنی برای گفتگوی معمولی
// از "groq/compound" استفاده می‌کنیم چون یک ابزار جستجوی وب (web search) داخلش
// به‌صورت توکار وجود داره. یعنی مدل خودش تشخیص می‌ده که یک سوال نیاز به اطلاعات
// به‌روز/خارج از کاتالوگ فروشگاه داره یا نه، و در صورت نیاز خودکار سرچ می‌کنه؛
// بدون اینکه لازم باشه API Key یا سرویس سرچ جداگانه‌ای اضافه کنیم.
// مستندات: https://console.groq.com/docs/compound
const TEXT_MODEL = 'groq/compound';
// مدل چندوجهی (تصویر + متن)؛ طبق مستندات فعلی Groq تنها مدل چندوجهی است
// (لیست به‌روز را در console.groq.com/docs/vision ببینید)
// توجه: سیستم‌های compound فعلاً از ورودی تصویر پشتیبانی نمی‌کنن، برای همین
// وقتی کاربر عکس می‌فرسته همچنان از این مدل استفاده می‌شه، نه از compound.
const VISION_MODEL = 'qwen/qwen3.6-27b';

if (!GROQ_API_KEY) {
  console.warn('هشدار: متغیر GROQ_API_KEY تنظیم نشده است. فایل .env را بسازید.');
}

// این تابع کاتالوگ محصولات را به یک متن فشرده برای system prompt تبدیل می‌کند
// تا مدل بدون نیاز به دیتابیس یا embedding به محتوای واقعی سایت دسترسی داشته باشد.
function buildSiteContext() {
  const lines = products.products.map((p) => {
    const specs = [
      `رم: ${p.ram}`,
      `حافظه: ${p.storage}`,
      `نمایشگر: ${p.screen}`,
      `دوربین: ${p.camera}`,
      `باتری: ${p.battery}`,
      `پردازنده: ${p.chip}`,
    ].join('، ');
    const priceLine = p.oldPrice
      ? `قیمت: ${p.price.toLocaleString('fa-IR')} تومان (قیمت قبلی ${p.oldPrice.toLocaleString('fa-IR')} تومان)`
      : `قیمت: ${p.price.toLocaleString('fa-IR')} تومان`;
    return `- ${p.name} (برند: ${p.brand}, دسته: ${p.category}) — ${priceLine}. ${specs}. رنگ‌ها: ${p.colors.join('، ')}. امتیاز: ${p.rating} از ۵ (${p.reviews} نظر).${p.badge ? ` برچسب: ${p.badge}.` : ''}`;
  });

  return [
    `نام فروشگاه: ${products.storeName} — ${products.tagline}`,
    `شرایط ارسال: ${products.shippingInfo}`,
    `گارانتی: ${products.warrantyInfo}`,
    `پشتیبانی: ${products.supportHours}`,
    '',
    'فهرست محصولات موجود:',
    ...lines,
  ].join('\n');
}

const SITE_CONTEXT = buildSiteContext();

const SYSTEM_PROMPT = `You are the AI shopping assistant embedded on the ${products.storeName} website, a mobile phone store.
Always reply in the same language the user wrote in (Persian or English), fluently and naturally. Never mix in characters from other scripts (e.g. Chinese) unless the user explicitly wrote in that language.
Remember details the user has shared earlier in this conversation (like their name or budget) and use them naturally.

You have access to the store's real product catalog and policies below — for any question about this store's specs, prices, comparisons, recommendations, shipping, or warranty, answer ONLY from this catalog (do not search the web for these, and do not invent facts not present here; if something about the store isn't covered, say you're not sure and suggest contacting support).

For anything NOT related to this store's catalog (general knowledge, current events, other products/brands not listed here, prices elsewhere, technical questions, etc.), you have a built-in web search tool — use it to find accurate, up-to-date information and answer normally like a helpful general assistant. Don't refuse or say you can only help with the store; just search and answer.

If the user sends a photo (e.g. of their current phone, a screen issue, or a product they're comparing), look at it carefully and connect your answer back to the catalog when relevant (e.g. suggesting a suitable upgrade or matching accessory).
Keep answers concise, friendly, and focused on helping the person.

--- STORE CONTEXT ---
${SITE_CONTEXT}
--- END STORE CONTEXT ---`;

// مسیر دریافت کاتالوگ محصولات برای رندر در فرانت‌اند
app.get('/api/products', (req, res) => {
  res.json(products);
});

// آیا آخرین پیام کاربر شامل عکس است؟
function messagesContainImage(messages) {
  return messages.some(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')
  );
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'فیلد messages الزامی است و باید آرایه غیرخالی باشد.' });
    }

    // فقط ۲۰ پیام آخر را می‌فرستیم تا از سقف توکن مدل رد نشویم
    const recentHistory = messages.slice(-20);
    const hasImage = messagesContainImage(recentHistory);
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
        // نسخه‌ی جدیدترِ سیستم compound رو فعال می‌کنه (جستجوی وب پیشرفته‌تر)
        'Groq-Model-Version': 'latest',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...recentHistory,
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'خطا در ارتباط با Groq' });
    }

    const reply = data.choices?.[0]?.message?.content ?? '';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  }
});

app.listen(PORT, () => {
  console.log(`سرور روی http://localhost:${PORT} در حال اجراست`);
});