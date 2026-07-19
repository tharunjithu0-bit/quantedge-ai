"""
database/db.py
---------------
Reusable database connection module. Builds a single SQLAlchemy engine
from the app config and exposes helpers for getting a connection,
testing connectivity, and initializing tables from ORM models.

Models (in models/) import `Base` from here and inherit from it.
Routes that need a session import `SessionLocal` from here.
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import SQLAlchemyError

from config import Config

# A single, reusable engine for the whole app. SQLAlchemy engines manage
# their own connection pool internally, so this should be created once
# and imported wherever a connection is needed — never recreated per request.
engine = create_engine(
    Config.DATABASE_URI,
    pool_pre_ping=True,  # verifies connections are alive before using them
    pool_recycle=280,    # recycle connections periodically to avoid MySQL timeouts
)

# Base class every ORM model inherits from. Importing Base here (rather
# than each model creating its own) is what lets Base.metadata.create_all()
# see every model's table in one place.
Base = declarative_base()

# Session factory for future CRUD work. Not used yet in this step —
# routes will call SessionLocal() to get a session once CRUD endpoints
# are added.
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_connection():
    """
    Return a live connection checked out from the pool.
    Caller is responsible for closing it (use as a context manager):

        with get_connection() as conn:
            conn.execute(text("SELECT 1"))
    """
    return engine.connect()


def test_connection():
    """
    Attempt to connect to MySQL and run a trivial query.

    Returns:
        (success: bool, error_message: str | None)
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as e:
        return False, str(e.__cause__ or e)
    except Exception as e:
        return False, str(e)


def init_db():
    """
    Create all tables registered on Base.metadata if they don't already
    exist. Safe to call repeatedly — create_all() is a no-op for tables
    that are already present.

    Models must be imported before this runs so they're registered on
    Base.metadata; importing models/__init__.py (done at call sites)
    takes care of that.

    Returns:
        (success: bool, error_message: str | None)
    """
    try:
        Base.metadata.create_all(bind=engine)
        return True, None
    except SQLAlchemyError as e:
        return False, str(e.__cause__ or e)
    except Exception as e:
        return False, str(e)
