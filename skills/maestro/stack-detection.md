# Stack Detection — Auto-Discovery of Project Commands

Справочный файл для автоматического определения команд сборки, тестирования
и линтинга по артефактам проекта. Используется maestro pipeline
(шаги 0, 15, 15a), когда секция Commands в project-context.md не задана явно.

## Модель разрешения (3 Tier)

| Tier | Источник | Поведение |
|------|----------|-----------|
| 1 | Явно в project-context.md (секция Commands) | Безусловный приоритет |
| 2 | Авто-детект по артефактам проекта | Если не задано явно и не `none` |
| 3 | HITL-эскалация | Если не удалось определить — НЕ skip |

```
Tier 1: explicit in project-context.md
   ↓ (нет записи, не "none")
Tier 2: авто-детект
   ├─ один кандидат → выполнить + HITL persist (предложить записать)
   ├─ несколько кандидатов → HITL: выбор + silent persist
   └─ ни одного → Tier 3
   ↓
Tier 3: HITL
   "Не удалось определить X. (a) указать вручную — (b) пропустить с подтверждением — (c) отмена"
```

## Общий алгоритм детекта

Для каждой команды агент проверяет артефакты в указанном порядке.
Первое совпадение — кандидат. Если кандидатов несколько (разные артефакты
на разных уровнях) — это неоднозначность, требуется HITL.

### Monorepo

Агент сканирует корень проекта + подкаталоги первого уровня,
имеющие собственный манифест (package.json, Cargo.toml, go.mod, pyproject.toml,
Makefile, *.sh скрипты). Для каждого пути — независимый детект.

Результат структурируется per-path:
```yaml
### Default (root)
TEST_COMMAND: "npm run test:unit"

### web/
TEST_COMMAND: "npm run test:e2e"
```

---

## TEST_COMMAND

### Приоритет детекта

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `test.sh` / `test-unit.sh` / `test-all.sh` в корне | `./test.sh` | — |
| 2 | `Makefile` с целью `test` / `check` / `unit-test` | `make test` / `make check` | — |
| 3 | `package.json` → `scripts.test:unit` / `scripts.test` | `npm run test:unit` | Node.js / NestJS |
| 4 | `Cargo.toml` | `cargo test` | Rust |
| 5 | `go.mod` | `go test ./...` | Go |
| 6 | `pyproject.toml` с `[tool.pytest]` / `[build-system]` | `pytest` / `poetry run pytest` / `uv run pytest` / `pdm run pytest` | Python |
| 7 | `deno.json` / `deno.jsonc` | `deno test` | Deno |
| 8 | `bun.lock` / `bun.lockb` | `bun test` | Bun |
| 9 | `Cargo.toml` (workspace) | `cargo test --workspace` | Rust workspace |
| 10 | Иной признак стека (Gemfile → `bundle exec rspec`, mix.exs → `mix test`, build.gradle → `./gradlew test`) | — | — |

### Monorepo

Если несколько директорий имеют манифесты с тестовыми командами,
каждая получает свою запись:
```yaml
### Default (root)
TEST_COMMAND: "npm run test:unit"

### services/etl/
TEST_COMMAND: "cargo test"
```

---

## BUILD_COMMAND

### Приоритет детекта

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `build.sh` / `build.ps1` / `compile.sh` в корне | `./build.sh` | — |
| 2 | `Makefile` с целью `build` / `all` / `compile` | `make build` | — |
| 3 | `package.json` → `scripts.build` | `npm run build` | Node.js |
| 4 | `Cargo.toml` → `cargo build` | `cargo build` | Rust |
| 5 | `go.mod` | `go build ./...` | Go |
| 6 | `pyproject.toml` | `poetry build` / `pdm build` / `pip install -e .` | Python |
| 7 | `deno.json` / `deno.jsonc` | `deno compile` / `deno task build` | Deno |
| 8 | `bun.lock` / `bun.lockb` | `bun run build` | Bun |
| 9 | `tsconfig.json` (без package.json build) | `npx tsc` | TypeScript standalone |
| 10 | `Dockerfile` | `docker build` (fallback) | Container |

---

## E2E_COMMAND

### Приоритет детекта

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `test-e2e.sh` / `e2e.sh` | `./test-e2e.sh` | — |
| 2 | `Makefile` с целью `e2e` / `integration` | `make e2e` | — |
| 3 | `package.json` → `scripts.test:e2e` / `scripts.e2e` | `npm run test:e2e` | Node.js |
| 4 | playwright.config.ts (в корне или `e2e/`) | `npx playwright test` | Playwright |
| 5 | `cypress.config.ts` / `cypress.json` | `npx cypress run` | Cypress |
| 6 | `Cargo.toml` с `[[test]]` | `cargo test --test <name>` | Rust integration |

Если не найден — используется `TEST_COMMAND` как fallback (агент включает
e2e в общий тестовый прогон).

---

## LINT_COMMAND

### Приоритет детекта

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `lint.sh` / `check.sh` | `./lint.sh` | — |
| 2 | `Makefile` с целью `lint` / `check` | `make lint` | — |
| 3 | `package.json` → `scripts.lint` / `scripts.check` | `npm run lint` | Node.js |
| 4 | `.eslintrc*` / `eslint.config.*` | `npx eslint .` | ESLint |
| 5 | `.prettierrc*` / `.prettierrc.*` | `npx prettier --check .` | Prettier |
| 6 | `rustfmt.toml` / `rust-toolchain.toml` | `cargo fmt --check` | Rust |
| 7 | `golangci.yml` / `.golangci.yml` | `golangci-lint run` | Go |
| 8 | `pyproject.toml` с `[tool.ruff]` / `[tool.pylint]` | `ruff check .` / `pylint .` | Python |
| 9 | `deno.json` с `lint` | `deno lint` | Deno |

---

## DOCS_COVERAGE_COMMAND

### Специфичные для стека

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `docs-coverage.sh` | `./docs-coverage.sh` | — |
| 2 | `Makefile` с целью `docs-coverage` / `docs-check` | `make docs-coverage` | — |
| 3 | `package.json` → `scripts.docs-coverage` | `npm run docs-coverage` | Node.js |

Обычно определяется явно в project-context.md. Выполняется на шаге 15
(финальные проверки), если задана и не `none`.

**Fallback — diff-сверка (если команда не задана/`none`/не детектится):**
НЕ молчаливый skip. Оркестратор выполняет diff-сверку на шаге 14: сверяет
diff кода с изменениями в `manual_docs/` по правилам acceptance criteria шага 14
(каждое пользовательское изменение кода имеет отражение в `manual_docs/`).
HITL поднимается только при расхождении: (a) дополнить доку → (b) follow-up →
(c) skip с подтверждением. Это работает в любом проекте без coverage-теста.
Если команда задана — coverage-гейт выполняется на шаге 15.

---

## OBSERVABILITY_COVERAGE_COMMAND

### Специфичные для стека

| # | Артефакт | Команда | Пример |
|---|-----------|---------|--------|
| 1 | `observability-coverage.sh` | `./observability-coverage.sh` | — |
| 2 | `Makefile` с целью `obs-coverage` / `observability-check` | `make obs-coverage` | — |
| 3 | `package.json` → `scripts.obs-coverage` | `npm run obs-coverage` | Node.js |

Обычно определяется явно в project-context.md. Если не задан — агент
пропускает проверку observability coverage.

---

## Обработка неоднозначности

Если детект нашёл несколько кандидатов для одной команды (например,
в корне есть и `test-unit.sh`, и `package.json` с `scripts.test:unit`):

1. Агент собирает все найденные кандидаты
2. Представляет их пользователю через HITL:
   "Найдено N вариантов для `$TEST_COMMAND`:
    (a) `./test-unit.sh`
    (b) `npm run test:unit`
    (c) указать вручную
    (d) пропустить"
3. После выбора пользователя — silent persist в project-context.md
4. Если выбран ручной ввод → Tier 3

---

## Если ничего не найдено

Если ни один артефакт не совпал — агент переходит к Tier 3 (HITL-эскалация):

"Не удалось определить `$TEST_COMMAND`.
(a) указать команду вручную
(b) пропустить с подтверждением (команда не будет выполнена в pipeline)
(c) отмена"

**Важно:** Молчаливый skip тестов/сборки — anti-pattern.
Агент обязан получить явное подтверждение на пропуск (вариант b).
