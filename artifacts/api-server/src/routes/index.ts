import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveTeamContext } from "../middlewares/resolveTeamContext";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import tournamentsRouter from "./tournaments";
import pitchCountsRouter from "./pitch-counts";
import lineupsRouter from "./lineups";
import statsRouter from "./stats";
import historyRouter from "./history";
import battingRouter from "./batting";
import constraintsRouter from "./constraints";
import aiAssistantRouter from "./ai-assistant";
import lineupFromImageRouter from "./lineup-from-image";
import locksRouter from "./locks";
import teamSettingsRouter from "./team-settings";
import preferencesRouter from "./preferences";
import teamRouter from "./team";

const router: IRouter = Router();

// Public routes — no auth required.
router.use(healthRouter);

// All routes mounted below this line require an authenticated coach.
// resolveTeamContext sets req.ownerUserId (the data scope) based on the
// user's saved active team — see middleware for fallback behavior when
// the saved selection is stale.
router.use(requireAuth);
router.use(resolveTeamContext);

router.use(playersRouter);
router.use(gamesRouter);
router.use(tournamentsRouter);
router.use(pitchCountsRouter);
router.use(lineupsRouter);
router.use(statsRouter);
router.use(historyRouter);
router.use(battingRouter);
router.use(constraintsRouter);
router.use(aiAssistantRouter);
router.use(lineupFromImageRouter);
router.use(locksRouter);
router.use(teamSettingsRouter);
router.use(preferencesRouter);
router.use(teamRouter);

export default router;
