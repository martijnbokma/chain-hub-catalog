# Contributing

`catalog.json` is generated from `collections.json` and `overrides.json`; pull requests should change those, not `catalog.json`.

## Propose a repository

Add one object to `collections` in `collections.json`:

- `repo`: public https git repository; `ref`: branch or tag to index.
- `author` and `license`: the license must be on the allowlist in `scripts/validate.mjs` and cover every indexed asset.
- `include`: one or more `{ "kind": "skills" | "agents" | "workflows", "glob": "..." }`. Skills match a `SKILL.md`; agents and workflows match single `.md` files whose file name becomes the entry id.
- Optional: `category` (default), `categories` (`[regex, category]` rules on the file path), `tags`, `tagPattern` (regex whose first group becomes a tag), `exclude` (ids), `requireAssetLicense` (skip skills without their own matching LICENSE file).

## Adjust an entry

Add or edit the entry id in `overrides.json` to set a better `name`, `description`, `category` or `tags`.

## Checks

Enforced by `.github/workflows/validate.yml` and run by the generator workflow:

- The schema matches the format in the README; unknown fields are rejected; ids are kebab-case and unique.
- Every `source.repo` clones and every `subdir` exists.
- Skills have a `SKILL.md` with `name` and `description`; agents have `name` and `description` frontmatter; workflows have `description`.
- `hasScripts` is `true` when a skill ships a `scripts/` directory (the generator also flags other executable files).

Run them locally with `node scripts/generate.mjs && node scripts/validate.mjs`.
