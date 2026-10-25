# @musetric/checks

Repository checks shared by the Musetric repositories, so that each check is
written once. Run one from the root of a repository; it reads the files git
tracks and exits with 1 when it finds something.

```sh
musetric-checks english   # every letter is in the English alphabet
musetric-checks notices   # every path in a "- Local files:" line of thirdPartyNotices.md exists
musetric-checks links     # every relative link of a markdown page resolves
```

## Exceptions

A file where another language is part of what it means, such as multilingual
data and its tests, a copy of a license, third-party code or translated
values, is listed under `checks` in the repository's `package.json`. So is a
page whose links are not files of the repository.

```json
{
  "checks": {
    "english": { "except": ["src/transcription/hallucinationFilter.ts"] },
    "links": { "except": ["docs/external/**"] }
  }
}
```

Entries are globs, matched with `path.matchesGlob` of Node.

## License

[MIT](https://github.com/musetric/musetric/blob/main/license.md)
