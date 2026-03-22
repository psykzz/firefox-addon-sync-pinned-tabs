"""Sync Pinned Tabs – FastAPI server."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import Profile, Tab, create_tables, get_db
from models import ProfileResponse, TabItem, TabsPayload, TabsResponse

app = FastAPI(title="Sync Pinned Tabs", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
create_tables()


# ── routes ────────────────────────────────────────────────────────────────────


@app.post("/profiles", response_model=ProfileResponse, status_code=201)
def create_profile(db: Session = Depends(get_db)) -> ProfileResponse:
    """Register a new profile and return its ID."""
    profile = Profile(id=str(uuid.uuid4()))
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@app.get("/profiles/{profile_id}/tabs", response_model=TabsResponse)
def get_tabs(
    profile_id: str,
    response: Response,
    db: Session = Depends(get_db),
) -> TabsResponse:
    """Return the pinned tabs stored for a profile."""
    profile = db.get(Profile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    tabs = profile.tabs
    last_modified: Optional[datetime] = None
    if tabs:
        last_modified = max(t.last_modified for t in tabs)

    # Allow clients to cache this response for 60 seconds
    response.headers["Cache-Control"] = "max-age=60, private"
    if last_modified:
        response.headers["Last-Modified"] = last_modified.strftime(
            "%a, %d %b %Y %H:%M:%S GMT"
        )

    return TabsResponse(
        profile_id=profile_id,
        tabs=[TabItem(url=t.url, title=t.title) for t in tabs],
        last_modified=last_modified,
    )


@app.put("/profiles/{profile_id}/tabs", response_model=TabsResponse)
def update_tabs(
    profile_id: str,
    payload: TabsPayload,
    db: Session = Depends(get_db),
) -> TabsResponse:
    """Replace the pinned tabs for a profile."""
    profile = db.get(Profile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")

      # Always use server time to avoid clock-skew issues.
    now = datetime.now(timezone.utc)

    # Delete existing tabs and replace with the new list
    for tab in list(profile.tabs):
        db.delete(tab)
    db.flush()

    new_tabs = []
    for item in payload.tabs:
        tab = Tab(
            id=str(uuid.uuid4()),
            profile_id=profile_id,
            url=item.url,
            title=item.title,
            last_modified=now,
        )
        db.add(tab)
        new_tabs.append(tab)

    db.commit()

    return TabsResponse(
        profile_id=profile_id,
        tabs=[TabItem(url=t.url, title=t.title) for t in new_tabs],
        last_modified=now if new_tabs else None,
    )


@app.get("/health")
def health() -> dict:
    """Simple health-check endpoint."""
    return {"status": "ok"}
