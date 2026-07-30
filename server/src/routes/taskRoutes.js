import { Router } from "express";
import { TaskController } from "../controllers/taskController.js";

export const taskRouter = Router();

taskRouter.get("/", TaskController.list);
taskRouter.post("/", TaskController.create);
taskRouter.put("/", TaskController.replaceAll);
taskRouter.post("/import", TaskController.importMany);
taskRouter.post("/reorder", TaskController.reorder);
taskRouter.delete("/completed", TaskController.clearCompleted);
taskRouter.delete("/all", TaskController.clearAll);
taskRouter.patch("/:id", TaskController.update);
taskRouter.delete("/:id", TaskController.remove);