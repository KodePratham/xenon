# Gmail SMTP Setup for Ventilation Reports

This guide shows how to connect Gmail securely and send professional ventilation test reports from `check_ventilation_rule.py`.

## 1) Enable 2-Step Verification on Google Account

1. Open: https://myaccount.google.com/security
2. Turn on **2-Step Verification** for your Gmail account.

Gmail SMTP with scripts should use an App Password, not your normal Gmail login password.

## 2) Create a Gmail App Password

1. Open: https://myaccount.google.com/apppasswords
2. Sign in and select app type (for example: **Mail**) and device (for example: **Windows PC**).
3. Click **Generate**.
4. Copy the 16-character password shown by Google.

Keep this password private. Treat it like a secret token.

## 3) Configure a local `.env` file (recommended)

From `xenon-backend` folder:

1. Copy `.env.example` to `.env`
2. Edit `.env` with your real values:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_STARTTLS=true
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_16_char_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
REPORT_RECIPIENTS=alice@example.com,bob@example.com
REPORT_SUBJECT_PREFIX=Xenon Ventilation Report
```

Notes:
- `SMTP_USERNAME` should usually be your full Gmail address.
- `SMTP_PASSWORD` should be the generated App Password.
- `REPORT_RECIPIENTS` supports comma-separated list.
- The script auto-loads `.env` each run.
- Use standard dotenv format only: `KEY=VALUE`.

## 4) Run the ventilation check

```powershell
python check_ventilation_rule.py .\sample1.ifc
```

Every run now does both:
- Prints a local pass/fail report in terminal
- Sends a professional HTML email report to recipients

## 5) Override SMTP settings per command (optional)

You can override defaults directly:

```powershell
python check_ventilation_rule.py .\sample1.ifc `
  --smtp-host smtp.gmail.com `
  --smtp-port 587 `
  --smtp-username your_email@gmail.com `
  --smtp-password your_16_char_app_password `
  --email-to alice@example.com bob@example.com
```

## 6) Troubleshooting

- `SMTPAuthenticationError`:
  - Verify 2-Step Verification is enabled.
  - Confirm you are using App Password, not your normal account password.
  - Regenerate App Password and retry.

- `STARTTLS extension not supported by server`:
  - Confirm SMTP host/port are correct.
  - If using a non-Gmail relay, run with `--no-smtp-use-starttls` only if your server expects plain SMTP.

- Emails not received:
  - Check spam/junk folder.
  - Verify recipient list formatting.
  - Confirm sender address is allowed by your SMTP provider.
