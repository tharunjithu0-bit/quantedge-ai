"""
app.py
------
Application entry point. Creates the Flask app via a factory function,
configures extensions (CORS), registers blueprints, initializes the
database, and runs the dev server.
"""

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

# Load environment variables
load_dotenv()

from config import Config
from database.db import init_db

# IMPORTANT: Import models BEFORE init_db() so SQLAlchemy knows
# about every table (users, trades, etc.)
import models

from routes.main_routes import main_bp
from routes.db_routes import db_bp
from routes.trade_routes import trade_bp
from routes.ai_routes import ai_bp
from routes.auth_routes import auth_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # Enable CORS
    CORS(app, resources={r"/*": {"origins": Config.CORS_ORIGINS}})

    # Register blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(db_bp)
    app.register_blueprint(trade_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(auth_bp)

    # Create database tables if they don't exist
    success, error = init_db()
    if success:
        print("✅ Database initialized successfully.")
    else:
        print(f"❌ Database initialization failed: {error}")

    return app


app = create_app()

if __name__ == "__main__":
    app.run(
        debug=app.config.get("DEBUG", True),
        host="0.0.0.0",
        port=5000,
    )