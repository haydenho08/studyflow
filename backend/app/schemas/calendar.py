from pydantic import BaseModel, Field


class CalendarFeed(BaseModel):
    path: str | None = Field(
        description="The feed's path on this site (/api/calendar/<secret>.ics), or null while off."
    )
