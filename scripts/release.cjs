const { createHash } = require("node:crypto");
const { createReadStream, constants } = require("node:fs");
const {
  appendFile,
  copyFile,
  readFile,
  stat,
  writeFile,
} = require("node:fs/promises");
const { resolve } = require("node:path");

const REPOSITORY = "linglan111/slice-man";
const API = "https://api.github.com";

function releaseContext(env, manifest, lock) {
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== "refs/heads/release" ||
    !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
  ) {
    throw new Error(
      "Publishing is permitted only from this repository's release branch.",
    );
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "")) {
    throw new Error("A complete tested commit SHA is required.");
  }
  const version = manifest.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || "")) {
    throw new Error(
      "Official releases require a stable numeric major.minor.patch version.",
    );
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error("package.json and package-lock.json versions differ.");
  }
  return { version, tag: `v${version}`, sha: env.GITHUB_SHA };
}

async function resolveTag(api, tag) {
  const ref = await api(`/git/ref/tags/${tag}`, { optional: true });
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; depth < 10; depth += 1) {
    if (object?.type === "commit" && /^[a-f0-9]{40}$/.test(object.sha))
      return object.sha;
    if (object?.type !== "tag" || !/^[a-f0-9]{40}$/.test(object.sha)) break;
    object = (await api(`/git/tags/${object.sha}`)).object;
  }
  throw new Error(`Cannot resolve ${tag} to a commit.`);
}

async function planRelease(api, context) {
  const release = await api(`/releases/tags/${context.tag}`, {
    optional: true,
  });
  if (release && !release.draft) {
    if (release.prerelease)
      throw new Error(
        "This version already has a prerelease; choose a new version.",
      );
    return { publish: false, release };
  }
  const tagSha = await resolveTag(api, context.tag);
  if (tagSha && tagSha !== context.sha) {
    throw new Error(
      `${context.tag} already points to another commit. Choose a new version; tags are never moved.`,
    );
  }
  if (release && !tagSha)
    throw new Error("Existing draft is missing its verified tag.");
  return { publish: true, release, tagSha };
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function artifactNames(context) {
  return [`Slice-Man-Setup-${context.version}.exe`, "SHA256SUMS.txt"];
}

async function prepareArtifacts(context, directory) {
  const [name, checksumName] = artifactNames(context);
  const source = resolve(directory, `Slice Man Setup ${context.version}.exe`);
  const target = resolve(directory, name);
  // Re-running a local build must not replace an installer prepared earlier.
  await copyFile(source, target, constants.COPYFILE_EXCL);
  const checksum = `${await digest(target)}  ${name}\n`;
  await writeFile(resolve(directory, checksumName), checksum, { flag: "wx" });
}

async function verifiedArtifacts(context, directory) {
  const [name, checksumName] = artifactNames(context);
  const installer = resolve(directory, name);
  const checksumFile = resolve(directory, checksumName);
  const checksum = await readFile(checksumFile, "utf8");
  const expected = `${await digest(installer)}  ${name}\n`;
  if (checksum !== expected)
    throw new Error("Installer does not match SHA256SUMS.txt.");
  if ((await stat(installer)).size === 0)
    throw new Error("Installer is empty.");
  return Promise.all(
    [name, checksumName].map(async (assetName) => {
      const file = resolve(directory, assetName);
      return {
        name: assetName,
        file,
        size: (await stat(file)).size,
        digest: `sha256:${await digest(file)}`,
      };
    }),
  );
}

async function publishRelease(api, context, assets, notes) {
  const plan = await planRelease(api, context);
  if (!plan.publish) return plan.release;
  if (!plan.tagSha) {
    await api("/git/refs", {
      method: "POST",
      json: { ref: `refs/tags/${context.tag}`, sha: context.sha },
    });
  }
  const release =
    plan.release ||
    (await api("/releases", {
      method: "POST",
      json: {
        tag_name: context.tag,
        target_commitish: context.sha,
        name: `Slice Man ${context.tag}`,
        draft: true,
        prerelease: false,
        body: notes,
      },
    }));
  const currentAssets = await api(
    `/releases/${release.id}/assets?per_page=100`,
  );
  for (const asset of assets) {
    const existing = currentAssets.find(
      (candidate) => candidate.name === asset.name,
    );
    if (existing) {
      if (
        existing.state !== "uploaded" ||
        existing.size !== asset.size ||
        existing.digest !== asset.digest
      ) {
        throw new Error(
          `Draft asset ${asset.name} differs from the tested build; it will not be overwritten.`,
        );
      }
      continue;
    }
    await api(
      `/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
      {
        method: "POST",
        asset,
      },
    );
  }
  const uploaded = await api(`/releases/${release.id}/assets?per_page=100`);
  for (const asset of assets) {
    if (
      !uploaded.some(
        (candidate) =>
          candidate.name === asset.name &&
          candidate.state === "uploaded" &&
          candidate.size === asset.size &&
          candidate.digest === asset.digest,
      )
    ) {
      throw new Error(
        `Uploaded ${asset.name} failed server-side digest verification; release remains a draft.`,
      );
    }
  }
  // A failed upload never exposes a release with missing installer/checksum assets.
  return api(`/releases/${release.id}`, {
    method: "PATCH",
    json: { draft: false, prerelease: false, make_latest: "true" },
  });
}

function githubApi(token) {
  if (!token) throw new Error("GH_TOKEN is required for release API access.");
  return async (path, options = {}) => {
    const isUpload = Boolean(options.asset);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    let body;
    if (isUpload) {
      headers["Content-Type"] = "application/octet-stream";
      headers["Content-Length"] = String(options.asset.size);
      body = createReadStream(options.asset.file);
    } else if (options.json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    const response = await fetch(
      `${isUpload ? "https://uploads.github.com" : API}/repos/${REPOSITORY}${path}`,
      {
        method: options.method || "GET",
        headers,
        body,
        ...(isUpload ? { duplex: "half" } : {}),
        signal: AbortSignal.timeout(isUpload ? 10 * 60_000 : 60_000),
      },
    );
    if (response.status === 404 && options.optional) return null;
    if (!response.ok)
      throw new Error(
        `GitHub API ${options.method || "GET"} ${path}: HTTP ${response.status}`,
      );
    return response.status === 204 ? null : response.json();
  };
}

async function main() {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const context = releaseContext(process.env, manifest, lock);
  const command = process.argv[2];
  const directory = resolve("dist/release");
  if (command === "artifacts") {
    await prepareArtifacts(context, directory);
    console.log(`Prepared ${context.tag} installer and SHA-256 manifest.`);
    return;
  }
  const api = githubApi(process.env.GH_TOKEN);
  if (command === "plan") {
    const plan = await planRelease(api, context);
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("GITHUB_OUTPUT is required.");
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `publish=${plan.publish}\nversion=${context.version}\n`,
    );
    console.log(
      plan.publish
        ? `Building ${context.tag} at ${context.sha}.`
        : `${context.tag} is already published; leaving it unchanged.`,
    );
    return;
  }
  if (command === "publish") {
    const assets = await verifiedArtifacts(context, directory);
    let notes;
    try {
      notes = await readFile(`docs/releases/${context.tag}.md`, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      notes = (
        await api("/releases/generate-notes", {
          method: "POST",
          json: { tag_name: context.tag, target_commitish: context.sha },
        })
      ).body;
    }
    const release = await publishRelease(api, context, assets, notes);
    console.log(`Published release: ${release.html_url}`);
    return;
  }
  throw new Error("Use release.cjs plan, artifacts, or publish.");
}

module.exports = {
  releaseContext,
  resolveTag,
  planRelease,
  prepareArtifacts,
  verifiedArtifacts,
  publishRelease,
  githubApi,
};
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
