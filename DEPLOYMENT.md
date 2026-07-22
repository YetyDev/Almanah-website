# Deployment: Render + Google Sheets

The app runs as a free Render web service. All data (donations, contact
messages, newsletter signups) lives in one Google Spreadsheet, so nothing is
lost when Render restarts or redeploys, and the spreadsheet doubles as a
human-friendly view of the data alongside the `/admin` dashboard.

## 1. Create the spreadsheet

1. Go to [sheets.new](https://sheets.new) and create an empty spreadsheet.
   Name it something like `Almanah Website Data`.
2. Copy the **spreadsheet ID** from the URL — the long string between `/d/`
   and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
3. Don't create any tabs or headers — the app creates the `Donations`,
   `Messages`, and `Newsletter` tabs with header rows automatically on first
   use.
4. Do **not** share the spreadsheet publicly. It contains donor names and
   emails; only share it with the people who need to see the data.

## 2. Create a Google service account

This gives the app its own "Google identity" that can edit the sheet.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a project (any name, e.g. `almanah-website`). No billing account is
   needed for this.
2. **APIs & Services → Library** → search "Google Sheets API" → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account.**
   Name it (e.g. `almanah-app`), skip the optional role/access steps.
4. Open the new service account → **Keys → Add key → Create new key → JSON.**
   A `.json` file downloads. Treat it like a password.
5. Copy the service account's email address (looks like
   `almanah-app@almanah-website.iam.gserviceaccount.com`) and **share the
   spreadsheet with that email as an Editor** (Share button in Sheets, untick
   "Notify people").

## 3. Deploy on Render

1. Push this repository to GitHub (`.env` and `data/` are gitignored — never
   commit them).
2. At [render.com](https://render.com): **New → Web Service** → connect the
   repo.
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
3. Add environment variables (Environment tab):

   | Key | Value |
   | --- | --- |
   | `PUBLIC_BASE_URL` | `https://<your-service>.onrender.com` or your custom domain |
   | `SHEETS_SPREADSHEET_ID` | the ID from step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | entire contents of the downloaded key file, as one line |
   | `PAYSTACK_SECRET_KEY` | from the Paystack dashboard |
   | `FLUTTERWAVE_SECRET_KEY` | from the Flutterwave dashboard |
   | `FLUTTERWAVE_WEBHOOK_HASH` | the secret hash you set in Flutterwave |
   | `ADMIN_USERNAME` | admin dashboard login |
   | `ADMIN_PASSWORD` | admin dashboard password — pick a strong one |
   | `NODE_ENV` | `production` |

4. Deploy. The logs should show `Data store: google-sheets` on boot. If they
   show `json-files` instead, one of the two Google variables is missing or
   malformed.

## 4. Point the payment providers at the app

```text
Paystack webhook:
https://<your-domain>/api/webhooks/paystack

Flutterwave webhook:
https://<your-domain>/api/webhooks/flutterwave
```

## 5. Custom domain

In Render: Settings → Custom Domains → add
`almanahcarefoundation.org`, then create the DNS records Render shows you at
your registrar. Update `PUBLIC_BASE_URL` to match.

## Notes and limitations

- **Free-tier cold starts:** after ~15 idle minutes the service spins down and
  the next visit takes ~30–60s. Webhooks that arrive while asleep are retried
  by Paystack/Flutterwave, so payment confirmations are not lost. If cold
  starts become annoying, Render's Starter tier keeps the service always-on.
- **Don't edit rows the app manages.** Sorting/filtering views and reading are
  fine; adding your own columns to the right of the app's columns is fine.
  Deleting or reordering the app's columns will confuse it.
- **Local development:** just run `npm start` with no Google variables set —
  data goes to JSON files under `data/`.
