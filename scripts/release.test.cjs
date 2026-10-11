const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  releaseContext,
  resolveTag,
  planRelease,
  prepareArtifacts,
  verifiedArtifacts,
  publishRelease,
  githubApi,
} = require("./release.cjs");

const SHA = "1".repeat(40);
const OTHER_SHA = "2".repeat(40);
const ENV = {
  GITHUB_REPOSITORY: "linglan111/slice-man",
  GITHUB_REF: "refs/heads/release",
  GITHUB_EVENT_NAME: "push",
  GITHUB_SHA: SHA,
};
const MANIFEST = { version: "0.1.4" };
const LOCK = { version: "0.1.4", packages: { "": { version: "0.1.4" } } };
const CONTEXT = releaseContext(ENV, MANIFEST, LOCK);
const ASSETS = [
  {
    name: "Slice-Man-Setup-0.1.4.exe",
    size: 10,
    digest: `sha256:${"a".repeat(64)}`,
  },
  { name: "SHA256SUMS.txt", size: 90, digest: `sha256:${"b".repeat(64)}` },
];

function fakeGitHub(initial = {}) {
  const state = { tag: null, release: null, assets: [], calls: [], ...initial };
  const api = async (path, options = {}) => {
    state.calls.push({ path, ...options });
    if (path === "/releases/tags/v0.1.4") return state.release;
    if (path === "/git/ref/tags/v0.1.4")
      return state.tag ? { object: { type: "commit", sha: state.tag } } : null;
    if (path === "/git/refs") {
      assert.equal(
        state.tag,
        null,
        "Never recreate or overwrite an existing tag",
      );
      assert.equal(options.json.ref, "refs/tags/v0.1.4");
      state.tag = options.json.sha;
      return {};
    }
    if (path === "/releases") {
      assert.equal(options.json.draft, true);
      assert.equal(options.json.target_commitish, state.tag);
      state.release = {
        ...options.json,
        id: 123,
        html_url: "https://github.com/linglan111/slice-man/releases/tag/v0.1.4",
      };
      return state.release;
    }
    if (path === "/releases/123/assets?per_page=100") return [...state.assets];
    if (options.asset) {
      assert.equal(
        state.release.draft,
        true,
        "Asset upload must occur before publication",
      );
      if (state.failUpload) throw new Error("Simulated upload failure");
      state.assets.push({
        ...options.asset,
        state: "uploaded",
        ...(state.badDigest ? { digest: "sha256:bad" } : {}),
      });
      return {};
    }
    if (path === "/releases/123" && options.method === "PATCH") {
      assert.equal(
        state.assets.length,
        2,
        "Installer and checksum must exist before publication",
      );
      state.release = { ...state.release, ...options.json };
      return state.release;
    }
    throw new Error(`Unexpected mock API request ${path}`);
  };
  return { state, api };
}

test("only the exact release branch in the original repository can publish", () => {
  for (const ref of [
    "refs/heads/main",
    "refs/heads/dev",
    "refs/heads/develop",
    "refs/heads/codex/feature",
    "refs/heads/release-candidate",
    "refs/tags/v0.1.4",
    "refs/pull/1/merge",
  ]) {
    assert.throws(
      () => releaseContext({ ...ENV, GITHUB_REF: ref }, MANIFEST, LOCK),
      /only/,
    );
  }
  for (const event of [
    "pull_request",
    "pull_request_target",
    "release",
    "workflow_run",
    "schedule",
  ]) {
    assert.throws(
      () =>
        releaseContext({ ...ENV, GITHUB_EVENT_NAME: event }, MANIFEST, LOCK),
      /only/,
    );
  }
  assert.throws(
    () =>
      releaseContext(
        { ...ENV, GITHUB_REPOSITORY: "fork/slice-man" },
        MANIFEST,
        LOCK,
      ),
    /only/,
  );
  assert.deepEqual(
    releaseContext(
      { ...ENV, GITHUB_EVENT_NAME: "workflow_dispatch" },
      MANIFEST,
      LOCK,
    ),
    CONTEXT,
  );
});

test("reject malformed SHA, prerelease version, version injection and unsynchronized lockfile", () => {
  assert.throws(
    () => releaseContext({ ...ENV, GITHUB_SHA: "main" }, MANIFEST, LOCK),
    /SHA/,
  );
  for (const version of [
    "01.1.4",
    "0.1.4-beta",
    "0.1.4+build",
    "v0.1.4",
    "0.1.4\nversion=bad",
    "../bad",
  ]) {
    assert.throws(() => releaseContext(ENV, { version }, LOCK), /numeric/);
  }
  assert.throws(
    () => releaseContext(ENV, MANIFEST, { ...LOCK, version: "0.1.3" }),
    /differ/,
  );
  assert.throws(
    () =>
      releaseContext(ENV, MANIFEST, {
        ...LOCK,
        packages: { "": { version: "0.1.3" } },
      }),
    /differ/,
  );
});

test("published version is an idempotent no-op even after subsequent same-version commits", async () => {
  const { api, state } = fakeGitHub({
    tag: OTHER_SHA,
    release: { id: 123, draft: false, prerelease: false },
  });
  assert.equal((await planRelease(api, CONTEXT)).publish, false);
  await publishRelease(api, CONTEXT, ASSETS, "notes");
  assert.ok(
    state.calls.every((call) => !call.method),
    "No mutating API calls for published releases",
  );
});

test("unpublished tag cannot be moved to a different commit", async () => {
  const { api, state } = fakeGitHub({ tag: OTHER_SHA });
  await assert.rejects(planRelease(api, CONTEXT), /another commit/);
  assert.ok(state.calls.every((call) => !call.method));
});

test("resolve annotated tags and reject tags that do not resolve to a commit", async () => {
  const api = async (path) =>
    path.startsWith("/git/ref/")
      ? { object: { type: "tag", sha: OTHER_SHA } }
      : { object: { type: "commit", sha: SHA } };
  assert.equal(await resolveTag(api, "v0.1.4"), SHA);
  await assert.rejects(
    resolveTag(async () => ({ object: { type: "tree", sha: SHA } }), "v0.1.4"),
    /Cannot resolve/,
  );
});

test("tag creation, draft upload, server checksum validation, final publication occur in order", async () => {
  const { api, state } = fakeGitHub();
  await publishRelease(api, CONTEXT, ASSETS, "release notes");
  assert.equal(state.tag, SHA);
  assert.equal(state.release.draft, false);
  assert.equal(state.release.body, "release notes");
  assert.deepEqual(
    state.calls.filter((call) => call.method).map((call) => call.method),
    ["POST", "POST", "POST", "POST", "PATCH"],
  );
});

test("upload failure leaves a draft and never publishes", async () => {
  const { api, state } = fakeGitHub({ failUpload: true });
  await assert.rejects(
    publishRelease(api, CONTEXT, ASSETS, "notes"),
    /upload failure/,
  );
  assert.equal(state.release.draft, true);
  assert.ok(!state.calls.some((call) => call.method === "PATCH"));
});

test("server checksum mismatch blocks publication", async () => {
  const { api, state } = fakeGitHub({ badDigest: true });
  await assert.rejects(
    publishRelease(api, CONTEXT, ASSETS, "notes"),
    /digest verification/,
  );
  assert.equal(state.release.draft, true);
});

test("matching partially uploaded draft resumes without replacing assets", async () => {
  const { api, state } = fakeGitHub({
    tag: SHA,
    release: { id: 123, draft: true },
    assets: [{ ...ASSETS[0], state: "uploaded" }],
  });
  await publishRelease(api, CONTEXT, ASSETS, "notes");
  assert.equal(state.calls.filter((call) => call.asset).length, 1);
  assert.equal(state.release.draft, false);
});

test("different existing draft assets are never overwritten", async () => {
  const { api, state } = fakeGitHub({
    tag: SHA,
    release: { id: 123, draft: true },
    assets: [{ ...ASSETS[0], state: "uploaded", digest: "sha256:different" }],
  });
  await assert.rejects(
    publishRelease(api, CONTEXT, ASSETS, "notes"),
    /not be overwritten/,
  );
  assert.equal(state.release.draft, true);
  assert.ok(!state.calls.some((call) => call.asset || call.method === "PATCH"));
});

test("HTTP failures are not mistaken for an absent release", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const api = githubApi("fake-test-token");
  for (const status of [401, 403, 429, 500]) {
    global.fetch = async () => ({ status, ok: false });
    await assert.rejects(
      api("/releases/tags/v0.1.4", { optional: true }),
      new RegExp(`HTTP ${status}`),
    );
  }
  global.fetch = async () => ({ status: 404, ok: false });
  assert.equal(await api("/releases/tags/v0.1.4", { optional: true }), null);
  await assert.rejects(api("/releases/tags/v0.1.4"), /HTTP 404/);
  global.fetch = async () => {
    throw new Error("Network unavailable");
  };
  await assert.rejects(
    api("/releases/tags/v0.1.4", { optional: true }),
    /Network unavailable/,
  );
});

test("actual installer checksum detects corruption and preparation refuses overwrite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "slice-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "Slice Man Setup 0.1.4.exe"),
    "test installer bytes",
  );
  await prepareArtifacts(CONTEXT, directory);
  const assets = await verifiedArtifacts(CONTEXT, directory);
  assert.equal(assets.length, 2);
  assert.match(
    await readFile(join(directory, "SHA256SUMS.txt"), "utf8"),
    /^[a-f0-9]{64}  Slice-Man-Setup-0\.1\.4\.exe\n$/,
  );
  await assert.rejects(prepareArtifacts(CONTEXT, directory), /EEXIST/);
  await writeFile(
    join(directory, "Slice-Man-Setup-0.1.4.exe"),
    "corrupted bytes",
  );
  await assert.rejects(verifiedArtifacts(CONTEXT, directory), /does not match/);
});
