"""Sending email, through whichever backend the deployment chose (see config.mail_backend).

Messages are sent from a background task, after the response has gone out: the request never
waits on (or fails because of) a mail server, and "we've emailed you" takes the same time
whether or not an email was actually sent.
"""

import logging
import smtplib
import uuid
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_mail(to: str, subject: str, body: str) -> None:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    match settings.mail_backend:
        case "none":
            return
        case "console":
            print(f"\n----- email -----\n{message}\n-----------------\n", flush=True)
        case "file":
            outbox = settings.mail_outbox_dir
            if outbox is None:
                raise RuntimeError("MAIL_BACKEND=file needs MAIL_OUTBOX_DIR")
            outbox.mkdir(parents=True, exist_ok=True)
            (outbox / f"{uuid.uuid4().hex}.eml").write_bytes(message.as_bytes())
        case "smtp":
            try:
                with smtplib.SMTP(settings.smtp_host or "", settings.smtp_port, timeout=10) as smtp:
                    smtp.starttls()
                    if settings.smtp_username:
                        smtp.login(settings.smtp_username, settings.smtp_password or "")
                    smtp.send_message(message)
            except (OSError, smtplib.SMTPException):
                # Logged, not raised: it runs after the response, so there's no one to tell.
                logger.exception("Couldn't send email to %s", to)
