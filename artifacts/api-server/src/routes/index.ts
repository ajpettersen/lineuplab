import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import lineupsRouter from "./lineups";
import statsRouter from "./stats";
import historyRouter from "./history";
import battingRouter from "./batting";
import constraintsRouter from "./constraints";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(gamesRouter);
router.use(lineupsRouter);
router.use(statsRouter);
router.use(historyRouter);
router.use(battingRouter);
router.use(constraintsRouter);

export default router;
