import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
const app = await createApp(config);
await app.listen(config.port, "0.0.0.0");
