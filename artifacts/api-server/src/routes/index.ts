import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import placementRouter from "./placement";
import levelsRouter from "./levels";
import lessonsRouter from "./lessons";
import exercisesRouter from "./exercises";
import vocabularyRouter from "./vocabulary";
import subscriptionsRouter from "./subscriptions";
import dashboardRouter from "./dashboard";
import reviewRouter from "./review";
import adminRouter from "./admin";
import languagesRouter from "./languages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(profileRouter);
router.use(placementRouter);
router.use(levelsRouter);
router.use(lessonsRouter);
router.use(exercisesRouter);
router.use(vocabularyRouter);
router.use(subscriptionsRouter);
router.use(dashboardRouter);
router.use(reviewRouter);
router.use(adminRouter);
router.use(languagesRouter);

export default router;
