import { app } from "./app.js";
import { databasePath } from "./config/database.js";

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Agenda API: http://localhost:${port}`);
  console.log(`SQLite: ${databasePath}`);
});