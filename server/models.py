"""Pydantic models (request/response schemas) for the Sync Pinned Tabs server."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class TabItem(BaseModel):
    url: str
    title: str = ""


class ProfileCreate(BaseModel):
    pass


class ProfileResponse(BaseModel):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TabsPayload(BaseModel):
    tabs: List[TabItem]
    last_modified: Optional[str] = None


class TabsResponse(BaseModel):
    profile_id: str
    tabs: List[TabItem]
    last_modified: Optional[datetime]
