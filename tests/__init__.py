"""Unit tests: venv\\Scripts\\python -m unittest discover -s tests -t . -v

This package is imported before any test module, so it makes every test run offline even from a
terminal whose repo .env points at the production database and mailbox: python-dotenv is disabled
before `database` is imported (database.py calls load_dotenv(override=True)), the default engine
URL is a throwaway SQLite file the tests never connect to (each module repoints the engines at an
in-memory SQLite), and mail / OpenAI settings are dropped.
"""
import os
import tempfile

os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["BACKGROUND_JOBS"] = "0"
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.gettempdir(), "scmbpo_unit_tests_unused.db").replace("\\", "/")
for _var in ("OPENAI_API_KEY", "EMAIL_SENDER", "EMAIL_PASSWORD", "OUTLOOK_EMAIL", "OUTLOOK_PASSWORD", "EMAIL_HOST",
             "EMAIL_PORT", "SMTP_SERVER", "SMTP_PORT", "IMAP_SERVER", "PUBLIC_BASE_URL", "INBOX_DEFAULT_TENANT_ID",
             "EMAIL_CREDENTIAL_ENCRYPTION_KEY", "FRONTEND_URL", "EMAIL_AGENT_SENDER", "EMAIL_AGENT_PASSWORD"):
    os.environ.pop(_var, None)
