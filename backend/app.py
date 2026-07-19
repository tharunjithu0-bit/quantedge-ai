"""
app.py
------
Application entry point. Creates the Flask app via a factory function,
configures extensions (CORS), registers blueprints, and runs the dev server.
"""

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

# Load environment variables (e.g. GEMINI_API_KEY) from a local .env file
# before anything else touches os.environ. Safe to call even if no .env
# exists — it's a no-op in that case.
load_dotenv()

from config import Config
from routes.main_routes import main_bp
from routes.db_routes import db_bp
from routes.trade_routes import trade_bp
from routes.ai_routes import ai_bp
from routes.auth_routes import auth_bp


def create_app():
    """Application factory: builds and configures the Flask app instance."""
    app = Flask(__name__)
    app.config.from_object(Config)

    # Enable CORS for all routes. Origins will be restricted once the
    # React frontend is wired up in a later step.
    CORS(app)

    # Register blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(db_bp)
    app.register_blueprint(trade_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(auth_bp)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=app.config.get("DEBUG", True), port=5000)