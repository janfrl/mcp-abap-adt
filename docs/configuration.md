# Configuration in depth

The README covers the two routes most people need: the four `SAP_*` variables for one system, and a config file for several. This page holds the rest — every setting without a file, how the routes combine, the user-level rc file that serves every MCP client on a machine, and the `setup` command that fills it from a shared team list.

## Any setting without a file

Every setting the config file accepts can also be given on the command line or through the environment:

| | Meaning |
| --- | --- |
| `SAP_IMPORT_FIORI_SYSTEMS` / `--import-fiori-systems` | Adopt the systems saved in SAP Fiori tools |
| `SAP_DEFAULT_SYSTEM` / `--default-system <name>` | Which system a tool call uses when it names none |
| `MCP_ABAP_ADT_CONFIG` / `--config <path>` | Path to a config file |
| `MCP_ABAP_ADT_CONFIG_JSON` / `--config-json '<json>'` | Any setting, including per-system ones |

`MCP_ABAP_ADT_CONFIG_JSON` takes the same object a config file holds, which is what makes nested settings reachable without a file. It is JSON rather than a set of flat variables on purpose: JSON carries its own types, so a `client` of `"100"` stays a string and nothing has to guess whether `010` means the client `010` or the number ten.

Adjusting one imported system, without repeating its url and client:

```json
"env": {
  "SAP_IMPORT_FIORI_SYSTEMS": "true",
  "MCP_ABAP_ADT_CONFIG_JSON": "{\"systems\":{\"PRD400\":{\"language\":\"EN\"}}}"
}
```

A file earns its place once the configuration grows past a line or two — it takes comments and does not need escaping.

## Where the config file is looked up, and which formats work

Point at a file explicitly with `--config <path>` or `MCP_ABAP_ADT_CONFIG`. Without an explicit path, the file is looked up as `mcp-abap-adt.config.*` in the working directory the server is started in — and MCP clients rarely start it where you expect, so an absolute path is the reliable choice. JSON, JSONC, YAML, TOML and `.ts` files all work.

## How the routes combine

Precedence runs command line → environment → config file → rc file. Wherever they overlap, `systems` merges entry by entry rather than replacing the whole set, so one route can adjust a single system and leave the rest alone.

The `SAP_*` variables only ever build the system named `default`; they do not affect imported or config-file systems. An `.env` file is read from two places, the directory the server is started in and the package's own directory, and a variable already set in the real environment wins over any `.env` file.

Ask the model to call **`ListSystems`** at any time to see what the server actually resolved, including each system's `origin` (`config-file`, `fiori-tools` or `environment`) and any configuration problems. It returns no credentials.

## The user-level rc file: `.mcp-abap-adtrc`

Settings in a user-level `.mcp-abap-adtrc` apply to every client on the machine, which is otherwise not possible: a client spawns the server with a filtered environment, so a system-wide `MCP_ABAP_ADT_CONFIG` never reaches it and each client would need its own copy of the settings.

The file lives in `$XDG_CONFIG_HOME` if you have that variable set, otherwise in your home directory. It holds flat `key=value` lines rather than JSON, nesting through dots:

```ini
defaultSystem=dev
importFioriSystems=true
systems.dev.url=https://dev.example.com:44300
systems.dev.client=100
systems.dev.keychain=true
```

Everything else — a config file in the working directory, the environment, the command line — takes precedence over it, in that order.

## One system at a time: `add` and `remove`

`mcp-abap-adt add` asks for name, URL, client and language (any of them can be given as `--name`, `--url`, `--client`, `--language`, or the name as the first argument), validates the entry, writes it into the rc file with `keychain: true`, and then asks once for username and password to fill the keychain entry; `--skip-credentials` leaves that step out. An existing system of the same name is only replaced after confirmation.

`mcp-abap-adt default <name>` sets `defaultSystem` in the rc file after checking that the name is a configured system, imported ones included; without a name it shows the current default and the candidates. `mcp-abap-adt remove <name>` takes the entry out of the rc file. The keychain entry stays, because the SAP Fiori tools extension may share it. Both commands keep the previous rc file as `.bak`. Systems that come from SAP Fiori tools are not in the rc file and are managed in the extension.

## Onboarding a whole team: `setup --from`

Because passwords live in the keychain, the system list itself contains no secrets — so it can be shared. Put a file like this in your team's repository or on a share:

```jsonc
// sap-systems.jsonc - no secrets in here
{
  "defaultSystem": "dev",
  "systems": {
    "dev": { "url": "https://dev.example.com:44300", "client": "100", "keychain": true },
    "qas": { "url": "https://qas.example.com:44300", "client": "200", "keychain": true }
  }
}
```

Then a new team member runs one command, with a local path or an https URL:

```bash
mcp-abap-adt setup --from ./sap-systems.jsonc
mcp-abap-adt setup --from https://raw.githubusercontent.com/your-org/sap-mcp-setup/main/sap-systems.jsonc
```

Without `--from`, `setup` reads the JSON from the terminal: paste it, press Enter, done — it recognises where the object ends, so no end marker is needed. The same works from a pipe (`curl … | mcp-abap-adt setup --skip-credentials`), where the password prompts cannot run, so credentials are stored afterwards with `store-credentials --all`.

A URL is downloaded and then treated exactly like a local file; plain http is refused, since the systems in the file are where passwords get sent. For a file in a private GitHub repository, a token in `GITHUB_TOKEN` or `GH_TOKEN` (the variables the gh CLI uses) is sent along; without one, clone the repository and pass the path. The summary names where the systems came from, so a wrong URL is visible.

It folds the list into the user-level rc file (local settings win; the previous file is kept as `.bak`), asks once for username and password, and stores a keychain entry per system — after which both this server and the SAP Fiori tools extension work. `--skip-credentials` writes only the configuration; `--username <user>` skips the username question.

Details worth knowing when authoring the shared file:

- Only `.json`/`.jsonc` files are accepted and `extends` is refused: a shared file is edited by whoever can push to the team repository, so it must be data, never code.
- System names have to survive the rc file format: letters, digits, `_` or `-`, not digits only, no spaces or dots. `setup` rejects anything else before writing.
- A system that names no credential source gets `"keychain": true` automatically — a shared list exists for per-user credentials — and `setup` says which systems it enabled that way.
- Re-running `setup` after the team list changed is safe: local settings win the merge, and removals do not propagate (deleting a system from the team file does not delete it from anyone's machine).

Who may edit the shared file is a security decision, not housekeeping: the URLs in it are where colleagues' SAP passwords get sent. Keep write access to the file reviewed and small.
