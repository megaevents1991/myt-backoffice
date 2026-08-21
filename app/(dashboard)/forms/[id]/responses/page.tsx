import { redirect } from "next/navigation";

// The standalone responses page was removed (doc 21.08): the trips report
// already lists every response, with the full-answer popup. Old links land there.
export default async function FormResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/forms/${id}/report`);
}
