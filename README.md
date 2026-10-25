# Chain Hub Catalog

Curated pointer index for [Chain Hub](https://github.com/martijnbokma/chain-hub). `catalog.json` lists skills, agents and workflows that live in their own upstream repositories; the index never contains asset content.

Chain Hub fetches this file from `https://raw.githubusercontent.com/martijnbokma/chain-hub-catalog/main/catalog.json`, caches it locally and installs entries through its regular git install path. Installed entries stay upstream-owned: fork them in Chain Hub to customize.

## Entry format

```json
{
  "id": "systematic-debugging",
  "kind": "skills",
  "name": "Systematic debugging",
  "description": "Four-phase root-cause debugging.",
  "author": "obra",
  "license": "MIT",
  "category": "code-quality",
  "tags": ["debugging"],
  "source": { "repo": "https://github.com/obra/superpowers", "subdir": "skills/systematic-debugging", "ref": "main" },
  "hasScripts": false
}
```

- `id`: kebab-case, unique in this catalog.
- `kind`: `skills`, `agents` or `workflows`.
- `category`: `code-quality`, `design`, `docs`, `testing`, `devops`, `research`, `writing`, `productivity`, `editor-integration` or `other`.
- `source`: public https git repo, optional `subdir` and `ref` (branch, tag or sha).
- `hasScripts`: `true` when the asset bundles executable scripts. Verified by CI.

See [CONTRIBUTING.md](CONTRIBUTING.md) to submit an entry.
