import { Router } from "express";
import { PatientsQueryService } from "../services/PatientsQueryService.js";

const queryService = new PatientsQueryService();

export const patientsRouter = Router();

patientsRouter.get("/patients/:id", async (req, res, next) => {
  try {
    const patient = await queryService.getPatient(req.params.id);
    if (!patient) {
      res.status(404).json({ error: "patient_not_found" });
      return;
    }
    res.json({ patient });
  } catch (err) {
    next(err);
  }
});
