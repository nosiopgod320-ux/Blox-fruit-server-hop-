import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import serversRouter from "./servers.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(serversRouter);

export default router;
