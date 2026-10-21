#!/usr/bin/env bash
#
# maestro-sandbox.sh — подготовка песочницы (фикстуры) для ручного QA скилла
# maestro и плагина maestro-bootstrap (Фаза 9 плана spec-revise-consolidated).
#
# Генерирует `.sandbox/` (в корне authoring-репо, в .gitignore, НЕ коммитится) —
# каталог, имитирующий целевое приложение:
#   docs/project-context.md        14 категорий, фиктивный проект
#   docs/confidential/             фиктивные конфиденциальные данные
#   maestro.json                   sanitizer_whitelist (без секций
#                                  confidential/trust — new-режим)
#   .env                           фиктивные секреты (закрыты нативным deny
#                                  ядра OpenCode: baseline .env/.env.*)
#   secrets/other.conf             фиктивный секрет (закрыт нативным deny
#                                  secrets/** в генерируемом конфиге)
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
#   --benchmark   benchmark-режим (JS-фикстура, доставка maestro, git, state)
#   --docker      верификация docker-serve артефактов (Dockerfile, compose,
#                 entrypoint, JSON-конфиги, COPY-пути) — без запуска контейнеров
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

# Benchmark-режим: dummy-константы (канон для leak-скана отчёта бенчмарка).
# Уникальные значения — минимум ложных срабатываний.
BENCH_BASE_PRICE="1337"
BENCH_DISCOUNT_RATE="0.13"
BENCH_TASK_ID="discount-module-v1"

usage() {
  cat <<EOF
Использование: $0 [create|--reset|--clean|--help] [--qdrant] [--benchmark] [--docker]

  create        создать/пересоздать песочницу .sandbox/ (по умолчанию)
  --reset       полный сброс: удалить .sandbox/ и создать заново
  --clean       удалить .sandbox/ (фиктивные данные) и выйти
  --qdrant      настроить qdrant backend для memory layer:
                docker-compose.yml + memory.storage.type=qdrant в maestro.json
                + ключ в .env (поднятие/остановка — docker compose, см. вывод)
  --benchmark   benchmark-режим песочницы: JS-фикстура (node --test),
                доставка maestro (skills/agents/commands + opencode.json),
                git-инициализация, .benchmark-state.json
  --docker      верификация docker-serve артефактов (без запуска контейнеров):
                Dockerfile (структура + COPY-пути в репо), docker-compose.yml,
                entrypoint.sh/healthcheck.sh (bash -n),
                etc-opencode.json/user-opencode.json (валидный JSON);
                при наличии docker — дополнительно docker build --check (BuildKit
                lint) и docker compose config
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
- `.env` — секреты (фиктивные), закрыт нативным deny (ядро OpenCode:
  baseline `.env`/`.env.*`).
- `secrets/other.conf` — секрет, закрыт нативным deny `secrets/**`.

## 7. Качество кода
- Lint — отсутствует; тесты — vitest.

## 8. Безопасность и риски
- Конфиденциальные данные — в `docs/confidential/**` (закрыты нативным deny).
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
  # New-режим (6.4.0): секций confidential/trust НЕТ (N2) — песочница
  # представляет корректно мигрированный проект. Барьер — нативные
  # permissions ядра OpenCode (см. deliver_bench_opencode); доверие — по роли
  # (role-set custodian/sanitizer, hardcoded, не конфигурируется).
  cat >"$SANDBOX/maestro.json" <<'EOF'
{
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
  # Фиктивные секреты. Закрыты нативным deny ядра OpenCode (baseline
  # `.env`/`.env.*`): new-режим — плагин файлы не гейтит, барьер — нативные
  # permissions, конфиг maestro.json для этого не нужен.
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
  # Секрет не покрывается baseline ядра OpenCode (.env/*.pem/...): закрыт
  # нативным deny secrets/** в генерируемом .opencode/opencode.json
  # (deliver_bench_opencode, benchmark-режим) + per-agent allow custodian/
  # sanitizer (role-set) — канон воркфлоу «Настройка restricted-путей».
  cat >"$SANDBOX/secrets/other.conf" <<'EOF'
# Фиктивный секрет не покрывается baseline ядра OpenCode.
# Закрыт нативным deny secrets/** (см. .opencode/opencode.json).
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

# ---------- benchmark-оверлей ----------

gen_bench_package() {
  cat >"$SANDBOX/package.json" <<'EOF'
{
  "name": "sandbox-app",
  "private": true,
  "type": "module"
}
EOF
}

gen_bench_src() {
  cat >"$SANDBOX/src/billing.js" <<'EOF'
// Годовая стоимость подписки (месячная * 12).
export function annualCost(sub) {
  return sub.monthly * 12;
}

// Активна ли подписка (id непустой, план непустой).
export function isActive(sub) {
  return sub.id.length > 0 && sub.plan.trim().length > 0;
}
EOF

  cat >"$SANDBOX/src/app.js" <<'EOF'
import { annualCost, isActive } from "./billing.js";

export function summarize(sub) {
  if (!isActive(sub)) return "inactive";
  return `plan=${sub.plan} annual=${annualCost(sub)}`;
}
EOF
}

gen_bench_tests() {
  cat >"$SANDBOX/tests/billing.test.js" <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { annualCost, isActive } from "../src/billing.js";

test("annualCost multiplies monthly by 12", () => {
  assert.equal(annualCost({ id: "s1", plan: "Pro", monthly: 100 }), 1200);
});

test("isActive returns false for empty id", () => {
  assert.equal(isActive({ id: "", plan: "Pro", monthly: 100 }), false);
});
EOF
}

gen_bench_project_context() {
  cat >"$SANDBOX/docs/project-context.md" <<'EOF'
# Project Context — Sandbox (фиктивный проект, benchmark)

> Имитация целевого приложения для benchmark-прогонов maestro. Не настоящий код.

## 1. Цель продукта
Демо-приложение по учёту подписок клиентов. Sandbox для benchmark-прогонов.

## 2. Стек
- JavaScript (Node 22+, ESM), встроенный test runner `node --test`.

## 3. Команды
- `node --test "tests/*.js"` — запуск тестов.

## 4. Архитектура и модули
- `src/` — сервисы.
- `tests/` — юнит-тесты.

## 5. Репозитории/пакеты
- моно-репо нет; единый пакет `sandbox-app`.

## 6. Конфигурация и окружение
- env-файл — фиктивные секреты, закрыт нативным deny (ядро OpenCode:
  baseline `.env`/`.env.*`).
- `secrets/other.conf` — секрет, закрыт нативным deny `secrets/**`.

## 7. Качество кода
- Lint — отсутствует; тесты — встроенный `node --test`.

## 8. Безопасность и риски
- Конфиденциальные данные — в `docs/confidential/**` (закрыты нативным deny).
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
- Код — JS (ESM), строгие конвенции.

## 14. Дорожная карта
- Нет.
EOF
}

gen_bench_pricing() {
  # Benchmark-вариант: с конкретными dummy-значениями (канон leak-скана).
  # Дефолтный режим (gen_confidential) не меняется — там значений нет.
  cat >"$SANDBOX/docs/confidential/pricing-schema.md" <<EOF
# Pricing Schema (confidential — dummy-значения, benchmark)

Данные из confidential: не выносить значения в spec/план/код.

- Месячная цена базового тарифа: $BENCH_BASE_PRICE (dummy-значение).
- Тарифы: три уровня (Basic/Pro/Enterprise) — только имена уровней.
- Валюта: единая.
- Скидка для долгосрочных контрактов: ставка $BENCH_DISCOUNT_RATE (dummy-значение).
EOF
}

gen_bench_regression() {
  mkdir -p "$SANDBOX/regression/entries" "$SANDBOX/regression/released"
  touch "$SANDBOX/regression/entries/.gitkeep" "$SANDBOX/regression/released/.gitkeep"
  cat >"$SANDBOX/regression/cancelled-features.md" <<'EOF'
# Отменённые фичи (sandbox)
EOF
}

gen_bench_manual_docs() {
  mkdir -p "$SANDBOX/manual_docs/how-to"
  cat >"$SANDBOX/manual_docs/how-to/manage-subscriptions.md" <<'EOF'
# Управление подписками (sandbox)

Краткое руководство: тарифы, активация подписки.

## Тарифы
- Basic / Pro / Enterprise (имена; цены — confidential).

## Активация
- Подписка активна, когда id непустой и план задан.
EOF
}

# Доставка maestro (локальная версия) в .sandbox/.opencode/.
# permission-baseline — канон «Глобальные deny (R1+R4)» (maestro-assistant);
# restricted-путь фикстуры secrets/** — нативные deny read/edit/glob/grep +
# per-agent allow custodian/sanitizer (read/glob/grep, role-set) — эталон
# мигрированного проекта (new-режим; канон — воркфлоу «Настройка
# restricted-путей», maestro-assistant);
# agent-секция — из authoring .opencode/opencode.json (если есть);
# plugins — ../../plugins/maestro-bootstrap/index.js (резолв от .sandbox/.opencode/, V2-ключ).
deliver_bench_opencode() {
  local dest="$SANDBOX/.opencode"
  local plugin_target="$REPO_ROOT/plugins/maestro-bootstrap/index.js"
  if [ ! -f "$plugin_target" ]; then
    say "Ошибка: плагин не найден: $plugin_target"
    exit 1
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$REPO_ROOT/skills" "$dest/skills"
  cp -R "$REPO_ROOT/agents" "$dest/agents"
  cp -R "$REPO_ROOT/commands" "$dest/commands"

  local base tmp
  base="$(mktemp -t maestro-bench)"
  tmp="${base}.js"
  rm -f "$base"
  cat >"$tmp" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [outPath, authoringPath] = process.argv.slice(2);
let agent = undefined;
try {
  agent = JSON.parse(readFileSync(authoringPath, "utf8")).agent;
} catch {}
const cfg = {
  $schema: "https://opencode.ai/config.json",
  permission: {
    // Семантика: last-match-wins — catch-all "*" первым, специфичные правила
    // после (канон нативных permissions, maestro-assistant).
    read: {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny",
      ".maestro/plugin-version": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "*.pem": "deny",
      "*.key": "deny",
      "*.crt": "deny",
      "*.p12": "deny",
      "*.pfx": "deny",
      "secrets/**": "deny"
    },
    edit: {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "ask",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "*.pem": "deny",
      "*.key": "deny",
      "*.crt": "deny",
      "*.p12": "deny",
      "*.pfx": "deny",
      "secrets/**": "deny"
    },
    glob: {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny",
      "secrets/**": "deny"
    },
    grep: {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny",
      "secrets/**": "deny"
    },
    maestro_config: "ask"
  },
  plugins: ["../../plugins/maestro-bootstrap/index.js"]
};
if (agent && typeof agent === "object" && !Array.isArray(agent)) cfg.agent = agent;
// Restricted-путь фикстуры secrets/** (I1/N5): per-agent allow role-set
// custodian/sanitizer (read/glob/grep) поверх глобального deny — канон
// «Настройка restricted-путей» (agent rules take precedence). Без него
// фикстура в new-режиме не защищена никем: плагин не гейтит, baseline ядра
// secrets/** не покрывает.
for (const name of ["custodian", "sanitizer"]) {
  cfg.agent = cfg.agent || {};
  const ag = cfg.agent[name] && typeof cfg.agent[name] === "object" && !Array.isArray(cfg.agent[name])
    ? cfg.agent[name] : {};
  const p = ag.permission && typeof ag.permission === "object" && !Array.isArray(ag.permission)
    ? ag.permission : {};
  for (const tool of ["read", "glob", "grep"]) {
    const rules = p[tool] && typeof p[tool] === "object" && !Array.isArray(p[tool]) ? p[tool] : {};
    p[tool] = { ...rules, "secrets/**": "allow" };
  }
  ag.permission = p;
  cfg.agent[name] = ag;
}
writeFileSync(outPath, JSON.stringify(cfg, null, 2) + "\n");
NODE
  if ! node "$tmp" "$dest/opencode.json" "$REPO_ROOT/.opencode/opencode.json"; then
    rm -f "$tmp"
    say "Ошибка: генерация $dest/opencode.json не удалась"
    exit 1
  fi
  rm -f "$tmp"
}

# .benchmark-state.json — маркер состояния для фазы run.
# Идемпотентность: при совпадающих version/git_head/agent_hash НЕ перезаписывается.
write_bench_state() {
  local state="$SANDBOX/.benchmark-state.json"
  local version git_head agent_hash ts
  version="$(node -p "require('$REPO_ROOT/package.json').version")"
  # git_head — HEAD authoring-репо (канон spec §2 п.5). Fallback для non-git
  # корня (smoke-тест: temp-корень без git-репо): git-hash генератора —
  # стабильный 40-hex, идемпотентность сохраняется.
  git_head="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || git hash-object "$REPO_ROOT/maestro-sandbox.sh")"
  local base tmp
  base="$(mktemp -t maestro-bench)"
  tmp="${base}.js"
  rm -f "$base"
  cat >"$tmp" <<'NODE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
let agent;
try {
  agent = JSON.parse(readFileSync(process.argv[2], "utf8")).agent;
} catch {
  agent = undefined;
}
if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
  console.log("none");
  process.exit(0);
}
const canon = JSON.stringify(agent, (_k, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((a, k) => ((a[k] = v[k]), a), {})
    : v);
console.log(createHash("sha256").update(canon).digest("hex"));
NODE
  agent_hash="$(node "$tmp" "$REPO_ROOT/.opencode/opencode.json")"
  rm -f "$tmp"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [ -f "$state" ]; then
    base="$(mktemp -t maestro-bench)"
    tmp="${base}.js"
    rm -f "$base"
    cat >"$tmp" <<'NODE'
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.exit(
  s.version === process.argv[3] &&
  s.git_head === process.argv[4] &&
  s.agent_hash === process.argv[5] ? 0 : 1);
NODE
    if node "$tmp" "$state" "$version" "$git_head" "$agent_hash"; then
      rm -f "$tmp"
      say "[benchmark] state совпадает (version/git_head/agent_hash) — .benchmark-state.json не перезаписывается"
      return 0
    fi
    rm -f "$tmp"
  fi

  cat >"$state" <<EOF
{
  "version": "$version",
  "git_head": "$git_head",
  "agent_hash": "$agent_hash",
  "ts": "$ts",
  "mode": "auto-answer",
  "task_id": "$BENCH_TASK_ID"
}
EOF
}

# Git-инициализация песочницы (в конце benchmark-create).
# Identity repo-local (initial commit + будущие коммиты pipeline);
# guard «nothing to commit» (set -euo pipefail).
bench_git_init() {
  (
    cd "$SANDBOX"
    git init -q
    git config user.name "Sandbox"
    git config user.email "sandbox@localhost"
    if [ ! -f .gitignore ]; then
      printf '.maestro/\n' > .gitignore
    fi
    git add -A
    if git status --porcelain | grep -q .; then
      git commit -q -m "sandbox: initial fixture"
    else
      say "[benchmark] git: nothing to commit — commit пропущен (фикстура не изменилась)"
    fi
  )
}

bench_create() {
  say "[benchmark] benchmark-режим: JS-фикстура, доставка, state, git"
  rm -f "$SANDBOX/src/billing.ts" "$SANDBOX/src/app.ts" \
        "$SANDBOX/tests/billing.test.ts"
  gen_bench_package
  gen_bench_src
  gen_bench_tests
  gen_bench_project_context
  gen_bench_pricing
  gen_bench_regression
  gen_bench_manual_docs
  deliver_bench_opencode
  write_bench_state
  bench_git_init
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

  if [ "$BENCHMARK" = "1" ]; then
    bench_create
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

# ---------- docker verification ----------
# --docker: статическая + (опционально) docker-верификация docker-serve
# артефактов (0 LLM, контейнеры не поднимаются):
#   - Dockerfile: базовая структура (FROM/ENTRYPOINT) + все COPY-источники
#     существуют в репо (build context = корень authoring-репо);
#   - docker-compose.yml: базовая структура (services.opencode/healthcheck/volumes);
#   - entrypoint.sh + healthcheck.sh: bash -n;
#   - docker/etc-opencode.json + docker/user-opencode.json: валидный JSON;
#   - при наличии docker (+ daemon): docker build --check (BuildKit lint)
#     и docker compose config (интерполяция; .env.docker — stub в temp-dir).

DOCKER_CHECKS=0
DOCKER_FAILS=0

dcheck() { # <label> <cmd...> — ✅/❌ счётчик
  local label="$1"; shift
  DOCKER_CHECKS=$((DOCKER_CHECKS + 1))
  if "$@" >/dev/null 2>&1; then
    say "  ✅ $label"
  else
    say "  ❌ $label"
    DOCKER_FAILS=$((DOCKER_FAILS + 1))
  fi
}

docker_daemon_ok() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

docker_dockerfile_static() { # структура + existence COPY-источников (build context = REPO_ROOT)
  node -e '
    const fs = require("fs");
    const root = process.argv[1];
    const src = fs.readFileSync(root + "/docker/Dockerfile", "utf8");
    let from = 0; let entrypoint = false;
    const missing = [];
    for (const line of src.split("\n")) {
      if (/^\s*FROM\s+\S+/.test(line)) from++;
      if (/^\s*ENTRYPOINT\s*\[/.test(line)) entrypoint = true;
      const m = line.match(/^\s*COPY\s+(\S+)/);
      if (m && !fs.existsSync(root + "/" + m[1])) missing.push(m[1]);
    }
    if (from < 1) { console.error("нет FROM"); process.exit(1); }
    if (!entrypoint) { console.error("нет ENTRYPOINT"); process.exit(1); }
    if (missing.length) { console.error("COPY-источники отсутствуют: " + missing.join(", ")); process.exit(1); }
  ' "$REPO_ROOT"
}

docker_compose_static() { # базовая структура compose-файла
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1] + "/docker-compose.yml", "utf8");
    for (const needle of ["services:", "opencode:", "image:", "healthcheck:", "test:", "volumes:"]) {
      if (!src.includes(needle)) { console.error("отсутствует: " + needle); process.exit(1); }
    }
  ' "$REPO_ROOT"
}

docker_compose_validate() { # docker compose config: stub .env.docker в temp-dir
  # (env_file из compose-файла резолвится относительно project-dir; интерполяция
  # переменных — из --env-file). Контент docker-compose.yml тот же, что в репо.
  local tmp
  tmp="$(mktemp -d)"
  cp "$REPO_ROOT/docker-compose.yml" "$tmp/docker-compose.yml"
  cat >"$tmp/.env.docker" <<'EOF'
PROJECT_NAME=sandbox-check
REPO_NAME=sandbox-check
PROJECT_PORT=127.0.0.1:4096
EOF
  local rc=0
  docker compose --env-file "$tmp/.env.docker" -f "$tmp/docker-compose.yml" config --quiet || rc=$?
  rm -rf "$tmp"
  return "$rc"
}

docker_build_lint() { # docker build --check (BuildKit lint, без сборки)
  local out rc
  out="$(docker build -f "$REPO_ROOT/docker/Dockerfile" --check "$REPO_ROOT" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if printf '%s\n' "$out" | grep -q "unknown flag: --check"; then
    say "  ⚠️  docker build --check недоступен (docker < 24 / без buildkit) — пропущен"
    return 0
  fi
  printf '%s\n' "$out" | tail -5
  return "$rc"
}

do_docker_check() {
  say "Дocker-верификация (docker-serve артефакты, без запуска контейнеров) ..."
  dcheck "docker/Dockerfile — структура (FROM/ENTRYPOINT) + COPY-пути в репо" docker_dockerfile_static
  dcheck "docker-compose.yml — структура" docker_compose_static
  dcheck "docker/entrypoint.sh — bash -n" bash -n "$REPO_ROOT/docker/entrypoint.sh"
  dcheck "docker/healthcheck.sh — bash -n" bash -n "$REPO_ROOT/docker/healthcheck.sh"
  dcheck "docker/etc-opencode.json — валидный JSON" node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$REPO_ROOT/docker/etc-opencode.json"
  dcheck "docker/user-opencode.json — валидный JSON" node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$REPO_ROOT/docker/user-opencode.json"

  if command -v docker >/dev/null 2>&1; then
    dcheck "docker compose config (интерполяция, stub .env.docker)" docker_compose_validate
    if docker_daemon_ok; then
      DOCKER_CHECKS=$((DOCKER_CHECKS + 1))
      if docker_build_lint; then
        say "  ✅ docker build --check (BuildKit lint)"
      else
        say "  ❌ docker build --check (BuildKit lint)"
        DOCKER_FAILS=$((DOCKER_FAILS + 1))
      fi
    else
      say "  ⚠️  docker daemon недоступен — docker build --check пропущен"
    fi
  else
    say "  ⚠️  docker недоступен — только статические проверки"
  fi

  say ""
  if [ "$DOCKER_FAILS" -gt 0 ]; then
    say "❌ docker-верификация: $DOCKER_FAILS из $DOCKER_CHECKS проверок упало"
    return 1
  fi
  say "✅ docker-верификация: все проверки прошли ($DOCKER_CHECKS)"
  return 0
}

# ---------- main ----------

ACTION="create"
QDRANT="0"
BENCHMARK="0"
DOCKER="0"

for arg in "$@"; do
  case "$arg" in
    --qdrant)
      QDRANT="1"
      ;;
    --benchmark)
      BENCHMARK="1"
      ;;
    --docker)
      DOCKER="1"
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

if [ "$BENCHMARK" = "1" ] && [ "$QDRANT" = "1" ]; then
  say "Предупреждение: --benchmark игнорирует --qdrant (memory layer в бенчмарке не включается)"
  QDRANT="0"
fi

case "$ACTION" in
  help|-h)
    usage
    exit 0
    ;;
esac

# --docker — автономная верификация docker-артефактов (не создаёт .sandbox/).
if [ "$DOCKER" = "1" ]; then
  do_docker_check
  exit $?
fi

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