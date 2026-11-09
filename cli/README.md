# edgebeat

Install and update [Edgebeat](https://github.com/edgebeat-dev/edgebeat), an open-source uptime monitor that runs on one Cloudflare Worker.

## Usage

```sh
bunx edgebeat setup      # install
bunx edgebeat update     # update an existing install
bunx edgebeat help
bunx edgebeat --version
```

`npx edgebeat ...` works too (Node 20+).

Setup asks for a Cloudflare API token (input is hidden), picks your account, optionally asks for an admin password (leave empty to generate one), then prints a checklist and the result:

```
✓ Database
✓ Script
...
Status page: https://edgebeat.<you>.workers.dev/
Admin:       https://edgebeat.<you>.workers.dev/admin
Admin password (shown once): ...
```

## Flags

| Flag | Meaning |
|------|---------|
| `--api-token <token>` | API token. Falls back to `CLOUDFLARE_API_TOKEN`, then an interactive prompt. |
| `--account <id>` | Account id. Auto-picked when you have one account, asked when you have several. |
| `--name <name>` | Worker and database name (default `edgebeat`, `^[a-z0-9-]{1,63}$`). |
| `--admin-password <p>` | Admin password, at least 12 characters and not `change-me`. Generated when omitted. |
| `--subdomain <s>` | workers.dev subdomain, used only when the account has none. |
| `--yes` | Non-interactive: never asks. Needs the token and, with several accounts, `--account`. |

Exit codes: `0` success, `1` install error, `2` usage error.

## API token permissions

Create a token at https://dash.cloudflare.com/profile/api-tokens with:

- Account · Workers Scripts · Edit
- Account · D1 · Edit
- Account · Account Settings · Read

The token is only used for the run. It is never written to disk or printed.

## What gets created

- A D1 database named like the Worker.
- A Worker (default `edgebeat`) with the bundled code, static assets and a one-minute cron trigger.
- Two Worker secrets, set only when absent: `ENCRYPTION_KEY` and `ADMIN_PASSWORD`.
- Your `workers.dev` subdomain, if the account has none yet.

Re-running `setup` after an interrupted run resumes where it stopped and keeps existing secrets.

## Updating

`edgebeat update` uploads the new code and applies pending database migrations only. Secrets and data are left untouched.

Installs managed by a git repository (Deploy to Cloudflare button, manual deploy) cannot be updated here: pull upstream and redeploy instead.
