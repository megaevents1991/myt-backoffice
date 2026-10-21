import { redirect } from "next/navigation";

// The Events Factory was replaced by the AI Uploader (2026-10-21): old links and bookmarks land there.
export default function FactoryRedirect() {
  redirect("/uploader");
}
