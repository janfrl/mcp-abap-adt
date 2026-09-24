# Contributing

```bash
npm install
npm run build        # compile to dist/
npm test             # unit tests, no SAP system needed
npm run typecheck
npm run lint         # oxlint, including type-aware rules
npm run lint:fix
npm run fmt          # oxfmt; fmt:check verifies without writing
npm run inspect      # build, then the MCP Inspector web UI
npm run inspect:cli  # same without a browser; examples in the README's Troubleshooting section
```

## Releasing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), because the release is derived from them:

```bash
npm run release          # changelogen: bump, update CHANGELOG.md, commit, tag
git push --follow-tags
npm publish
```

`changelogen --release --clean` refuses to run on a dirty working tree, works out the semver bump from the commits since the last tag, and writes the new section into `CHANGELOG.md`. It does not push, so there is a moment to review the commit and tag before anything leaves the machine.

Publishing happens manually from the maintainer's machine with npm 2FA - deliberately: no long-lived automation token exists whose theft could publish in this package's name. Keep it that way, and keep 2FA on.

`prepublishOnly` runs the build, lint, typecheck, the tests and `npm run check:package` before npm uploads anything. The package check inspects what `npm pack` would ship: only `dist/`, README, LICENSE and package.json may be in it, and none of them may contain credential-looking tokens, private keys, local paths or real e-mail addresses. Patterns that must not appear in this public repository themselves - a company's system ids or hostnames - go into a local file, one regular expression per line, named by `PACKAGE_CHECK_PATTERNS`. CI runs the same check.

changelogen bumps only package.json. `server.json`, the MCP registry manifest, and `package-lock.json` each carry the version twice; scripts/release.mjs syncs both into the same release commit and re-points the tag, because each went stale for several releases while this was left to hand.

The `changelog.types` map in `package.json` hides `test`, `style` and `ci` commits: they cannot change anything for someone installing the package, so they do not belong in its changelog. Breaking changes are collected into their own section regardless of type, from either a `!` marker or a `BREAKING CHANGE:` footer.

Two dependencies are deliberately held back, so a routine "everything to latest" pass does not undo them. `@types/node` tracks the oldest supported Node (the `engines` floor of 22.19) rather than the newest that exists: typing against a newer major would let the compiler accept APIs that are missing at runtime on that floor. `c12` stays on its 3.x line because 4.x is still a prerelease.

The inspector is run through `npx` rather than installed: it pulls in React, Vite and around twenty other packages that CI would otherwise download on every matrix job for a tool CI never uses. The major version is pinned in the script, because the argument order changed between its 1.x and 2.x lines.

The unit tests mock HTTP and the keychain, so they run anywhere. The integration suite talks to a real system and is opt-in:

```bash
RUN_INTEGRATION=1 npm test               # bash
$env:RUN_INTEGRATION='1'; npm test       # PowerShell
```

Set `INTEGRATION_SYSTEM` to target a specific configured system.

