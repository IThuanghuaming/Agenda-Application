import express from "express";
import { taskRouter } from "./routes/taskRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/tasks", taskRouter);
app.use(errorHandler);