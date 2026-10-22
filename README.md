# Mailbot

Mailbot is a local tool for composing and preparing individually personalized club emails through the club's existing Gmail or Google Workspace account. It avoids a separate Mailgun service and its additional provider costs; Google account limits and delivery rules still apply. Mailbot never treats imported contacts as consent: newsletter eligibility must come from an explicit opt-in in Notion.

## Start

Requires **Node.js 20 or newer** and Git. There are no third-party runtime packages.

```bash
git clone https://github.com/neinron/club-mailbot.git
cd club-mailbot
cp .env.example .env
npm install
npm start
```

Open [http://localhost:5177](http://localhost:5177). Start the server from the repository directory so it reads the correct `.env`. The interface, draft editor and test-email flow work without Notion; **real bulk sends require the Notion connection and delivery-history properties** described below. Enter Gmail credentials only in **Settings**, then test the connection and send a test email before a real campaign.

Each installation starts with an empty private workspace. Web-app drafts, recipient lists and filters are saved to `data/workspace.json`, with a browser cache. They survive restarts and are shared between localhost and 127.0.0.1 on that computer. The CLI uses ignored `drafts/` and `campaigns/` folders. Nothing synchronizes your local drafts to other team members automatically. Credentials are not saved with drafts or lists.

### Club setup checklist

1. Ask the database owner to grant your Notion integration access to **Newsletter Subscribers**, then set `NOTION_API_KEY` in `.env`. Use the existing club data source, or set `NOTION_DATA_SOURCE_ID` and `NOTION_DATABASE_URL` for a compatible database. Change `NOTION_CURRENT_APPLICATION_PHASE` when recruitment moves to a new phase.
2. Confirm the schema in [Notion setup](#notion-setup). Each team member needs authorized integration access; this repository does not include an API key or subscriber data.
3. To use `{{unsubscribeUrl}}`, obtain the existing website signing secret through the club's approved credential-sharing process and configure `.env` as explained below. Do not generate a different secret for an already configured website. Cloning this repository does not deploy the website's signup or unsubscribe service.
4. In **Settings**, enter the approved sender address and its Google App Password (or the advanced OAuth access token). Credentials remain in tab memory and must be re-entered after reloading.
5. Load or import recipients, save a named list, write and save a draft, then review it and send a test email to yourself. The real send button asks for confirmation.

Keep Mailbot on your computer's loopback address. It is a local tool, not an authenticated public web service; do not expose its port to the internet.

## Notion setup

Mailbot is tailored to the club's subscriber schema. These exact properties are needed for delivery logging and manual-contact creation:

| Property | Notion type / values |
| --- | --- |
| Name | Title; full name |
| Email | Email; unique normalized address |
| First name / Last name | Text; optional personalization fields |
| Subscription status | Select: `Subscribed`, `Not subscribed`, `Pending confirmation`, `Unsubscribed` |
| Source | Text |
| Lists | Multi-select; provenance, phase and membership labels |
| Last email sent at / Last email attempt at | Date |
| Last email subject / Last email campaign | Text |
| Last email status | Select: `Sent`, `Failed`, `Unknown` |

The integration needs to read contacts, create/update pages, and append delivery-history blocks. Create the schema before a bulk send; missing audit properties block sending. Optional recruitment fields and `Lists` labels are described under **Choose recipients**. Importing a contact never grants newsletter consent. The club's existing database already contains this schema; use its authorized integration rather than duplicating the database.

## Compose from the CLI

The CLI can create and update campaign drafts, attach an eligible recipient CSV, check personalization fields, render an HTML preview, export a recipient list from Notion, and record opt-outs. It deliberately has no send command.

```bash
npm run mailbot -- draft create \
  --name "Recruiting launch" \
  --subject "Applications are open" \
  --body-file drafts/recruiting-message.html \
  --recipients campaigns/recruiting-opt-ins.csv \
  --design drafts/brand-design.json

npm run mailbot -- draft check --name "Recruiting launch"
npm run mailbot -- draft preview --name "Recruiting launch" --output /tmp/recruiting-preview.html
```

`--body-file` may contain HTML authored for the visual editor. `--html-file` is an optional full email wrapper and should contain `{{content}}`; `--design` is a JSON file with `layout`, `accent`, `background`, `font`, `padding`, and `width` fields. Drafts never include Gmail credentials. To load the result into the web app, open **Message → Manage drafts → Import CLI JSON** and choose `drafts/recruiting-launch.json`. To edit an existing browser draft from the CLI, export it as JSON, run `npm run mailbot -- draft import --input <file.json>`, then use `draft update`.

### Notion source of truth and opt-outs

Configure a Notion internal integration with access to the newsletter/applicant data source, then put its token in the ignored `.env` file as `NOTION_API_KEY=...`. Do not commit or screenshot that file. For a legacy application source, inspect its schema first: it may use `Marketing Updates Opt In`, `Email`, and `Full Name`. That is different from the current subscriber database’s `Subscription status` select. Exclude members explicitly when exporting a legacy application source. Set the application source and exact property names for public unsubscribe handling in `.env` as well:

```dotenv
NOTION_DATA_SOURCE_ID=your-winter-2026-applications-source
NOTION_EMAIL_PROPERTY=Email
NOTION_OPT_IN_PROPERTY=Marketing Updates Opt In
PUBLIC_BASE_URL=https://tum-socialaiclub.de
NEWSLETTER_TOKEN_SECRET=use-the-same-random-secret-as-the-website-worker
```

Use `npm run mailbot -- notion inspect --source <id>` to inspect the schema. Export only checked opt-ins and exclude every email address listed on a current member record:

```bash
npm run mailbot -- notion export \
  --source <winter-2026-applications-source> --email "Email" \
  --name "Full Name" --consent "Marketing Updates Opt In" \
  --exclude-source <members-source> \
  --exclude-email-property "E-Mail" \
  --exclude-email-property "Education Email  " \
  --output campaigns/newsletter.csv
```

`notion sync` saves the current Notion audience to `campaigns/notion-newsletter.csv`; add `--force` when refreshing that existing file. An unsubscribe change is a dry run unless `--apply` is supplied:

```bash
npm run mailbot -- notion unsubscribe --source <data-source-id> \
  --email "Email" --consent "Marketing Updates Opt In" \
  --address person@example.org --apply
```

Create a signed link for a Notion page with `unsubscribe link`. The link opens the TUM Social AI website, where the recipient confirms the change before the website Worker updates the opt-in in Notion. Set `PUBLIC_BASE_URL=https://tum-socialaiclub.de` and the same `NEWSLETTER_TOKEN_SECRET` in the Mailbot and website Worker. The Mailbot remains private; only the website hosts signup, confirmation, and unsubscribe pages.

### Website newsletter subscriptions

Public signups are stored in the [Newsletter Subscribers database](https://app.notion.com/p/83120150-36a4-4b90-be22-b9b05cd1b9df). The signup form, double-opt-in confirmation, and unsubscribe pages are part of the TUM Social AI Club website. Their server-side routes run in the website's Cloudflare Worker and update Notion directly. Confirmation uses a one-time encrypted token that expires after 48 hours; unsubscribe links are signed for a specific Notion page and email. The website Worker uses Gmail API OAuth to send confirmation emails and Durable Object rate limits. Its deployment configuration and required secrets are documented in the website repository. The Mailbot is only for private campaign preparation and sending.

For newsletter delivery, `Subscription status` is authoritative: only `Subscribed` is eligible. Application invitations use the club’s separate rule: contacts without an opt-in are allowed, but active `Unsubscribed` contacts, members and current open/completed applicants are excluded. This does not change anyone’s subscription status. `Pending confirmation`, `Unsubscribed`, and empty statuses are excluded, even if the legacy `Subscribed` checkbox is checked. Notion exports and CLI unsubscribe support the select; older recruitment checkbox sources continue to work. Edit the select in Notion. Native automations record the status-change time and person and keep the hidden legacy checkbox synchronized for compatibility. Do not infer consent from an RSVP or an imported address.

## Workflow

### 1. Choose recipients

In **Recipients**, click **Choose recipients** or **Change audience**. The picker has **Notion** and **CSV / paste** sources. Notion opens as a database with **All contacts**, regardless of the current campaign. Its API key stays on the local server. The top **Saved list** dropdown contains only locally saved, named lists; Notion tags are filter values, not saved lists.

| Sending purpose | Required audience |
| --- | --- |
| Recruiting invitation | Not actively Unsubscribed, not a current member, no open or completed application in the current phase; newsletter opt-in is not required |
| Application deadline | Not actively Unsubscribed, not a member, no submitted application in the current phase; includes started applications |
| Newsletter | Subscription status is Subscribed |
| Finish your application | Eligible incomplete application in the current phase, no completed application, not a current member; newsletter opt-in is separate |
| Browse all contacts | Review only; cannot send |

Click the **filter icon** to build conditions. Every condition after the first has its own **AND / OR** connector directly before it. Conditions run from top to bottom; nested groups combine subconditions. Existing saved all/any groups retain their behavior. Filter the **Lists** tags, names or addresses; the table updates immediately. Every contact in the current selection is rendered in one continuous, scrollable table without pagination. Search is available in the toolbar. The **sort icon** next to the filter icon opens sort field and order controls. **More options** in the filter panel contains extra personalization fields and batch sizes. **Save list** asks for a name and stores the selected contacts, filters and fields locally; the saved list immediately appears in the dropdown. Select a named list and click the **pencil icon** beside it to rename it; existing contacts and filters are preserved, and another saved list cannot be overwritten by renaming. **All contacts** clears the selection and filters. Opening the picker starts from all contacts again. Saving or browsing does not attach recipients to a campaign or send email.

**Use list** checks eligibility for the campaign after filtering. For a Notion list, choose an application invitation, application reminder or newsletter in this final check; it shows how many contacts are eligible before **Use N recipients** attaches them. This check does not alter the saved contact list. A manually imported list uses its existing recipient data. The campaign then shows one compact list. **Contacts & lists** uses the same database and named-list workflow. **Refresh**, on the campaign page, rebuilds the attached Notion audience from current records and its saved filters. Filters do not edit Notion contacts or views. New Tally submissions and membership changes from other sources still need to be synchronized into Notion.

**Lists** is the single visible grouping field in Notion and Mailbot. It combines sources (for example `Application · Summer 2026` and individual `Luma · …` events), phase-specific application stages (`Winter 2026 · Started` / `Winter 2026 · Submitted`), recorded opt-in sources (`Marketing opt-in · Summer 2026`), active marketing consent (`Marketing opt-in`) and membership (`Club member`). Multiple tags can belong to one contact. Use these tags inside the **filter** panel. The separate **Saved list** dropdown holds only your own named lists; campaign eligibility is checked when a list is attached. A list tag never creates newsletter consent.

The older source and consent properties are retained for compatibility, audit history and automatic unsubscribe handling, and hidden in the main Notion views. Lists are populated from the existing records; new external imports and website changes still need to keep those labels synchronized. Mailbot normalizes consent labels against the current subscription status when loading, and revalidates eligibility immediately before delivery.

Use **{{firstName}}**, **{{lastName}}** and **{{name}}** in messages. Notion's dedicated first-name field is preserved; without one, `Hi {{firstName}},` becomes `Hi there,`. Extra selected fields appear under **Personalize**, with variables such as `{{marketingOptInPhases}}` and `{{lumaEvents}}`. The Notion Page ID is retained for unsubscribe links and validation.

### Per-contact delivery history

Real sends require the configured Notion database. Each SMTP attempt is journaled privately under `data/deliveries/` before sending. After SMTP accepts a message, Mailbot records **Last email sent at**, **Last email attempt at**, **Last email subject**, **Last email campaign**, and **Last email status** on each recipient's Notion contact. A permanent paragraph on the contact page retains each attempt with its unique delivery ID, time, campaign, personalized subject, sender and purpose. `Sent` means accepted by SMTP; it does not prove inbox delivery or an open. Failed attempts are separate, and an interrupted attempt is `Unknown` until checked. Test emails do not modify contact delivery history.

Manual recipients are matched by exact normalized email. An address without a contact is created as **Not subscribed**, without granting consent; ambiguous duplicate addresses block the send. Additional To/CC/BCC recipients are recorded too. The journal contains metadata only, never SMTP secrets or message bodies, and is excluded from Git. If Notion is temporarily unavailable after SMTP acceptance, Mailbot keeps the successful send result and shows a synchronization warning. A background retry and server startup recovery synchronize pending metadata only; they never resend email. Check an unknown attempt before deciding to send again. Historical emails are not backfilled automatically.

Before a real send, the server re-reads Notion and blocks ineligible contacts: opt-outs, newly completed applications, newly marked members for recruiting/reminders, removed contacts, changed email identities and review-only audiences. Test emails go only to the explicit test address. Loading or saving never sends email. There is no fixed 250-recipient cap. Sending is sequential with a minimum 1.2-second pause, and Google account limits still apply.

Local `.env` settings (never commit the key):

```dotenv
NOTION_API_KEY=<scoped integration key>
NOTION_DATA_SOURCE_ID=ee78a5b5-8a15-48e5-b5fd-16f821e57d1c
NOTION_DATABASE_URL=https://www.notion.so/8312015036a44b90be22b9b05cd1b9df
NOTION_CURRENT_APPLICATION_PHASE="Winter 2026"
```

Grant the integration access only to this database. Change `NOTION_CURRENT_APPLICATION_PHASE` for the next round and restart Mailbot. Keep application and membership fields current in Notion. Views and filters organize contacts; they are not separate access-control boundaries.




In **Choose recipients → CSV / paste**, choose a file or paste comma-, semicolon- or tab-separated data, with or without a header. **Use imported recipients** attaches it; cancelling leaves the campaign unchanged. **List tools** exposes editable fields and delivery roles. Extra metadata is available from each contact’s **Details** button and as editor variables. Saved lists and drafts are stored on this computer in `data/workspace.json` (ignored by Git, file permissions 0600), with a browser cache. Existing browser data is imported automatically on first load. They survive server restarts and are shared between localhost and 127.0.0.1. App passwords and secrets are never saved. Back up the private data directory separately; it contains contact data. A failed disk save is shown in the save status.

For larger or repeat lists, prepare the file in the CLI instead of pasting contacts one by one:

```bash
node bin/mailbot.js recipients prepare \
  --input /path/to/luma-guests.csv \
  --exclude /path/to/current-members.csv \
  --output campaigns/demo-day-rsvps.csv
```

The CLI accepts CSV or TSV files, with or without a header. Repeat `--exclude` for additional suppression or member exports. It deduplicates email addresses case-insensitively, drops invalid addresses, reports counts without printing contact data, and writes a headerless `Name,Email` CSV that can be loaded with **Choose CSV file** in Recipients. Output files are kept in the ignored `campaigns/` folder by default, and an existing file is never replaced unless you pass `--force`. For a preview without writing a file, omit `--output` to print the CSV to standard output.

Use only contacts who are eligible to receive that message, such as applicants who opted in to updates. A manual CSV import does not determine consent or membership; use the Notion export workflow above when those rules apply.

### 2. Write the message

In **Message**, create or rename a draft, add a subject, and write the email with the visual editor. Use **Personalize** to insert recipient fields such as `{{firstName}}`; use **HTML** for custom markup. Buttons and horizontal dividers can be inserted from the toolbar. Select text to choose Albert Sans or League Spartan, a size from 1–200 px and a weight from 100–900. The toolbar reflects the current selection; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo editor changes. Web fonts are requested remotely from Google and are not attachments; unsupported or privacy-restricted mail clients may use fallback fonts. The live preview updates as you edit.

Open **Email design** within Message to change layout, colors, fonts, spacing, width or the custom HTML template. **Apply to draft** replaces the current layout. Templates must include `{{content}}`.

### 3. Review & send

**Review & send** combines recipient personalization, desktop/mobile preview, blocked-image preview, the readiness checklist, test address and sending controls. Enter sender credentials in **Settings**. The test uses one selected recipient’s personalization and goes only to the explicit test address, with Cc/Bcc removed. Bulk sending still requires confirmation. Loading, filtering and saving audiences never sends mail.

### Live progress and resuming

The send panel updates every two seconds with sent, failed, skipped and processed counts. It identifies active, finished or interrupted sends and warns when no recent progress is visible. For new runs it also shows whether Mailbot is sending or saving the result to Notion. Only one real campaign runs at a time. Refreshing the browser does not cancel the server's current request; keep the server running and the computer awake.

After an interruption, restart the same saved campaign with the **same draft name, subject and sender**. The private local journal skips matching `Sent` entries and blocks `Unknown` attempts until manually verified. Failed attempts can be retried. Changing the identifying fields, deleting the journal or using another computer can bypass this local duplicate check. There is no cross-computer send lock, so coordinate who sends each campaign. Notion history is synchronized separately; it does not automatically transfer another computer's resume state.

Do not interpret a stale counter as permission to restart the server or send again. Check the journal and provider first. `Sent` means SMTP acceptance, not confirmed inbox delivery.

## Connect the Gmail account

1. Open **Settings** in the sidebar and enter the sender's Gmail or Google Workspace address.
2. Mailbot's default sign-in method is a Google **App Password**. Google requires 2-Step Verification to create one. Generate it in the Google Account's App Passwords settings, then paste it into the app-password field. Do not use the normal Google account password. Google's current instructions and restrictions are [here](https://support.google.com/accounts/answer/185833).
3. Test the connection. The app password stays in the current browser tab's memory and is not written to local storage or sent to GitHub. It is used by the local Mailbot server to authenticate to Gmail SMTP. Re-enter it after closing or refreshing the tab.

![Gmail sender settings with blank credential fields](docs/screenshots/05-account.png)

Google recommends “Sign in with Google” when an app supports it. Mailbot also exposes an advanced OAuth access-token mode; use the organization's approved method if available. Google Workspace administrators can restrict app passwords, so contact the account owner if the setting is unavailable.

**Shared credentials:** ask the account owner where the approved credential is stored, for example in the club’s password manager. Repository access does not grant mailbox access. Never put the password in this repository, screenshots, or this guide.

## Why this tool

Mailbot uses Gmail SMTP through an existing club account, so the club does not need a separate paid Mailgun account for this workflow. It stores web drafts on local disk with a browser cache and CLI drafts as local JSON, renders one personalized message per row, and supports a test-only send to an explicit address. Notion remains the source for opt-in status when the integration is configured.

## Data and security

- Web-app drafts and recipient lists are saved in ignored `data/workspace.json`, with a browser cache. CLI drafts and exports use ignored `drafts/` and `campaigns/` folders. Back up private data securely, never through Git.
- The app password and OAuth token are not persisted. SMTP command logging masks authentication secrets.
- Do not put real drafts, recipient exports, audit files, or credentials in GitHub. The `data/`, `campaigns/`, `drafts/`, `.env` and local progress files are ignored by Git.
- The test-send route requires an explicit valid test address and sends only to it, without Cc or Bcc.
- Google limits sending and can block suspicious or excessive activity. Check the current [Gmail sending limits](https://support.google.com/mail/answer/22839?hl=en) and the relevant Workspace policy before a large send.

## Screenshots

Screenshots in this README use a separate local demo origin and synthetic `example.org` addresses. They contain no campaign draft, real recipient list, or credential.

## Tests

```bash
npm test
```

Tests cover CLI draft creation, recipient preparation, message rendering, and test-recipient isolation. They do not connect to Gmail or Notion.

## Template compatibility

Existing HTML and button macros remain supported:

```html
<p>Hi {{firstName}},</p>
button{{Choose a slot,interviewLink}}
```

The visual editor shows button macros as editable buttons. Pasted rich text is inserted as plain text; use HTML mode for custom markup. Previews are sandboxed with scripts disabled.
