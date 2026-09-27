"""
FastAPI application factory and middleware setup.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router
from app.api.websockets.telemetry_ws import ws_router


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="RF Smart Scheduler - Cognitive EW Scan API",
        description=(
            "High-performance FastAPI and WebSocket backend for real-time cognitive "
            "radar frequency band scheduling using Contextual Bandits (LinUCB) and "
            "Pulse Descriptor Words (PDWs)."
        ),
        version="2.0.0",
    )

    # Enable CORS for frontend clients (Vite dev server, localhost, etc.)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register modular REST and WebSocket routers
    app.include_router(api_router)
    app.include_router(ws_router)

    return app


app = create_app()
