"use client";

import { CouponsTable } from "./coupons-table";

export default function CouponsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Coupons</h1>
        <p className="text-muted-foreground">
          Discount codes customers can enter on the order summary. The bigger
          discount wins - coupons never stack with affiliate discounts.
        </p>
      </div>

      <CouponsTable />
    </div>
  );
}
