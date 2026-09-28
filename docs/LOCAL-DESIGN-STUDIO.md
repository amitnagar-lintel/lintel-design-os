# Running Design Studio locally

One command starts the complete local stack — PostgreSQL, the API, the Design Studio web app, synthetic
rehearsal data, and per-person login tokens — so you can use it as a real working application in your own
browser. This is a **local rehearsal environment**: the data it loads is synthetic (`LOCAL REHEARSAL ONLY`,
clearly labelled everywhere it appears) and it never touches Supabase staging or production.

---

## 1. Prerequisites (once per machine)

- **Node.js ≥ 22.12** — [nodejs.org](https://nodejs.org) or `brew install node@22`.
- **pnpm 10**, via Node's own Corepack: `corepack enable` (do this once; it makes the `pnpm` command available
  at the version this repo pins).
- **PostgreSQL 16**, running locally. On a Mac with Homebrew:
  ```sh
  brew install postgresql@16
  brew services start postgresql@16
  ```
- **git**, to clone the repository.

You do **not** need Docker, Supabase, or any cloud account — everything above runs entirely on your machine.

## 2. Installation (once per clone)

```sh
git clone <this repository's URL> lintel-design-os
cd lintel-design-os
pnpm install
```

## 3. Start the stack

```sh
pnpm pilot:demo --reset
```

`--reset` drops and recreates the local rehearsal database, so you always start from a clean, known-good
state. This one command:

1. creates/migrates a disposable local database (`lintel_rehearsal`, on your own PostgreSQL — never Supabase);
2. starts the API (`http://127.0.0.1:3000`);
3. onboards a rehearsal organization and nine people (one per role — Sales, Designer, Design Head, Site
   Engineer, Production, Procurement, Costing, Finance, Admin) and writes one access token per person to
   `.pilot/tokens/<ROLE>.txt`;
4. loads and approves the synthetic rehearsal reference data (materials, construction standard, products, …)
   so the full BOM/validation/pricing/drawing pipeline actually resolves;
5. starts the Design Studio web app (`http://127.0.0.1:5173`).

It prints a line per step, then a summary of who to sign in as and where their token is, then waits — leave
the terminal open while you use the app.

**If PostgreSQL needs a password, or a different admin user than `postgres`,** the command will say so
explicitly and tell you to set `PILOT_POSTGRES_URL`, e.g.:
```sh
PILOT_POSTGRES_URL='postgresql://postgres:<your-password>@127.0.0.1:5432/postgres' pnpm pilot:demo --reset
```
If your Homebrew PostgreSQL has no `postgres` role at all (common on a fresh install — Homebrew's own
superuser role is usually your macOS username instead), the simplest one-time fix is:
```sh
createuser -s postgres   # creates a local superuser role named "postgres", same trust as your own login
```
then re-run `pnpm pilot:demo --reset` with no extra environment variables needed.

## 4. Open it in your browser

**`http://127.0.0.1:5173`**

You'll land on **Sign in (LOCAL demo)**. To sign in as a person:
1. Open the token file the terminal printed for them, e.g. `.pilot/tokens/DESIGNER.txt` (`cat
   .pilot/tokens/DESIGNER.txt`, or open it in a text editor).
2. Copy its contents, paste into the **Access token** box, click **Add person**.

You can add several people at once (each token is a separate row under "Signed in") and switch between them
with **Use** — useful since different steps need different roles, e.g.:
- **Sales** (`.pilot/tokens/SALES.txt`) creates the client and the project, and adds the Designer to it
  (`Sales` holds `project.write`).
- **Designer** (`.pilot/tokens/DESIGNER.txt`) creates the room, the design and its version, and does all the
  cabinet work in Design Studio (`Designer` holds `room.survey.write` / `design_version.author`).

From there: **Project → Room (give it a length/width/height, e.g. 4000×3000×2700mm) → Design → Design
Studio.** In Design Studio you can place cabinets from the library onto any wall, edit their dimensions/
position/finish in the Properties panel, view the room in Plan / Elevation / 3D (all kept in sync — selecting
a cabinet in one highlights it in the others), open the Validation tab, and generate a BOM from the BOM tab.

## 5. Stop the server

Press **Ctrl-C** in the terminal running `pnpm pilot:demo`. It stops the API and the web app cleanly. Your
local PostgreSQL server itself keeps running in the background (it's a normal system service) — that's fine
to leave running; stop it separately if you want to (`brew services stop postgresql@16`).

## 6. Reset the demo data

Run the same command again with `--reset`:
```sh
pnpm pilot:demo --reset
```
This drops the local rehearsal database and rebuilds it from scratch — every project/room/design you created
is gone, and the synthetic reference data is freshly loaded and approved. Use this whenever you want a clean
slate (e.g. after experimenting, or if the data looks inconsistent).

To keep your existing local data (projects, rooms, designs you've built) and just restart the servers, run it
**without** `--reset`:
```sh
pnpm pilot:demo
```

## 7. Restart after a crash

If the terminal was closed without Ctrl-C, or something crashed, the API/web processes are usually gone with
it. Just run the start command again:
```sh
pnpm pilot:demo
```
(omit `--reset` to keep your data). If it fails saying a port is already in use (3000 or 5173), a stale
process is still holding it — find and stop it:
```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN   # and :5173
kill <PID>
```
If the database itself seems stuck or inconsistent, `pnpm pilot:demo --reset` rebuilds it from nothing.

## 8. Use it from another device on the same Wi-Fi (optional)

By default the web app only binds to `127.0.0.1` (this machine only). To also reach it from your phone,
tablet, or another computer on the **same trusted Wi-Fi network**:

```sh
PILOT_WEB_HOST=0.0.0.0 pnpm pilot:demo --reset
```

Then find this machine's LAN address (on a Mac: **System Settings → Wi-Fi → Details… → IP Address**, or `ipconfig
getifaddr en0`) and browse to `http://<that-ip>:5173` from the other device. The terminal also prints a
"Network:" URL from Vite itself once it's up.

**What is and isn't exposed:**
- The **web app** (port 5173) becomes reachable on your LAN — that's the point.
- The **API** (port 3000) already listens on all interfaces, but the web app talks to it through its own
  built-in proxy running on this same machine, so nothing else needs to change for it to work from another
  device.
- **PostgreSQL is never exposed** — it only ever accepts connections on `127.0.0.1` (loopback), regardless of
  `PILOT_WEB_HOST`. Nothing in this setup opens the database to the network.

Only do this on a network you trust: anyone on that Wi-Fi who can reach your machine's IP can use the app as
whichever rehearsal person they have (or are given) a token for. It's still synthetic rehearsal data — never
real Lintel or client data — but treat access to it accordingly. Your Mac's firewall may prompt to allow
incoming connections for `node`/`vite` the first time; allow it if you want LAN access, or deny it to keep
this machine-only.

---

## Reference

| What | Where |
|---|---|
| Start command | `pnpm pilot:demo --reset` |
| Web app | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:3000` |
| Login tokens | `.pilot/tokens/<ROLE>.txt` (`ADMIN`, `SALES`, `SITE_ENGINEER`, `DESIGNER`, `DESIGN_HEAD`, `COSTING`, `FINANCE`, `PRODUCTION`, `PROCUREMENT`) |
| Local files (uploads, PDFs) | `.pilot/files/` |
| Stop | Ctrl-C |
| Reset data | `pnpm pilot:demo --reset` |
| Restart, keep data | `pnpm pilot:demo` |
| LAN access | `PILOT_WEB_HOST=0.0.0.0 pnpm pilot:demo --reset` |

`.pilot/` is entirely local, per-machine, git-ignored state — deleting it is always safe (the next
`pnpm pilot:demo --reset` recreates everything it needs).
