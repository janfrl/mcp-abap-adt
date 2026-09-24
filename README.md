# mcp-abap-adt

An MCP server that lets tools like [Claude Desktop](https://claude.com/download), [Claude Code](https://claude.com/claude-code) or [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) read from your SAP ABAP systems through ADT (ABAP Development Tools): program and class sources, table structures and contents, CDS views, packages, where-used lists, syntax and ATC checks, and more. Nothing it does changes repository objects, Customizing or business data.

This is a fork of [mario-andreschak/mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) that adds:

- **Several SAP systems at once** — name them once and pick one per tool call.
- **No passwords in files** — credentials come from the OS keychain, shared with the SAP Fiori tools VS Code extension.
- **Certificate verification on by default**, with the operating system's trust store loaded automatically.

## Contents

1. [Requirements](#1-requirements)
2. [Quick start](#2-quick-start)
3. [Installation](#3-installation)
4. [Configuring SAP systems](#4-configuring-sap-systems)
5. [Credentials](#5-credentials)
6. [Connecting an MCP client](#6-connecting-an-mcp-client)
7. [Available tools](#7-available-tools)
8. [Troubleshooting](#8-troubleshooting)
9. [Further reading](#9-further-reading)

## 1. Requirements

- **Node.js 22.19 or newer.** Get the LTS installer from [nodejs.org](https://nodejs.org/) if you do not have it. To check, open a terminal (PowerShell on Windows, Terminal on macOS) and run `node -v`.
- **An SAP ABAP system reachable over HTTPS** with the ADT services active. Your basis administrator can activate `/sap/bc/adt` in transaction `SICF`. You also need a user with the authorizations to read the objects you ask for.

## 2. Quick start

One path, start to finish, for the common case: one or more systems, the password in the OS keychain, Claude Desktop as the client. Every step has alternatives in the sections below; you do not need them the first time.

**1. Install the server** (in a terminal):

```bash
npm install -g @janfr/mcp-abap-adt
```

**2. Tell it about your systems and store the password.** Run

```bash
mcp-abap-adt setup
```

and paste your systems as JSON when asked (edit the url and client; add more systems the same way), then press Enter:

```json
{
  "systems": {
    "dev": { "url": "https://dev.example.com:44300", "client": "100" }
  }
}
```

It then asks once for username and password. The password goes into the OS keychain (the prompt does not echo it), and the systems go into a user-level settings file that every MCP client on this machine reads — so nothing below needs a path.

If your team keeps the systems in a file, pass it instead of pasting: `mcp-abap-adt setup --from <path or https URL>` ([details](docs/configuration.md#onboarding-a-whole-team-setup---from)). For one system without any JSON, `mcp-abap-adt add` asks for the fields instead.

**3. Connect Claude Desktop.** Settings → Developer → Edit Config, add the entry, save, restart Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "mcp-abap-adt"
    }
  }
}
```

**4. Check.** In the terminal:

```bash
mcp-abap-adt doctor
```

One table per system: where its credentials come from, whether the keychain holds them, whether the host answers. Then ask Claude "which SAP systems do you see?" — it calls `ListSystems` and lists them.

If you already use the **SAP Fiori tools** VS Code extension and saved your systems there, step 2 shrinks to nothing: the server can adopt those systems and their passwords, see [Credentials](#5-credentials).

## 3. Installation

**Recommended: install globally.** The client entry is `"command": "mcp-abap-adt"` and never changes; you decide when to update, with one command:

```bash
npm install -g @janfr/mcp-abap-adt   # run it again later to update to the newest version
```

**Alternative: npx.** `npx -y @janfr/mcp-abap-adt` as the client command needs no installation and fetches the latest version on every start. That convenience means whatever is published under this name runs on your machine unseen, and this server holds your SAP credentials — [the security model](docs/security.md#installing-globally-or-through-npx) explains the trade-off. Pinning a version (`@janfr/mcp-abap-adt@2.5.0`) closes the gap at the cost of editing every client to update.

**From source**, for development:

```bash
git clone https://github.com/janfrl/mcp-abap-adt
cd mcp-abap-adt
npm install
npm run build
```

Then point your client at `node` with the absolute path to `dist/index.js`.

### The command line

In a terminal, `mcp-abap-adt` manages the SAP systems your MCP client uses:

| Command | Purpose |
| --- | --- |
| `setup [--from <path or https URL>]` | Take over a shared systems list, or paste one, and store the password |
| `add [<name>]` | Add one system, asking for whatever is not given as `--url`, `--client`, `--language` |
| `remove <name>` | Remove one system from the user-level settings (`delete` works too) |
| `default [<name>]` | Show or set the system used when a call names none |
| `config [<setting> [<value>]]` | Show the whole configuration, or read, set (`--unset` removes) one setting, e.g. `config importFioriSystems false` |
| `store-credentials --system <name>` | Store a password in the OS keychain; `--all` for every system at once |
| `doctor [--login]` | Check configuration, keychain and reachability; `--login` tries one logon per system |
| `version`, `help` | The installed version; this list |
| `serve` | Run the MCP server by hand; typed without a command, `mcp-abap-adt` shows this list instead |

## 4. Configuring SAP systems

Two routes cover most setups. Both can be combined, and a system's settings can be adjusted from a second route without repeating the whole entry — [docs/configuration.md](docs/configuration.md) has the details, the file-free variants and the precedence rules.

### Config file (any number of systems)

Pass the path with `--config <path>` in the client's `args`. JSON with comments is fine:

```jsonc
{
  // Used when a tool call omits the "system" argument.
  "defaultSystem": "dev",

  // Adopt systems saved by the SAP Fiori tools VS Code extension.
  "importFioriSystems": true,

  "systems": {
    "dev": {
      "url": "https://dev.example.com:44300",
      "client": "100",
      "username": "DEVELOPER",
      "keychain": true
    },
    "qas": {
      "url": "https://qas.example.com:44300",
      "client": "200",
      "username": "DEVELOPER",
      "passwordEnv": "SAP_QAS_PASSWORD"
    },
    "sandbox": {
      "url": "https://vhcalnplci.dummy.nodomain:44300",
      "client": "001",
      "username": "DEVELOPER",
      "keychain": true,
      "allowSelfSigned": true,
      "language": "EN"
    }
  }
}
```

Per-system options:

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | required | Base URL of the system |
| `client` | — | Three digit client. Omitted means the system default client. |
| `language` | — | Logon language |
| `username` | — | SAP user. May also come from the keychain entry. |
| `keychain` | `false` | Read the password from the OS keychain |
| `passwordEnv` | — | Name of an environment variable holding the password |
| `password` | — | Plaintext password. Works, but warns on startup. |
| `allowSelfSigned` | `false` | Accept untrusted certificates for this system |
| `allowFreeSql` | `true` | Allow `ExecuteQuery` to run ad-hoc SELECTs against this system |
| `timeoutMs` | `60000` | Request timeout in milliseconds |
| `authType` | `basic` | Only Basic authentication is implemented |

**Which system is the default?** In order: the `defaultSystem` you declared, then a system named `default` created from the `SAP_*` variables, then the only system if there is exactly one. Otherwise every tool call must name a system, and calls that don't get an error listing the valid names.

### Environment variables (single system)

For one system without any file, set these in your client's `env` block. Together they create one system named `default`:

| Variable | Required | Meaning |
| --- | --- | --- |
| `SAP_URL` | yes | Base URL, e.g. `https://sap.example.com:44300` |
| `SAP_USERNAME` | yes | SAP user |
| `SAP_PASSWORD` | yes | Password |
| `SAP_CLIENT` | yes | Three digit client, e.g. `100` |
| `SAP_LANGUAGE` | no | Logon language, e.g. `EN` |
| `SAP_ALLOW_SELF_SIGNED` | no | Last resort: `true` skips certificate verification. Internal company CAs need nothing - the OS trust store is loaded automatically |
| `SAP_ALLOW_FREE_SQL` | no | `false` forbids ad-hoc SELECTs through `ExecuteQuery` |

Each variable has the same name and meaning as the corresponding config-file key. The password sits in the client's config file with this route, which is what the keychain avoids.

> `TLS_REJECT_UNAUTHORIZED=0` from earlier versions still works and means the same as `SAP_ALLOW_SELF_SIGNED=true`, but it prints a deprecation warning.

### One config for several clients, or a whole team

A user-level `.mcp-abap-adtrc` applies to every MCP client on the machine, and `setup --from <shared file>` turns onboarding a colleague into one command: config written, one password prompt, keychain filled. Both are described in [docs/configuration.md](docs/configuration.md).

### Adding or removing one system

For a single system, `add` asks for the fields one by one — name, URL, client, language — then for username and password, and writes the rc entry and the keychain entry:

```bash
mcp-abap-adt add
mcp-abap-adt add QAS200 --url https://qas.example.com:44300 --client 200   # fields as flags; whatever is missing is asked
mcp-abap-adt remove QAS200
```

`remove` takes the system out of the rc file and leaves the keychain entry alone, since the SAP Fiori tools extension may share it. Systems imported from SAP Fiori tools are managed there. `default <name>` picks the system a call uses when it names none; without a name it shows the current one.

### Adjusting an imported system

A config-file entry whose name matches an imported system is treated as an **override**: you only name what differs, and the imported `url`, `client` and `keychain` settings stay. For example, to pin the logon language of one imported system:

```jsonc
{
  "importFioriSystems": true,
  "systems": {
    // PRD400 keeps its imported url and client; only this one setting changes.
    "PRD400": { "language": "EN" }
  }
}
```

Spelling out `url` turns the entry into a full definition that replaces the imported one. If an override is invalid, the imported system stays usable and `ListSystems` reports that the override was ignored.

## 5. Credentials

The server looks for a password in this order and uses the first one that applies: `password`, then `passwordEnv`, then the keychain.

### OS keychain (recommended)

Credentials live in the Windows Credential Manager, the macOS Keychain or libsecret — never in a file. The entries use the same naming as the SAP Fiori tools VS Code extension (service `fiori/v2/system`, account `<url>[/<client>]`), so the two tools share one entry.

If you already saved a system in **SAP Fiori tools**, you are done: set `"importFioriSystems": true` and the server picks up the system *and* its password. Systems using an authentication type other than basic are skipped with an explanatory message.

It is off by default deliberately: turning it on gives a model read access to every system you have saved, production among them — a decision to make rather than to inherit ([why, in full](docs/security.md#why-importfiorisystems-is-off-by-default)). A server with nothing configured names the systems it could adopt, so the option stays findable.

Otherwise store the password yourself:

```bash
mcp-abap-adt store-credentials --system dev
```

It asks for the username and a password that is not echoed (`--username <user>` skips the first question). An entry that already exists is only replaced after you confirm, because it may be one the Fiori tools extension wrote.

When one password serves several systems — the usual case with a central user administration — rotate them all at once:

```bash
mcp-abap-adt store-credentials --all
```

One password prompt, one summary, one confirmation, and every system with `"keychain": true` gets its entry rewritten (a subset works too: `--systems dev,qas`). Each existing entry keeps its own username, so mixed-user landscapes are fine. Storing never attempts a logon — verify afterwards with `doctor --login`.

### Environment variable

Name the variable in the config and let your MCP client provide it:

```jsonc
{ "systems": { "qas": { "url": "...", "client": "200", "username": "DEVELOPER", "passwordEnv": "SAP_QAS_PASSWORD" } } }
```

On-premise ADT does not accept OAuth tokens, so Basic authentication is the only option; [the security model](docs/security.md#why-not-oauth) explains why, and why the keychain is the right answer to that.

## 6. Connecting an MCP client

All clients follow the same shape: a command to run, optional `args`, and an `env` block for variables. The examples assume the global install; with npx, replace the command with `npx` and put `-y`, `@janfr/mcp-abap-adt` in front of the `args`.

**The examples keep the password out of the client's config**, because a password sitting in a shared or synced JSON file is the thing this fork exists to avoid. They rely on the keychain, filled by SAP Fiori tools or by `store-credentials` — see [Credentials](#5-credentials).

If you use more than one client — say Claude Desktop and Claude Code — put the systems in a [user-level `.mcp-abap-adtrc`](docs/configuration.md) or run `setup --from` once, and keep every client's entry down to the bare command. Then there is one place to change a system rather than one per client.

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "mcp-abap-adt",
      "args": ["--config", "C:/Users/you/mcp-abap-adt.config.jsonc"]
    }
  }
}
```

Restart Claude Desktop afterwards. Leave `args` out if the systems come from an rc file or from SAP Fiori tools; for the latter, add `"env": { "SAP_IMPORT_FIORI_SYSTEMS": "true" }` instead. The entry does not change again when a system is added or a password rotates.

The plaintext alternative, for a throwaway sandbox that is not in the keychain:

```json
"env": {
  "SAP_URL": "https://sap.example.com:44300",
  "SAP_USERNAME": "your_username",
  "SAP_PASSWORD": "your_password",
  "SAP_CLIENT": "100"
}
```

Note where that file lives: Claude Desktop's config is readable by anything running as you, and on a managed machine it may be backed up or synced.

### Claude Code

```bash
claude mcp add --scope user mcp-abap-adt -- mcp-abap-adt --config C:/Users/you/mcp-abap-adt.config.jsonc
```

Keep `--scope user`, which registers the server for every directory; the default `local` ties it to the one you ran the command in. `claude mcp list` shows what the current directory has. To adopt the SAP Fiori tools systems instead of a file, drop the `--config` part and add `--env SAP_IMPORT_FIORI_SYSTEMS=true` before the `--`.

Or commit a `.mcp.json` in your project root. Because that file is shared, reference variables rather than writing secrets into it — Claude Code expands `${VAR}`:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "mcp-abap-adt",
      "args": ["--config", "./mcp-abap-adt.config.jsonc"],
      "env": { "SAP_QAS_PASSWORD": "${SAP_QAS_PASSWORD}" }
    }
  }
}
```

### Cline

Same JSON as for Claude Desktop, in `cline_mcp_settings.json` (VS Code settings → "Cline MCP Settings" → Edit in settings.json).

Since Cline runs inside VS Code, this is where sharing credentials with SAP Fiori tools pays off: save the system once in Fiori tools, then use `"SAP_IMPORT_FIORI_SYSTEMS": "true"` and no file at all.

## 7. Available tools

Every tool below takes an optional **`system`** argument naming a configured system. Omit it to use the default.

| Tool | Description | Arguments |
| --- | --- | --- |
| `ListSystems` | List configured systems, the default, and configuration problems. Returns no credentials. | — |
| `ExecuteQuery` | Run a read-only ABAP SQL SELECT, returned as CSV | `query`, `maxRows` (default 100, max 5000), `timeoutMs` |
| `GetProgram` | ABAP program source | `program_name` |
| `GetClass` | ABAP class source | `class_name` |
| `GetInterface` | ABAP interface source | `interface_name` |
| `GetFunctionGroup` | Function group source | `function_group` |
| `GetFunction` | Function module source | `function_name`, `function_group` |
| `GetInclude` | Include source | `include_name` |
| `GetStructure` | DDIC structure | `structure_name` |
| `GetTable` | Table structure | `table_name` |
| `GetTableContents` | All columns of a table, as CSV | `table_name`, `max_rows` (default 100, max 5000) |
| `GetSystemInfo` | Release and installed software component versions (CVERS) | — |
| `GetPackage` | Package contents | `package_name` |
| `GetTypeInfo` | Domain or data element | `type_name` |
| `GetCDSView` | CDS view (DDL source) | `cds_view_name` |
| `GetTransaction` | Transaction details | `transaction_name` |
| `SearchObject` | Quick search across objects | `query`, `maxResults` (default 100, max 1000) |
| `GetBehaviorDefinition` | RAP behavior definition (needs ~NW 7.54 / S/4HANA) | `behavior_definition_name` |
| `GetServiceDefinition` | RAP service definition (needs ~NW 7.54 / S/4HANA) | `service_definition_name` |
| `CheckSyntax` | Non-activating syntax check of source text you supply | `object_type`, `object_name`, `source` |
| `GetWhereUsed` | Where-used list for a program, class, interface, table, or CDS view | `object_type`, `object_name`, `max_results` (default 100, max 1000) |
| `GetAtcFindings` | ABAP Test Cockpit findings for one object | `object_type`, `object_name`, `check_variant` (default: the system's), `max_findings` (default 100, max 1000) |

Nothing here can write. `ExecuteQuery` accepts a single SELECT in ABAP SQL (no `LIMIT`, use `maxRows`), and every query runs under the SAP authorisations of the configured user, which remains the real boundary on what can be read.

Three tools do more than fetch an object and are worth a closer look in [docs/tools.md](docs/tools.md): `CheckSyntax` checks text you supply, against an object that need not even exist; `GetWhereUsed` filters SAP's answer down to real usages and always names the true total; `GetAtcFindings` runs the system's own ATC check variant and keeps "no findings" strictly apart from "not checked". It is also the one tool that leaves something on the server — an ATC result entry valid for ten days, [explained in the security model](docs/security.md#the-one-tool-that-leaves-something-behind).

## 8. Troubleshooting

**Start with `doctor`.** One table shows every configured system, where its credentials come from, whether the keychain actually holds the entry, and whether the host is reachable — with the usual causes (VPN, internal CA) named next to the failure:

```bash
mcp-abap-adt doctor
```

Reachability is probed without authentication, so running it never touches a failed-logon counter. Add `--login` for exactly one real logon attempt per system when you want the password itself verified. Inside a chat, `ListSystems` answers the configuration half of the same questions.

**The client says the server could not be started** — the client cannot find the `mcp-abap-adt` command. On Windows, Claude Desktop finds globally installed npm commands; if another client does not, use the full path instead: the folder that `npm prefix -g` prints, plus `\mcp-abap-adt.cmd`. Or switch that client to `npx`.

**"TLS certificate verification failed"** — on a company network the certificate is usually fine: the server loads the operating system's trust store automatically, so what your browser trusts, it trusts. `doctor` tells the two cases apart. If the certificate genuinely cannot be validated (a self-signed sandbox), `"allowSelfSigned": true` on that system — or an [override entry](#adjusting-an-imported-system) for an imported one — switches verification off there. Mechanics, older-Node fallback and the opt-out live in [docs/security.md](docs/security.md#tls-and-the-trust-stores).

**"No keychain entry for system ..."** — run `mcp-abap-adt store-credentials --system <name>`, or save the system in SAP Fiori tools. Note that the entry is keyed by URL *and* client, so `https://host` and `https://host/100` are different entries.

**"No answer from system ... within ... ms"** — the request ran out of its time budget. Every request gets 60 seconds by default. For one heavy query, pass `timeoutMs` on the `ExecuteQuery` call (up to 10 minutes) — a model reading the error can retry with it directly. If a system is generally slow, raise `"timeoutMs"` in its configuration entry instead, which applies to every tool.

**"No system was given and no default system is configured"** — you have more than one system and no `defaultSystem`. Either set one or pass `system` in the call.

**SAP returns 401 or 403** — check the user and client, and that the user may use ADT. Some ADT endpoints need `S_DEVELOP` authorizations.

**"The session for system … had expired, and the re-login was rejected"** — the server recovers from an expired ADT session by itself (logging off in SAP GUI kills it, since both share the user's security session): it drops the dead session and retries once with the stored credentials. This message means that retry was rejected too, so the credentials themselves no longer work — the password changed or the user is locked. Update the keychain entry with `store-credentials` or in SAP Fiori tools. The server deliberately never retries more than once, to keep a stale password from locking the user out.

**Nothing works and you want to poke at it directly** — set `MCP_ABAP_ADT_DEBUG=1` to trace every ADT call with status and duration, on stderr and as MCP log notifications; credentials, cookies and query bodies are never logged. Tracing details and how to drive the server with the MCP Inspector: [docs/debugging.md](docs/debugging.md).

## 9. Further reading

- **[Configuration in depth](docs/configuration.md)** — every setting without a file, precedence, the user-level rc file, and team onboarding with `setup --from`.
- **[The tools in detail](docs/tools.md)** — the ABAP SQL dialect, and how the syntax, where-used and ATC tools interpret SAP's answers.
- **[Security model](docs/security.md)** — why this server cannot write, the TLS trust-store mechanics, the install trade-off, OAuth, and how logon attempts are kept away from SAP lock counters.
- **[Debugging](docs/debugging.md)** — tracing every ADT call, and driving the server with the MCP Inspector.
- **[Migrating from mario-andreschak/mcp-abap-adt](docs/migration.md)** — what changes for a 1.x setup, what can break, and the one-line minimum change. All 16 original tools keep their names and arguments.
- **[Contributing](CONTRIBUTING.md)** — the build, test and release commands, and why a few tooling choices are the way they are.

## License

MIT. Originally created by [mario-andreschak](https://github.com/mario-andreschak/mcp-abap-adt).
