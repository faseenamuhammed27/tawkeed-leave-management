"""Single source of "now" and "today" so date rules are testable.

Tests override these functions instead of patching the system clock.
"""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today() -> date:
    """Today's date in the configured business timezone (default Asia/Dubai)."""
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()
