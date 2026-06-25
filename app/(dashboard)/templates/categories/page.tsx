import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CategoriesTable } from "./categories-table";
import { RevalidateButton } from "@/components/templates/RevalidateButton";

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
        <div className="flex items-center gap-2">
          <RevalidateButton />
          <Button asChild>
            <Link href="/templates/categories/new">Add New Category</Link>
          </Button>
        </div>
      </div>
      <CategoriesTable />
    </div>
  );
}
