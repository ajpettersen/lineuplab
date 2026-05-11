import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * End-to-end coverage for the Select Positions feature + name helper changes
 * shipped in Task #1. Walks through:
 *
 *   1. Short-name "First L." chip rendering on the lineup grid AND on the
 *      Field Display field chips (formatPlayerNameShort is the shared helper).
 *   2. Select Positions dialog round-trip (9 ↔ 10 player field).
 *   3. Lineup grid switching from 9 to 10 columns including LCF/RCF.
 *   4. Field Display rendering LCF + RCF slot positions (and not CF).
 *   5. Innings-by-Position tally treating LCF/RCF as Outfield (no separate
 *      LCF/RCF columns).
 *   6. team_settings.activeFieldPositions persisting both ways.
 *
 * NOTE on the "switch back to 9 drops LCF/RCF from the grid header" check:
 * the grid intentionally renders the union of (active positions ∪ positions
 * present in the saved lineup) so historical games keep their original
 * columns (see `displayPositions` in
 * artifacts/baseball-lineup/src/pages/game-detail.tsx). The source-of-truth
 * for the team's choice is therefore GET /api/team-settings — that's what
 * we assert.
 */

const STANDARD_9 = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const TEN = ["P", "C", "1B", "2B", "3B", "SS", "LF", "LCF", "RCF", "RF"];

type GeneratedEntry = {
  playerId: number;
  inning: number;
  position: string;
  battingOrder: number | null;
};

async function ensureTestUser(): Promise<{ email: string; password: string }> {
  const fixedEmail = process.env.E2E_CLERK_USER_EMAIL;
  const fixedPassword = process.env.E2E_CLERK_USER_PASSWORD;
  if (fixedEmail && fixedPassword) {
    return { email: fixedEmail, password: fixedPassword };
  }
  // Create a disposable Clerk user for this run via the Backend API. The
  // `+clerk_test` local-part forces Clerk's test-mode (no real email sent).
  // See https://clerk.com/docs/testing/test-emails-and-phones
  const stamp = Date.now();
  const email = `e2e+clerk_test+${stamp}@example.com`;
  const password = `Pw_${stamp}_AaBbCc!`;
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: "E2E",
      last_name: "Coach",
      skip_password_checks: true,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create disposable Clerk test user: ${res.status} ${await res.text()}`,
    );
  }
  return { email, password };
}

async function getApiContextWithSession(page: Page, baseURL: string) {
  // Re-use the browser cookies (set by Clerk after sign-in) for API requests
  // so we hit the API as the signed-in coach.
  const storageState = await page.context().storageState();
  return await request.newContext({ baseURL, storageState });
}

async function generateAndSaveLineup(api: APIRequestContext, gameId: number) {
  const playersRes = await api.get("/api/players");
  expect(playersRes.ok()).toBeTruthy();
  const players = (await playersRes.json()) as Array<{ id: number }>;
  expect(players.length).toBeGreaterThanOrEqual(10);
  const generateRes = await api.post(`/api/games/${gameId}/lineup/generate`, {
    data: { availablePlayerIds: players.map((p) => p.id), constraints: {} },
  });
  expect(
    generateRes.ok(),
    `generate failed: ${generateRes.status()} ${await generateRes.text()}`,
  ).toBeTruthy();
  const previewEntries = (await generateRes.json()) as GeneratedEntry[];
  expect(previewEntries.length).toBeGreaterThan(0);
  const saveRes = await api.post(`/api/games/${gameId}/lineup/save`, {
    data: {
      entries: previewEntries.map((e) => ({
        playerId: e.playerId,
        inning: e.inning,
        position: e.position,
        battingOrder: e.battingOrder,
      })),
    },
  });
  expect(saveRes.ok()).toBeTruthy();
  return previewEntries;
}

async function getDefenseHeaderPositions(page: Page): Promise<string[]> {
  // Scoped to the defensive lineup card only — avoids picking up headers
  // from other tables on the page (e.g. the innings tally).
  const headers = await page
    .getByTestId("card-defensive-lineup")
    .locator("table thead tr th")
    .allInnerTexts();
  return headers
    .map((t) => t.trim())
    .filter((t) => t && t !== "Inning" && t.toLowerCase() !== "bench");
}

const SHORT_NAME_RE = /^[A-Za-z][A-Za-z\-']*\s[A-Z]\.$/;

test.describe("Select Positions + name helper", () => {
  test("9 ↔ 10 player field round-trip with chip + tally + field-display", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    expect(baseURL, "baseURL must be set in playwright.config.ts").toBeTruthy();

    const { email, password } = await ensureTestUser();
    await setupClerkTestingToken({ page });

    // 1. Sign in via Clerk's testing helper (no UI driving).
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: { strategy: "password", identifier: email, password },
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const api = await getApiContextWithSession(page, baseURL!);

    // 2. Seed roster + sample games via the dev-only demo seed endpoint.
    const seed = await api.post("/api/demo/seed", { data: {} });
    expect(
      [200, 201, 409].includes(seed.status()),
      `demo seed unexpected status ${seed.status()}: ${await seed.text()}`,
    ).toBeTruthy();

    // 3. Enable the Select Positions UI gate + force standard-9 baseline.
    expect(
      (await api.patch("/api/team-settings", {
        data: { showSelectPositions: true, activeFieldPositions: STANDARD_9 },
      })).ok(),
    ).toBeTruthy();

    // 4. Pick the first game.
    const gamesRes = await api.get("/api/games");
    expect(gamesRes.ok()).toBeTruthy();
    const games = (await gamesRes.json()) as Array<{ id: number }>;
    expect(games.length).toBeGreaterThan(0);
    const gameId = games[0].id;

    // 5. Seed a 9-player saved lineup so the defense grid (and short-name
    //    chips) actually render. The defense card shows an empty placeholder
    //    when displayLineup.length === 0, so we MUST have a saved lineup
    //    before any header / chip assertions.
    const nineEntries = await generateAndSaveLineup(api, gameId);

    await page.goto(`/games/${gameId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("button-select-positions")).toBeVisible();
    await expect(page.getByTestId("card-defensive-lineup")).toBeVisible();

    // 6. Initial standard-9 header check — scoped to the defense card.
    expect(await getDefenseHeaderPositions(page)).toEqual(STANDARD_9);

    // 7. Short-name chip on the lineup grid for an inning-1 player tile.
    {
      const inning1Cf = page.getByTestId("cell-1-CF").first();
      await expect(inning1Cf).toBeVisible();
      const chipText = (await inning1Cf.innerText()).trim();
      expect(chipText.length).toBeGreaterThan(0);
      // Demo roster names all have a last name, so the strict "First L."
      // pattern must hold.
      expect(chipText, `chip "${chipText}" should be First L. format`).toMatch(
        SHORT_NAME_RE,
      );
    }

    // 8. Switch to 10-player mode through the dialog.
    await page.getByTestId("button-select-positions").click();
    await expect(page.getByTestId("radio-positions-standard")).toBeVisible();
    await expect(page.getByTestId("radio-positions-ten")).toBeVisible();
    await page.getByTestId("radio-positions-ten").click();
    await page.getByTestId("button-positions-save").click();
    await expect(page.getByTestId("button-positions-save")).toBeHidden();

    // 9. Generate + save a 10-player lineup so LCF/RCF cells populate.
    const tenEntries = await generateAndSaveLineup(api, gameId);
    expect(
      tenEntries.some((e) => e.position === "LCF" || e.position === "RCF"),
      "10-player generate should produce at least one LCF/RCF entry",
    ).toBeTruthy();
    void nineEntries;

    await page.reload();
    await page.waitForLoadState("networkidle");

    // 10. Defense headers reflect the 10-player layout.
    await expect
      .poll(async () => getDefenseHeaderPositions(page), { timeout: 10_000 })
      .toEqual(TEN);

    // 11. At least one of inning-1 LCF or RCF must be a populated tile.
    const inning1LCF = page.getByTestId("cell-1-LCF");
    const inning1RCF = page.getByTestId("cell-1-RCF");
    const lcfCount = await inning1LCF.count();
    const rcfCount = await inning1RCF.count();
    expect(
      lcfCount + rcfCount,
      "expected a player tile in inning 1 LCF or RCF after generate+save",
    ).toBeGreaterThan(0);
    const populatedCell = lcfCount > 0 ? inning1LCF.first() : inning1RCF.first();
    const populatedPos = lcfCount > 0 ? "LCF" : "RCF";
    {
      const chipText = (await populatedCell.innerText()).trim();
      expect(chipText, `chip "${chipText}" should be First L. format`).toMatch(
        SHORT_NAME_RE,
      );
    }

    // 12. Innings tally: switch to the Innings tab first (the panel is
    //     `forceMount`-ed but `data-[state=inactive]:hidden`, so the
    //     visibility assertion would fail until we activate the tab).
    const populatedPlayer = tenEntries.find(
      (e) => e.inning === 1 && e.position === populatedPos,
    );
    expect(populatedPlayer, `no preview entry for inning 1 ${populatedPos}`).toBeTruthy();

    await page.getByTestId("tab-innings").click();
    const tallyOutfield = page.getByTestId(
      `tally-${populatedPlayer!.playerId}-outfield`,
    );
    await expect(tallyOutfield).toBeVisible();
    expect(
      Number.parseInt((await tallyOutfield.innerText()).trim(), 10),
      `tally outfield for player ${populatedPlayer!.playerId} should be >= 1`,
    ).toBeGreaterThanOrEqual(1);
    // No separate LCF / RCF tally columns exist.
    expect(
      await page.getByTestId(`tally-${populatedPlayer!.playerId}-lcf`).count(),
    ).toBe(0);
    expect(
      await page.getByTestId(`tally-${populatedPlayer!.playerId}-rcf`).count(),
    ).toBe(0);

    // 13. Field Display: open the standalone /games/:id/display page and
    //     verify LCF + RCF slot positions render (not CF). Field chip text
    //     also uses formatPlayerNameShort, so re-assert the "First L."
    //     pattern there.
    await page.goto(`/games/${gameId}/display`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("field-pos-LCF").first()).toBeVisible();
    await expect(page.getByTestId("field-pos-RCF").first()).toBeVisible();
    expect(await page.getByTestId("field-pos-CF").count()).toBe(0);
    {
      const fieldChip = page.getByTestId(`field-chip-${populatedPos}`).first();
      await expect(fieldChip).toBeVisible();
      const text = (await fieldChip.innerText()).trim();
      // Field chip renders the position label THEN the short name; assert
      // the short-name suffix matches the "First L." pattern.
      const lastLine = text.split(/\s+/).slice(-2).join(" ");
      expect(lastLine, `field chip text "${text}"`).toMatch(SHORT_NAME_RE);
    }

    // 14. Switch back to standard 9 via the dialog. Source-of-truth check
    //     is GET /api/team-settings — see header note at top of file.
    await page.goto(`/games/${gameId}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("button-select-positions").click();
    await page.getByTestId("radio-positions-standard").click();
    await page.getByTestId("button-positions-save").click();
    await expect(page.getByTestId("button-positions-save")).toBeHidden();

    const finalSettings = await api.get("/api/team-settings");
    expect(finalSettings.ok()).toBeTruthy();
    expect((await finalSettings.json()).activeFieldPositions).toEqual(STANDARD_9);
  });
});
