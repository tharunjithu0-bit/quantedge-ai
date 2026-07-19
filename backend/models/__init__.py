# The models package holds database model classes (ORM classes).
#
# trade.py   - the Trade model (trade journal entries)
# user.py    - the User model (authentication)
#
# Importing models here ensures every model is registered on
# Base.metadata before init_db() / create_all() runs.

from models.trade import Trade
from models.user import User

__all__ = ["Trade", "User"]