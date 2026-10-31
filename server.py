"""Сервер сайта парикмахерской «Стиль».

Отдаёт сайт и обрабатывает записи:
  GET  /api/services                 — услуги с ценами и длительностью
  GET  /api/slots?date=&service=&master=
                                     — свободное время на день (или ближайший свободный день)
  POST /api/bookings                 — записаться
  GET  /api/booking?token=           — запись по личной ссылке клиента
  POST /api/bookings/cancel          — клиент отменяет запись
  /admin                             — таблица менеджера (вход по паролю из config.json)

Записи хранятся в data/bookings.db, о новых записях и отменах приходит сообщение в Telegram.
Только стандартная библиотека Python.

Запуск:              py server.py
Проверить Telegram:  py server.py telegram-test
Узнать chat_id:      py server.py telegram-chats
"""

import base64
import contextlib
import hmac
import html
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
# на хостинге папку базы можно вынести на постоянный диск: DATA_DIR=/var/data
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "bookings.db")
CONFIG_PATH = os.path.join(ROOT, "config.json")
SERVICES_PATH = os.path.join(ROOT, "services.json")

# ---------- расписание ----------
TZ = timezone(timedelta(hours=7))  # Норильск, UTC+7, без перехода на летнее время
OPEN_MIN = 10 * 60                 # 10:00
CLOSE_MIN = 20 * 60                # 20:00 — к этому времени услуга должна закончиться
STEP_MIN = 30                      # шаг сетки записи
LEAD_MIN = 30                      # на сегодня — не раньше чем через 30 минут
DAYS_AHEAD = 90                    # запись на 3 месяца вперёд
MASTERS = {"marina": "Марина Соколова", "olga": "Ольга Белова"}

PUBLIC_EXT = {".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico"}
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря"]
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
# не чаще одной записи в 20 секунд с одного адреса
BOOKING_COOLDOWN_SEC = int(os.environ.get("BOOKING_COOLDOWN", 20))
MAX_ACTIVE_PER_PHONE = 3


# ---------- настройки ----------
def load_config():
    """config.json, а на хостинге — переменные окружения (они важнее файла)."""
    config = read_config_file()
    tg = config.setdefault("telegram", {})
    config["admin_password"] = os.environ.get("ADMIN_PASSWORD") or config.get("admin_password")
    tg["bot_token"] = os.environ.get("TELEGRAM_BOT_TOKEN") or tg.get("bot_token", "")
    tg["chat_id"] = os.environ.get("TELEGRAM_CHAT_ID") or tg.get("chat_id", "")
    if not config["admin_password"]:
        sys.exit("Задайте пароль менеджера: переменная ADMIN_PASSWORD или admin_password в config.json")
    return config


def read_config_file():
    if os.environ.get("ADMIN_PASSWORD") and not os.path.exists(CONFIG_PATH):
        return {}  # на хостинге всё задано переменными — файл не нужен
    if not os.path.exists(CONFIG_PATH):
        config = {
            "admin_password": secrets.token_urlsafe(9),
            "telegram": {"bot_token": "", "chat_id": ""},
            "port": 5500,
        }
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"Создан {CONFIG_PATH} — там пароль менеджера и настройки Telegram")
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


CONFIG = load_config()
with open(SERVICES_PATH, encoding="utf-8") as f:
    SERVICES_JSON = f.read()
SERVICES = {s["id"]: s for s in json.loads(SERVICES_JSON)["services"]}


# ---------- база ----------
db_lock = threading.Lock()


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                token        TEXT NOT NULL UNIQUE,
                name         TEXT NOT NULL,
                phone        TEXT NOT NULL,
                service      TEXT NOT NULL,
                master       TEXT NOT NULL,
                date         TEXT NOT NULL,
                start_min    INTEGER NOT NULL,
                duration     INTEGER NOT NULL,
                comment      TEXT NOT NULL DEFAULT '',
                status       TEXT NOT NULL DEFAULT 'active',
                created_at   TEXT NOT NULL,
                cancelled_at TEXT,
                cancelled_by TEXT
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS bookings_day ON bookings (date, master, status)")


# ---------- время ----------
def now_local():
    return datetime.now(TZ)


def today():
    return now_local().date()


def hhmm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_hhmm(value):
    try:
        h, m = str(value).split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def parse_day(value):
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def human_day(day):
    return f"{day.day} {MONTHS[day.month - 1]} ({WEEKDAYS[day.weekday()]})"


# ---------- свободное время ----------
def free_starts(conn, day, master, duration):
    """Время начала, на которое мастер свободен на всю длительность услуги."""
    first = today()
    if day < first or day > first + timedelta(days=DAYS_AHEAD):
        return []
    busy = [(r["start_min"], r["start_min"] + r["duration"]) for r in conn.execute(
        "SELECT start_min, duration FROM bookings WHERE date = ? AND master = ? AND status = 'active'",
        (day.isoformat(), master))]

    earliest = OPEN_MIN
    if day == first:
        now = now_local()
        soon = now.hour * 60 + now.minute + LEAD_MIN
        earliest = max(OPEN_MIN, -(-soon // STEP_MIN) * STEP_MIN)  # округление вверх до шага

    starts = []
    for t in range(earliest, CLOSE_MIN - duration + 1, STEP_MIN):
        if all(t + duration <= s or t >= e for s, e in busy):
            starts.append(t)
    return starts


def available(conn, day, master, duration):
    if master != "any":
        return free_starts(conn, day, master, duration)
    merged = set()
    for m in MASTERS:
        merged.update(free_starts(conn, day, m, duration))
    return sorted(merged)


def pick_master(conn, day, start, duration, choice):
    """Мастер, свободный в это время; при «любом» — тот, у кого в этот день меньше записей."""
    candidates = MASTERS if choice == "any" else [choice]
    free = [m for m in candidates if start in free_starts(conn, day, m, duration)]
    if not free:
        return None

    def load(m):
        row = conn.execute(
            "SELECT COALESCE(SUM(duration), 0) FROM bookings WHERE date = ? AND master = ? AND status = 'active'",
            (day.isoformat(), m)).fetchone()
        return row[0]
    return min(free, key=load)


# ---------- Telegram ----------
def telegram_request(method, payload=None):
    token = CONFIG.get("telegram", {}).get("bot_token")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def notify(text):
    """Уведомление менеджеру. Никогда не бросает исключений: запись уже сохранена."""
    tg = CONFIG.get("telegram", {})
    if not tg.get("bot_token") or not tg.get("chat_id"):
        with contextlib.suppress(Exception):
            print("[Telegram не настроен]\n" + text)
        return

    def send():
        try:
            telegram_request("sendMessage", {
                "chat_id": tg["chat_id"], "text": text,
                "parse_mode": "HTML", "disable_web_page_preview": True})
        except Exception as e:  # уведомление не должно ломать запись
            with contextlib.suppress(Exception):
                print("Не удалось отправить в Telegram:", e)
    threading.Thread(target=send, daemon=True).start()


def booking_message(b, title):
    e = html.escape
    day = date.fromisoformat(b["date"])
    lines = [
        f"<b>{title}</b>  №{b['id']}",
        f"📅 {human_day(day)}, {hhmm(b['start_min'])}–{hhmm(b['start_min'] + b['duration'])}",
        f"💇 {MASTERS[b['master']]}",
        f"✂️ {e(SERVICES[b['service']]['name'])} ({b['duration']} мин)",
        f"👤 {e(b['name'])}",
        f"📞 {e(b['phone'])}",
    ]
    if b["comment"]:
        lines.append(f"💬 {e(b['comment'])}")
    if needs_call(b) and b["status"] == "active":
        lines.append("❗ <b>Перезвонить: уточнить детали и цену</b>")
    return "\n".join(lines)


def needs_call(b):
    """Консультация и окрашивание — цена договорная, менеджер перезванивает клиенту."""
    return SERVICES[b["service"]]["price"] is None


def booking_end(b):
    start = datetime.combine(date.fromisoformat(b["date"]), datetime.min.time(), TZ)
    return start + timedelta(minutes=b["start_min"] + b["duration"])


def public_booking(b):
    return {
        "finished": booking_end(b) <= now_local(),
        "id": b["id"],
        "service": SERVICES[b["service"]]["name"],
        "master": MASTERS[b["master"]],
        "date": b["date"],
        "start": hhmm(b["start_min"]),
        "end": hhmm(b["start_min"] + b["duration"]),
        "duration": b["duration"],
        "status": b["status"],
    }


# ---------- HTTP ----------
last_booking_at = {}


def one_line(value, limit):
    return " ".join(str(value or "").split())[:limit]


# ---------- проверка данных клиента (те же правила — в script.js) ----------
NAME_PUNCT = " .'’-"


def check_name(value):
    """Возвращает (имя, ошибка). Имя — буквы, пробел, дефис, апостроф, точка; без мусора."""
    name = one_line(value, 60)
    if not name:
        return name, "Укажите имя"
    if not name[0].isalpha() or any(not (c.isalpha() or c in NAME_PUNCT) for c in name):
        return name, "Имя может содержать только буквы, пробел и дефис"
    if sum(c.isalpha() for c in name) < 2:
        return name, "Имя слишком короткое"
    if (re.search(r"[.'’-]{2,}", name) or re.search(r"(\w)\1{3,}", name, re.IGNORECASE)
            or looks_like_gibberish(name)):
        return name, "Проверьте имя — похоже на опечатку"
    return name, None


VOWELS = set("аеёиоуыэюяaeiouy")
NEUTRAL = set("ьъй")


def looks_like_gibberish(text):
    """Случайный набор букв: нет гласных или 6+ согласных подряд (в «Мкртчян» — 5)."""
    letters = [c.lower() for c in text if c.isalpha()]
    if not any(c in VOWELS for c in letters):
        return True
    run = 0
    for c in letters:
        run = 0 if c in VOWELS or c in NEUTRAL else run + 1
        if run >= 6:
            return True
    return False


def normalize_phone(value):
    """+7…, 8… или 10 цифр без кода -> «+7 (913) 160-75-92»; иначе None."""
    raw = str(value or "").strip()
    if not re.fullmatch(r"\+?[\d\s()\-]+", raw):
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] in "78":
        digits = digits[1:]
    elif len(digits) != 10 or raw.startswith("+"):  # «+» — только с кодом страны, 11 цифр
        return None
    if digits[0] not in "3456789":
        return None
    return f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:]}"


def check_comment(value):
    """Комментарий необязателен, но если есть — это должны быть слова, а не набор символов."""
    text = str(value or "").strip()[:500]
    if not text:
        return text, None
    letters = sum(c.isalpha() for c in text)
    visible = sum(not c.isspace() for c in text)
    if letters < 3 or letters < visible * 0.5 or re.search(r"(.)\1{4,}", text):
        return text, "Опишите пожелание словами или оставьте поле пустым"
    return text, None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- ответы ---
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, message, field=None):
        self.send_json(status, {"error": message, "field": field} if field else {"error": message})

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 10_000:
            return None
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def end_headers(self):
        # чтобы после обновления сайта браузер не показывал старую версию
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # --- доступ ---
    def is_manager(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            _, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
        except ValueError:
            return False
        return hmac.compare_digest(password.encode(), CONFIG["admin_password"].encode())

    def ask_login(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Stil", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def client_ip(self):
        # за прокси хостинга (TRUST_PROXY=1) все запросы приходят с его адреса — настоящий в X-Forwarded-For
        forwarded = self.headers.get("X-Forwarded-For")
        if os.environ.get("TRUST_PROXY") and forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def is_public(self, path):
        if path == "/":
            return True
        ext = os.path.splitext(path)[1].lower()
        return (ext in PUBLIC_EXT and "/." not in path
                and not path.startswith(("/data/", "/admin")))

    # --- маршруты ---
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path, query = url.path, dict(urllib.parse.parse_qsl(url.query))

        if path == "/api/services":
            body = SERVICES_JSON.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if path == "/api/slots":
            return self.api_slots(query)
        if path == "/api/booking":
            return self.api_booking(query)
        if path == "/cancel":
            self.path = "/cancel.html"
            return super().do_GET()

        if path.startswith(("/admin", "/api/admin")):
            if not self.is_manager():
                return self.ask_login()
            if path == "/api/admin/bookings":
                return self.api_admin_bookings(query)
            if path in ("/admin", "/admin/"):
                self.path = "/admin.html"
            elif path not in ("/admin.html", "/admin.js", "/admin.css"):
                return self.send_error(404)
            return super().do_GET()

        if not self.is_public(path):
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        path = urllib.parse.urlsplit(self.path).path
        if not self.is_public(path):
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        data = self.read_json()
        if data is None:
            return self.error(400, "Некорректные данные")
        if path == "/api/bookings":
            return self.api_create(data)
        if path == "/api/bookings/cancel":
            return self.api_cancel(data)
        if path == "/api/admin/cancel":
            if not self.is_manager():
                return self.ask_login()
            return self.api_admin_cancel(data)
        self.send_error(404)

    # --- API: клиент ---
    def api_slots(self, q):
        day = parse_day(q.get("date"))
        service = SERVICES.get(q.get("service"))
        master = q.get("master", "any")
        if not day or not service or (master != "any" and master not in MASTERS):
            return self.error(400, "Некорректные данные")

        last = today() + timedelta(days=DAYS_AHEAD)
        with connect() as conn:
            slots = available(conn, day, master, service["duration"])
            result = {"date": day.isoformat(), "slots": [hhmm(t) for t in slots],
                      "next": None, "first": today().isoformat(), "last": last.isoformat()}
            if not slots:
                d = day + timedelta(days=1) if day >= today() else today()
                while d <= last:
                    found = available(conn, d, master, service["duration"])
                    if found:
                        result["next"] = {"date": d.isoformat(), "slots": [hhmm(t) for t in found]}
                        break
                    d += timedelta(days=1)
        self.send_json(200, result)

    def api_booking(self, q):
        with connect() as conn:
            b = conn.execute("SELECT * FROM bookings WHERE token = ?", (q.get("token", ""),)).fetchone()
        if not b:
            return self.error(404, "Запись не найдена")
        self.send_json(200, public_booking(b))

    def api_create(self, data):
        if data.get("website"):  # ловушка для спам-ботов
            return self.send_json(201, {})

        name, name_error = check_name(data.get("name"))
        phone = normalize_phone(data.get("phone"))
        comment, comment_error = check_comment(data.get("comment"))
        service_id = data.get("service")
        master = data.get("master", "any")
        day = parse_day(data.get("date"))
        start = parse_hhmm(data.get("time"))

        if name_error:
            return self.error(400, name_error, "name")
        if not phone:
            return self.error(400, "Номер в формате +7…, 8… или 10 цифр, например 913 160-75-92", "phone")
        if comment_error:
            return self.error(400, comment_error, "comment")
        if service_id not in SERVICES or (master != "any" and master not in MASTERS) or not day or start is None:
            return self.error(400, "Некорректные данные")

        ip = self.client_ip()
        now = time.time()
        if now - last_booking_at.get(ip, 0) < BOOKING_COOLDOWN_SEC:
            return self.error(429, "Подождите немного перед следующей записью")

        duration = SERVICES[service_id]["duration"]
        digits = "".join(c for c in phone if c.isdigit())[-10:]
        with db_lock, connect() as conn:
            active = conn.execute(
                "SELECT phone FROM bookings WHERE status = 'active' AND date >= ?", (today().isoformat(),)).fetchall()
            if sum(1 for r in active if "".join(c for c in r["phone"] if c.isdigit())[-10:] == digits) >= MAX_ACTIVE_PER_PHONE:
                return self.error(429, "На этот номер уже есть несколько записей. Позвоните нам, если нужно ещё")

            chosen = pick_master(conn, day, start, duration, master)
            if not chosen:
                return self.error(409, "Это время уже заняли — выберите другое")

            token = secrets.token_urlsafe(16)
            cur = conn.execute(
                """INSERT INTO bookings (token, name, phone, service, master, date, start_min, duration, comment, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (token, name, phone, service_id, chosen, day.isoformat(), start, duration, comment,
                 now_local().isoformat(timespec="seconds")))
            b = conn.execute("SELECT * FROM bookings WHERE id = ?", (cur.lastrowid,)).fetchone()
        last_booking_at[ip] = now

        notify(booking_message(b, "🟢 Новая запись"))
        self.send_json(201, {**public_booking(b), "token": token})

    def api_cancel(self, data):
        with db_lock, connect() as conn:
            b = conn.execute("SELECT * FROM bookings WHERE token = ?", (str(data.get("token", "")),)).fetchone()
            if not b:
                return self.error(404, "Запись не найдена")
            if b["status"] == "cancelled":
                return self.send_json(200, public_booking(b))
            start = datetime.combine(date.fromisoformat(b["date"]), datetime.min.time(), TZ) + timedelta(minutes=b["start_min"])
            if start <= now_local():
                return self.error(400, "Время записи уже прошло")
            b = self.mark_cancelled(conn, b["id"], "client")
        notify(booking_message(b, "🔴 Клиент отменил запись"))
        self.send_json(200, public_booking(b))

    # --- API: менеджер ---
    def api_admin_bookings(self, q):
        first = parse_day(q.get("from")) or today()
        last = parse_day(q.get("to")) or today() + timedelta(days=DAYS_AHEAD)
        with connect() as conn:
            rows = conn.execute(
                "SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, start_min",
                (first.isoformat(), last.isoformat())).fetchall()
        self.send_json(200, {
            "masters": MASTERS,
            "open": hhmm(OPEN_MIN), "close": hhmm(CLOSE_MIN),
            "bookings": [{
                **public_booking(b),
                "masterId": b["master"],
                "needsCall": needs_call(b),
                "name": b["name"], "phone": b["phone"], "comment": b["comment"],
                "createdAt": b["created_at"], "cancelledBy": b["cancelled_by"],
            } for b in rows],
        })

    def api_admin_cancel(self, data):
        with db_lock, connect() as conn:
            b = conn.execute("SELECT * FROM bookings WHERE id = ?", (data.get("id"),)).fetchone()
            if not b:
                return self.error(404, "Запись не найдена")
            if b["status"] == "cancelled":
                return self.send_json(200, public_booking(b))
            b = self.mark_cancelled(conn, b["id"], "manager")
        notify(booking_message(b, "🔴 Менеджер отменил запись"))
        self.send_json(200, public_booking(b))

    @staticmethod
    def mark_cancelled(conn, booking_id, by):
        conn.execute(
            "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE id = ?",
            (now_local().isoformat(timespec="seconds"), by, booking_id))
        return conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()


# ---------- команды ----------
def telegram_cli(command):
    tg = CONFIG.get("telegram", {})
    if not tg.get("bot_token"):
        sys.exit("Впишите bot_token в config.json (его выдаёт @BotFather)")
    if command == "telegram-chats":
        chats = {}
        for update in telegram_request("getUpdates").get("result", []):
            msg = update.get("message") or update.get("my_chat_member") or {}
            chat = msg.get("chat")
            if chat:
                chats[chat["id"]] = chat.get("title") or chat.get("first_name") or chat.get("username")
        if not chats:
            print("Чатов не найдено. Напишите боту любое сообщение (или добавьте его в группу) и повторите.")
        for chat_id, title in chats.items():
            print(f"chat_id: {chat_id}   ({title})")
    else:
        if not tg.get("chat_id"):
            sys.exit("Впишите chat_id в config.json (узнать: py server.py telegram-chats)")
        telegram_request("sendMessage", {"chat_id": tg["chat_id"], "text": "✅ Бот парикмахерской «Стиль» подключён"})
        print("Сообщение отправлено")


class DualStackServer(ThreadingHTTPServer):
    """Слушает и IPv4, и IPv6: иначе браузер на Windows ждёт ~2 с, пробуя ::1 для localhost."""
    address_family = socket.AF_INET6

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    # уведомления сразу видны в консоли; эмодзи, которых нет в кодировке консоли Windows, — заменяются
    sys.stdout.reconfigure(line_buffering=True, errors="replace")
    if len(sys.argv) > 1:
        telegram_cli(sys.argv[1])
        sys.exit()
    init_db()
    port = int(os.environ.get("PORT") or CONFIG.get("port", 5500))
    try:
        httpd = DualStackServer(("::", port), Handler)
    except OSError:  # на сервере без IPv6
        httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Сайт «Стиль»:       http://localhost:{port}")
    print(f"Таблица менеджера:  http://localhost:{port}/admin")
    httpd.serve_forever()
