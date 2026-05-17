import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveTeamContext } from "../middlewares/resolveTeamContext";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import tournamentsRouter from "./tournaments";
import poolPlayRouter from "./pool-play";
import tournamentNetworkRouter from "./tournament-network";
import pitchCountsRouter from "./pitch-counts";
import pitchingRouter from "./pitching";
import armWatchRouter from "./arm-watch";
import lineupsRouter from "./lineups";
import statsRouter from "./stats";
import historyRouter from "./history";
import battingRouter from "./batting";
import boxScoreRouter from "./box-score";
import constraintsRouter from "./constraints";
import aiAssistantRouter from "./ai-assistant";
import lineupFromImageRouter from "./lineup-from-image";
import locksRouter from "./locks";
import teamSettingsRouter from "./team-settings";
import preferencesRouter from "./preferences";
import teamRouter from "./team";
import practicesRouter from "./practices";
import practicePlanAiRouter from "./practice-plan-ai";
import demoSeedRouter from "./demo-seed";
import dashboardRouter from "./dashboard";
import coachProfileRouter from "./coach-profile";
import adminRouter from "./admin";
import helpRouter from "./help";
import heartbeatRouter from "./heartbeat";
import pushRouter from "./push";

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
router.use(poolPlayRouter);
router.use(tournamentNetworkRouter);
router.use(pitchCountsRouter);
router.use(lineupsRouter);
router.use(statsRouter);
router.use(historyRouter);
router.use(battingRouter);
router.use(pitchingRouter);
router.use(armWatchRouter);
router.use(boxScoreRouter);
router.use(constraintsRouter);
router.use(aiAssistantRouter);
router.use(lineupFromImageRouter);
router.use(locksRouter);
router.use(teamSettingsRouter);
router.use(preferencesRouter);
router.use(teamRouter);
router.use(practicesRouter);
router.use(practicePlanAiRouter);
router.use(demoSeedRouter);
router.use(dashboardRouter);
router.use(coachProfileRouter);
router.use(adminRouter);
router.use(helpRouter);
router.use(heartbeatRouter);
router.use(pushRouter);

export default router;
