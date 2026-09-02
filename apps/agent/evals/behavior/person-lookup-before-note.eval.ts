import { defineEval } from "../define-eval";

export default defineEval({
  description: "Notes about a named person resolve identity before linking context.",
  tags: ["deterministic", "behavior", "disambiguation"],
  async test(t) {
    await t.send("Log a note for Sam: he asked for a reminder after the next heavy rain.");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Sam/i } });
    t.calledTool("capture_source_record");
    t.toolOrder(["search_people", "capture_source_record"]);
    t.notCalledTool("create_person");
  },
});
