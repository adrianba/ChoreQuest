"""Shared utility helpers for ChoreQuest."""

from __future__ import annotations

from datetime import date, datetime


def utc_iso(dt: datetime | None) -> str | None:
    """Serialize a datetime to an ISO 8601 string with a UTC 'Z' suffix.

    All datetimes in ChoreQuest are stored as UTC.  SQLite returns them as
    naive Python datetime objects (no tzinfo).  Without the 'Z' suffix,
    JavaScript's Date constructor treats the string as *local* time which
    produces wrong timestamps on every device that isn't running in UTC.

    Usage:
        "completed_at": utc_iso(assignment.completed_at),

    Plain date objects should still use .isoformat() directly — they have
    no time component so timezone conversion is irrelevant.
    """
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
