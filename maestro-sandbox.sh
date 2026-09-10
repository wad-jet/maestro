#!/usr/bin/env bash
#
# maestro-sandbox.sh — подготовка песочницы (фикстуры) для ручного QA скилла
# maestro и плагина maestro-bootstrap (Фаза 9 плана spec-revise-consolidated).
#
# Генерирует `.sandbox/` (в корне authoring-репо, в .gitignore, НЕ коммитится) —
# каталог, имитирующий целевое приложение:
#   docs/project-context.md        14 категорий, фиктивный проект
#   docs/confidential/             фиктивные конфиденциальные данные
#   maestro.json                   trust/access_policy/confidential
#   .env                           фиктивные секреты (закрыты built-in confidential)
#   secrets/other.conf             фиктивный секрет вне built-in (закрыт конфигом)
#   src/, tests/                   минимальный код-скелет (TS) для debug/bugfix
#   docs/superpowers/{specs,plans} каталоги для spec/plan
#
# Сценарии maestro запускаются с workdir = корень `.sandbox/`, НЕ в корне
# authoring (см. AGENTS.md).
#
# Флаги:
#   create        создать/пересоздать песочницу (по умолчанию)
#   --reset       полный сброс (пересоздать с нуля)
#   --clean       удалить .sandbox/ (фиктивные данные)
#   --qdrant      настроить qdrant backend (docker-compose + maestro.json + .env)
#   --help        краткая справка
#
# Идемпотентен: повторный `create` не ломает существующую песочницу
# (файлы перезаписываются, лишние не удаляются без --reset).
#
# Qdrant: `--qdrant` включает memory.storage.type=qdrant в sandbox maestro.json,
# генерирует .sandbox/docker-compose.yml и добавляет ключ в .sandbox/.env.
# Поднятие/остановка — вручную (docker compose), см. инструкцию в выводе.
# Может комбинироваться с --reset (--reset --qdrant).
#
# Совместимость: bash 3.2+ (macOS/Linux).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX="$REPO_ROOT/.sandbox"
CHECKLIST_REL="docs/testing/maestro-sandbox-checklist.md"

usage() {
  cat <<EOF
Использование: $0 [create|--reset|--clean|--help] [--qdrant]

  create        создать/пересоздать песочницу .sandbox/ (по умолчанию)
  --reset       полный сброс: удалить .sandbox/ и создать заново
  --clean       удалить .sandbox/ (фиктивные данные) и выйти
  --qdrant      настроить qdrant backend для memory layer:
                docker-compose.yml + memory.storage.type=qdrant в maestro.json
                + ключ в .env (поднятие/остановка — docker compose, см. вывод)
  --help        показать эту справку

QA: после create/--reset печатается путь к чеклисту
    ($CHECKLIST_REL).
EOF
}

say() { printf '%s\n' "$*"; }

# ---------- генерация файлов ----------

gen_project_context() {
  cat >"$SANDBOX/docs/project-context.md" <<'EOF'
# Project Context — Sandbox (фиктивный проект)

> Имитация целевого приложения для ручного QA maestro. Не настоящий код.

## 1. Цель продукта
Демо-приложение по учёту подписок клиентов. Sandbox для QA-сценариев.

## 2. Стек
- TypeScript (Node 20), express, vitest.

## 3. Команды
- `npm test` — запуск тестов (vitest).
- `npm run build` — компиляция TS.

## 4. Архитектура и модули
- `src/` — сервисы и маршруты.
- `tests/` — юнит-тесты.

## 5. Репозитории/пакеты
- моно-репо нет; единый пакет `sandbox-app`.

## 6. Конфигурация и окружение
- `.env` — секреты (фиктивные), защищён built-in confidential.
- `secrets/other.conf` — секрет вне built-in, закрыт `confidential.paths`.

## 7. Качество кода
- Lint — отсутствует; тесты — vitest.

## 8. Безопасность и риски
- Конфиденциальные данные — в `docs/confidential/**` (см. `maestro.json`).
- Секреты не должны попадать в spec/план/код.

## 9. Развёртывание
- Нет (локальный демо-проект).

## 10. Процесс разработки
- Maestro-пайплайн (feature/bugfix/spike).

## 11. Наблюдаемость и логирование
- Отсутствует.

## 12. Роли и владельцы
- Один разработчик.

## 13. Соглашения и правила
- Код — TS, строгие типы.

## 14. Дорожная карта
- Нет.
EOF
}

gen_confidential() {
  cat >"$SANDBOX/docs/confidential/pricing-schema.md" <<'EOF'
# Pricing Schema (confidential — фиктивные данные)

Данные из confidential: не выносить значения в spec/план.

- Месячная цена базового тарифа: фиксированная сумма (значение не раскрывать).
- Тарифы: три уровня (Basic/Pro/Enterprise) — только имена уровней, без цен.
- Валюта: единая.
- Скидка для долгосрочных контрактов: процент (значение не раскрывать).
EOF

  cat >"$SANDBOX/docs/confidential/customer-contract.md" <<'EOF'
# Customer Contract (confidential — фиктивные данные)

Данные из confidential: не выносить значения в spec/план.

- Имя клиента: фиктивное, не раскрывать.
- Условия оплаты: тип (срок, реквизиты) — без конкретных номеров.
- Ответственный менеджер: только роль, без имени.
EOF

  cat >"$SANDBOX/docs/confidential/onboarding-flows.md" <<'EOF'
# Onboarding Flows (confidential — фиктивные данные)

Данные из confidential: не выносить значения в spec/план.

- Потоки онбординга: три (регистрация, приглашение, миграция).
- Длительность каждого шага: тип (диапазон/фиксированный) — без значений.
- Триггеры: названия событий, без чувствительных полей.
EOF
}

gen_maestro_json() {
  cat >"$SANDBOX/maestro.json" <<'EOF'
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  },
  "access_policy": {
    "version": 1,
    "default": "ask",
    "allow": [
      "src/**",
      "tests/**",
      "docs/project-context.md",
      "docs/superpowers/specs/**",
      "docs/superpowers/plans/**"
    ],
    "deny": [
      "secrets/**"
    ]
  },
  "confidential": {
    "version": 1,
    "paths": [
      "docs/confidential/**",
      "secrets/**"
    ],
    "trusted": {
      "read": "allow",
      "write": "deny",
      "edit": "deny"
    }
  },
  "sanitizer_whitelist": {
    "patterns": [
      "sandbox_dummy_placeholder"
    ],
    "extra_fields": []
  }
EOF

  # Закрытие корневого объекта: с qdrant — через запятую добавляем секцию memory.
  if [ "$QDRANT" = "1" ]; then
    cat >>"$SANDBOX/maestro.json" <<'EOF'
  ,
  "memory": {
    "enabled": true,
    "namespace": "sandbox",
    "identity": "sandbox",
    "storage": {
      "type": "qdrant",
      "qdrant": {
        "url": "http://localhost:6333",
        "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY",
        "collection": "maestro_memory"
      }
    }
  }
EOF
  fi
  printf '%s\n' '}' >>"$SANDBOX/maestro.json"
}

gen_env() {
  # Фиктивные секреты. Закрыты BUILT-IN confidential (Фаза 2): .env deny для
  # primary/non-trusted по умолчанию, конфиг для этого не нужен.
  cat >"$SANDBOX/.env" <<'EOF'
SANDBOX_DUMMY_PASSWORD=sandbox-dummy-password
SANDBOX_FAKE_API_KEY=sandbox-fake-api-key-value
SANDBOX_FAKE_CARD=4111-1111-1111-1111
EOF

  if [ "$QDRANT" = "1" ]; then
    # Ключ qdrant для memory layer. Плагин читает его из process.env (имя —
    # memory.storage.qdrant.api_key_env), не через файловые тулы — защита не задета.
    cat >>"$SANDBOX/.env" <<'EOF'
MAESTRO_MEMORY_QDRANT_KEY=sandbox-qdrant-key
EOF
  fi
}

gen_docker_compose() {
  cat >"$SANDBOX/docker-compose.yml" <<'EOF'
# Qdrant для memory layer песочницы. Поднятие/остановка:
#   docker compose up -d
#   docker compose down
# Порт 6333 (REST) — как в memory.storage.qdrant.url sandbox maestro.json.
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: maestro-sandbox-qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"   # HTTP REST (maestro)
      - "6334:6334"   # gRPC (опционально)
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__API_KEY: ${MAESTRO_MEMORY_QDRANT_KEY}

volumes:
  qdrant_data:
EOF
}

gen_secrets() {
  # Секрет вне built-in набора. Закрывается через confidential.paths/access_policy.deny
  # в maestro.json (не входит в built-in).
  cat >"$SANDBOX/secrets/other.conf" <<'EOF'
# Фиктивный секрет вне built-in confidential набора.
SANDBOX_OTHER_SECRET=sandbox-other-secret-value
EOF
}

gen_src() {
  cat >"$SANDBOX/src/billing.ts" <<'EOF'
export interface Subscription {
  id: string;
  plan: string;
  monthly: number;
}

// Вычисляет годовую стоимость подписки (месячная цена * 12).
export function annualCost(sub: Subscription): number {
  return sub.monthly * 12;
}

// Проверяет, активна ли подписка (id непустой и план не empty).
export function isActive(sub: Subscription): boolean {
  return sub.id.length > 0 && sub.plan.trim().length > 0;
}
EOF

  cat >"$SANDBOX/src/app.ts" <<'EOF'
import { annualCost, isActive, type Subscription } from "./billing";

export function summarize(sub: Subscription): string {
  if (!isActive(sub)) return "inactive";
  return `plan=${sub.plan} annual=${annualCost(sub)}`;
}
EOF
}

gen_tests() {
  cat >"$SANDBOX/tests/billing.test.ts" <<'EOF'
import { test, expect } from "vitest";
import { annualCost, isActive } from "../src/billing";

test("annualCost multiplies monthly by 12", () => {
  expect(annualCost({ id: "s1", plan: "Pro", monthly: 100 })).toBe(1200);
});

test("isActive returns false for empty id", () => {
  expect(isActive({ id: "", plan: "Pro", monthly: 100 })).toBe(false);
});
EOF
}

# ---------- create ----------

do_create() {
  say "Создание песочницы в $SANDBOX ..."
  mkdir -p "$SANDBOX/docs"
  mkdir -p "$SANDBOX/docs/confidential"
  mkdir -p "$SANDBOX/docs/superpowers/specs"
  mkdir -p "$SANDBOX/docs/superpowers/plans"
  mkdir -p "$SANDBOX/secrets"
  mkdir -p "$SANDBOX/src"
  mkdir -p "$SANDBOX/tests"
  mkdir -p "$SANDBOX/.maestro"

  gen_project_context
  gen_confidential
  gen_maestro_json
  gen_env
  gen_secrets
  gen_src
  gen_tests

  if [ "$QDRANT" = "1" ]; then
    gen_docker_compose
  fi

  # Каталоги для spec/plan (maestro на них опирается).
  mkdir -p "$SANDBOX/docs/superpowers/specs"
  mkdir -p "$SANDBOX/docs/superpowers/plans"
  # Каталог для эфемерных артефактов maestro.
  mkdir -p "$SANDBOX/.maestro"

  # --- Memory layer smoke (опционально) --------------------------------------
  if [[ -d node_modules ]] && node -e "require.resolve('better-sqlite3')" 2>/dev/null; then
    echo "[memory] проверка: запускаю смоук-тест памяти (sqlite)..."
    if ! node --test plugins/maestro-bootstrap/memory/index.test.js 2>&1 | tail -5; then
      echo "[memory] смоук НЕ прошёл (см. вывод выше) — песочница продолжает создание."
    fi
  else
    echo "[memory] смоук пропущен: зависимости памяти не установлены (npm install для devDependencies)."
  fi

  say ""
  say "✅ Песочница готова. Чеклист: $CHECKLIST_REL"
  say "   Запускайте сценарии maestro с workdir = корень .sandbox/ ($SANDBOX)."
  if [ "$QDRANT" = "1" ]; then
    say ""
    say "🐳 Qdrant backend настроен. Поднимите и настройте память:"
    say "   cd $SANDBOX"
    say "   docker compose up -d"
    say "   # затем в module_dir памяти: npm install (добавляет @qdrant/js-client-rest)"
    say "   # и перезапустите opencode (OP-1). URL http://localhost:6333, ключ в .env."
    say "   # Остановка: docker compose down (данные сохранены в volume qdrant_data)."
  fi
}

# ---------- main ----------

ACTION="create"
QDRANT="0"

for arg in "$@"; do
  case "$arg" in
    --qdrant)
      QDRANT="1"
      ;;
    create|--reset|--clean|--help|-h)
      ACTION="${arg#--}"
      ;;
    *)
      say "Неизвестный аргумент: $arg"
      usage
      exit 1
      ;;
  esac
done

case "$ACTION" in
  help|-h)
    usage
    exit 0
    ;;
esac

if [ "$ACTION" = "clean" ]; then
  if [ -d "$SANDBOX" ]; then
    rm -rf "$SANDBOX"
    say "Удалено: $SANDBOX"
  else
    say "Песочница отсутствует (нечего удалять): $SANDBOX"
  fi
  exit 0
fi

if [ "$ACTION" = "reset" ]; then
  if [ -d "$SANDBOX" ]; then
    rm -rf "$SANDBOX"
    say "Полный сброс: $SANDBOX удалён."
  fi
fi

do_create