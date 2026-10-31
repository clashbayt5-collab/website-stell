// Прайс-лист и длительности приходят с сервера (services.json). price: null — цена договорная.
let SERVICES = [];
let CATEGORY_LABELS = {};

const formatPrice = (s) =>
  s.price === null ? "Договорная" : `${s.from ? "от " : ""}${s.price.toLocaleString("ru-RU")} ₽`;

// ---------- шапка ----------
const header = document.getElementById("header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const burger = document.getElementById("burger");
const nav = document.getElementById("nav");
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  burger.setAttribute("aria-expanded", open);
});
nav.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
  }
});

// Пункты меню: две грани для переворота вверх
document.querySelectorAll(".nav a").forEach((a) => {
  const text = a.textContent.trim();
  a.innerHTML = `<span class="flip"><span class="flip__face">${text}</span>` +
    `<span class="flip__face flip__face--bottom" aria-hidden="true">${text}</span></span>`;
});

// ---------- вьющиеся пряди и кисточка с краской ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const heroDefs = document.querySelector(".hero__bg defs");
const baseGroup = document.getElementById("strandsBase");
const paintGroup = document.getElementById("strandsPaint");
const paintRect = document.getElementById("paintRect");
const brush = document.getElementById("brush");
const brushPaint = document.getElementById("brushPaint");
const dropsGroup = document.getElementById("drops");

const BUNDLES = [
  { base: 640, amp: 60, count: 10, phase: 0.0, opacity: 0.6 },
  { base: 695, amp: 50, count: 12, phase: 1.3, opacity: 0.65 },
  { base: 750, amp: 45, count: 16, phase: 2.4, opacity: 0.8 },
];

// Палитры: по градиенту на каждый пучок. Первая — «натуральный» цвет до окрашивания.
const PALETTES = [
  [["#5a4a6e", "#7d6b8f"], ["#6b5878", "#8f7a96"], ["#7f6c84", "#a593a8"]],
  [["#E8167A", "#FF5E8A"], ["#F5793B", "#FBB034"], ["#FBB034", "#FFD27A"]],
  [["#7B2FF7", "#C86DD7"], ["#A23CF0", "#F15BB5"], ["#C86DD7", "#F7B2FF"]],
  [["#B23A1E", "#E2683C"], ["#D9572B", "#F29E4C"], ["#F29E4C", "#FFD39A"]],
  [["#E85D9C", "#FFB3C6"], ["#F49AC2", "#FFD1E1"], ["#FFC8DD", "#FFF0F5"]],
];

PALETTES.forEach((palette, p) => {
  palette.forEach(([from, to], b) => {
    heroDefs.insertAdjacentHTML("beforeend",
      `<linearGradient id="hair-${p}-${b}" x1="0" x2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`);
  });
});

const strands = [];
BUNDLES.forEach((b, bi) => {
  for (let i = 0; i < b.count; i++) {
    const width = (1 + Math.random() * 2).toFixed(1);
    const opacity = (b.opacity * (0.5 + Math.random() * 0.5)).toFixed(2);
    // одна и та же прядь рисуется дважды: в старом цвете и в новом (под маской)
    const [basePath, paintPath] = [baseGroup, paintGroup].map((group) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-width", width);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("opacity", opacity);
      group.appendChild(path);
      return path;
    });
    strands.push({ basePath, paintPath, b, bi, offset: (i - b.count / 2) * 5, jitter: Math.random() * 0.8 });
  }
});

function setPalettes(from, to) {
  strands.forEach(({ basePath, paintPath, bi }) => {
    basePath.setAttribute("stroke", `url(#hair-${from}-${bi})`);
    paintPath.setAttribute("stroke", `url(#hair-${to}-${bi})`);
  });
  brushPaint.setAttribute("fill", PALETTES[to][1][0]);
}

const waveAt = (b, s, p) => {
  const u = s / 1440;
  return b.base + b.amp * Math.sin(u * 5.2 + p) + b.amp * 0.5 * Math.sin(u * 11 - p * 1.3);
};

// Прядь — плавная волна, на которую местами накручены завитки (трохоида)
const CURL_K = 0.055; // частота завитков, рад/px
function drawStrands(t) {
  strands.forEach(({ basePath, paintPath, b, offset, jitter }) => {
    const p = b.phase + jitter + t;
    let d = "";
    for (let s = -80; s <= 1520; s += 6) {
      const u = s / 1440;
      const wave = waveAt(b, s, p) + offset;
      const bump = Math.max(0, Math.sin(u * Math.PI * 2.5 - t * 0.9 + jitter * 4));
      const r = (10 + 16 * u) * bump ** 3;
      const a = s * CURL_K - t * 1.6 + jitter * 9;
      d += `${d ? "L" : "M"}${(s + r * Math.cos(a)).toFixed(1)} ${(wave + r * Math.sin(a)).toFixed(1)}`;
    }
    basePath.setAttribute("d", d);
    paintPath.setAttribute("d", d);
  });
}

// Капли краски с кисточки
const drops = Array.from({ length: 14 }, () => {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("r", "0");
  dropsGroup.appendChild(c);
  return { c, x: 0, y: 0, vy: 0, life: 0 };
});
let nextDrop = 0;
function spawnDrop(x, y, color) {
  const d = drops.find((d) => d.life <= 0);
  if (!d) return;
  Object.assign(d, { x: x + (Math.random() - 0.5) * 20, y, vy: 0.5 + Math.random(), life: 1 });
  d.c.setAttribute("fill", color);
}
function updateDrops() {
  drops.forEach((d) => {
    if (d.life <= 0) return;
    d.vy += 0.12;
    d.y += d.vy;
    d.life -= 0.018;
    d.c.setAttribute("cx", d.x.toFixed(1));
    d.c.setAttribute("cy", d.y.toFixed(1));
    d.c.setAttribute("r", Math.max(0, 3.2 * d.life).toFixed(2));
    d.c.setAttribute("opacity", Math.max(0, d.life).toFixed(2));
  });
}

// Проход кисточки: слева направо, за ней пряди окрашиваются по всей длине
const PASS_MS = 5200;
const PAUSE_MS = 1400;
const ease = (x) => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
let fromPalette = 0;
let toPalette = 1;
let passStart = 0;
setPalettes(fromPalette, toPalette);

function frame(ms) {
  const t = ms / 2600;
  drawStrands(t);

  if (!passStart) passStart = ms;
  const k = Math.min(1, (ms - passStart) / PASS_MS);
  const x = -160 + ease(k) * 1780;
  paintRect.setAttribute("width", Math.max(0, x + 200).toFixed(1));

  // кончик кисти скользит по среднему пучку и чуть пружинит
  const mid = BUNDLES[1];
  const y = waveAt(mid, x, mid.phase + t) - 4 + Math.sin(ms / 140) * 3;
  const tilt = Math.sin(ms / 420) * 4;
  brush.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(1.5)`);

  if (k < 1 && x > -40 && x < 1480 && ms > nextDrop) {
    spawnDrop(x, y + 6, PALETTES[toPalette][1][0]);
    nextDrop = ms + 90 + Math.random() * 120;
  }
  updateDrops();

  // проход закончен — новый цвет становится основным, кисть берёт следующую краску
  if (ms - passStart > PASS_MS + PAUSE_MS) {
    fromPalette = toPalette;
    toPalette = toPalette % (PALETTES.length - 1) + 1;
    setPalettes(fromPalette, toPalette);
    paintRect.setAttribute("width", "0");
    passStart = ms;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- копирование номера ----------
const toast = document.getElementById("toast");
let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

const isTouch = window.matchMedia("(pointer: coarse)").matches;
document.querySelectorAll("[data-copy-phone]").forEach((link) => {
  link.addEventListener("click", (e) => {
    // на компьютере не пытаемся звонить, на телефоне копируем и открываем звонилку
    if (!isTouch) e.preventDefault();
    copyText(link.textContent.trim());
    showToast("Номер скопирован");
  });
});

// ---------- прайс ----------
const grid = document.getElementById("priceGrid");
const serviceSelect = document.getElementById("serviceSelect");

function renderPrices(category) {
  grid.innerHTML = SERVICES.filter((s) => s.category === category).map((s, i) => `
    <article class="price-card" style="animation-delay:${i * 60}ms">
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
      <div class="price-card__bottom">
        <span class="price-card__price ${s.price === null ? "price-card__price--deal" : ""}">${formatPrice(s)}</span>
        <button class="price-card__btn" data-service="${s.id}">
          ${s.price === null ? "Узнать цену" : "Записаться"}
        </button>
      </div>
    </article>`).join("");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    renderPrices(tab.dataset.tab);
  });
});

// Кнопка на карточке — выбираем услугу в форме и прокручиваем к ней
grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-service]");
  if (!btn) return;
  serviceSelect.value = btn.dataset.service;
  updateServiceHint();
  loadSlots();
  document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
});

// ---------- форма записи ----------
const form = document.getElementById("bookingForm");
const masterSelect = document.getElementById("masterSelect");
const dateInput = document.getElementById("dateInput");
const timeSelect = document.getElementById("timeSelect");
const slotNote = document.getElementById("slotNote");

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const humanDate = (isoDate) => new Date(`${isoDate}T00:00`)
  .toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" });
const humanDuration = (min) =>
  [Math.floor(min / 60) && `${Math.floor(min / 60)} ч`, min % 60 && `${min % 60} мин`].filter(Boolean).join(" ");

dateInput.value = iso(new Date());
dateInput.min = dateInput.value;

function fillTimes(slots) {
  timeSelect.innerHTML = slots.length
    ? slots.map((t) => `<option value="${t}">${t}</option>`).join("")
    : `<option value="">Нет свободного времени</option>`;
  timeSelect.disabled = !slots.length;
}

// Свободное время на выбранный день. Если день занят целиком — переходим на ближайший свободный (до 3 месяцев).
let slotsRequest = 0;
async function loadSlots() {
  if (!serviceSelect.value || !dateInput.value) return;
  const request = ++slotsRequest;
  timeSelect.disabled = true;
  timeSelect.innerHTML = "<option>Загружаем…</option>";
  try {
    const params = new URLSearchParams({ date: dateInput.value, service: serviceSelect.value, master: masterSelect.value });
    const res = await fetch(`/api/slots?${params}`);
    const data = await res.json();
    if (request !== slotsRequest) return; // пользователь уже поменял выбор
    if (!res.ok) throw new Error(data.error);

    dateInput.min = data.first;
    dateInput.max = data.last;
    const service = SERVICES.find((s) => s.id === serviceSelect.value);
    let slots = data.slots;
    let note = `Услуга длится около ${humanDuration(service.duration)}.`;
    if (!slots.length && data.next) {
      note = `На ${humanDate(data.date)} свободного времени нет — показываем ближайший свободный день: ${humanDate(data.next.date)}.`;
      dateInput.value = data.next.date;
      slots = data.next.slots;
    } else if (!slots.length) {
      note = "В ближайшие 3 месяца свободного времени нет — позвоните нам, что-нибудь придумаем.";
    }
    fillTimes(slots);
    slotNote.textContent = note;
  } catch (err) {
    if (request !== slotsRequest) return;
    fillTimes([]);
    slotNote.textContent = err.message || "Не удалось загрузить расписание. Попробуйте обновить страницу.";
  }
}

[serviceSelect, masterSelect, dateInput].forEach((el) => el.addEventListener("change", loadSlots));

// Консультация и окрашивание — цена договорная: менеджер перезвонит и всё уточнит
const needsCallback = (serviceId) => SERVICES.find((s) => s.id === serviceId)?.price === null;
const serviceHint = document.getElementById("serviceHint");
const updateServiceHint = () => { serviceHint.hidden = !needsCallback(serviceSelect.value); };
serviceSelect.addEventListener("change", updateServiceHint);

// Услуги загружаются один раз, затем рисуем прайс, список в форме и свободное время
fetch("/api/services")
  .then((res) => res.json())
  .then((data) => {
    SERVICES = data.services;
    CATEGORY_LABELS = data.categories;
    renderPrices(document.querySelector(".tab.is-active").dataset.tab);
    const consult = SERVICES.find((s) => !s.category);
    serviceSelect.innerHTML = `<option value="${consult.id}">${consult.name}</option>` +
      Object.entries(CATEGORY_LABELS).map(([key, label]) =>
        `<optgroup label="${label}">${SERVICES.filter((s) => s.category === key)
          .map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}</optgroup>`
      ).join("");
    updateServiceHint();
    loadSlots();
  })
  .catch(() => {
    grid.innerHTML = `<p class="section__lead">Не удалось загрузить прайс. Обновите страницу.</p>`;
  });

// ---------- отправка заявки ----------
const modal = document.getElementById("successModal");
const modalText = document.getElementById("modalText");
const modalCallback = document.getElementById("modalCallback");

// ---------- проверка полей (те же правила — в server.py) ----------
function normalizePhone(value) {
  const raw = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1);
  else if (digits.length !== 10 || raw.startsWith("+")) return null; // «+» — только с кодом страны
  if (!/^[3-9]/.test(digits)) return null;
  return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

// Случайный набор букв: нет гласных или 6+ согласных подряд (в «Мкртчян» — 5)
function looksLikeGibberish(text) {
  const letters = (text.toLowerCase().match(/\p{L}/gu) || []);
  const isVowel = (c) => "аеёиоуыэюяaeiouy".includes(c);
  if (!letters.some(isVowel)) return true;
  let run = 0;
  for (const c of letters) {
    run = isVowel(c) || "ьъй".includes(c) ? 0 : run + 1;
    if (run >= 6) return true;
  }
  return false;
}

const VALIDATORS = {
  name(value) {
    const name = value.trim().replace(/\s+/g, " ");
    if (!name) return "Укажите имя";
    if (!/^\p{L}[\p{L} .'’-]*$/u.test(name)) return "Имя может содержать только буквы, пробел и дефис";
    if ((name.match(/\p{L}/gu) || []).length < 2) return "Имя слишком короткое";
    if (/[.'’-]{2,}/.test(name) || /([\p{L}\d])\1{3,}/iu.test(name) || looksLikeGibberish(name)) {
      return "Проверьте имя — похоже на опечатку";
    }
    return "";
  },
  phone(value) {
    if (!value.trim()) return "Укажите телефон";
    return normalizePhone(value) ? "" : "Номер в формате +7…, 8… или 10 цифр, например 913 160-75-92";
  },
  comment(value) {
    const text = value.trim();
    if (!text) return "";
    const letters = (text.match(/\p{L}/gu) || []).length;
    const visible = text.replace(/\s/g, "").length;
    if (letters < 3 || letters < visible * 0.5 || /(.)\1{4,}/u.test(text)) {
      return "Опишите пожелание словами или оставьте поле пустым";
    }
    return "";
  },
};

function showFieldError(fieldName, message) {
  const field = form.elements[fieldName].closest(".field");
  field.classList.toggle("is-error", Boolean(message));
  field.querySelector(".field__error").textContent = message;
}

function validateField(fieldName) {
  const message = VALIDATORS[fieldName](form.elements[fieldName].value);
  showFieldError(fieldName, message);
  return !message;
}

Object.keys(VALIDATORS).forEach((fieldName) => {
  const input = form.elements[fieldName];
  // проверяем, когда человек закончил ввод, а пока исправляет — убираем ошибку
  input.addEventListener("blur", () => {
    if (!input.value.trim() && fieldName !== "comment") return; // не ругаемся на нетронутое поле
    if (validateField(fieldName) && fieldName === "phone") input.value = normalizePhone(input.value);
  });
  input.addEventListener("input", () => showFieldError(fieldName, ""));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const invalid = Object.keys(VALIDATORS).filter((fieldName) => !validateField(fieldName));
  if (invalid.length) {
    form.elements[invalid[0]].focus();
    return;
  }
  form.elements.name.value = form.elements.name.value.trim().replace(/\s+/g, " ");
  form.elements.phone.value = normalizePhone(form.elements.phone.value);
  if (!timeSelect.value || timeSelect.disabled) {
    showToast("Выберите свободное время");
    return;
  }

  const submitBtn = form.querySelector("[type=submit]");
  submitBtn.disabled = true;
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const booking = await res.json();
    if (!res.ok) {
      if (booking.field) {
        showFieldError(booking.field, booking.error);
        form.elements[booking.field].focus();
        return;
      }
      showToast(booking.error || "Не удалось записаться");
      if (res.status === 409) loadSlots(); // время успели занять — обновляем список
      return;
    }

    modalText.textContent = `${form.elements.name.value.trim()}, ждём вас ${humanDate(booking.date)} ` +
      `в ${booking.start} (до ${booking.end}). Мастер — ${booking.master}, услуга — ${booking.service}.`;
    modalCallback.hidden = !needsCallback(serviceSelect.value);
    modal.hidden = false;
    rememberBooking(form.elements.name.value.trim(), form.elements.phone.value.trim(), booking.token);

    const keepDate = dateInput.value;
    form.reset();
    dateInput.value = keepDate;
    prefillForm();
    updateServiceHint();
    loadSlots(); // занятое время пропадает из списка
  } catch {
    showToast("Нет связи с сервером, попробуйте ещё раз");
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- окна ----------
const closeModals = () => document.querySelectorAll(".modal").forEach((m) => { m.hidden = true; });
document.getElementById("modalClose").addEventListener("click", closeModals);
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) closeModals();
  });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });

// ---------- профиль клиента и «Моя запись» ----------
// Профиль хранится только в браузере клиента: имя, телефон и личные ссылки на его записи.
// Так свои записи видит только он сам — по имени или телефону чужие записи не открыть.
const PROFILE_KEY = "stil-profile";
const myBtn = document.getElementById("myBookingBtn");
const myModal = document.getElementById("myBookingsModal");
const myList = document.getElementById("myList");

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; }
}
function saveProfile(p) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch { /* приватный режим — профиль не сохранится */ }
}

let profile = loadProfile();
let myBookings = [];

function prefillForm() {
  if (!profile) return;
  if (!form.elements.name.value) form.elements.name.value = profile.name;
  if (!form.elements.phone.value) form.elements.phone.value = profile.phone;
}

function rememberBooking(name, phone, token) {
  profile = { name, phone, tokens: [...(profile?.tokens || []), token] };
  saveProfile(profile);
  refreshMyBookings();
}

// Подтягиваем свежий статус каждой записи; отменённые и прошедшие забываем
async function refreshMyBookings() {
  const tokens = profile?.tokens || [];
  const results = await Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(`/api/booking?token=${encodeURIComponent(token)}`);
      if (res.status === 404) return { token, gone: true };
      if (!res.ok) return { token, offline: true };
      return { token, ...(await res.json()) };
    } catch {
      return { token, offline: true }; // нет связи — ссылку не теряем
    }
  }));
  const live = results.filter((b) => b.offline || (!b.gone && b.status === "active" && !b.finished));
  if (profile) {
    profile.tokens = live.map((b) => b.token);
    saveProfile(profile);
  }
  myBookings = live.filter((b) => !b.offline)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  renderMyBookings();
}

function renderMyBookings() {
  const next = myBookings[0];
  myBtn.hidden = !next;
  document.body.classList.toggle("has-my-booking", Boolean(next));
  if (next) {
    document.getElementById("myBookingWhen").textContent = `${humanDate(next.date)}, ${next.start}`;
    const count = document.getElementById("myBookingCount");
    count.hidden = myBookings.length < 2;
    count.textContent = myBookings.length;
  }

  document.getElementById("myHello").textContent = profile
    ? `${profile.name}, кнопка «Моя запись» будет на сайте, пока запись не пройдёт.`
    : "";
  myList.replaceChildren(...(myBookings.length ? myBookings.map((b) => {
    const item = document.createElement("div");
    item.className = "my-item";
    item.innerHTML = `
      <div class="my-item__when"></div>
      <div class="my-item__what"></div>
      <div class="my-item__actions">
        <button type="button" class="btn btn--ghost" data-cancel-token>Отменить</button>
        <button type="button" class="btn btn--light" data-close>Оставить</button>
      </div>`;
    item.querySelector(".my-item__when").textContent = `${humanDate(b.date)}, ${b.start}–${b.end}`;
    item.querySelector(".my-item__what").textContent = `${b.service} · мастер ${b.master}`;
    item.querySelector("[data-cancel-token]").dataset.cancelToken = b.token;
    return item;
  }) : [Object.assign(document.createElement("p"), { className: "my-empty", textContent: "Активных записей нет." })]));
}

myBtn.addEventListener("click", () => { myModal.hidden = false; });

myList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-cancel-token]");
  if (!btn || !confirm("Точно отменить запись?")) return;
  btn.disabled = true;
  try {
    const res = await fetch("/api/bookings/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: btn.dataset.cancelToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast("Запись отменена");
    await refreshMyBookings();
    loadSlots(); // освободившееся время снова видно в форме
    if (!myBookings.length) closeModals();
  } catch (err) {
    btn.disabled = false;
    showToast(err.message || "Не удалось отменить запись");
  }
});

document.getElementById("forgetMe").addEventListener("click", () => {
  if (!confirm("Забыть ваше имя, телефон и записи на этом устройстве? Сами записи останутся в силе.")) return;
  profile = null;
  saveProfile(null);
  myBookings = [];
  form.elements.name.value = "";
  form.elements.phone.value = "";
  renderMyBookings();
  closeModals();
});

prefillForm();
refreshMyBookings();
// запись прошла — кнопка исчезает сама; проверяем раз в минуту и при возвращении на вкладку
setInterval(() => { if (!document.hidden && profile) refreshMyBookings(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && profile) refreshMyBookings(); });
