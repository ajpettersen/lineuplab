Drop landing-page feature screenshots here. The Features section on
`/` (see `src/pages/landing.tsx`) renders one image per card, picked
up automatically as soon as a matching file exists:

- `ai-lineups.png`      — AI lineup generator (e.g. `/games/:id` defense tab)
- `roster.png`          — Roster page (`/players`)
- `stats.png`           — Season stats (`/season-stats`) or rotation report (`/stats`)
- `schedule.png`        — Schedule (`/games`) or practices
- `field-display.png`   — Field display (`/games/:id/display`)
- `youth-coaches.png`   — Hero/dashboard or any general workflow shot

Recommended: 16:9 aspect (any resolution; cards display ~360×200).
PNG or JPG works (the path can be `.jpg` if you update `landing.tsx`).
Until a file exists, each card shows a stylized icon-on-gradient
placeholder.
