"""Diagnostic: reads credentials from .env the same way api.py does, then tries SMTP login."""
import smtplib
from pathlib import Path

ENV_PATH = Path(__file__).with_name(".env")

def read_env_direct(key, default=""):
    if not ENV_PATH.exists():
        print(f"  ERROR: .env file not found at {ENV_PATH}")
        return default
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip().strip("\"'")
    return default

print("=" * 55)
print("  Xenon SMTP Diagnostics")
print("=" * 55)
print(f"\n.env path: {ENV_PATH}")
print(f".env exists: {ENV_PATH.exists()}\n")

smtp_user = read_env_direct("SMTP_USERNAME")
smtp_pass = read_env_direct("SMTP_PASSWORD")
smtp_host = read_env_direct("SMTP_HOST", "smtp.gmail.com")
smtp_port = int(read_env_direct("SMTP_PORT", "587"))

print(f"SMTP_USERNAME : '{smtp_user}'")
print(f"SMTP_PASSWORD : '{smtp_pass}'  (length={len(smtp_pass)})")
print(f"SMTP_HOST     : '{smtp_host}'")
print(f"SMTP_PORT     : {smtp_port}")
print()

if not smtp_user or not smtp_pass:
    print("ERROR: Username or password is empty. Fix your .env file.")
    exit(1)

print(f"Connecting to {smtp_host}:{smtp_port} ...")
try:
    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        print(f"Logging in as '{smtp_user}' ...")
        smtp.login(smtp_user, smtp_pass)
        print("\n✅  LOGIN SUCCESSFUL! Email is ready to send.")
except Exception as e:
    print(f"\n❌  LOGIN FAILED: {e}")
    print("\nLikely causes:")
    print("  1. App Password was typed incorrectly — regenerate it at https://myaccount.google.com/apppasswords")
    print("  2. 2-Step Verification is not enabled on your Google account")
    print("  3. The App Password shown above contains unexpected characters")
