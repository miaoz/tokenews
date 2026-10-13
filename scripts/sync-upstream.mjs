// Pull the data Tokenews is built from out of the upstream Real API Pricing
// repository, and nothing else. Only the listed paths are fetched (sparse,
// shallow, blobs on demand), copied into upstream/, and pinned in
// upstream.lock.json. The site's code never comes from upstream.
//
//   node scripts/sync-upstream.mjs            # latest upstream main
//   node scripts/sync-upstream.mjs <ref>      # a branch, tag or commit
//
// upstream.lock.json changes only when the synced data does. In GitHub Actions
// the script also writes `changed` and `adapter_changed` outputs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "https://github.com/Fei2411/real-api-pricing";
// Everything the site reads. Keep in step with scripts/lib/build-site-data.mjs,
// web/scripts/build-data.mjs and the OG images in web/scripts/build-pages.mjs.
const PATHS = [
  "LICENSE",
  "config",
  "derived",
  "data/adopted.csv",
  "data/conventions.json",
  "data/i18n",
  "data/research",
  "charts/en/pareto/pareto-aa-intelligence.png",
  "charts/zh/pareto/帕累托_AA智力榜.png",
];
// Upstream's own site-data adapter. Tokenews keeps its copy in scripts/lib;
// a change upstream usually means the data format moved, so it is flagged.
const UPSTREAM_ADAPTER = "scripts/lib/build-site-data.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "upstream");
const lockFile = path.join(root, "upstream.lock.json");
const ref = process.argv[2] ?? "main";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
/** One hash over every synced file (path and content), to tell real data changes from upstream commits that touched nothing we use. */
async function treeHash(dir) {
  const hash = createHash("sha256");
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
  for (const f of files) hash.update(f).update("\0").update(await readFile(path.join(dir, f))).update("\0");
  return hash.digest("hex");
}

const work = await mkdtemp(path.join(tmpdir(), "tokenews-upstream-"));
try {
  git(work, "init", "--quiet");
  git(work, "remote", "add", "origin", REPOSITORY);
  git(work, "config", "core.quotePath", "false");
  git(work, "sparse-checkout", "set", "--no-cone", ...[...PATHS, UPSTREAM_ADAPTER].map((p) => `/${p}`));
  git(work, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", ref);
  git(work, "checkout", "--quiet", "FETCH_HEAD");
  const commit = git(work, "rev-parse", "HEAD");
  const committedAt = git(work, "log", "-1", "--format=%cI");

  for (const p of PATHS)
    if (!existsSync(path.join(work, p))) throw new Error(`Upstream no longer has ${p} at ${commit}`);

  await rm(target, { recursive: true, force: true });
  for (const p of PATHS) await cp(path.join(work, p), path.join(target, p), { recursive: true });

  const previous = existsSync(lockFile) ? JSON.parse(await readFile(lockFile, "utf8")) : null;
  const dataSha256 = await treeHash(target);
  const adapter = await sha256(path.join(work, UPSTREAM_ADAPTER));
  // The baseline is the upstream adapter our copy was last reconciled with;
  // it only moves when someone updates scripts/lib/build-site-data.mjs.
  const adapterBaseline = previous?.adapterBaseline ?? adapter;
  const changed = previous?.dataSha256 !== dataSha256;
  const adapterChanged = adapter !== adapterBaseline;
  // The lock moves only with the data, so upstream commits that touch
  // nothing we use leave the repository untouched.
  if (changed || adapter !== previous?.upstreamAdapter?.sha256)
    await writeFile(
      lockFile,
      JSON.stringify(
        {
          repository: REPOSITORY,
          ref,
          commit,
          committedAt,
          paths: PATHS,
          dataSha256,
          upstreamAdapter: { path: UPSTREAM_ADAPTER, sha256: adapter },
          adapterBaseline,
        },
        null,
        2,
      ) + "\n",
    );

  console.log(`Upstream ${ref} @ ${commit.slice(0, 12)} (${committedAt}): data ${changed ? "changed" : "unchanged"}`);
  if (adapterChanged)
    console.log(
      `::warning::Upstream changed ${UPSTREAM_ADAPTER}; review it against scripts/lib/build-site-data.mjs, then set adapterBaseline to ${adapter}.`,
    );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `commit=${commit}\nchanged=${changed}\nadapter_changed=${adapterChanged}\n`,
    );
} finally {
  await rm(work, { recursive: true, force: true });
}
