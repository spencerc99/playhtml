---
title: "Install with an agent"
description: "Give a coding agent one page to install playhtml, verify the setup, and report a problem."
sidebar:
  order: 2
---

Give this page to a coding agent that can install packages and run local commands. It tells the agent how to add playhtml to an existing project, verify the setup, and report a setup failure.

## Give this to your agent

```text
Install playhtml for me.

Read https://playhtml.fun/docs/agent-setup/ and install playhtml in this project.
Use the package manager already configured in the project. Run the project's normal
build, type-check, or test command after setup.

If you cannot install packages or run local commands in this chat, tell me to use a
command-capable agent such as Claude Code, Codex, Cursor, or another local coding
agent.

If setup fails or you have feedback about playhtml, open
https://github.com/spencerc99/playhtml/issues/new?template=feedback.yml. For setup
problems, include the agent, project stack, package manager, exact command, full
error output, and the changes you tried.
```

## Agent instructions

### Use the project package manager

Check the project for its existing package manager and use it. Do not add a second
lockfile or change package managers for this install.

### Install the public packages

For a vanilla HTML or JavaScript app with a package build:

```bash
npm install playhtml
```

For a React app:

```bash
npm install playhtml @playhtml/react
```

Replace `npm` with the project's package manager when needed. Do not install
`@playhtml/common` in application code.

For a static page without a package build, follow the [getting started guide](/docs/getting-started/) instead.

### Verify the change

Run the project's existing build, type-check, or test command after installing.
Use the command already defined by the project when there is one. If setup still
fails, keep the complete error output for the report.

### Ask before choosing the data model

Before building a custom interactive element, ask whether its state should persist
across reloads and whether everyone should share it. Those answers determine whether
to use shared data, presence, events, or local storage.

## Cannot run commands here?

Use a local, command-capable coding agent. It needs permission to edit the project,
install packages, and run the project's verification command.

## Share feedback

Open the [playhtml feedback form](https://github.com/spencerc99/playhtml/issues/new?template=feedback.yml) to report a problem, suggest a feature, or share general feedback. For setup problems, include the agent and project stack, package manager, exact command, raw error output, and changes already attempted.
