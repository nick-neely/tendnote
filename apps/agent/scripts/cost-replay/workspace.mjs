import { cpSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createReplayWorkspace(app, workspace) {
  cpSync(join(app, "agent"), join(workspace, "agent"), {
    recursive: true,
    filter: (path) => !path.includes("/schedules"),
  });
  cpSync(join(app, "evals"), join(workspace, "evals"), { recursive: true });
  writeFileSync(
    join(workspace, "agent/tools/web_search.ts"),
    'import { disableTool } from "eve/tools";\nexport default disableTool();\n',
  );
  for (const file of ["package.json", "tsconfig.json"])
    cpSync(join(app, file), join(workspace, file));
  symlinkSync(join(app, "node_modules"), join(workspace, "node_modules"), "dir");
}
