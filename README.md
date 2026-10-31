# Парикмахерская «Стиль» — сайт с онлайн-записью

Сайт парикмахерской в Норильске (ул. Советская, 1): услуги и цены, мастера, отзывы,
онлайн-запись с выбором свободного времени, отмена записи клиентом,
таблица менеджера и уведомления в Telegram.

Сервер — один файл `server.py` на чистом Python 3.10+, без сторонних библиотек.
Записи хранятся в SQLite (`data/bookings.db`).

## Что где

| Файл | Что это |
|---|---|
| `index.html`, `styles.css`, `script.js` | сайт для клиентов |
| `admin.html`, `admin.css`, `admin.js` | таблица менеджера (`/admin`, вход по паролю) |
| `cancel.html` | страница отмены записи по личной ссылке |
| `services.json` | услуги, цены и длительность — правьте здесь |
| `server.py` | сервер: API записи, расписание, Telegram |
| `config.example.json` | пример настроек |

График (10:00–20:00, шаг 30 минут, запись на 90 дней вперёд, мастера) — в начале `server.py`.

## Запуск на своём компьютере

```bash
cp config.example.json config.json   # впишите пароль менеджера и данные бота
python server.py
```

Сайт: http://localhost:5500, таблица менеджера: http://localhost:5500/admin

## Настройки

Задаются в `config.json` **или** переменными окружения (на хостинге удобнее переменные — они важнее файла):

| Переменная | Что это |
|---|---|
| `ADMIN_PASSWORD` | пароль входа в `/admin` (логин — любой) |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | куда слать уведомления (узнать: `python server.py telegram-chats`) |
| `PORT` | порт (хостинги обычно задают сами) |
| `DATA_DIR` | папка для базы записей — на хостинге укажите постоянный диск |

Проверить бота: `python server.py telegram-test`

> `config.json` и папка `data/` не попадают в репозиторий (`.gitignore`): там пароль, токен бота и телефоны клиентов.

## Выкладка в интернет

GitHub Pages **не подойдёт**: он отдаёт только статичные страницы, а записи обрабатывает Python-сервер.
Нужен хостинг, где работает Python и есть **постоянный диск** (иначе база записей сотрётся при перезапуске).

### Вариант 1 — свой VPS (Timeweb Cloud, Selectel, REG.RU и т.п.), от ~200 ₽/мес

```bash
git clone https://github.com/clashbayt5-collab/website-stell.git /opt/stil
cd /opt/stil
cp config.example.json config.json && nano config.json   # пароль и бот
python3 server.py
```

Чтобы сервер работал постоянно и перезапускался сам — systemd-служба `/etc/systemd/system/stil.service`:

```ini
[Unit]
Description=Stil website
After=network.target

[Service]
WorkingDirectory=/opt/stil
ExecStart=/usr/bin/python3 server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now stil
```

Затем подключите домен и HTTPS через Caddy (сертификат выпускается сам), `/etc/caddy/Caddyfile`:

```
stil-norilsk.ru {
    reverse_proxy localhost:5500
}
```

### Вариант 2 — Render.com / Railway

- Start command: `python server.py`
- Переменные окружения: `ADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Подключите постоянный диск (Persistent Disk / Volume) и укажите его путь в `DATA_DIR`

**HTTPS обязателен:** пароль менеджера передаётся при входе в `/admin`, без HTTPS его можно перехватить.
