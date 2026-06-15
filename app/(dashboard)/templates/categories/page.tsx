import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CategoriesTable } from "./categories-table";

export default async function CategoriesPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:underline">
            ← Templates
          </Link>
          <h1 className="text-3xl font-bold">Categories</h1>
        </div>
        <Button asChild>
          <Link href="/templates/categories/new">Add New Category</Link>
        </Button>
      </div>
      <CategoriesTable />
    </div>
  );
}
