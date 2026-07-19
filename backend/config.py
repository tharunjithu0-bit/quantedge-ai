"""
config.py
---------
Centralized configuration for the Flask app. Values are read from
environment variables (loaded from .env in local dev) where possible,
with sane local-dev defaults.

As the project grows, add environment-specific subclasses here
(e.g. DevelopmentConfig, ProductionConfig) instead of scattering
settings across files.
"""

import os
from dotenv import load_dotenv

# Load variables from .env into the process environment.
# In production, these should instead be set directly in the environment
# (e.g. via the hosting platform's secrets/config manager).
load_dotenv()


class Config:
    # General
    DEBUG = os.environ.get("FLASK_DEBUG", "True") == "True"
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")

    # MySQL connection settings
    MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
    MYSQL_PORT = os.environ.get("MYSQL_PORT", "3306")
    MYSQL_USER = os.environ.get("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
    MYSQL_DB = os.environ.get("MYSQL_DB", "quantedge")

    # SQLAlchemy-style connection URI, built from the pieces above.
    # mysql+pymysql://<user>:<password>@<host>:<port>/<database>
    DATABASE_URI = (
        f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}"
        f"@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"
    )

    # CORS (placeholder — will be restricted to the frontend origin later)
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")

    # JWT auth settings. In production, set JWT_SECRET_KEY to a long,
    # random value via the environment — never rely on the dev default.
    # Defaults to SECRET_KEY if JWT_SECRET_KEY isn't set separately.
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", SECRET_KEY)
    JWT_EXP_HOURS = int(os.environ.get("JWT_EXP_HOURS", "24"))