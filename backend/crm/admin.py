from django.contrib import admin
from django.apps import apps

for m in apps.get_app_config('crm').get_models():
    admin.site.register(m)
