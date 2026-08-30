import { Router } from "express";
import { CallsQueryService } from "../services/CallsQueryService.js";

const queryService = new CallsQueryService();

export const mattersRouter = Router();

mattersRouter.get("/matters/:id", async (req, res, next) => {
  try {
    const matter = await queryService.getMatter(req.params.id);
    if (!matter) {
      res.status(404).json({ error: "matter_not_found" });
      return;
    }
    res.json({ matter });
  } catch (err) {
    next(err);
  }
});
