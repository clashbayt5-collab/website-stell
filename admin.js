// Таблица менеджера: расписание мастеров на день и список всех записей.
// Данные — с /api/admin/bookings (доступ по паролю из config.json), обновляются раз в 30 секунд.

const REFRESH_MS = 30000;
const AHEAD_DAYS = 90;

let bookings = [];
let masters = {};
let openMin = 600;
let closeMin = 1200;

const $ = (id) => document.getElementById(id);
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const humanDate = (isoDate, opts = { day: "numeric", month: "short", weekday: "short" }) =>
  new Date(`${isoDate}T00:00`).toLocaleDateString("ru-RU", opts);
const hours = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(" ") || "0 ч";
};
const today = () => iso(new Date());

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => c != null && node.append(c));
  return node;
}

const toast = $("toast");
let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

// ---------- загрузка ----------
async function load() {
  // прошедшие дни менеджеру не нужны — только сегодня и вперёд
  const params = new URLSearchParams({ from: today(), to: addDays(today(), AHEAD_DAYS) });
  try {
    const res = await fetch(`/api/admin/bookings?${params}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    bookings = data.bookings;
    masters = data.masters;
    openMin = toMin(data.open);
    closeMin = toMin(data.close);
    fillMasterFilter();
    render();
    $("updated").textContent = `обновлено в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    $("updated").textContent = "нет связи с сервером";
  }
}

function fillMasterFilter() {
  const select = $("masterFilter");
  if (select.options.length > 1) return;
  Object.entries(masters).forEach(([id, name]) => select.append(el("option", { value: id }, name)));
}

function render() {
  renderTimeline();
  renderTable();
}

// ---------- расписание на день ----------
function renderTimeline() {
  const day = $("dayInput").value;
  const span = closeMin - openMin;
  const active = bookings.filter((b) => b.date === day && b.status === "active");

  const scale = el("div", { class: "timeline__scale" });
  for (let t = openMin; t <= closeMin; t += 60) {
    scale.append(el("span", { style: `left:${((t - openMin) / span) * 100}%` }, `${t / 60}:00`));
  }
  const inner = el("div", { class: "timeline__inner" },
    el("div", { class: "timeline__hours" }, el("div"), scale));

  Object.entries(masters).forEach(([id, name]) => {
    const own = active.filter((b) => b.masterId === id);
    const busy = own.reduce((sum, b) => sum + b.duration, 0);
    const track = el("div", { class: "timeline__track", style: `--hours:${span / 60}` });
    own.forEach((b) => {
      const left = ((toMin(b.start) - openMin) / span) * 100;
      const width = (b.duration / span) * 100;
      track.append(el("div", {
        class: "slot", style: `left:${left}%;width:${width}%`,
        title: `${b.start}–${b.end} · ${b.name} · ${b.phone}\n${b.service}${b.needsCall ? "\n📞 перезвонить" : ""}`,
      }, el("b", {}, `${b.needsCall ? "📞 " : ""}${b.name}`), el("span", {}, `${b.start}–${b.end} · ${b.service}`)));
    });
    inner.append(el("div", { class: "timeline__row" },
      el("div", { class: "timeline__name" }, name, el("small", {}, `занято ${hours(busy)}`)),
      track));
  });

  $("timeline").replaceChildren(inner);
  const total = active.reduce((sum, b) => sum + b.duration, 0);
  $("daySummary").textContent = `${humanDate(day, { day: "numeric", month: "long", weekday: "long" })}: ` +
    `${active.length} ${plural(active.length, "запись", "записи", "записей")}, занято ${hours(total)}`;
}

function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

// ---------- таблица ----------
function inPeriod(b) {
  const t = today();
  switch ($("periodFilter").value) {
    case "today": return b.date === t;
    case "tomorrow": return b.date === addDays(t, 1);
    case "week": return b.date >= t && b.date <= addDays(t, 6);
    default: return b.date >= t;
  }
}

function renderTable() {
  const master = $("masterFilter").value;
  const query = $("search").value.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, "");
  const showCancelled = $("showCancelled").checked;

  const list = bookings.filter((b) =>
    inPeriod(b)
    && (!master || b.masterId === master)
    && (showCancelled || b.status === "active")
    && (!query || b.name.toLowerCase().includes(query)
      || (queryDigits && b.phone.replace(/\D/g, "").includes(queryDigits))));
  const rows = list.map((b) => {
    const cancelled = b.status === "cancelled";
    const who = b.cancelledBy === "manager" ? "менеджером" : "клиентом";
    return el("tr", { class: cancelled ? "is-cancelled" : "" },
      el("td", {}, String(b.id)),
      el("td", { class: "nowrap" }, humanDate(b.date)),
      el("td", { class: "nowrap" }, `${b.start}–${b.end}`, el("div", { class: "muted" }, hours(b.duration))),
      el("td", { class: "nowrap" }, b.master),
      el("td", {}, b.name),
      el("td", { class: "nowrap" }, el("a", { href: `tel:${b.phone.replace(/[^\d+]/g, "")}` }, b.phone)),
      el("td", {}, b.service,
        b.needsCall && !cancelled ? el("div", { class: "call-tag" }, "📞 перезвонить: детали и цена") : null),
      el("td", {}, b.comment || el("span", { class: "muted" }, "—")),
      el("td", { class: "status" }, el("span", { class: `badge${cancelled ? " badge--off" : ""}` },
        cancelled ? `отменена ${who}` : "активна")),
      el("td", {}, cancelled || b.date < today() ? "" :
        el("button", { class: "row-btn", "data-cancel": b.id }, "Отменить")));
  });

  $("rows").replaceChildren(...(rows.length ? rows :
    [el("tr", {}, el("td", { colspan: 10, class: "empty" }, "Записей нет"))]));
  const total = list.filter((b) => b.status === "active").reduce((sum, b) => sum + b.duration, 0);
  $("tableSummary").textContent = `Показано: ${list.length} · занято времени: ${hours(total)}`;
}

$("rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-cancel]");
  if (!btn) return;
  const b = bookings.find((x) => String(x.id) === btn.dataset.cancel);
  if (!confirm(`Отменить запись №${b.id}: ${b.name}, ${humanDate(b.date)} ${b.start}?`)) return;
  btn.disabled = true;
  try {
    const res = await fetch("/api/admin/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id }),
    });
    if (!res.ok) throw new Error();
    showToast("Запись отменена");
    load();
  } catch {
    btn.disabled = false;
    showToast("Не удалось отменить запись");
  }
});

// ---------- управление ----------
// В календаре — только сегодня и будущие дни
function setDay(isoDate) {
  const day = isoDate < today() ? today() : isoDate;
  $("dayInput").min = today();
  $("dayInput").max = addDays(today(), AHEAD_DAYS);
  $("dayInput").value = day;
  $("prevDay").disabled = day <= today();
  renderTimeline();
}
$("dayInput").addEventListener("change", () => setDay($("dayInput").value || today()));
$("prevDay").addEventListener("click", () => setDay(addDays($("dayInput").value, -1)));
$("nextDay").addEventListener("click", () => setDay(addDays($("dayInput").value, 1)));
$("todayBtn").addEventListener("click", () => setDay(today()));
$("dayInput").value = today();
$("dayInput").min = today();
$("prevDay").disabled = true;
["periodFilter", "masterFilter", "showCancelled"].forEach((id) => $(id).addEventListener("change", renderTable));
$("search").addEventListener("input", renderTable);

load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
