import { PageHeader } from "@/components/page-header";
import { GuideClient } from "./guide-client";

// The system manual (Dor: "a CLAUDE.md of the system"). Bilingual with a
// language toggle; content lives in guide-content.ts - update it whenever a
// flow it describes changes.
export default function GuidePage() {
  return (
    <div className="container mx-auto space-y-4 py-10">
      <PageHeader title="Guide" description="MYT Backoffice — how everything works" />
      <GuideClient />
    </div>
  );
}
