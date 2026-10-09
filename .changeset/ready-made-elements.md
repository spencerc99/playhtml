---
"playhtml": minor
---

Adds ready-made elements: `<play-lamp>`, `<play-reaction>`, `<play-online-count>`, and `<play-guestbook>`. Once `playhtml.init()` runs, these tags work anywhere on the page with no extra imports or scripts: a lamp anyone can switch on (with `src` and `src-on` for your own lamp images), a reaction button that counts each person once, a live count of people on the page, and a guestbook. They render plain HTML without shadow DOM so site CSS applies directly, and their code only downloads on pages that use one.
