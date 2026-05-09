# Casino X — Бэкенд

## Структура проекта

```
casino-backend/
├── server.js          # Node.js сервер (Express + SQLite)
├── package.json       # Зависимости
├── .env.example       # Пример конфигурации
├── casino.db          # База данных (создаётся автоматически)
└── public/
    └── index.html     # Фронтенд (Casino X)
```

---

## 🚀 Как запустить

### 1. Установи Node.js
Скачай и установи Node.js (версия 18+): https://nodejs.org

### 2. Создай конфиг
```bash
cp .env.example .env
```
Отредактируй `.env`:
- `BOT_TOKEN` — токен бота от @BotFather
- `ADMIN_PASS` — пароль для admin panel
- `CASINO_WALLET` — TON-адрес кошелька казино

### 3. Установи зависимости
```bash
npm install
```

### 4. Запусти
```bash
# Обычный запуск
node server.js

# Или в режиме разработки (с авторестартом при изменениях)
node --watch server.js
```

### 5. Открой в браузере
```
http://localhost:3000
```

---

## 📡 API Endpoints

### Пользователь (требует Telegram initData в заголовке)
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/me` | Профиль и баланс |
| POST | `/api/balance/sync` | Синхронизировать баланс |
| POST | `/api/game/result` | Записать результат игры |
| GET | `/api/daily/check` | Доступен ли ежедневный бонус |
| POST | `/api/daily/claim` | Получить ежедневный бонус |
| GET | `/api/inventory` | Инвентарь NFT |
| POST | `/api/inventory/add` | Добавить NFT |
| DELETE | `/api/inventory/:uid` | Удалить NFT |
| POST | `/api/inventory/sell` | Продать NFT |
| POST | `/api/withdrawal/request` | Запрос на вывод NFT |
| POST | `/api/deposit/ton` | Создать депозит TON |
| GET | `/api/transactions` | История транзакций |

### Admin (заголовок: `x-admin-pass: ваш_пароль`)
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/admin/stats` | Общая статистика |
| GET | `/api/admin/users` | Список пользователей |
| POST | `/api/admin/balance` | Пополнить баланс пользователя |
| GET | `/api/admin/withdrawals` | Запросы на вывод |
| POST | `/api/admin/withdrawal/complete` | Подтвердить вывод |
| POST | `/api/deposit/confirm` | Подтвердить депозит TON |
| GET | `/api/admin/transactions` | Все транзакции |

---

## 💰 Как принимать депозиты TON

1. Пользователь нажимает **"+"** → выбирает сумму → открывается TON кошелёк
2. Пользователь отправляет TON на адрес казино с комментарием вида `dep_<tg_id>_<timestamp>`
3. Ты видишь транзакцию в своём TON кошельке
4. Подтверждаешь через API:

```bash
curl -X POST http://localhost:3000/api/deposit/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "admin_pass": "твой_пароль",
    "tg_id": "123456789",
    "amount_coins": 500,
    "comment": "dep_123456789_1234567890"
  }'
```

> 1 TON = 500 ◆ (можно изменить в server.js, строка с `amount_coins`)

---

## 🌐 Деплой на сервер (VPS)

### Вариант 1: Railway / Render (бесплатно)
1. Залей проект на GitHub
2. Подключи к Railway: https://railway.app
3. Добавь переменные окружения из `.env`
4. Готово — получишь HTTPS URL

### Вариант 2: VPS (Ubuntu)
```bash
# Установи Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Клонируй / загрузи проект
cd /var/www/casino-x
npm install

# Запуск через PM2 (фоновый процесс)
npm install -g pm2
pm2 start server.js --name casino-x
pm2 save
pm2 startup
```

### Настройка Nginx (HTTPS):
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 🤖 Настройка Telegram Mini App

1. Открой @BotFather → `/newbot` → получи токен
2. `/newapp` → выбери бота → укажи URL сервера (например `https://yourdomain.com`)
3. Вставь токен в `.env` → `BOT_TOKEN=...`
4. Измени `NODE_ENV=production` в `.env` для включения верификации

---

## 🔒 Безопасность

- В `production` режиме все запросы верифицируются через подпись Telegram
- Admin endpoints защищены паролем (заголовок `x-admin-pass`)
- Смени `ADMIN_PASS` с дефолтного `1234` на безопасный пароль!

## Обновление
Frontend обновлён до версии v3 (casino_x_v3.html) с полной backend-интеграцией.
