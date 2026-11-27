import test from "node:test";
import assert from "node:assert/strict";
import {
  diffManifests,
  parseSitemapPaths,
  selectSubmissionPaths,
  submitUrls,
} from "./indexnow.mjs";

test("parseSitemapPaths extracts pathnames from sitemap XML", () => {
  const xml = `<urlset><url><loc>https://tokenews.xyz/</loc></url><url><loc>https://tokenews.xyz/models/o3/</loc></url></urlset>`;
  assert.deepEqual([...parseSitemapPaths(xml)], ["/", "/models/o3/"]);
});

test("diffManifests detects added, modified, and removed pages while ignoring unchanged", () => {
  const live = {
    version: 1,
    pages: { "/": "aaa", "/models/a/": "bbb", "/models/old/": "ccc" },
  };
  const next = {
    version: 1,
    pages: { "/": "aaa", "/models/a/": "ddd", "/models/new/": "eee" },
  };
  assert.deepEqual(diffManifests(next, live), {
    added: ["/models/new/"],
    modified: ["/models/a/"],
    removed: ["/models/old/"],
    initialized: false,
  });
});

test("diffManifests avoids bulk dump on first manifest deploy and only reports new sitemap pages", () => {
  const next = {
    version: 1,
    pages: { "/": "aaa", "/models/a/": "bbb", "/models/brand-new/": "ccc" },
  };
  const liveSitemap = new Set(["/", "/models/a/"]);
  assert.deepEqual(diffManifests(next, null, liveSitemap), {
    added: ["/models/brand-new/"],
    modified: [],
    removed: [],
    initialized: true,
  });
  assert.deepEqual(diffManifests(next, null, new Set()), {
    added: [],
    modified: [],
    removed: [],
    initialized: true,
  });
});

test("selectSubmissionPaths enforces bulk guard and isolates new pages when templates change", () => {
  const small = { added: ["/a/"], modified: ["/b/"], removed: [] };
  assert.deepEqual(selectSubmissionPaths(small, 5), {
    paths: ["/a/", "/b/"],
    skippedBulk: false,
    total: 2,
  });

  const templateBump = {
    added: ["/new-model/"],
    modified: Array.from({ length: 10 }, (_, i) => `/m-${i}/`),
    removed: [],
  };
  assert.deepEqual(selectSubmissionPaths(templateBump, 5), {
    paths: ["/new-model/"],
    skippedBulk: true,
    total: 11,
  });

  const bulkAdd = {
    added: Array.from({ length: 6 }, (_, i) => `/n-${i}/`),
    modified: [],
    removed: [],
  };
  assert.deepEqual(selectSubmissionPaths(bulkAdd, 5), {
    paths: [],
    skippedBulk: true,
    total: 6,
  });
});

test("submitUrls streams single GET requests with pacing delay and stops on 429", async () => {
  const calls = [];
  const delays = [];
  const res = await submitUrls({
    urls: ["https://tokenews.xyz/a/", "https://tokenews.xyz/b/", "https://tokenews.xyz/a/"],
    site: "https://tokenews.xyz/",
    key: "testkey",
    maxUrls: 10,
    delayMs: 100,
    fetchFn: async (url, init) => {
      calls.push({ url, method: init.method });
      return { ok: true, status: 200, text: async () => "" };
    },
    sleepFn: async (ms) => {
      delays.push(ms);
    },
  });
  assert.deepEqual(res, { submitted: 2, rateLimited: false, skippedBulk: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  const u0 = new URL(calls[0].url);
  assert.equal(u0.origin + u0.pathname, "https://api.indexnow.org/indexnow");
  assert.equal(u0.searchParams.get("url"), "https://tokenews.xyz/a/");
  assert.equal(u0.searchParams.get("key"), "testkey");
  assert.equal(u0.searchParams.get("keyLocation"), "https://tokenews.xyz/testkey.txt");
  assert.deepEqual(delays, [100]);

  let count = 0;
  const limited = await submitUrls({
    urls: ["https://tokenews.xyz/1/", "https://tokenews.xyz/2/", "https://tokenews.xyz/3/"],
    site: "https://tokenews.xyz",
    key: "testkey",
    delayMs: 0,
    fetchFn: async () => {
      count++;
      if (count === 2) return { ok: false, status: 429, text: async () => "Too Many Requests" };
      return { ok: true, status: 202, text: async () => "" };
    },
  });
  assert.deepEqual(limited, { submitted: 1, rateLimited: true, skippedBulk: false });

  const refused = await submitUrls({
    urls: ["https://tokenews.xyz/1/", "https://tokenews.xyz/2/"],
    site: "https://tokenews.xyz",
    key: "testkey",
    maxUrls: 1,
    fetchFn: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.deepEqual(refused, { submitted: 0, rateLimited: false, skippedBulk: true });

  await assert.rejects(
    submitUrls({
      urls: ["https://tokenews.xyz/1/"],
      site: "https://tokenews.xyz",
      key: "testkey",
      fetchFn: async () => ({ ok: false, status: 500, text: async () => "boom" }),
    }),
    /IndexNow answered 500/,
  );
});
