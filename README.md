# Club-Mailbot

Local web app for sending personalized club emails through Gmail SMTP.

## Start

```bash
npm start
```

Then open `http://localhost:5177`.

## Gmail Setup

1. Enable 2-factor authentication in the Google account.
2. Create an app password for Mail.
3. Enter the Gmail address and app password in Club-Mailbot.

The app password is not stored. It is only sent to the local backend for the current auth test or send run.

Alternatively, set `Auth-Modus` to `OAuth Access Token (XOAUTH2)` and enter a valid OAuth access token with the `https://mail.google.com/` scope. A normal Google login password does not work here.

## Recipient Data

Paste rows into the import field and manage column names in the table below. Comma, semicolon, and tab-separated values are supported.

```text
Alex Example,alex@example.com,https://example.com/invite/alex
Sam Sample,sam@example.com,https://example.com/invite/sam
```

Template variables come from the current table columns:

```text
{{name}}
{{email}}
{{interviewLink}}
```

## Message HTML

The message editor accepts HTML. The design template must contain `{{content}}`; Club-Mailbot injects the message HTML there.

```html
<h2>Interview Invitation</h2>
<p>Hi {{name}},</p>
<p>Please choose a time for your interview.</p>
button{{Choose a slot,interviewLink}}
```

Button macros support either a direct URL or a table property as target.

## Local Storage

Drafts and recipient tables are stored in browser `localStorage`.

Stored locally:

- sender email
- sender name
- recipient table
- subject
- message HTML
- design template
- send delay

Not stored:

- Gmail app password
- OAuth access token
- SMTP session data

## Notes

Gmail has sending limits. Send in small batches and always send a test email first. Use the app only for recipients who are allowed to receive the message.
