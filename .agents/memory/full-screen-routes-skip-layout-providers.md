---
name: Full-screen routes skip Layout-scoped providers
description: Surfaces that render outside <Layout> miss any provider mounted inside Layout (e.g. theming) — mount app-wide providers at the signed-in root instead.
---

# Full-screen routes render outside <Layout>

Some authed surfaces deliberately render OUTSIDE the app shell (`<Layout>`) so they
get the full viewport — notably the Field Display (`/games/:id/display`) and the
`/welcome` onboarding wizard. They live as their own routes in `ProtectedApp`
(App.tsx), siblings of the `<Layout>`-wrapped `<Switch>`, not children of it.

**Rule:** any provider/effect-component that must affect the whole signed-in app
(theme variable injection, global listeners, etc.) must mount at the signed-in
app root in `ProtectedApp` (inside `<Show when="signed-in">`, above the route
`<Switch>`), NOT inside `<Layout>`.

**Why:** `TeamThemeApplier` (sets per-team `--primary`/`--accent` CSS vars on
`<html>`) was originally mounted inside `<Layout>`. The Field Display therefore
never received the team's colors and always showed default navy/gold — the user's
"the colors didn't change" report. Mounting it once at the signed-in root fixes
all surfaces at once and, because it persists across navigation, avoids re-applying
/ theme flicker on route changes.

**How to apply:** before assuming a context/provider covers a page, check whether
that page is rendered inside `<Layout>` or as a standalone full-screen route. If
standalone, the Layout-scoped providers do NOT reach it.
