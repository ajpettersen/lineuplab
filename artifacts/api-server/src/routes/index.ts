import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import lineupsRouter from "./lineups";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(gamesRouter);
router.use(lineupsRouter);
router.use(statsRouter);

export default router;
