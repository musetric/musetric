# @musetric/checks

Repository checks shared by the Musetric repositories, run from the root of a
repository; each reads the files git tracks and exits with 1 on a finding.

```sh
musetric-checks english   # every letter is in the English alphabet
musetric-checks notices   # every path in a "- Local files:" line of thirdPartyNotices.md exists
musetric-checks links     # every relative link of a markdown page resolves
```

## Exceptions

A file where another language is part of what it means (multilingual data and
its tests, a copy of a license, third-party code, translated values) and a page
whose links are not files of the repository are listed under `checks` of the
repository's `package.json`, as globs for Node's `path.matchesGlob`.

```json
{
  "checks": {
    "english": { "except": ["src/transcription/hallucinationFilter.ts"] },
    "links": { "except": ["docs/external/**"] }
  }
}
```

## License

[MIT](https://github.com/musetric/musetric/blob/main/license.md)
