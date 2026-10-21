# Docker: полный запуск через maestro-setup-docker.sh

[Назад к оглавлению](../index.md)

> Пошаговая инструкция по запуску maestro в Docker с помощью `maestro-setup-docker.sh` — от чистой машины до работающего контейнера. Сценарии: новая машина, CI, обновление, диагностика.

---

## 🎯 Назначение

`docker/maestro-setup-docker.sh` — **единый скрипт** для полного запуска maestro в Docker. Он заменяет ручную комбинацию: клон → папки → `.env.docker` → `build` → `run`.

Скрипт покрывает три сценария:
1. **curl-one-liner** — запуск на чистой машине (автоматический клон maestro)
2. **из клона** — запуск, когда репо maestro уже склонировано
3. **non-interactive** — автоматизация в CI

---

## 📋 Предварительные требования

| Зависимость | Назначение | Где взять |
|---|---|---|
| **Docker** (daemon + CLI) | запуск контейнера | [docker.com](https://docker.com) |
| **git** | клон maestro (при self-clone) | `brew install git` или менеджер пакетов |
| **curl** | HTTP-запросы (healthcheck) | входит в macOS, на Linux: `apt install curl` |
| **jq** | обработка JSON | входит в macOS, на Linux: `apt install jq` |
| **openssl** (рекомендуется) | генерация случайного пароля | входит в macOS, на Linux: `apt install openssl` |

> **Примечание:** `opencode CLI` не обязателен для запуска (только для TUI-подключения). Если не установлен — скрипт выдаст предупреждение.

---

## 🚀 Сценарий 1: запуск с нуля (новая машина)

### Шаг 1: curl-one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/docker/maestro-setup-docker.sh \
  | bash -s --
```

Скрипт автоматически:

1. **Preflight** — проверяет наличие docker, git, curl, jq
2. **Self-clone** — клонирует репо maestro в `~/dev/maestro` (если не найден локально)
3. **Wizard** — задаст 4 вопроса (если `.env.docker` ещё не создан)
4. **Создаст папки** — `~/maestro-state/<project>` и `~/maestro-confidential/<project>`
5. **Соберёт образ** — `docker build`
6. **Запустит контейнер** — `docker run`
7. **Проверит готовность** — healthcheck с retry (до 120 секунд)

### Шаг 2: вопросы wizard

Если `.env.docker` не существует, скрипт попросит:

| Вопрос | По умолчанию | Описание |
|---|---|---|
| URL репозитория проекта | — | URL целевого репозитория для клонирования в контейнер |
| Git token (GitHub PAT) | пустой = public | PAT с scope `contents: read` |
| Пароль сервера | **генерируется random** | Строка из 12 символов |
| Модель для всех агентов | `akash/Qwen3.6-35B-A3B` | Формат: `provider/model` |

> **Генерация пароля:** при наличии `openssl` используется `openssl rand -base64 12`, иначе — `/dev/urandom`.

### Шаг 3: подключение

В конце скрипт напечатает команду подключения:

```bash
OPENCODE_PASSWORD='<сгенерированный-пароль>' \
  opencode --server http://127.0.0.1:4096
```

Первая команда внутри сессии:

```
/maestro-setup        → инициализация целевого проекта
@maestro-init "Задача" → запуск пайплайна
```

---

## 🛠 Сценарий 2: из клона репо

Если maestro уже склонирован (например, `~/dev/maestro`):

```bash
cd ~/dev/maestro
./docker/maestro-setup-docker.sh
```

Скрипт автоматически обнаружит клон через `detect_self_clone` (проверяет наличие `maestro-install.sh` + `skills/` + `docker/`) и пропустит self-clone.

### Повторный запуск

Если `.env.docker` уже существует — wizard пропускается, используются текущие значения:

```bash
./docker/maestro-setup-docker.sh setup
# → использует существующий .env.docker, пересоберёт образ и запустит контейнер
```

---

## 🤖 Сценарий 3: неинтерактивный режим (CI)

Для CI/CD используйте `--non-interactive` с обязательными параметрами:

```bash
./docker/maestro-setup-docker.sh setup \
  --project myapp \
  --repo-url https://github.com/org/myapp.git \
  --git-token "$GH_PAT" \
  --password "strong-password-here" \
  --model "akash/Qwen3.6-35B-A3B" \
  --non-interactive
```

**Обязательные флаги в non-interactive режиме:**
- `--repo-url` — URL целевого репозитория
- `--password` — пароль сервера (не генерируется автоматически)
- `--model` — модель для всех агентов
- `--non-interactive` — переключатель режима

---

## 🔧 Сценарий 4: проверка плана (dry-run)

```bash
./docker/maestro-setup-docker.sh setup --dry-run
```

Выведет план действий без выполнения `build` и `up`:

```
=== DRY RUN PLAN ===
1. Preflight: docker, git, curl ✓
2. Clone:    /Users/me/dev/maestro
3. Env:      /Users/me/dev/maestro/docker/.env.docker
4. Dirs:     ~/maestro-state/myapp
5. Build:    docker build -t maestro-opencode:6.x
6. Up:       docker run --name maestro-myapp ...
```

---

## 🔄 Сценарий 5: рутинное управление

### Lifecycle-команды

После первого запуска используйте краткие команды:

```bash
./docker/maestro-setup-docker.sh up       # запуск (авто-build если образа нет)
./docker/maestro-setup-docker.sh down     # остановить и удалить контейнер
./docker/maestro-setup-docker.sh logs     # логи контейнера (-f tail)
./docker/maestro-setup-docker.sh health   # проверка healthcheck
./docker/maestro-setup-docker.sh ps       # список контейнеров maestro
./docker/maestro-setup-docker.sh build    # пересобрать образ
./docker/maestro-setup-docker.sh help     # полная справка
```

> **По умолчанию:** при вызове без команды выполняется `setup`.

### Обновление версии

```bash
# 1. Остановить контейнер (volumes сохраняются)
./docker/maestro-setup-docker.sh down

# 2. Пересобрать образ (обновить клон maestro)
./docker/maestro-setup-docker.sh build

# 3. Запустить заново
./docker/maestro-setup-docker.sh up
```

---

## ⚙️ Переменные окружения

Перед запуском можно задать переменные для кастомизации:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PROJECT_NAME` | `default` | Имя проекта (контейнер, volumes) |
| `PROJECT_PORT` | `4096` | Порт хоста (только localhost) |
| `IMAGE_TAG` | `6.x` | Тег образа |
| `MAESTRO_STATE` | `~/maestro-state/<project>` | Хост-путь для `/maestro` (логи, memory) |
| `MAESTRO_CONF` | `~/maestro-confidential/<project>` | Хост-путь для `.confidential` |
| `DOCKER_MODE` | `A` | `A` (self-contained) или `B` (live-mount) |
| `MODEL` | `akash/Qwen3.6-35B-A3B` | Модель для всех агентов |

Пример с кастомным портом:

```bash
PROJECT_PORT=4097 PROJECT_NAME=frontend \
  ./docker/maestro-setup-docker.sh up
```

---

## 📝 Формат `.env.docker`

Wizard создаёт `.env.docker` в каталоге скрипта (не в целевом репо). Содержимое:

```bash
OPENCODE_PASSWORD="generated-password"
REPO_URL="https://github.com/org/repo.git"
GIT_TOKEN="ghp_xxxxxxxx"
OC_BUILD_MODEL="akash/Qwen3.6-35B-A3B"
OC_CUSTODIAN_MODEL="akash/Qwen3.6-35B-A3B"
OC_SANITIZER_MODEL="akash/Qwen3.6-35B-A3B"
```

> **Безопасность:** файл содержит токены — права `600` (chmod 600).

---

## ⚠️ Известные ограничения

| Ограничение | Детали |
|---|---|
| `--help` после команды | Флаги после команды (например `setup --help`) имеют меньший приоритет над командой |
| Dry-run + self-clone | Dry-run выводится и при self-locate fail, но self-clone всё равно выполняется до dry-run блока |
| Один контейнер на проект | Имя контейнера `maestro-<PROJECT_NAME>` — для нескольких проектов используйте разные `PROJECT_NAME` |
| `--` в pipe-аргументах | `bash -s --` разделяет аргументы скрипта от аргументов bash; флаги после `--` обрабатываются корректно |

---

## 🔗 Связанные разделы

- [Docker: запуск через compose](./docker-serve.md) — подробная документация по docker-serve (режимы A/B, hardening, backup, сценарии)
- [docker/README.md](../../docker/README.md) — quick start (hello world за 5 минут)
- [Обновление maestro](./update-maestro.md) — доставка новой версии скиллов и плагина
