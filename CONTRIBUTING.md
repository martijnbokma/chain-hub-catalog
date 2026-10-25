# Contributing

Submit a pull request that adds one entry to `catalog.json`.

Requirements, enforced by `.github/workflows/validate.yml`:

- The schema matches the format in the README; unknown fields are rejected.
- `id` is kebab-case and unique.
- `license` is an OSI/Creative Commons license from the allowlist in `scripts/validate.mjs`.
- `source.repo` is a public https git repository that clones, and `subdir` exists in it.
- Skills have a `SKILL.md` with `name` and `description` in its frontmatter.
- `hasScripts` is `true` when the skill ships a `scripts/` directory or any other executable files.
- Descriptions are in English, one sentence, and describe what the asset does.

Run the checks locally with `node scripts/validate.mjs` (Node 20+ and git required).

Pin `source.ref` to a tag or commit when the upstream repository moves fast.
