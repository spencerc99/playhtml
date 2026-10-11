// ABOUTME: Tests the shared-collage routes: strict upload checks, storage layout, serving and token deletes.
// ABOUTME: Runs the handlers against an in-memory stand-in for the R2 bucket and the rate limiter.

import { describe, expect, it, vi } from "vitest";
import worker from "../index";
import {
  hashDeleteToken,
  matchSharedCollageRoute,
} from "../routes/sharedCollages";
import type { Env } from "../lib/supabase";
import {
  SHARED_COLLAGE_FORMAT,
  SHARED_COLLAGE_LIMITS,
  SHARED_COLLAGE_VERSION,
} from "../../../shared/sharedCollage";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const GIF = new Uint8Array(
  [..."GIF89a"].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0]),
);

interface Stored {
  bytes: Uint8Array;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

function fakeBucket() {
  const objects = new Map<string, Stored>();
  const bucket = {
    objects,
    async put(
      key: string,
      value: Uint8Array | string,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) {
      const bytes =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
      objects.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
        customMetadata: options?.customMetadata,
      });
      return {};
    },
    async get(key: string) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        body: new Response(stored.bytes as Uint8Array<ArrayBuffer>).body,
        httpMetadata: { contentType: stored.contentType },
        customMetadata: stored.customMetadata,
      };
    },
    async head(key: string) {
      const stored = objects.get(key);
      return stored ? { customMetadata: stored.customMetadata } : null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
    async list({ prefix }: { prefix: string }) {
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      };
    },
  };
  return bucket;
}

function makeEnv(options: { allowed?: boolean } = {}) {
  const bucket = fakeBucket();
  const limit = vi.fn(async () => ({ success: options.allowed ?? true }));
  const env = {
    SHARED_COLLAGES: bucket,
    COLLAGE_SHARE_RATE_LIMITER: { limit },
  } as unknown as Env;
  return { env, bucket, limit };
}

function piece(image: string, extra: Record<string, unknown> = {}) {
  return {
    x: 10,
    y: 20,
    width: 200,
    height: 120,
    rotation: -4,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    image,
    source: {
      kind: "image",
      pageUrl: "https://example.com/a/page?q=1",
      pageTitle: "An example page",
      domain: "example.com",
      ts: 1_760_000_000_000,
      faviconUrl: "https://example.com/favicon.ico",
      alt: "a cat",
    },
    ...extra,
  };
}

function collage(
  pieces: unknown[] = [piece("img/0"), piece("img/1", { z: 1 })],
) {
  return {
    format: SHARED_COLLAGE_FORMAT,
    version: SHARED_COLLAGE_VERSION,
    title: "my collage",
    frame: { width: 1500, height: 1000 },
    paper: { color: "#FFFDF9", grain: true },
    pieces,
  };
}

function uploadRequest(
  body: unknown,
  images: Record<string, Uint8Array | string>,
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  form.set("collage", typeof body === "string" ? body : JSON.stringify(body));
  for (const [name, bytes] of Object.entries(images)) {
    form.set(name, new Blob([bytes as BlobPart], { type: "image/png" }), name);
  }
  return new Request("https://worker.test/collages", {
    method: "POST",
    body: form,
    headers: { "CF-Connecting-IP": "203.0.113.9", ...headers },
  });
}

const ctx = {} as ExecutionContext;

async function share(
  env: Env,
  body: unknown = collage(),
  images: Record<string, Uint8Array | string> = { "img/0": PNG, "img/1": GIF },
) {
  return worker.fetch(uploadRequest(body, images), env, ctx);
}

describe("matchSharedCollageRoute", () => {
  it("names the create, collage and picture routes", () => {
    expect(matchSharedCollageRoute("/collages")).toEqual({ kind: "create" });
    expect(matchSharedCollageRoute("/collages/abc")).toEqual({
      kind: "collage",
      id: "abc",
    });
    expect(matchSharedCollageRoute("/collages/abc/img/3")).toEqual({
      kind: "image",
      id: "abc",
      ref: "img/3",
    });
    expect(matchSharedCollageRoute("/collages/abc/other/3")).toBeNull();
    expect(matchSharedCollageRoute("/collage")).toBeNull();
  });
});

describe("POST /collages", () => {
  it("stores the checked collage and its pictures under an unguessable id", async () => {
    const { env, bucket, limit } = makeEnv();
    const res = await share(env);
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      deleteToken: string;
      url: string;
    };
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created.deleteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.url).toBe(`https://wewere.online/collage/?id=${created.id}`);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.9" });

    const keys = [...bucket.objects.keys()].sort();
    expect(keys).toEqual([
      `collages/${created.id}/collage.json`,
      `collages/${created.id}/img/0`,
      `collages/${created.id}/img/1`,
    ]);
    const stored = bucket.objects.get(`collages/${created.id}/collage.json`)!;
    // Only the hash of the delete token is kept.
    expect(stored.customMetadata?.deleteTokenHash).toBe(
      await hashDeleteToken(created.deleteToken),
    );
    expect(new TextDecoder().decode(stored.bytes)).not.toContain(
      created.deleteToken,
    );
    const json = JSON.parse(new TextDecoder().decode(stored.bytes));
    expect(json.paper.color).toBe("#fffdf9");
    expect(typeof json.sharedAt).toBe("number");
    // The type comes from the bytes, not from what the upload claimed.
    expect(
      bucket.objects.get(`collages/${created.id}/img/1`)!.contentType,
    ).toBe("image/gif");
  });

  it("opens links on the configured viewer origin", async () => {
    const { env } = makeEnv();
    (env as { COLLAGE_VIEWER_ORIGIN?: string }).COLLAGE_VIEWER_ORIGIN =
      "http://localhost:5173/";
    const created = (await (await share(env)).json()) as {
      id: string;
      url: string;
    };
    expect(created.url).toBe(`http://localhost:5173/collage/?id=${created.id}`);
  });

  it("drops fields the format does not know before storing", async () => {
    const { env, bucket } = makeEnv();
    const body = { ...collage(), sneaky: "<script>" };
    const created = (await (await share(env, body)).json()) as { id: string };
    const stored = new TextDecoder().decode(
      bucket.objects.get(`collages/${created.id}/collage.json`)!.bytes,
    );
    expect(stored).not.toContain("sneaky");
  });

  it("refuses when rate limited, before reading the body", async () => {
    const { env, bucket } = makeEnv({ allowed: false });
    const res = await share(env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(bucket.objects.size).toBe(0);
  });

  const rejections: [string, () => Request][] = [
    [
      "a JSON body",
      () =>
        new Request("https://worker.test/collages", {
          method: "POST",
          body: JSON.stringify(collage()),
          headers: { "Content-Type": "application/json" },
        }),
    ],
    [
      "a collage part that is not JSON",
      () => uploadRequest("{nope", { "img/0": PNG, "img/1": GIF }),
    ],
    [
      "the wrong format",
      () =>
        uploadRequest(
          { ...collage(), format: "other" },
          { "img/0": PNG, "img/1": GIF },
        ),
    ],
    [
      "a newer version",
      () =>
        uploadRequest(
          { ...collage(), version: 2 },
          { "img/0": PNG, "img/1": GIF },
        ),
    ],
    ["a missing picture", () => uploadRequest(collage(), { "img/0": PNG })],
    [
      "an extra part",
      () =>
        uploadRequest(collage(), { "img/0": PNG, "img/1": GIF, "img/2": PNG }),
    ],
    [
      "a gap in the pictures",
      () =>
        uploadRequest(collage([piece("img/0"), piece("img/2")]), {
          "img/0": PNG,
          "img/2": PNG,
        }),
    ],
    [
      "an svg",
      () =>
        uploadRequest(collage(), {
          "img/0": PNG,
          "img/1":
            '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
        }),
    ],
    [
      "a javascript: page link",
      () =>
        uploadRequest(
          collage([
            piece("img/0", {
              source: {
                ...piece("img/0").source,
                pageUrl: "javascript:alert(1)",
              },
            }),
          ]),
          { "img/0": PNG },
        ),
    ],
    ["no pieces", () => uploadRequest(collage([]), {})],
    [
      "too many pieces",
      () =>
        uploadRequest(
          collage(
            Array.from({ length: SHARED_COLLAGE_LIMITS.maxPieces + 1 }, () =>
              piece("img/0"),
            ),
          ),
          { "img/0": PNG },
        ),
    ],
    [
      "a picture over 5 MB",
      () =>
        uploadRequest(collage([piece("img/0")]), {
          "img/0": new Uint8Array(SHARED_COLLAGE_LIMITS.maxImageBytes + 1)
            .fill(0)
            .map((_, i) => (i < PNG.length ? PNG[i] : 0)),
        }),
    ],
  ];

  for (const [name, build] of rejections) {
    it(`rejects ${name} and stores nothing`, async () => {
      const { env, bucket } = makeEnv();
      const res = await worker.fetch(build(), env, ctx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(
        /^Cannot share this collage/,
      );
      expect(bucket.objects.size).toBe(0);
    });
  }

  it("refuses a declared body over the total cap", async () => {
    const { env, bucket } = makeEnv();
    const request = uploadRequest(collage(), { "img/0": PNG, "img/1": GIF });
    const oversized = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers),
        "Content-Length": String(60 * 1024 * 1024),
      },
    });
    const res = await worker.fetch(oversized, env, ctx);
    expect(res.status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects pictures adding up to more than 40 MB", async () => {
    const { env } = makeEnv();
    const big = new Uint8Array(SHARED_COLLAGE_LIMITS.maxImageBytes - 16);
    big.set(PNG);
    const pieces = Array.from({ length: 9 }, (_, i) => piece(`img/${i}`));
    const images = Object.fromEntries(pieces.map((_, i) => [`img/${i}`, big]));
    const res = await share(env, collage(pieces), images);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("40 MB");
  });
});

describe("GET /collages/<id>", () => {
  it("serves the stored collage and its pictures to anyone", async () => {
    const { env } = makeEnv();
    const { id } = (await (await share(env)).json()) as { id: string };

    const res = await worker.fetch(
      new Request(`https://worker.test/collages/${id}`),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as { title: string; pieces: unknown[] };
    expect(body.title).toBe("my collage");
    expect(body.pieces).toHaveLength(2);

    const image = await worker.fetch(
      new Request(`https://worker.test/collages/${id}/img/1`),
      env,
      ctx,
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/gif");
    expect(image.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(image.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(GIF);
  });

  it("answers 404 for unknown ids, malformed ids and unknown pictures", async () => {
    const { env } = makeEnv();
    const { id } = (await (await share(env)).json()) as { id: string };
    for (const path of [
      "/collages/AAAAAAAAAAAAAAAAAAAAAA",
      "/collages/short",
      `/collages/${id}/img/7`,
      `/collages/${id}/img/01`,
      `/collages/${id}/img/x`,
    ]) {
      const res = await worker.fetch(
        new Request(`https://worker.test${path}`),
        env,
        ctx,
      );
      expect(res.status, path).toBe(404);
    }
  });
});

describe("DELETE /collages/<id>", () => {
  function del(id: string, token?: string) {
    return new Request(`https://worker.test/collages/${id}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  it("removes the collage and every picture with the right token", async () => {
    const { env, bucket } = makeEnv();
    const other = (await (await share(env)).json()) as { id: string };
    const { id, deleteToken } = (await (await share(env)).json()) as {
      id: string;
      deleteToken: string;
    };

    const res = await worker.fetch(del(id, deleteToken), env, ctx);
    expect(res.status).toBe(204);
    expect([...bucket.objects.keys()].some((key) => key.includes(id))).toBe(
      false,
    );
    // Another share is left alone.
    expect(bucket.objects.has(`collages/${other.id}/collage.json`)).toBe(true);

    const gone = await worker.fetch(
      new Request(`https://worker.test/collages/${id}`),
      env,
      ctx,
    );
    expect(gone.status).toBe(404);
  });

  it("refuses a missing or wrong token and keeps the collage", async () => {
    const { env, bucket } = makeEnv();
    const { id } = (await (await share(env)).json()) as { id: string };
    expect((await worker.fetch(del(id), env, ctx)).status).toBe(401);
    expect(
      (await worker.fetch(del(id, "not-the-token"), env, ctx)).status,
    ).toBe(403);
    expect(bucket.objects.has(`collages/${id}/collage.json`)).toBe(true);
  });

  it("answers 404 for a collage already taken down", async () => {
    const { env } = makeEnv();
    const { id, deleteToken } = (await (await share(env)).json()) as {
      id: string;
      deleteToken: string;
    };
    await worker.fetch(del(id, deleteToken), env, ctx);
    expect((await worker.fetch(del(id, deleteToken), env, ctx)).status).toBe(
      404,
    );
  });
});
