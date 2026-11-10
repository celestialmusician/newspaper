from .models import ActivityLog, Notification


def log(actor, action: str, entity: str, detail: str = '', entity_id='') -> None:
    ActivityLog.objects.create(actor=actor if getattr(actor, 'is_authenticated', False) else None, action=action, entity=entity[:160], detail=detail[:300], entity_id=str(entity_id))


def notify(to, kind: str, title: str, body: str, link: str = '') -> None:
    """`to` may be a User, a list of Users, or a role string like 'role:admin'."""
    targets = to if isinstance(to, (list, tuple, set)) else [to]
    rows = []
    for t in targets:
        if t is None:
            continue
        if isinstance(t, str) and t.startswith('role:'):
            rows.append(Notification(role=t[5:], kind=kind, title=title, body=body, link=link))
        else:
            rows.append(Notification(user=t, kind=kind, title=title, body=body, link=link))
    Notification.objects.bulk_create(rows)
    # Web Push fan-out hooks in here (pywebpush + VAPID keys) when configured.
