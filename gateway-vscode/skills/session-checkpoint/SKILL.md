---
name: session-checkpoint
description: Create or update SESSION_CHECKPOINT.md to preserve WebCode session state and continue work across conversations.
---

# Session Checkpoint Skill

## Name

session-checkpoint

## Description

用于保存当前开发会话状态，帮助用户在新的 WebCode 会话中快速恢复工作。

## When to Use

当出现以下情况时建议使用此 Skill：

- 当前独立功能已经完成；
- 即将开始新的大型功能；
- 当前会话上下文较长；
- 用户主动要求保存进度；
- Agent 判断需要重新开始会话。

## Workflow

### Step 1: Read Current Project State

读取当前项目真实状态。

优先使用：

- git status
- git diff
- 当前任务相关文件

不要依赖聊天历史推断代码状态。

### Step 2: Summarize Current State

总结当前状态。

必须包含：

- Current Goal
- Completed Work
- Architecture Decisions
- Changed Files
- Verification
- Known Issues
- Next Step

### Step 3: Generate or Update SESSION_CHECKPOINT.md

生成或更新 SESSION_CHECKPOINT.md。

### Step 4: Report Completion

完成后输出：

- checkpoint 文件路径
- 当前状态摘要
- 建议是否开启新会话

## Rules

- SESSION_CHECKPOINT.md 是项目交接文件，不是聊天记录。
- 只记录当前真实状态。
- 不记录无关讨论。
- 不猜测未验证内容。
- 修改代码前必须确认现状。
