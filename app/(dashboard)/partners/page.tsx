import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PlusCircle } from "lucide-react"
import { PartnersTable } from "./partners-table"

export default function PartnersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Partners</h1>
          <p className="text-muted-foreground">Manage your affiliate partners and their commission rates.</p>
        </div>
        <Link href="/partners/new">
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Partner
          </Button>
        </Link>
      </div>

      <PartnersTable />
    </div>
  )
}

