import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.TENDNOTE_AGENT_MODEL ?? "openai/gpt-5.4-mini",
});
