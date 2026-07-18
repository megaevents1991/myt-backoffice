import { BlogForm } from "@/components/templates/BlogForm";

export default function NewBlogPage() {
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Add New Post</h1>
      <BlogForm />
    </div>
  );
}
