# Выбор моделей

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник tier-моделей и их ролей в pipeline скилла `maestro`. Модели
настраиваются пользователем в `.opencode/opencode.json` или global; выбор делает
оркестратор по tier-правилам.

## 📖 Tier → тип задачи

| Tier | Когда использовать | OpenCode сабагент |
|---|---|---|
| **Haiku** (быстрая/дешёвая) | Механические task-и: 1-2 файла, полный spec, трансляция+тесты | `haiku` |
| **Sonnet** (средняя/сбалансированная) | Интеграционные task-и: multi-file, pattern matching, debugging | `sonnet` |
| **Opus** (наиболее мощная) | Архитектура, spec formation, design judgment, final whole-branch review | `custodian` (Q/A по confidential), `opus` (spec review), `code-reviewer` (code review). На Revise `opus` выдаёт правки, применяет оркестратор |
| **Fable** (креативная) | Примеры, метафоры, аналогии, пояснения в стиле историй | `fable` |

## 📖 Шаг → Tier

| Шаг | Tier | OpenCode сабагент |
|---|---|---|
| `spec_formation` (шаг 8) | opus | `custodian` (trusted, Q/A по confidential) |
| `spec_review` (шаг 9, после sanitize) | opus | `opus` |
| `task_reviewer` (шаг 13, per-task) | sonnet | `sonnet` |
| `code_review` (шаг 16) | opus | `code-reviewer` |
| `implementer_mechanical` (шаг 13, 1-2 файла) | haiku | `haiku` |
| `implementer_integration` (шаг 13, multi-file) | sonnet | `sonnet` |
| `explain` (по запросу, примеры/метафоры) | fable | `fable` |
| `security_review` (шаг 8.6, перед untrusted-диспатчем) | своя | `sanitizer` (trusted) |

**Fix-loop эскалация (rounds 4-5):** минимум на tier выше предыдущей попытки.

> ⚠️ Без явного выбора tier сабагент наследует модель сессии (часто самую
> дорогую) — это разрушает экономику tier-выбора. Всегда диспатчить сабагента
> нужного tier'а.

## 📖 Субагенты и их роли

| Сабагент | Файл | Редактирование | Роль |
|---|---|---|---|
| `custodian` | `agents/custodian.md` | read-only (`edit: deny`) | Q/A-брокер по confidential: отвечает primary агрегатами (тип/ограничение/чувствительность/связь) БЕЗ raw-значений (trusted). Spec пишет primary |
| `haiku` | `agents/haiku.md` | edit+bash | Механические задачи, юнит-тесты, bash (git, grep, запуск тестов/сборки) |
| `sonnet` | `agents/sonnet.md` | edit+bash | Интеграционные, multi-file, отладка |
| `opus` | `agents/opus.md` | read-only | Spec Review (ревьюит спецификацию, прошедшую проверку `sanitizer` — Ур.1 плагин + Ур.2 сабагент), security audit, архитектура. На Revise — правки, применяет оркестратор |
| `fable` | `agents/fable.md` | read-only | Примеры, метафоры, пояснения. Диспатчится по запросу (шаг `explain`), не автоматически в pipeline |
| `code-reviewer` | `agents/code-reviewer.md` | bash+read (без edit) | Финальное ревью ветки |
| `sanitizer` | `agents/sanitizer.md` | read-only | Security review — поиск и пометка чувствительных данных |

**Когда использовать `fable`** (по запросу, шаг `explain`):
- объяснить концепцию/паттерн через метафору или аналогию;
- предложить аналогию для нестандартной идеи;
- пояснить сложный абстрактный термин через пример/«историю».

Все субагенты, кроме `code-reviewer`, объявлены `hidden: true`
(вызываются только программно через `task` tool). `task: deny` — субагенты не
диспатчат вложенные под-агенты (один уровень вложенности).

## 💡 Как диспатч работает в OpenCode

Модель жёстко привязана к именованному сабагенту в merge-конфиге
(`agent.{custodian,haiku,sonnet,opus}.model` в `.opencode/opencode.json` или global).
`task` tool не принимает параметр `model` —
оркестратор выбирает **сабагента** по таблице «Шаг → Tier».

```
SDD-шаблон:  Subagent (general-purpose): model: haiku
OpenCode:    task(subagent_type="haiku", prompt="...")
```

## 💡 Настройка моделей через `/maestro-setup`

`/maestro-setup` настраивает модели агентов в `.opencode/opencode.json` или global (M1):

- **Tier (мощность) и Trust (доверие) — ортогональные оси.** Trusted — атрибут
  безопасности, не мощность.
- **Tier:** custodian→opus, opus→opus, code-reviewer→opus, haiku→haiku, sonnet→sonnet,
  fable→fable, **sanitizer→своя**.
- **Trust:** `custodian` и `sanitizer` — trusted (в `maestro.json`); остальные —
  untrusted. `custodian` и `sanitizer` — **разные агенты**, оба trusted. Модели могут
  быть разными, но **одна модель тоже допустима** на усмотрение пользователя
  (например, одна локальная/изолированная для обоих).

> **«Своя модель» (`sanitizer`).** Это **не tier-класс** (не haiku/sonnet/opus/fable),
> а особая категория: индивидуально подобранная модель под security-задачу —
> поиск и маркировка чувствительных данных перед untrusted-диспатчем. Требуемое —
> **точность и надёжность** распознавания, а не мощность рассуждения; по типу
> операции это детерминированная классификация, но модель **не обязана быть
> лёгкой/дешёвой**. По умолчанию `temperature 0.0` (стабильность вывода), поправимо.
> Задаётся в `agent.sanitizer.model` (в `.opencode/opencode.json` или global) по
> общим правилам M1/D2. `sanitizer` trusted (доступ к `docs/confidential/**`) —
> это **доверие**, не мощность.
>
> **Рекомендация (локальная модель).** Для `sanitizer` (и `custodian` — trusted-
> агентов) **рекомендуется** использовать локальную/изолированную модель — она не
> отправляет confidential-данные во внешний провайдер (см. `SECURITY.md` → P4).
> Это **предпочтение, не жёсткое требование**: выбор остаётся за пользователем.
> Допустимо, что одна такая модель обслуживает и `custodian`, и `sanitizer` (см. п.27).
>
> **Enforce P4 через нативные policies (опционально).** Рекомендацию локальной
> модели можно превратить в **enforced**-правило через `experimental.policies`
> (`provider.use`) в merge-config: глобальный deny/allow провайдеров в ядре
> OpenCode. В отличие от merge-конфига `agent.*.model` (не enforced в рантайме),
> policies блокируют использование не-одобренного провайдера на уровне ядра.
> Настраивается в `/maestro-setup` (R5); global-конфиг приоритетнее project.
> Enforce не заменяет выбор `agent.*.model` — он дополняет рекомендацию.

Выбор моделей — **7 отдельных HITL-вопросов** (по одному на агента). Каждый
задаётся через вопросный инструмент (radio) с вариантами: кандидаты моделей
(из D2) + `auto` + «оставить текущую» + «свой вариант» (ручной ввод ID).
Предложение формируется из: текущий `.opencode/opencode.json` (project) → global →
tier-подсказка.
Доступные модели определяются (D2): основной источник — `opencode models <provider>`
(по каждому известному провайдеру, списки объединяются); fallback — `provider.<name>.models`
в merge-конфиге (project → global), затем ручной ввод.

**Temperature** задаётся дефолтом по tier (если у агента нет своего значения),
существующее значение не перезаписывается; записывается вместе с `model`
(не при `auto`):

| Агент | Tier | temperature (дефолт) |
|---|---|---|
| `haiku` | haiku | 0.0 |
| `sonnet` | sonnet | 0.1 |
| `opus` | opus | 0.1 |
| `code-reviewer` | opus | 0.2 |
| `fable` | fable | 0.7 |
| `custodian` | opus | 0.1 |
| `sanitizer` | своя | 0.0 |

> Подробная пошаговая настройка проекта и моделей — в
> [Настройке проекта для maestro](../tutorials/setup-project.md).
>
> **Централизованная настройка (рекомендуется).** Настроить `agent.*`
> (model + temperature) один раз в global-конфиге
> `~/.config/opencode/opencode.json`. Проекты наследуют значения; `/maestro-setup`
> предлагает «оставить из global» первым вариантом. Project `.opencode/opencode.json`
> переопределяет global, если нужен индивидуальный набор.

> **Консультации по настройке моделей/конфигурации:** для вопросов по семантике моделей,
> tier/trust, D2 — используйте `/maestro-assistant` (консультативная точка). M1/D2-воркфлоу
> остаются в `/maestro-setup`.

## 📖 Модели памяти (memory layer) — вне agent-tier

> **Статус: beta.** Memory layer — экспериментальный функционал (опциональный,
> включается явно); модели/данные памяти не гарантируют обратную совместимость
> между версиями. См. [Память maestro (reference)](memory.md).

Опциональный memory layer плагина использует **две модели, не входящие в
tier-схему агентов** (они не настраиваются через `agent.*.model` и не
диспатчатся как сабагенты):

| Ключ (`memory.*`) | Дефолт | Роль |
|---|---|---|
| `embedding_model` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | **Legacy-алиас** для `embedding.model` (только при `provider: local`). Эмбеддинги транскриптов/запросов (transformers.js, dim 384, RU+EN, q8 ~120 МБ, локальный кэш) |
| `embedding.provider` | `local` | Провайдер эмбеддингов: `local` (default) \| `openai` (внешний OpenAI-совместимый API, opt-in) |
| `embedding.model` | `null` | local: имя ONNX-модели (fallback на `embedding_model`); openai: id модели API (обязателен) |
| `embedding.base_url` | `https://api.openai.com/v1` | Базовый URL OpenAI-совместимого API (trailing-slash нормализуется) |
| `embedding.api_key_env` | `null` | Имя env-переменной с ключом (обязателен для `openai`; никогда plaintext) |
| `embedding.dim` | `null` | Размерность векторов (обязателен для `openai`; нативная dim, без Matryoshka; для `local` игнорируется) |
| `summarizer_model` | `null` | Фоновая саммаризация сессий; `null` → модель саммаризируемой сессии |

- **`embedding_model`** — локальная модель эмбеддингов (ONNX, transformers.js).
  Загружается один раз (~120 МБ) и кэшируется; после загрузки работает офлайн.
  **Смена модели требует переиндексации** (вектора несовместимы). Это
  **legacy-алиас** для `embedding.model` (только при `provider: local`).
- **`summarizer_model`** — модель фонового саммаризатора (создаёт служебную
  сессию `[maestro-memory]`, которая удаляется после ответа). `null` (default) —
  используется модель **саммаризируемой сессии** (последнее assistant-сообщение).
  Явная модель полезна, если хочется отделить саммаризацию от рабочих моделей
  (например, дешёвая/быстрая модель для фоновой работы).
- Обе модели **не являются tier-классами** (не haiku/sonnet/opus/fable) и не
  связаны с trust-моделью: саммаризатор работает с **замаскированным**
  транскриптом (см. [Агенты и модель доверия](../explanation/agents-and-trust.md)),
  эмбеддинги — локальные по умолчанию (внешний — opt-in, см. ниже),
  raw-confidential не покидает машину (санизированные
  данные могут храниться/читаться на централизованных бэкендах — решение
  локально/удалённо только через `storage.type`).

### Внешний embedder (opt-in)

Помимо локальной модели, memory layer поддерживает **опциональный внешний
embedder** через любой OpenAI-совместимый `/embeddings` API
(`memory.embedding.provider: "openai"`). Это **осознанный opt-in** — локальный
embedder остаётся дефолтом (privacy/offline-инвариант).

**Плюсы:**
- более высокое качество recall (крупные провайдерские модели сильнее
  MiniLM-384);
- снятие локального бюджета (нет инференса в процессе opencode, нет ~120 МБ
  загрузки);
- гибкость размерности (конфигурируемый `embedding.dim` вместо захардкоженного
  384).

**Риски (документируются):**
- **данные покидают машину** — контент записей и recall-запросы уходят
  генерическому внешнему вендору (маскирование best-effort, см.
  [Агенты и модель доверия](../explanation/agents-and-trust.md));
- **нет offline** — внешний embedder требует сети на каждый вызов;
- **стоимость** — платные API-вызовы на каждый embed;
- `embedding.dim` **обязателен** и должен равняться **нативной** размерности
  модели (без Matryoshka-усечения через параметр `dimensions` — иначе
  dim-mismatch hard-fail);
- ключ — только через `embedding.api_key_env` (имя env-переменной, никогда
  plaintext в `maestro.json`);
- **смена модели/провайдера/URL → переиндексация** (другой `model_id`; миграция
  через `memory_export`/`memory_import` для разных `model_id` не поддерживается).

Подробнее — [Память maestro (reference)](memory.md) и
[Как включить память](../how-to/enable-memory.md).

## 🔗 Связанные разделы

- [Требования и оценка ИБ (SECURITY.md)](../../SECURITY.md) — модель доверия,
  P4 (trusted → изолированная модель)
- [Классификация фич](feature-classification.md)
- [Настройка проекта для maestro](../tutorials/setup-project.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)
