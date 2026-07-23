# @playhtml/extension

## 0.1.20 (2026-07-23)

- Firefox now keeps one reliable browser-session identity without adding warnings to webpage consoles.
- Preserve pending typing sequences when an input loses focus (#262)
- Restored history no longer uploads again, while offline history in imported files stays queued to sync.
- Send bugs, ideas, and other feedback directly from the extension popup.
  ![Feedback button in the extension popup](/changelog/media/feedback-popup-button.png)
  ![Feedback submission confirmation](/changelog/media/feedback-popup-success.png)
- Fix Wikipedia presence startup while keeping private identity keys out of page-facing payloads.
- Return to a site you haven't visited in over a month and a toast welcomes you back, showing how long it's been and a few of your past visit dates.


## 0.1.19 (2026-07-05)

- Restore Wikipedia link patina on pages with absolute article links
- Bug fixes with the keyboard collector (#217)


## 0.1.18 (2026-06-17)

- Reduced background CPU and storage work while collecting browsing activity.
- Stopped hidden inventory development features from observing and writing on every page.
- Preserved pending event uploads when upgrading existing local browsing databases.
- Stored click events sooner to avoid losing them during fast page exits.
- Cursor trails now render as smooth, hand-drawn ink strokes with tapered ends (perfect-freehand)
- Fixed the data collection settings panel to show local storage usage and stored event counts.


## 0.1.17 (2026-06-01)

- Make the Wikipedia jump portal ignore stale page presence so it only sends you to currently active readers.
- Keep Wikipedia chat handle article previews in sync after rerolling or changing your name.


## 0.1.16 (2026-05-29)

- Wikipedia chat: article-name hovercards now stay on-screen near the viewport edge instead of getting cut off. The reroll affordance is a dice icon, and on real article pages a pin-icon button lets you adopt the article you're reading as your name.


## 0.1.15 (2026-05-29)

- Wikipedia chat: a small chat panel on every Wikipedia page lets you talk live with whoever else is reading the same article. Open it from the presence pill or by pressing `/`. You get a random Wikipedia-article name (rerollable); names link to their article and show a hovercard preview on hover. Messages are live-only and never stored.
- Remote cursors now dim when a person's tab is blurred or hidden, so you can tell who's actively present.
- Announcements: important updates now surface as a page toast and a dismissible "from spencer" postcard in the popup, so you don't miss new features.
- Updated the store description to mention the social features (see who's here, Wikipedia chat); added `STORE_LISTING.md` with the full Chrome + Firefox listing copy.


## 0.1.9

### Patch Changes

- Updated dependencies [bdfa16f]
- Updated dependencies [cd467ce]
- Updated dependencies [6b0964f]
- Updated dependencies [8d34468]
  - playhtml@2.9.0
  - @playhtml/common@0.6.0
  - @playhtml/react@0.10.1

## 0.1.8

### Patch Changes

- Updated dependencies [b7fc2e6]
- Updated dependencies [09768d4]
- Updated dependencies [09768d4]
- Updated dependencies [09e380f]
- Updated dependencies [2d16755]
  - playhtml@2.8.0
  - @playhtml/react@0.10.0
  - @playhtml/common@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [90fa88a]
  - playhtml@2.7.0
  - @playhtml/react@0.9.0

## 0.1.6

### Patch Changes

- Updated dependencies [1427a62]
- Updated dependencies [3e385c7]
- Updated dependencies [7cc91bd]
  - playhtml@2.6.0
  - @playhtml/common@0.4.0
  - @playhtml/react@0.8.0

## 0.1.5

### Patch Changes

- Updated dependencies [8580d25]
  - @playhtml/common@0.3.1
  - playhtml@2.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [325bfde]
- Updated dependencies [60666b0]
  - playhtml@2.5.0
  - @playhtml/common@0.3.0
  - @playhtml/react@0.7.0

## 0.1.3

### Patch Changes

- Updated dependencies [162cfe9]
- Updated dependencies [09298ae]
  - @playhtml/common@0.2.1
  - playhtml@2.4.1
  - @playhtml/react@0.6.1

## 0.1.2

### Patch Changes

- Updated dependencies [335af8b]
- Updated dependencies [aa19771]
- Updated dependencies [335af8b]
  - @playhtml/react@0.6.0
  - playhtml@2.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [639c9b3]
  - playhtml@2.3.0
  - @playhtml/common@0.2.0
  - @playhtml/react@0.5.2
