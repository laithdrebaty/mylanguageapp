import { Router, type IRouter } from "express";
import dashboardRouter from "./dashboard";
import lessonsRouter from "./lessons";
import contentRouter from "./content";
import catalogRouter from "./catalog";
import vocabRouter from "./vocab";
import mediaRouter from "./media";
import reviewsRouter from "./reviews";
import gradingRouter from "./grading";
import quizzesRouter from "./quizzes";
import practiceReportsRouter from "./practice-reports";
import placementRouter from "./placement";

const router: IRouter = Router();

router.use(dashboardRouter);
router.use(lessonsRouter);
router.use(contentRouter);
router.use(catalogRouter);
router.use(vocabRouter);
router.use(mediaRouter);
router.use(reviewsRouter);
router.use(gradingRouter);
router.use(quizzesRouter);
router.use(practiceReportsRouter);
router.use(placementRouter);

export default router;
