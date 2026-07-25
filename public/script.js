// script.js — منطق سایت نوا موبایل + ویجت دستیار هوشمند
// این فایل در مرورگر کاربر اجرا می‌شود. هیچ API Key‌ای اینجا نیست؛
// همه چیز از طریق سرور خودمان (server.js) رد می‌شود.

/* ============================================================
   ۱) داده‌ی محصولات + رندر گرید و فیلترها
   ============================================================ */
let PRODUCTS = [];
let CATEGORY_LABELS = {};

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    PRODUCTS = data.products || [];
    (data.categories || []).forEach((c) => { CATEGORY_LABELS[c.id] = c.label; });
    renderProducts('all');
  } catch (err) {
    console.error('خطا در بارگذاری محصولات:', err);
    const grid = document.getElementById('product-grid');
    if (grid) grid.innerHTML = '<p style="color:var(--muted)">در حال حاضر امکان بارگذاری محصولات نیست.</p>';
  }
}

function formatToman(num) {
  return new Intl.NumberFormat('fa-IR').format(num) + ' تومان';
}

function renderProducts(filter) {
  const grid = document.getElementById('product-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const list = filter === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.category === filter);

  list.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.dataset.accent = p.accent || 'sapphire';
    card.style.animationDelay = `${Math.min(i * 0.05, 0.4)}s`;

    const chipsHtml = (p.chips || []).map((c) => `<span class="chip">${c}</span>`).join('');
    const oldPriceHtml = p.oldPrice ? `<span class="price-old">${formatToman(p.oldPrice)}</span>` : '';
    const badgeHtml = p.badge ? `<span class="card-badge">${p.badge}</span>` : '';

    card.innerHTML = `
      <div class="card-visual">
        ${badgeHtml}
        <span class="aperture-icon"></span>
      </div>
      <span class="card-brand">${p.brand}</span>
      <h3 class="card-name">${p.name}</h3>
      <div class="chip-row">${chipsHtml}</div>
      <div class="card-rating">★ ${p.rating} <span>(${p.reviews} نظر)</span></div>
      <div class="card-footer">
        <div class="price-block">
          ${oldPriceHtml}
          <span class="price-now">${formatToman(p.price)}</span>
        </div>
        <button class="ask-btn" data-ask="${p.id}">
          پرسش از دستیار
        </button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-ask]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const product = PRODUCTS.find((p) => p.id === btn.dataset.ask);
      if (!product) return;
      openChat();
      sendMessage(`درباره‌ی ${product.name} بیشتر برام توضیح بده و بگو به چه کسی پیشنهاد می‌شه؟`);
    });
  });
}

document.getElementById('filter-row')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  document.querySelectorAll('#filter-row .pill').forEach((p) => p.classList.remove('is-active'));
  btn.classList.add('is-active');
  renderProducts(btn.dataset.filter);
});

loadProducts();

/* ============================================================
   ۲) منوی موبایل
   ============================================================ */
const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');
navToggle?.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
mainNav?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
  mainNav.classList.remove('is-open');
  navToggle?.setAttribute('aria-expanded', 'false');
}));

/* ============================================================
   ۳) ویجت چت هوشمند
   ============================================================ */
const chatWidget = document.getElementById('chat-widget');
const chatFab = document.getElementById('chat-fab');
const chatPanel = document.getElementById('chat-panel');
const chatWindow = document.getElementById('chat-window');
const chatForm = document.getElementById('chat-form');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const chatClearBtn = document.getElementById('chat-clear');
const attachBtn = document.getElementById('attach-btn');
const imageInput = document.getElementById('image-input');
const imagePreviewWrap = document.getElementById('chat-image-preview');
const imagePreviewImg = document.getElementById('chat-image-preview-img');
const imageRemoveBtn = document.getElementById('chat-image-remove');
const suggestionsEl = document.getElementById('chat-suggestions');

const STORAGE_KEY = 'nova-chat-history-v1';
let history = loadHistory();
let pendingImage = null; // { dataUrl, mimeType }

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

// برای جلوگیری از خطای «حجم درخواست بیش از حد مجاز»، وقتی داریم به سرور
// می‌فرستیم، عکسِ پیام‌های قدیمی‌تر (همه به‌جز آخرین پیام کاربر) رو با یک
// متن جایگزین می‌کنیم. خودِ localStorage دست‌نخورده باقی می‌مونه و در نمایش
// روی صفحه هم عکس‌های قبلی مثل قبل دیده می‌شن؛ فقط چیزی که به سرور می‌ره سبک‌تره.
function buildPayloadForServer(fullHistory) {
  const lastUserIndex = [...fullHistory].map((m) => m.role).lastIndexOf('user');
  return fullHistory.map((msg, i) => {
    if (msg.role === 'user' && Array.isArray(msg.content) && i !== lastUserIndex) {
      return {
        role: 'user',
        content: msg.content.map((c) =>
          c.type === 'image_url' ? { type: 'text', text: '[کاربر قبلاً یک عکس فرستاده بود]' } : c
        ),
      };
    }
    return msg;
  });
}

function addMessage(text, sender, imageDataUrl) {
  const div = document.createElement('div');
  div.className = `msg msg-${sender}`;
  if (imageDataUrl) {
    const img = document.createElement('img');
    img.src = imageDataUrl;
    div.appendChild(img);
  }
  const textNode = document.createElement('div');
  textNode.textContent = text;
  div.appendChild(textNode);
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

function renderStoredHistory() {
  chatWindow.innerHTML = '';
  if (history.length === 0) {
    addMessage('سلام! من دستیار هوشمند نوا موبایلم 👋 هر سوالی درباره مشخصات، قیمت یا مقایسه گوشی‌ها داری بپرس، یا عکس گوشی موردنظرت رو بفرست.', 'bot');
    return;
  }
  history.forEach((msg) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const textPart = msg.content.find((c) => c.type === 'text');
      const imagePart = msg.content.find((c) => c.type === 'image_url');
      addMessage(textPart ? textPart.text : '', 'user', imagePart ? imagePart.image_url.url : null);
    } else {
      addMessage(typeof msg.content === 'string' ? msg.content : '', msg.role === 'user' ? 'user' : 'bot');
    }
  });
}
renderStoredHistory();

function openChat() {
  chatWidget.classList.add('is-open', 'seen');
  chatFab.setAttribute('aria-expanded', 'true');
  chatPanel.setAttribute('aria-hidden', 'false');
  setTimeout(() => promptInput.focus(), 200);
}
function closeChat() {
  chatWidget.classList.remove('is-open');
  chatFab.setAttribute('aria-expanded', 'false');
  chatPanel.setAttribute('aria-hidden', 'true');
}
function toggleChat() {
  if (chatWidget.classList.contains('is-open')) closeChat(); else openChat();
}

chatFab.addEventListener('click', toggleChat);
document.getElementById('open-chat-header')?.addEventListener('click', openChat);
document.getElementById('open-chat-hero')?.addEventListener('click', openChat);
document.getElementById('open-chat-cta')?.addEventListener('click', openChat);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chatWidget.classList.contains('is-open')) closeChat();
});

suggestionsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-q]');
  if (!btn) return;
  sendMessage(btn.dataset.q);
});

/* --- پیوست عکس --- */
attachBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    alert('حجم عکس باید کمتر از ۸ مگابایت باشد.');
    imageInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { dataUrl: reader.result, mimeType: file.type };
    imagePreviewImg.src = reader.result;
    imagePreviewWrap.hidden = false;
    attachBtn.classList.add('has-image');
  };
  reader.readAsDataURL(file);
});

imageRemoveBtn.addEventListener('click', () => {
  pendingImage = null;
  imageInput.value = '';
  imagePreviewWrap.hidden = true;
  attachBtn.classList.remove('has-image');
});

/* --- ارسال پیام --- */
async function sendMessage(promptText) {
  const image = pendingImage;
  pendingImage = null;
  imagePreviewWrap.hidden = true;
  attachBtn.classList.remove('has-image');
  imageInput.value = '';

  addMessage(promptText, 'user', image ? image.dataUrl : null);

  // ساخت پیام برای تاریخچه؛ اگر عکس پیوست شده به فرمت چندوجهی می‌فرستیم
  const userMessage = image
    ? {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: image.dataUrl } },
        ],
      }
    : { role: 'user', content: promptText };

  history.push(userMessage);
  saveHistory();

  sendBtn.disabled = true;
  const loadingEl = addMessage('', 'bot');
  loadingEl.classList.add('msg-loading');
  loadingEl.innerHTML = '<span></span><span></span><span></span>';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: buildPayloadForServer(history) }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    loadingEl.remove();

    if (!res.ok) {
      const friendly =
        res.status === 413
          ? 'عکس یا مکالمه خیلی سنگین شده. لطفاً گفتگو رو با دکمه‌ی «پاک کردن» ریست کنید یا عکس کوچیک‌تری بفرستید.'
          : data?.error || 'مشکلی پیش آمد';
      addMessage(`خطا: ${friendly}`, 'bot');
      return;
    }
    addMessage(data.reply, 'bot');
    history.push({ role: 'assistant', content: data.reply });
    saveHistory();
  } catch (err) {
    loadingEl.remove();
    addMessage('خطا در برقراری ارتباط با سرور.', 'bot');
  } finally {
    sendBtn.disabled = false;
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  promptInput.value = '';
  promptInput.style.height = 'auto';
  sendMessage(prompt);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 100)}px`;
});

chatClearBtn.addEventListener('click', () => {
  history = [];
  saveHistory();
  renderStoredHistory();
});
