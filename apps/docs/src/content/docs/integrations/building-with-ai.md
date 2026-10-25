---
title: "Building with AI"
description: "Give any coding agent (Claude, Codex, Cursor, Copilot, ChatGPT) the playhtml context it needs in one step."
sidebar:
  order: 1
---

playhtml keeps a single guide for coding agents at **[playhtml.fun/docs/llms.txt](/docs/llms.txt)**. It covers the APIs, which kind of data to use, and the mistakes that silently break sync. Pick whichever way of handing it over fits your tool.

## Paste one line

Works with any agent or chat that can open links, including Claude, ChatGPT, Codex, Cursor, and Copilot. Start your request with:

```text
Read https://playhtml.fun/docs/llms.txt first, then help me build a playhtml element that...
```

If your assistant can't browse, open [llms.txt](/docs/llms.txt) yourself and paste its contents into the chat instead.

## Install it as a skill

To have your agent pick up the guide on its own every time, install it as a skill. One command works across Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, and other agents that support [skills](https://skills.sh):

```bash
npx skills add spencerc99/playhtml --skill building-playhtml-elements
```

The installer asks which agents to set up. After that, just describe the element you want.

Claude Code users can also install it as a plugin:

```bash
claude plugin marketplace add spencerc99/playhtml
claude plugin install playhtml@playhtml
```

## Describe what you want

Whichever setup you use, the agent will ask before guessing about these three things, so mentioning them up front saves a round trip:

- What people see and do with the element.
- Whether everyone shares the same state, or each person has their own.
- Whether the state should **persist** across reloads, last only while people are **online**, or fire once as an **event** (like a confetti burst).

For example: _"A draggable sticky note in vanilla HTML. Anyone can drag it and everyone sees it move. Its position should stay after reload."_

For the hand-written setup, see [getting started](/docs/getting-started/).
