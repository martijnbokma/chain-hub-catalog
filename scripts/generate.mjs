#!/usr/bin/env node
// Regenerates catalog.json from collections.json (upstream repos to index) and
// overrides.json (curated per-entry fields). Zero dependencies: Node >= 20 + git.
// Usage: node scripts/generate.mjs [--src <dir>]  (--src reuses existing clones named owner_repo)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
const config = readJson("collections.json");
const overrides = existsSync(path.join(ROOT, "overrides.json")) ? readJson("overrides.json") : {};
const srcIndex = process.argv.indexOf("--src");
const srcDir = srcIndex > -1 ? process.argv[srcIndex + 1] : null;

const MAX_DESCRIPTION = 300;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCRIPT_EXTENSIONS = new Set([".py", ".sh", ".js", ".mjs", ".cjs", ".ts", ".rb", ".ps1"]);

// Preserve addedAt across regenerations; new entries get today's date.
const previous = existsSync(path.join(ROOT, "catalog.json")) ? readJson("catalog.json") : {};
const addedAtById = new Map((previous.entries ?? []).map((entry) => [entry.id, entry.addedAt]));
const today = new Date().toISOString().slice(0, 10);

/** GitHub stargazers + last push per collection repo (token optional, 60 req/h unauthenticated). */
async function fetchRepoStats(repo) {
  const match = repo.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!match) return null;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "chain-hub-catalog" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetch(`https://api.github.com/repos/${match[1]}`, { headers });
    if (!response.ok) return null;
    const data = await response.json();
    return { stars: data.stargazers_count ?? undefined, pushedAt: data.pushed_at ?? undefined };
  } catch {
    return null;
  }
}
const statsByRepo = new Map();
await Promise.all(
  [...new Set(config.collections.map((collection) => collection.repo))].map(async (repo) => {
    statsByRepo.set(repo, await fetchRepoStats(repo));
  })
);

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]+").replace(/\u0000/g, ".*")}$`);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Minimal YAML frontmatter reader: top-level `key: value`, quoted scalars and `|`/`>` blocks. */
function readFrontmatter(file) {
  const match = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!line) continue;
    let value = line[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      value = block.join(value.startsWith("|") ? "\n" : " ").trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ");
    }
    fields[line[1]] = value;
  }
  return fields;
}

function shorten(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_DESCRIPTION) return clean;
  const cut = clean.slice(0, MAX_DESCRIPTION);
  const sentence = cut.lastIndexOf(". ");
  return sentence > MAX_DESCRIPTION / 2 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const humanize = (id) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function detectLicense(assetDir) {
  const file = readdirSync(assetDir).find((name) => /^licen[cs]e(\.(txt|md))?$/i.test(name));
  if (!file) return null;
  const text = readFileSync(path.join(assetDir, file), "utf8");
  if (/Apache License/i.test(text)) return "Apache-2.0";
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  return "unknown";
}

function categorize(collection, relPath) {
  const subject = relPath.toLowerCase();
  for (const [pattern, category] of [...(collection.categories ?? []), ...(config.categoryKeywords ?? [])]) {
    if (new RegExp(pattern).test(subject)) return category;
  }
  return collection.category ?? "other";
}

function checkout(collection) {
  const slug = collection.repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (srcDir && existsSync(path.join(srcDir, slug.replace("/", "_")))) return { dir: path.join(srcDir, slug.replace("/", "_")), temp: false };
  const dir = mkdtempSync(path.join(tmpdir(), "collection-"));
  execFileSync("git", ["clone", "--quiet", "--depth", "1", ...(collection.ref ? ["--branch", collection.ref] : []), collection.repo, dir], { stdio: "pipe" });
  return { dir, temp: true };
}

const entries = [];
const seen = new Map();
const report = [];
for (const collection of config.collections) {
  const { dir, temp } = checkout(collection);
  const files = walk(dir);
  const counts = { skills: 0, agents: 0, workflows: 0 };
  const skipped = [];
  try {
    for (const rule of collection.include) {
      const pattern = globToRegExp(rule.glob);
      for (const file of files.filter((f) => pattern.test(f)).sort()) {
        const isSkill = rule.kind === "skills";
        const subdir = isSkill ? path.posix.dirname(file) : file;
        const id = isSkill ? path.posix.basename(subdir) : path.posix.basename(file, ".md");
        const where = `${collection.repo}/${file}`;
        if (!ID_PATTERN.test(id) || (collection.exclude ?? []).includes(id)) {
          skipped.push(`${id} (excluded or not kebab-case)`);
          continue;
        }
        if (seen.has(id)) {
          skipped.push(`${id} (already provided by ${seen.get(id)})`);
          continue;
        }
        const assetDir = path.join(dir, path.posix.dirname(file));
        const assetLicense = isSkill ? detectLicense(assetDir) : null;
        if (assetLicense === "unknown" || (assetLicense && assetLicense !== collection.license) || (collection.requireAssetLicense && !assetLicense)) {
          skipped.push(`${id} (license ${assetLicense ?? "missing"} does not match ${collection.license})`);
          continue;
        }
        const meta = readFrontmatter(path.join(dir, file));
        const needsName = rule.kind !== "workflows";
        if (!meta.description || (needsName && !meta.name)) {
          skipped.push(`${id} (frontmatter lacks ${needsName ? "name/description" : "description"})`);
          continue;
        }
        const tagMatch = collection.tagPattern ? file.match(new RegExp(collection.tagPattern)) : null;
        const hasScripts = isSkill && walk(assetDir).some((f) => f.startsWith("scripts/") || SCRIPT_EXTENSIONS.has(path.posix.extname(f)));
        const entry = {
          id,
          kind: rule.kind,
          name: humanize(id),
          description: shorten(meta.description),
          author: collection.author,
          license: collection.license,
          category: categorize(collection, file),
          tags: [...new Set([...(collection.tags ?? []), ...(tagMatch ? [tagMatch[1].replace(/^\d+-/, "")] : [])])],
          source: { repo: collection.repo, subdir, ...(collection.ref ? { ref: collection.ref } : {}) },
          hasScripts,
          addedAt: addedAtById.get(id) ?? today,
          stats: statsByRepo.get(collection.repo) ?? undefined,
          ...overrides[id]
        };
        entries.push(entry);
        seen.set(id, `${collection.repo} (${rule.kind})`);
        counts[rule.kind]++;
        void where;
      }
    }
  } finally {
    if (temp) rmSync(dir, { recursive: true, force: true });
  }
  report.push({ repo: collection.repo, ...counts, skipped });
}

const index = { version: 1, catalog: config.catalog ?? previous.catalog, entries };
writeFileSync(path.join(ROOT, "catalog.json"), `${JSON.stringify(index, null, 2)}\n`);

for (const item of report) {
  console.log(`${item.repo}: ${item.skills} skills, ${item.agents} agents, ${item.workflows} workflows, ${item.skipped.length} skipped`);
  for (const reason of item.skipped) console.log(`  - skipped ${reason}`);
}
console.log(`catalog.json: ${entries.length} entries`);
