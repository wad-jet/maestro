# Step 13 — SDD (Spec-Driven Development)

[Назад к оглавлению](../index.md)

## 🎯 Что делает

Реализация задач плана через субагентов (haiku/sonnet по сложности). Каждая задача проходит обязательный per-task review (sonnet). Progress лог в `.maestro/sdd/progress.md`.

## 📖 Описание

[Детали в разработке]

### Модель выбора

- Haiku: механические tasks (1-2 файла)
- Sonnet: интеграционные tasks (multi-file)
- Opus: ключевые tasks для архитектурных фич

### Fix-loop эскалация

При неконкурентном результате — эскалация на минимум 1 tier выше.

### Regression reconciliation

После реализации сверяются сценарии регрессии с кодом.

## 🔗 Связанные разделы

- [Выбор моделей](../reference/model-selection.md)
