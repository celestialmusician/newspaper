"""Role-based access control — mirrors frontend/src/domain/access.ts."""
from rest_framework.permissions import BasePermission

from accounts.models import CustomerProfile, Role, User

MATRIX = {
    Role.ADMIN: '*',
    Role.AGENT: {
        'customer.write', 'customer.status', 'subscription.write', 'location.write', 'route.write', 'route.handover',
        'executive.write', 'delivery.mark', 'stock.write', 'discount.write', 'invoice.generate', 'payment.collect',
        'complaint.respond', 'reports.view',
    },
    Role.EXECUTIVE: {'delivery.mark', 'payment.collect'},
    Role.CUSTOMER: {'subscription.write', 'payment.online', 'complaint.create'},
}


def can(user: User, action: str) -> bool:
    if not user or not user.is_authenticated or user.status != 'active':
        return False
    allowed = MATRIX.get(user.role)
    if allowed != '*' and action not in (allowed or set()):
        return False
    if user.role == Role.AGENT and action in ('route.write', 'route.handover'):
        return user.agent.can_manage_routes
    if user.role == Role.EXECUTIVE and action == 'payment.collect':
        return user.executive.can_collect_cash
    return True


def Allows(action: str):
    """DRF permission factory: `permission_classes = [Allows('product.write')]` for unsafe methods."""

    class _P(BasePermission):
        message = 'You do not have permission for this action.'

        def has_permission(self, request, view):
            if request.method in ('GET', 'HEAD', 'OPTIONS'):
                return request.user.is_authenticated
            return can(request.user, action)

    _P.__name__ = f'Allows_{action.replace(".", "_")}'
    return _P


def customers_for(user: User):
    qs = CustomerProfile.objects.select_related('user', 'area', 'agent', 'route').order_by('code')
    if user.role == Role.ADMIN:
        return qs
    if user.role == Role.AGENT:
        return qs.filter(agent=user.agent)
    if user.role == Role.EXECUTIVE:
        return qs.filter(route__executive=user.executive)
    return qs.filter(user=user)
