import { askBot } from "./openai.js";
import dotenv from "dotenv";
dotenv.config();

console.log("✅ API key loaded:", process.env.OPENAI_API_KEY ? "Yes" : "No");
console.log("🧠 Model:", process.env.OPENAI_MODEL);

askBot("Hello bot, how are you?");
