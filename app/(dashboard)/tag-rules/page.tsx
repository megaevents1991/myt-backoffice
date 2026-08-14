import { redirect } from "next/navigation";

// Merged into the Tags screen (banner tabs) - old links land on the rules tab.
export default function TagRulesPage() {
  redirect("/event-tags?tab=rules");
}
