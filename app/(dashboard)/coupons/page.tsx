"use client";

import { PageHeader } from "@/components/page-header";
import { CouponsTable } from "./coupons-table";

export default function CouponsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        description="Discount codes customers can enter on the order summary. The bigger discount wins - coupons never stack with affiliate discounts."
      />

      <CouponsTable />
    </div>
  );
}
