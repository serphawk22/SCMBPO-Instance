"""Master switch for the background pollers (inbox sync, reply checker, follow-up scheduler).

Default is disabled ('0') to preserve serverless compute hours and prevent Neon database overload.
Set `BACKGROUND_JOBS=1` (or true / yes / on) only on a dedicated background worker when continuous
polling is desired. Manual actions (the Inbox "Sync now" button, /webhook/check-replies-now) still work.
"""
import os


def jobs_enabled() -> bool:
    return os.getenv("BACKGROUND_JOBS", "0").strip().lower() in ("1", "true", "yes", "on")
