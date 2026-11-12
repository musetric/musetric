# @musetric/checks

Repository checks shared by the Musetric repositories, run from the root of a
repository; each reads the files git tracks and exits with 1 on a finding.

```sh
musetric-checks english   # every letter is in the English alphabet
musetric-checks notices   # every path in a "- Local files:" line of thirdPartyNotices.md exists
musetric-checks links     # every relative link of a markdown page resolves
musetric-checks comments  # no comment or docstring in any language, beyond tool directives
musetric-deps             # no package.json lists dependencies; in a pnpm workspace, every version comes from the catalog
```

`musetric-deps` asks every `package.json` to take what it needs as
`peerDependencies` and `devDependencies`. In a pnpm workspace it also asks
`catalog:` of every external range and override, `workspace:*` of every
workspace range, and of a package the peers of the workspace packages it
depends on.

## Exceptions

A file where another language is part of what it means (multilingual data and
its tests, a copy of a license, third-party code, translated values), a page
whose links are not files of the repository, third-party code that keeps its
comments and a tool that works as installed and so ships its dependencies are
listed under `checks` of the repository's `package.json`, as globs for Node's
`path.matchesGlob`.

```json
{
  "checks": {
    "english": { "except": ["src/transcription/hallucinationFilter.ts"] },
    "links": { "except": ["docs/external/**"] },
    "deps": { "except": ["packages/eslint-config/package.json"] }
  }
}
```

## License

[MIT](https://github.com/musetric/musetric/blob/main/license.md)
