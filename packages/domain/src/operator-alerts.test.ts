import { describe, expect, it } from "vitest";
import { operatorAlertMessage } from "./operator-alerts";

describe("operatorAlertMessage", () => {
  // One backup_surface condition covers a history window that is too short, one
  // that is too long, and a snapshot or branch that would outlive the window, so
  // its fixed titles must not name a direction (#730).
  it("titles the backup-surface alert and recovery as a mismatch, in neither direction", () => {
    const alert = operatorAlertMessage({ condition: "backup_surface", kind: "alert" });
    const recovery = operatorAlertMessage({ condition: "backup_surface", kind: "recovery" });
    expect(alert.title).toBe("Backup surface does not match the Backup Window");
    expect(recovery.title).toBe("Backup surfaces match the Backup Window again");
    expect(recovery.body).toBe(`The "${alert.title}" alert has cleared.`);
    for (const text of [alert.title, recovery.title, recovery.body]) {
      expect(text).not.toMatch(/outlive|inside/i);
    }
  });
});
