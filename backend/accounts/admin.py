from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AgentProfile, CustomerProfile, ExecutiveProfile, User


@admin.register(User)
class NewsRoundUserAdmin(UserAdmin):
    list_display = ['name', 'role', 'mobile', 'status', 'last_login']
    list_filter = ['role', 'status']
    search_fields = ['name', 'mobile']
    fieldsets = UserAdmin.fieldsets + (('NewsRound', {'fields': ('role', 'mobile', 'name', 'status', 'ext_id')}),)


admin.site.register([AgentProfile, ExecutiveProfile, CustomerProfile])
