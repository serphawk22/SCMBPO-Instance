"""Master switch for the background pollers (inbox sync, reply checker, follow-up scheduler).

`BACKGROUND_JOBS=0` (also false / no / off) stops them from starting. Use it on any local or staging
backend whose DATABASE_URL points at a database another backend already serves: those jobs read every
configured mailbox and send reminders / auto-send emails, so only ONE environment per database should
run them. Manual actions (the Inbox "Sync now" button, /webhook/check-replies-now) still work.
"""
import os


def jobs_enabled() -> bool:
    return os.getenv("BACKGROUND_JOBS", "1").strip().lower() not in ("0", "false", "no", "off")
