/** STUB - Task 10 replaces this with the real budget-bleed / viral-post alerts. */
export async function runMarketingAlerts(_opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mail: "sent" | "skipped" | "failed" }> {
  return { newAlerts: 0, resolved: 0, mail: "skipped" };
}
