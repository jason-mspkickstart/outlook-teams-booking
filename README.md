# outlook-teams-booking

**A self-hosted Calendly alternative for Microsoft 365.** Visitors book a Teams meeting from your website, it lands straight in your Outlook calendar, and Outlook sends them the invite.

It's a headless API, so every site you run can have its own booking page designed however you like. One Worker serves them all, each with its own meeting types, hours and sender address, all checked against one calendar so nothing double books.

Runs on Cloudflare Workers and D1, free plan. No servers, no subscription, no local install.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jason-mspkickstart/outlook-teams-booking)

## What it does

- Reads your free/busy from Outlook, so anything already in your calendar blocks that time
- Creates the meeting in your calendar with a Teams link, and Outlook sends the visitor a proper invite
- Multiple sites, each with its own meeting types, working hours and confirmation email address
- Durations, buffers before and after, minimum notice, how far ahead people can book, daily limits
- Intake questions per meeting type
- Reschedule and cancel links, which update or cancel the Outlook event
- Turnstile on every booking to keep bots out
- Settings live in the D1 database, edited in the Cloudflare dashboard. Change a buffer and it applies straight away, no redeploy

What it doesn't do: payments, round robin across a team, or an admin UI. Outlook handles reminders.

## How it fits together

```
Your website (any framework)
   |  fetch, from an allowed domain
   v
Cloudflare Worker  ----->  D1 (sites, hours, meeting types, bookings)
   |
   v
Microsoft Graph  ----->  your Outlook calendar + Teams
```

Your sites never hold any secrets. They only know the Worker's URL and their own site key.

## Setup

You'll need a Microsoft 365 business plan that includes Exchange and Teams (Business Basic is fine), admin rights to register an app, and a Cloudflare account.

### 1. Register an app in Microsoft Entra

1. Go to **Entra admin centre > App registrations > New registration**. Name it something like `Outlook Teams Booking`, single tenant, no redirect URI.
2. Copy the **Application (client) ID** and **Directory (tenant) ID** from the overview page.
3. **Certificates & secrets > New client secret.** Copy the **value** (not the ID). Note when it expires, the Worker stops working when it does.
4. **Do not** add Graph API permissions here. The next step grants them in Exchange, limited to one mailbox. Permissions granted in Entra apply to every mailbox in your tenant, and they add on top of the Exchange ones rather than being replaced by them.

### 2. Limit it to your mailbox

Open [`docs/exchange-setup.ps1`](docs/exchange-setup.ps1), fill in your client ID and mailbox at the top, and paste it into PowerShell as a Global or Exchange admin. It finds the enterprise app's Object ID for you, which is the usual sticking point, and it's safe to run again if anything fails part way. Don't save your filled-in copy into the repo.

This gives the app `Calendars.ReadWrite` and `Mail.Send` on the booking mailbox only, and nothing else in your tenant. Allow half an hour or so for it to take effect.

### 3. Create a Turnstile widget

In the Cloudflare dashboard, **Turnstile > Add widget**. Add every domain your booking pages live on. Copy the **site key** and **secret key**.

### 4. Deploy

Click **Deploy to Cloudflare** above. It copies this repo to your GitHub, creates the Worker and the D1 database, and asks for these:

| Setting | What it is |
| --- | --- |
| `MS_TENANT_ID` | Directory (tenant) ID from step 1 |
| `MS_CLIENT_ID` | Application (client) ID from step 1 |
| `MS_CLIENT_SECRET` | Client secret value from step 1 |
| `MAILBOX` | The mailbox that takes bookings, e.g. `you@yourdomain.com` |
| `TURNSTILE_SITE_KEY` | From step 3 |
| `TURNSTILE_SECRET` | From step 3 |
| `SIGNING_KEY` | Any long random string. Signs reschedule and cancel links, so keep it private and don't change it later or old links stop working |

Then open `https://<your-worker>/health`. You want `"ok": true`. If a setting is missing it tells you which one, and lists the names the Worker can actually see, which catches typos in setting names.

Optional but worth doing: add a custom domain such as `book.yourdomain.com` under **Worker > Settings > Domains & Routes**.

<details>
<summary>Deploying by hand instead of the button</summary>

1. Fork or clone this repo to your GitHub.
2. **Cloudflare dashboard > Workers & Pages > Create > Import a repository** and pick it. Leave the build settings as they are.
3. Under **Worker > Settings > Variables and Secrets**, add the seven settings above as secrets.
4. Push to redeploy. Every push to your main branch deploys automatically.

</details>

### 5. Switch on the admin page

The admin page at `/admin` lets you manage sites, hours, meeting types, time off, questions and bookings with forms instead of SQL. It's off until you put it behind Cloudflare Access, and the Worker checks the Access login itself, so it can't be reached any other way.

You need a custom domain on the Worker first (step 4).

1. Cloudflare dashboard > **Zero Trust**. If it's your first time, pick a team name and the Free plan
2. **Integrations > Identity providers**: make sure **One-time PIN** is listed (if not, **Add new identity provider > One-time PIN**)
3. **Access > Applications > Add an application > Self-hosted**
   - Application domain: your Worker's domain, path `admin`
   - Add a policy: Action **Allow**, Include **Emails**, your email address
   - Login methods: **One-time PIN**
4. Save, then open the application again and copy the **Application Audience (AUD) Tag** from its overview
5. In the Worker's **Settings > Variables and Secrets**, add:
   - `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `yourteam.cloudflareaccess.com` (shown under **Settings** in Zero Trust, as your team name or team domain)
   - `ACCESS_AUD`: the AUD tag from step 4
6. Visit `https://<your-worker-domain>/admin`, enter your email, then the code it sends you

Worth turning off the Worker's `workers.dev` URL too (**Settings > Domains & Routes**), so the custom domain is the only way in.

### 6. Add your sites and availability

The easy way is the admin page: add a site, then an Hours set, then a meeting type. Anything already in your Outlook calendar is blocked automatically, so holidays and days off can just go in Outlook.

If you'd rather use SQL, go to **Storage & Databases > D1 > outlook-teams-booking > Console**. Open [`docs/example-data.sql`](docs/example-data.sql), change the values to yours and run it. It's commented line by line.

The short version of the tables:

- **`schedules`**: a named set of hours with a time zone
- **`schedule_hours`**: one row per day per window. Day 1 is Monday. Two rows on the same day gives you a lunch break
- **`blocked_dates`**: holidays. Leave `schedule_key` empty to block every schedule
- **`sites`**: one per website, with its allowed domains, confirmation email sender and manage page URL
- **`meeting_types`**: what can be booked on each site, which schedule it uses, and the rules
- **`questions`**: optional extra form fields per meeting type

After that, day to day changes are a one line edit in the D1 table view, or see [`docs/cheatsheet.sql`](docs/cheatsheet.sql).

### 7. Build the booking page

The API is plain JSON over `fetch`, so any site can use it. If your site is built in Lovable, [`docs/lovable-prompt.md`](docs/lovable-prompt.md) has a prompt that builds the booking and manage pages for you.

## API

All endpoints take a `site` key (or a booking `token`) and only answer browsers on that site's allowed domains. Errors come back as `{ "error": "message" }`.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/config?site=` | Site name, meeting types, questions, Turnstile site key |
| `GET` | `/api/availability?site=&type=&from=&to=` | Free slots as UTC ISO strings. Dates are `YYYY-MM-DD`, max six weeks per call |
| `POST` | `/api/book` | `{ site, type, start, name, email, answers, timezone, turnstileToken }` |
| `GET` | `/api/booking?token=` | Details for the manage page |
| `POST` | `/api/reschedule` | `{ token, start, turnstileToken }` |
| `POST` | `/api/cancel` | `{ token, reason }` |
| `GET` | `/health` | Setup check |

`timezone` on `/api/book` is the visitor's IANA zone (e.g. `America/New_York`) so their confirmation email shows their local time.

## Good to know

**The invite comes from your main mailbox address.** Graph creates the event in that mailbox, so the organiser is its primary address, whatever site the booking came from. Put the brand in the meeting subject (`invite_subject` supports `{meeting}`, `{site}`, `{host}` and `{name}`) and the per-site confirmation email.

**Sending confirmation emails from aliases.** If a site's `sender_email` is an alias on the booking mailbox, `SendFromAliasEnabled` must be on (the setup script does it). Test it with a booking before going live. If the email fails, the booking still goes through and the error shows in the Worker logs.

**Free/busy.** Anything in the calendar not marked Free blocks time, including tentative and out of office.

**Client secret expiry.** Entra secrets expire, 24 months at most. Set a reminder to rotate it.

## Licence

MIT. Maintained in spare time, so issues and pull requests are welcome but replies may not be instant. See [SECURITY.md](SECURITY.md) for reporting security issues.
