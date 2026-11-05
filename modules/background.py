"""Master switch for the background pollers (inbox sync, reply checker, follow-up scheduler).

Background jobs are disabled by default; set `BACKGROUND_JOBS=1` (also true / yes / on) to start them.
Only one environment per database should run them: these jobs read configured mailboxes and can send
reminders or auto-send emails. Manual actions (the Inbox "Sync now" button, /webhook/check-replies-now)
still work while background jobs are disabled.
"""
import os


def jobs_enabled() -> bool:
    return os.getenv("BACKGROUND_JOBS", "0").strip().lower() in ("1", "true", "yes", "on")
