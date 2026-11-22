# Work Trip (web app)

A personal work-trip odometer log. Installable web app (PWA) that writes to a Google Sheet through a small
Google Apps Script endpoint running as you. ODO readings only: no GPS.

- Start a trip by typing the start odometer (prefilled from the last logged finish). End it by typing the finish.
- Trips queue on the phone and sync when online. The sheet de-duplicates by trip ID, so a retry never double-logs.
- Financial-year opening and closing odometer readings live on their own tab with business and private km.

Vehicle: `1HNK143`. Sheet times use `Australia/Perth`.

## Files

| Path | What it is |
|---|---|
| `index.html`, `app.js`, `lib.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icon-*.png` | The app. Static files, no build step. |
| `apps-script/Code.gs`, `appsscript.json` | The endpoint. Pasted into script.google.com. |
| `apps-script/SeedData.gs` | Your cleaned trip history. **Gitignored: it names clients.** Regenerate with `node tools/make-seed.mjs <csv>`. |
| `test/lib.test.js`, `test/mock-server.js` | `npm test` for the logic; `npm run mock` serves the app with a fake endpoint on :8080 (key `testkey`). |

## One-time setup

### 1. Create the endpoint (Google account that will own the sheet)

1. Go to <https://script.google.com> and create a new project.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs`. Add a second script file named `SeedData` and paste `apps-script/SeedData.gs` into it.
3. Project Settings, tick "Show appsscript.json manifest file", and replace it with `apps-script/appsscript.json`.
4. Run `setup` once. Approve the permissions. Google shows an "unverified app" warning for your own script; that is expected.
5. Open Execution log. It prints the **sheet URL** and the **API key**. Keep the key private.
6. Run `seed` once to import the history (safe to repeat; rows are keyed by Trip ID).
7. Deploy, New deployment, type Web app, Execute as **Me**, Who has access **Anyone**. Copy the Web app URL.

"Anyone" only means the URL is reachable. Every request must carry the API key, or it is refused.

### 2. Open the app and connect it

Open this once on your phone, replacing the two values (URL-encode the Web app URL):

```
https://<host>/<path>/#u=<encoded web app URL>&k=<api key>
```

The app stores the details on the phone and clears them from the address bar. You can also enter them under Settings.
Then use the browser menu, Install app (or Add to Home screen).

### 3. Android Auto prompt

A web page cannot detect Android Auto, and Google Assistant routines have no "Android Auto connected" or
car Bluetooth trigger. Options, in order of preference:

1. Pixel: Settings, Modes, Driving. It can start when the phone connects to the car's Bluetooth, but it is
   unconfirmed whether it can also open an app. Check the actions it offers on your phone.
2. An automation app such as MacroDroid or Tasker: trigger "Bluetooth device connected" (the car), action
   "Launch application: Work Trip". This works for wireless Android Auto. For a wired (USB) connection a
   Bluetooth trigger may not fire; use the app's USB or power-connected trigger instead.
3. No automation: keep the home-screen icon where you can reach it. Starting the trip is one tap and one number.

## Known limits

- No GPS. If you forget the finish reading, correct it in the sheet.
- FY reminders on 30 June and 1 July are in-app cards only. Add a recurring calendar reminder for the day itself.
- The first start reading comes from the last cached sync. If you have never synced, type it.
- `Code.gs` has not been run against real Apps Script yet (it cannot be run from here). Expect to fix a first-run error or two.
- Trips logged on another device are only seen after that device syncs.
