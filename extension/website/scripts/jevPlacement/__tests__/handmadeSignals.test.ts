// ABOUTME: Tests the handmade-web detectors against small snippets of real-shaped
// ABOUTME: HTML, covering both the handmade markers and the commercial apparatus.

import { describe, expect, it } from "vitest";

import {
  countAdTrackers,
  detectHandmadeSignals,
  handmadeScore,
  hasBadge88x31,
  hasCheckout,
  hasCookieBanner,
  hasFeed,
  hasGuestbook,
  hasRelMe,
  hasWebring,
  signalNames,
} from "../handmadeSignals";

describe("hasBadge88x31", () => {
  it("finds a badge by its width and height attributes", () => {
    expect(
      hasBadge88x31('<img src="/buttons/friend.gif" width="88" height="31">'),
    ).toBe(true);
  });

  it("finds a badge by its filename", () => {
    expect(hasBadge88x31('<img src="/img/button-88x31.png">')).toBe(true);
  });

  it("finds a badge sized in an inline style", () => {
    expect(
      hasBadge88x31('<img src="/b.gif" style="width: 88px; height: 31px">'),
    ).toBe(true);
  });

  it("ignores an ordinary image", () => {
    expect(hasBadge88x31('<img src="/photo.jpg" width="640" height="480">')).toBe(
      false,
    );
  });
});

describe("hasWebring", () => {
  it("finds an explicit webring link", () => {
    expect(
      hasWebring('<a href="https://webring.example/next">next site</a>'),
    ).toBe(true);
  });

  it("finds a known webring host", () => {
    expect(hasWebring('<a href="https://nekoweb.org/ring">ring</a>')).toBe(true);
  });

  it("finds classic prev/next ring navigation", () => {
    expect(
      hasWebring(
        '<div class="ring"><a href="/p">Previous</a><a href="/n">Next</a></div>',
      ),
    ).toBe(true);
  });

  it("ignores a page that merely mentions next", () => {
    expect(hasWebring("<p>Read the next chapter tomorrow.</p>")).toBe(false);
  });
});

describe("hasGuestbook", () => {
  it("finds a guestbook link", () => {
    expect(hasGuestbook('<a href="/guestbook">sign my guestbook</a>')).toBe(
      true,
    );
  });

  it("ignores an unrelated page", () => {
    expect(hasGuestbook("<p>a book about guests</p>")).toBe(false);
  });
});

describe("hasFeed", () => {
  it("finds an RSS link element", () => {
    expect(
      hasFeed('<link rel="alternate" type="application/rss+xml" href="/rss">'),
    ).toBe(true);
  });

  it("finds an Atom feed by its href", () => {
    expect(hasFeed('<a href="/atom.xml">subscribe</a>')).toBe(true);
  });

  it("ignores a page with no feed", () => {
    expect(hasFeed('<link rel="stylesheet" href="/style.css">')).toBe(false);
  });
});

describe("hasRelMe", () => {
  it("finds a rel=me identity link", () => {
    expect(hasRelMe('<a rel="me" href="https://social.example/@person">me</a>')).toBe(
      true,
    );
  });

  it("ignores rel=nofollow", () => {
    expect(hasRelMe('<a rel="nofollow" href="/x">x</a>')).toBe(false);
  });
});

describe("countAdTrackers", () => {
  it("counts distinct analytics vendors", () => {
    const html = `
      <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
      <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
    `;
    expect(countAdTrackers(html)).toBe(2);
  });

  it("counts a vendor named only in an inline snippet", () => {
    expect(
      countAdTrackers(
        "<script>window.ga=function(){};/* google-analytics.com */</script>",
      ),
    ).toBe(1);
  });

  it("finds none on a plain handmade page", () => {
    expect(countAdTrackers('<script src="/js/sparkle.js"></script>')).toBe(0);
  });
});

describe("hasCookieBanner", () => {
  it("finds a consent notice", () => {
    expect(hasCookieBanner("<div>We use cookies to improve your experience</div>")).toBe(
      true,
    );
  });

  it("ignores a page about baking", () => {
    expect(hasCookieBanner("<p>Oatmeal cookies recipe</p>")).toBe(false);
  });
});

describe("hasCheckout", () => {
  it("finds an add-to-cart control", () => {
    expect(hasCheckout("<button>Add to cart</button>")).toBe(true);
  });

  it("finds a checkout link", () => {
    expect(hasCheckout('<a href="/checkout">pay</a>')).toBe(true);
  });

  it("ignores a page with no commerce", () => {
    expect(hasCheckout("<p>a cart horse</p>")).toBe(false);
  });
});

describe("detectHandmadeSignals and scoring", () => {
  const handmadePage = `
    <html><head>
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
    </head><body>
      <a rel="me" href="https://social.example/@person">elsewhere</a>
      <a href="/guestbook">sign my guestbook</a>
      <a href="https://webring.example/next"><img src="/88x31.gif" width="88" height="31"></a>
    </body></html>
  `;

  const commercialPage = `
    <html><head>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
    </head><body>
      <div>We use cookies to improve your experience</div>
      <button>Add to cart</button>
    </body></html>
  `;

  it("reads every handmade marker on a personal page", () => {
    const signals = detectHandmadeSignals(handmadePage);

    expect(signals).toMatchObject({
      badge88x31: true,
      webring: true,
      guestbook: true,
      feed: true,
      relMe: true,
      adTrackerCount: 0,
      checkout: false,
    });
    expect(handmadeScore(signals)).toBe(8);
  });

  it("scores a commercial page below zero", () => {
    const signals = detectHandmadeSignals(commercialPage);

    expect(signals.adTrackerCount).toBeGreaterThan(0);
    expect(signals.cookieBanner).toBe(true);
    expect(signals.checkout).toBe(true);
    expect(handmadeScore(signals)).toBeLessThan(0);
  });

  it("names the signals it found without numbers", () => {
    expect(signalNames(detectHandmadeSignals(handmadePage))).toEqual([
      "88x31_badge",
      "webring",
      "guestbook",
      "rss_or_atom_feed",
      "rel_me_link",
    ]);
  });

  it("finds nothing in an empty document", () => {
    const signals = detectHandmadeSignals("<html><body></body></html>");

    expect(handmadeScore(signals)).toBe(0);
    expect(signalNames(signals)).toEqual([]);
  });
});
