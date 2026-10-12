"""SMTP/IMAP connection testing for the Email Integration feature.

Each helper performs a REAL authenticated connection (not just field checks),
respects the configured security mode, uses bounded timeouts, and maps failures
to user-friendly messages that never include credentials or raw tracebacks.
"""
import imaplib
import smtplib
import ssl
from typing import Tuple

TEST_TIMEOUT_SECONDS = 15

SecurityMode = str  # "ssl" | "starttls" | "none"


def _ssl_context() -> ssl.SSLContext:
    # Certificate verification stays ON — never disable it to force a connection.
    return ssl.create_default_context()


def test_smtp_connection(
    email: str,
    password: str,
    host: str,
    port: int,
    security: SecurityMode = "starttls",
) -> Tuple[bool, str]:
    """Connect + authenticate against SMTP. Returns (ok, friendly_message)."""
    security = (security or "starttls").lower()
    try:
        if security == "ssl":
            with smtplib.SMTP_SSL(host, int(port), timeout=TEST_TIMEOUT_SECONDS, context=_ssl_context()) as server:
                server.ehlo()
                server.login(email, password)
        elif security == "none":
            with smtplib.SMTP(host, int(port), timeout=TEST_TIMEOUT_SECONDS) as server:
                server.ehlo()
                server.login(email, password)
        else:  # starttls
            with smtplib.SMTP(host, int(port), timeout=TEST_TIMEOUT_SECONDS) as server:
                server.ehlo()
                server.starttls(context=_ssl_context())
                server.ehlo()
                server.login(email, password)
        return True, "SMTP connection successful."
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP authentication failed. Please verify your email and app password."
    except smtplib.SMTPNotSupportedError:
        return False, "The SMTP server does not support the selected security mode. Try a different option."
    except smtplib.SMTPConnectError:
        return False, f"Unable to connect to the SMTP server at {host}:{port}. Check the host and port."
    except TimeoutError:
        return False, f"SMTP connection to {host}:{port} timed out. Check the host and port."
    except ssl.SSLError:
        return False, f"TLS/SSL handshake with {host}:{port} failed. Check the security mode and port."
    except OSError:
        return False, f"Unable to reach the SMTP server at {host}:{port}. Check the host, port, and your network."
    except smtplib.SMTPException:
        return False, "The SMTP server returned an unexpected error. Please verify your settings."
    except Exception:
        return False, "SMTP test failed unexpectedly. Please verify your settings."


def test_imap_connection(
    email: str,
    password: str,
    host: str,
    port: int,
    security: SecurityMode = "ssl",
) -> Tuple[bool, str]:
    """Connect + authenticate against IMAP. Returns (ok, friendly_message)."""
    security = (security or "ssl").lower()
    conn = None
    try:
        if security == "ssl":
            conn = imaplib.IMAP4_SSL(host, int(port), timeout=TEST_TIMEOUT_SECONDS, ssl_context=_ssl_context())
        elif security == "none":
            conn = imaplib.IMAP4(host, int(port), timeout=TEST_TIMEOUT_SECONDS)
        else:  # starttls
            conn = imaplib.IMAP4(host, int(port), timeout=TEST_TIMEOUT_SECONDS)
            conn.starttls(ssl_context=_ssl_context())
        conn.login(email, password)
        return True, "IMAP connection successful."
    except imaplib.IMAP4.error:
        return False, "IMAP authentication failed. Please verify your email and app password."
    except TimeoutError:
        return False, f"IMAP connection to {host}:{port} timed out. Check the host and port."
    except ssl.SSLError:
        return False, f"TLS/SSL handshake with {host}:{port} failed. Check the security mode and port."
    except OSError:
        return False, f"Unable to reach the IMAP server at {host}:{port}. Check the host, port, and your network."
    except Exception:
        return False, "IMAP test failed unexpectedly. Please verify your settings."
    finally:
        if conn is not None:
            try:
                conn.logout()
            except Exception:
                pass
