# Ограничения docker-serve

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Документированные ограничения `opencode serve` в Docker-контейнере: что
оператор должен понимать и контролировать самостоятельно.

---

## Конфигурация и подстановка

### Scope подстановки `{env:}` и `{file:}`

Substitution переменных окружения и файлов в committed `opencode.json` (репо)
может читать env-секреты и файлы процесса **в обход read-permissions**.

**Scope подстановки** верифицирован на opencode v2.0.32: `{env:VAR}` резолвит
значение переменной процесса, `{file:path}` читает файл по пути.

**Митигации (частичные):**
- (a) API-ключи → credential-store, не env (`{env:}` не читается из credstore)
- (b) GIT_TOKEN → `unset` до старта сервера + fine-grained PAT
- (c) OPENCODE_PASSWORD must stay в env — **residual:** если подстановка
  подтверждена, репо может вынести пароль через `instructions` URL

Пароль охраняет localhost API — принятый residual с документированным blast
radius.

### Требования к оператору

Оператор несёт ответственность за:
- **Фильтрацию секрентов** из репо-конфига (никаких `{env:}` для чувствительных значений)
- **Создание managed-слоя** `/etc/opencode/` с правами на чтение только от root
- **Монтирование volumes** с правильной семантикой (ro/rw, tmpfs для секретов)

---

## Bash-env-access и PAT

### Bash-env-access (residual I5/I6)

Агенты с bash-allow (sonnet, haiku, reviewer) видят весь env процесса
(команда `env`) и `/dev/shm/git-credentials`. Это обход read-permissions.

**Митигации:**
- (a) Минимизировать секреты в env (credential-store вместо env)
- (b) Fine-grained PAT для GIT_TOKEN (scope на одну репо, expiry 30 дней)
- (c) `unset GIT_TOKEN` после записи в tmpfs credential-store

**Residual:** OPENCODE_PASSWORD в env (неизбежно) — blast radius ограничен
localhost API (порт биндится на `127.0.0.1` по умолчанию).

---

## Container-sandbox principle

> Контейнер — **не adversarial-песочница.** Он изолирует конфигурацию,
> но не защищает от вредоносного кода в репозитории.

npm postinstall, make-задачи, репо-скрипты исполняются в контейнере как
uid 1000 с `--cap-drop=ALL`. Это осознанный design: контейнер — boundary
для code-exec из репо.

**Полной изоляции нет:** агент bash может вызвать любую команду
(включая `npm install` на уже установленные пакеты).

**Митигации:**
- Egress-фильтр к `registry.npmjs.org` (только нужные registry)
- Deny plugin/MCP/provider (closed в managed-слое)
- `--pids-limit` (защита от fork-bomb)

---

## `docker exec opencode run` обходит serve-only контракт

> **Команда `docker exec <container> opencode run` обходит serve-only
> контракт `OPENCODE_CONFIG_CONTENT`.**

Env-инъекция `OPENCODE_CONFIG_CONTENT` (модели, providers) действует **только
в serve-режиме**. В CLI-режиме (`opencode run`, `opencode debug` и т.д.)
инъекция игнорируется — модели резоллятся из `{env:}` в committed конфиге
и skeleton-конфига.

**Ограничение:** в контейнере используйте **только** `opencode serve`.
Для отладки — `opencode debug` только если репо-конфиг доверен.

```bash
# ✅ Правильно: serve-режим (OPENCODE_CONFIG_CONTENT действует)
docker exec maestro-<project> opencode serve

# ⚠️ Опасно: CLI-режим (serve-only env-инъекция НЕ действует)
docker exec maestro-<project> opencode run
```

---

## 🔗 Связанные разделы

- [Подключение MCP-серверов](../how-to/docker-mcp.md)
- [Конфигурация](../reference/config.md) — managed-слой и env-переменные
- [Конфиденциальные данные](../reference/config.md#restricted-данные)
