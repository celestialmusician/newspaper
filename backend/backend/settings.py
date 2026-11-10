"""
Django settings for the NewsRound newspaper agency platform.

Environment-driven (python-decouple). Copy `.env.example` to `.env`.
PostgreSQL is the production database (set DB_ENGINE=postgres); SQLite is used
automatically for local development when no database is configured.
"""
from datetime import timedelta
from pathlib import Path

from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('DJANGO_SECRET_KEY', default='django-insecure-)elbrvpa(!w88anwa-d5=6ec9tl3(sv0e45_@)c*@w@ow8k&(!')
DEBUG = config('DJANGO_DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('DJANGO_ALLOWED_HOSTS', default='127.0.0.1,localhost', cast=Csv())

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'django_filters',
    'corsheaders',
    'accounts',
    'geo',
    'catalog',
    'crm',
    'distribution',
    'billing',
    'engagement',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'

# ---------------------------------------------------------------- Database
# DB_ENGINE=postgres  → PostgreSQL (recommended; required for PostGIS)
# USE_POSTGIS=true    → django.contrib.gis backend (needs GDAL/GEOS installed)
DB_ENGINE = config('DB_ENGINE', default='sqlite')
USE_POSTGIS = config('USE_POSTGIS', default=False, cast=bool)
if DB_ENGINE == 'postgres':
    DATABASES = {
        'default': {
            'ENGINE': 'django.contrib.gis.db.backends.postgis' if USE_POSTGIS else 'django.db.backends.postgresql',
            'NAME': config('DB_NAME', default='newsround'),
            'USER': config('DB_USER', default='postgres'),
            'PASSWORD': config('DB_PASSWORD', default=''),
            'HOST': config('DB_HOST', default='127.0.0.1'),
            'PORT': config('DB_PORT', default='5432'),
            'CONN_MAX_AGE': 60,
        }
    }
    if USE_POSTGIS:
        INSTALLED_APPS.append('django.contrib.gis')
else:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}

AUTH_USER_MODEL = 'accounts.User'
AUTH_PASSWORD_VALIDATORS = []  # MPIN auth; staff passwords for /admin are set via createsuperuser

LANGUAGE_CODE = 'en-in'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------- API
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.Pagination',
    'PAGE_SIZE': 25,
    'DEFAULT_THROTTLE_RATES': {'otp': '8/hour', 'anon': '60/minute'},
    'EXCEPTION_HANDLER': 'accounts.api.exception_handler',
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=config('JWT_ACCESS_HOURS', default=12, cast=int)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=config('JWT_REFRESH_DAYS', default=30, cast=int)),
    'ROTATE_REFRESH_TOKENS': True,
}

CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default='http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173', cast=Csv())

# OTP — DEMO mode returns the code in the API response so the prototype works without an SMS gateway.
OTP_DEMO_MODE = config('OTP_DEMO_MODE', default=True, cast=bool)
OTP_TTL_SECONDS = 300
OTP_RESEND_COOLDOWN_SECONDS = 20

# Payment gateway — SIMULATED unless real credentials are configured.
PAYMENT_GATEWAY = config('PAYMENT_GATEWAY', default='simulated')

# Web Push (VAPID) — leave empty to disable push delivery.
VAPID_PUBLIC_KEY = config('VAPID_PUBLIC_KEY', default='')
VAPID_PRIVATE_KEY = config('VAPID_PRIVATE_KEY', default='')
