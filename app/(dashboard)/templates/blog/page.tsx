import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BlogTable } from "./blog-table";

export default function BlogListPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:underline">← Templates</Link>
          <h1 className="text-3xl font-bold">Blog</h1>
        </div>
        <Button asChild><Link href="/templates/blog/new">Add New Post</Link></Button>
      </div>
      <BlogTable />
    </div>
  );
}
