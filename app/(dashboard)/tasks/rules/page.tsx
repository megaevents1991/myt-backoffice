import { redirect } from "next/navigation";

// Task rules live in a tab on /tasks now (Dor, 17.09). Old links and bookmarks land there.
export default function TaskRulesPage() {
  redirect("/tasks?tab=rules");
}
