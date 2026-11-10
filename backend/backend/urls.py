"""NewsRound REST API. All endpoints live under /api/ and are JWT-protected unless noted."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from accounts import api as auth
from core import sync_api
from accounts.people import AgentViewSet, CustomerViewSet, ExecutiveViewSet
from billing.api import InvoiceViewSet, PaymentViewSet, RemittanceViewSet
from catalog.api import PriceVersionViewSet, ProductViewSet
from crm.api import DiscountViewSet, SubscriptionViewSet
from distribution.api import DeliveryViewSet, HolidayViewSet, RouteViewSet, StockViewSet, calendar
from engagement.api import ActivityViewSet, ComplaintViewSet, NotificationViewSet, SettingsViewSet, dashboard
from geo.api import LocationViewSet

router = DefaultRouter()
router.register('locations', LocationViewSet, basename='location')
router.register('products', ProductViewSet, basename='product')
router.register('prices', PriceVersionViewSet, basename='price')
router.register('agents', AgentViewSet, basename='agent')
router.register('executives', ExecutiveViewSet, basename='executive')
router.register('customers', CustomerViewSet, basename='customer')
router.register('subscriptions', SubscriptionViewSet, basename='subscription')
router.register('discounts', DiscountViewSet, basename='discount')
router.register('holidays', HolidayViewSet, basename='holiday')
router.register('routes', RouteViewSet, basename='route')
router.register('deliveries', DeliveryViewSet, basename='delivery')
router.register('stock', StockViewSet, basename='stock')
router.register('invoices', InvoiceViewSet, basename='invoice')
router.register('payments', PaymentViewSet, basename='payment')
router.register('remittances', RemittanceViewSet, basename='remittance')
router.register('complaints', ComplaintViewSet, basename='complaint')
router.register('notifications', NotificationViewSet, basename='notification')
router.register('activity', ActivityViewSet, basename='activity')
router.register('settings', SettingsViewSet, basename='settings')

auth_urls = [
    path('lookup/', auth.lookup),
    path('otp/request/', auth.otp_request),
    path('otp/verify/', auth.otp_verify),
    path('mpin/set/', auth.mpin_set),
    path('mpin/login/', auth.mpin_login),
    path('register/', auth.register),
    path('refresh/', TokenRefreshView.as_view()),
    path('me/', auth.me),
]

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include(auth_urls)),
    path('api/calendar/', calendar),
    path('api/dashboard/', dashboard),
    path('api/sync/snapshot/', sync_api.snapshot),
    path('api/sync/bootstrap/', sync_api.bootstrap),
    path('api/sync/reset-demo/', sync_api.reset_demo),
    path('api/', include(router.urls)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
