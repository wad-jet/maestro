# Pipeline Status Indication

[Назад к оглавлению](../index.md)

## Overview

When the maestro pipeline is active, a status block is injected into the agent's
system prompt showing the current pipeline step. Users can also query status
at any time via the `maestro_pipeline_status` tool.

## System Prompt Block

Format: `## maestro pipeline: active (step X/Y, Description)`

При `active: true` — блок показывает: «пайплайн активен, шаг X/Y, Описание».
Пример: `## maestro pipeline: active (step 7/18.5, Feature Classification)`.

When idle: `## maestro pipeline: idle`

## Tool: maestro_pipeline_status

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `set`, `clear`, or `get` |
| `step` | integer | set | Current step number |
| `totalSteps` | integer/string | set | Total steps (supports `"18.5"` format for pipeline steps 0–18.5) |
| `description` | string | set | Step description |

### Examples

Set: `maestro_pipeline_status(action: "set", step: 7, totalSteps: "18.5", description: "Feature Classification")`

Get: `maestro_pipeline_status(action: "get")`

Clear: `maestro_pipeline_status(action: "clear")`

### Access Control

- `set`/`clear`: only from top-level primary sessions.
- `get`: available from any session.
