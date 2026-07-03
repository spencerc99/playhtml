---
title: usePlayerIdentity
description: Read the local player's cursor color, participant id, and name.
sidebar:
  order: 3
---

`usePlayerIdentity()` returns the local player's identity from the playhtml
context.

```tsx
import { usePlayerIdentity } from "@playhtml/react";

function Profile() {
  const { color, pid, name } = usePlayerIdentity();
  return <div style={{ color }}>{name ?? "anonymous"}</div>;
}
```

| Field   | Type                  | Notes                                                              |
| ------- | --------------------- | ------------------------------------------------------------------ |
| `color` | `string`              | The player's cursor color.                                         |
| `pid`   | `string \| undefined` | Participant id (ECDSA public key). `undefined` until cursors sync. |
| `name`  | `string \| undefined` | The player's chosen name, if set.                                  |

Values update reactively. When the ["we were online"](https://wewere.online) browser extension is
installed, it injects its identity via the `playhtml:configure-identity`
event, and this hook reflects the extension's color and PID automatically.

Requires a `PlayProvider` with `cursors: { enabled: true }`.
