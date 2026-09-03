# Управление конфиденциальными путями (confidential paths)

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как добавить/изменить путь к конфиденциальным данным в конфигурации maestro и
поддержать согласованность нативного слоя OpenCode. Добавление пути — усиление
защиты и выполняется консервативно; удаление/ослабление — жёсткий блок.

## 📖 Предпосылки

- Конфигурация maestro: `/maestro-assistant` (канон в `skills/maestro-assistant/SKILL.md`).
- Двойной источник (I3): путь зеркалируется в `maestro.json` (плагин) И в нативные
  permissions OpenCode (`.opencode/opencode.json`).

## 📖 Пошаговая инструкция — добавить confidential-путь

1. Запросите `/maestro-assistant «добавить путь <path> к confidential»`.
2. Ассистент прочитает текущие конфиги и сформирует diff-merge (идемпотентно, с
   сохранением пользовательских правок).
3. Покажет адресный diff «стало vs было» по `confidential.paths` и HITL-гейт:
   (a) approve — (b) правки — (c) отмена.
4. При approve — запишет ИЗМЕНЕНИЯ В ОБА МЕСТА (I3):
   - `maestro.json → confidential.paths` (плагин);
   - нативные `permission.read`/`edit` deny в `.opencode/opencode.json`
     (и per-agent allow `custodian`/`sanitizer`, если trusted должен читать новый путь).
5. **OP-1:** перезапустите opencode — конфиг `maestro.json` читается один раз при старте.

## 💡 Примеры масок

- Папка: `docs/confidential/**` — закрывает корень, поддиректории и файлы.
- Файл по имени: `maestro.json`, `app.pem`.
- Маска без `/` (напр. `*.env`) — ТОЛЬКО корневые файлы; для вложенных нужен
  `config/*.env` или `**/*.env`.

## ⚠️ Чего делать НЕ надо

- НЕ добавлять `docs/superpowers/specs/**` и `docs/superpowers/plans/**` в paths —
  они двухролевые (уничтожат доступ untrusted-субагентов к spec/plan).
- НЕ снимать пути без явного HITL-запроса и отдельного approve (жёсткий блок).
- НЕ менять существующие пути без HITL-гейта (merge — только дополнение).

## 🔗 Связанные разделы

- [Конфигурация](../reference/config.md) — секция `confidential`
- [Агенты и модель доверия](../explanation/agents-and-trust.md)
- [Кастомизация скилла](customize-maestro.md)
