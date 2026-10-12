"""Server-side encryption for Email Integration app passwords.

The key MUST come from environment configuration
(EMAIL_CREDENTIAL_ENCRYPTION_KEY). There is no hardcoded fallback — if the
key is missing, operations fail safely with a configuration error.
"""
import base64
import os

from cryptography.fernet import Fernet, InvalidToken

ENV_ENCRYPTION_KEY = "EMAIL_CREDENTIAL_ENCRYPTION_KEY"


class EmailCredentialEncryptionError(RuntimeError):
    """Raised when the encryption key is missing or a value cannot be (de)crypted."""


def _get_fernet() -> Fernet:
    key = (os.getenv(ENV_ENCRYPTION_KEY) or "").strip()
    if not key:
        raise EmailCredentialEncryptionError(
            "Email credential encryption is not configured. "
            f"Set the {ENV_ENCRYPTION_KEY} environment variable and restart the server."
        )
    try:
        return Fernet(key.encode("utf-8"))
    except (ValueError, TypeError):
        # Not a ready Fernet key — derive one deterministically from the
        # configured passphrase (house pattern from the Email_Agent reference).
        raw = key.encode("utf-8")[:32].ljust(32, b"=")
        return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_app_password(plain_password: str) -> str:
    """Encrypt an app password for at-rest storage. Never logs or returns the plain value."""
    try:
        return _get_fernet().encrypt(plain_password.encode("utf-8")).decode("utf-8")
    except EmailCredentialEncryptionError:
        raise
    except Exception as e:
        raise EmailCredentialEncryptionError(f"Failed to encrypt app password: {type(e).__name__}") from None


def decrypt_app_password(encrypted_password: str) -> str:
    """Decrypt a stored app password, for backend SMTP/IMAP use only."""
    try:
        return _get_fernet().decrypt(encrypted_password.encode("utf-8")).decode("utf-8")
    except EmailCredentialEncryptionError:
        raise
    except InvalidToken:
        raise EmailCredentialEncryptionError(
            "Stored email credentials could not be decrypted. "
            "The encryption key may have changed — re-save your Email Integration settings."
        ) from None
    except Exception as e:
        raise EmailCredentialEncryptionError(f"Failed to decrypt app password: {type(e).__name__}") from None
