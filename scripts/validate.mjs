#!/usr/bin/env node
// Validates catalog.json: schema (mirrors @chain-hub/contracts catalogIndexSchema),
// unique ids, license allowlist, repo reachability and SKILL.md frontmatter.
// Zero dependencies: Node >= 20 + git on PATH. Usage: node scripts/validate.mjs [--offline]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const KINDS = ["skills", "agents", "workflows"];
const CATEGORIES = ["code-quality", "design", "docs", "testing", "devops", "research", "writing", "productivity", "editor-integration", "other"];
const LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "CC-BY-4.0", "CC0-1.0", "Unlicense"];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_KEYS = new Set(["id", "kind", "name", "description", "author", "license", "category", "tags", "source", "hasScripts"]);
const SOURCE_KEYS = new Set(["repo", "subdir", "ref"]);

const offline = process.argv.includes("--offline");
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

const index = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));

if (index.version !== 1) fail("catalog.json", "version must be 1");
if (!index.catalog || !isNonEmptyString(index.catalog.id) || !isNonEmptyString(index.catalog.name)) {
  fail("catalog.json", "catalog.id and catalog.name are required");
}
if (!Array.isArray(index.entries)) fail("catalog.json", "entries must be an array");

const seen = new Set();
for (const [position, entry] of (index.entries ?? []).entries()) {
  const where = `entries[${position}]${entry?.id ? ` (${entry.id})` : ""}`;
  for (const key of Object.keys(entry ?? {})) if (!ENTRY_KEYS.has(key)) fail(where, `unknown field "${key}"`);
  if (!isNonEmptyString(entry.id) || entry.id.length > 100 || !ID_PATTERN.test(entry.id)) fail(where, "id must be kebab-case (max 100)");
  if (seen.has(entry.id)) fail(where, "duplicate id");
  seen.add(entry.id);
  if (!KINDS.includes(entry.kind)) fail(where, `kind must be one of ${KINDS.join("|")}`);
  if (!isNonEmptyString(entry.name)) fail(where, "name is required");
  if (!isNonEmptyString(entry.description)) fail(where, "description is required");
  if (entry.author !== undefined && !isNonEmptyString(entry.author)) fail(where, "author must be a non-empty string");
  if (entry.license !== undefined && !LICENSES.includes(entry.license)) fail(where, `license must be one of ${LICENSES.join(", ")}`);
  if (entry.category !== undefined && !CATEGORIES.includes(entry.category)) fail(where, `category must be one of ${CATEGORIES.join("|")}`);
  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || !entry.tags.every(isNonEmptyString))) fail(where, "tags must be non-empty strings");
  if (entry.hasScripts !== undefined && typeof entry.hasScripts !== "boolean") fail(where, "hasScripts must be a boolean");
  const source = entry.source;
  if (!source || !isNonEmptyString(source.repo)) {
    fail(where, "source.repo is required");
    continue;
  }
  for (const key of Object.keys(source)) if (!SOURCE_KEYS.has(key)) fail(where, `unknown source field "${key}"`);
  if (!/^https:\/\//.test(source.repo)) fail(where, "source.repo must be an https git URL");
  for (const key of ["subdir", "ref"]) if (source[key] !== undefined && !isNonEmptyString(source[key])) fail(where, `source.${key} must be a non-empty string`);
}

if (!offline && errors.length === 0) {
  const byRepo = new Map();
  for (const entry of index.entries) {
    const key = `${entry.source.repo}#${entry.source.ref ?? ""}`;
    byRepo.set(key, [...(byRepo.get(key) ?? []), entry]);
  }
  for (const [key, entries] of byRepo) {
    const [repo, ref] = key.split("#");
    const dir = mkdtempSync(path.join(tmpdir(), "catalog-"));
    try {
      execFileSync("git", ["clone", "--quiet", "--depth", "1", ...(ref ? ["--branch", ref] : []), repo, dir], { stdio: "pipe" });
      for (const entry of entries) {
        const where = `entry ${entry.id}`;
        const root = path.join(dir, entry.source.subdir ?? "");
        if (!existsSync(root)) {
          fail(where, `subdir not found in ${repo}: ${entry.source.subdir}`);
          continue;
        }
        if (entry.kind === "skills") {
          const skillFile = path.join(root, "SKILL.md");
          if (!existsSync(skillFile)) {
            fail(where, "SKILL.md missing");
            continue;
          }
          const frontmatter = readFileSync(skillFile, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (!frontmatter || !/^name:\s*\S/m.test(frontmatter[1]) || !/^description:\s*\S/m.test(frontmatter[1])) {
            fail(where, "SKILL.md frontmatter needs name and description");
          }
          const scripts = existsSync(path.join(root, "scripts"));
          // Authors may declare scripts outside scripts/ (conservative); an undeclared scripts/ dir always fails.
          if (scripts && !entry.hasScripts) fail(where, "hasScripts must be true: the skill ships a scripts/ directory");
        }
      }
    } catch (error) {
      fail(`repo ${repo}`, `not reachable: ${error.stderr?.toString().trim() || error.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (errors.length > 0) {
  console.error(`catalog.json is invalid:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`catalog.json is valid (${index.entries.length} entries${offline ? ", offline" : ""}).`);
