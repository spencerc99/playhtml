---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Adds `playhtml.people`, one place to see who's here and what they're doing. `playhtml.people.everyone` is everyone on the page (including you) as `Person` objects, `{ pid, name, color, isMe, presence }`. `people.me` is you: set `me.name` or `me.color` to save and show a new name or color. `people.setMyPresence(key, value)` sets one key of your page presence (`null` clears it), and `people.onChange(keys?, callback)` calls back now and when people join, leave, change their name or color, or change the watched presence keys. Cursor moves are skipped unless you pass `"cursor"`, and each person's cursor is at `person.presence.cursor`. Presence rooms expose the same API at `room.people`.

Elements use the same names. Give an element a `defaultPresence`, then read `everyone` and `me` and call `setMyPresence(value)` (or a mutator, like `setData`) in its callbacks. Handles add `everyone`, `me`, `setMyPresence()`, and `onEveryoneChange(keys?, callback)`, which works before the element exists. In React, `usePeople(keys?)` returns `{ everyone, me, setMyPresence }`, the same object is on `usePlayContext().people`, and `withSharedState` / `<CanPlayElement>` take `defaultPresence` and pass `everyone`, `me`, and `setMyPresence` to render.

Presence views and the presence objects passed to `shouldRenderCursor` / `getCursorStyle` now include `user` (`{ pid, name, color, isMe }`), and `onProximityEntered` receives it as a fourth argument. `user`, `playerIdentity`, `cursor`, and `isMe` are reserved presence keys. The earlier names keep working as deprecated aliases: `playhtml.users`, the `User` type, `playhtml.presence`, `room.presence`, `useUsers`, `usePresence`, `useCursorPresences`, `usePlayerIdentity`, `getMyPlayerIdentity`, `playerIdentity` on views, and the element `live` / `users` / `setLive` and awareness names. Nothing about stored or synced data changes.
