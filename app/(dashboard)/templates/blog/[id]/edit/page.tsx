import { BlogForm } from "@/components/templates/BlogForm";
import { getBlogPost } from "@/lib/actions/blog-actions";
import { notFound } from "next/navigation";

export default async function EditBlogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial;
  try {
    initial = await getBlogPost(Number(id));
  } catch {
    notFound();
  }
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Edit Post</h1>
      <BlogForm initial={initial} />
    </div>
  );
}
