from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: int,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Add an audit row to the current transaction.

    The caller commits, so the audit row and the change it describes succeed or fail together.
    """
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or {},
    )
    db.add(entry)
    return entry
