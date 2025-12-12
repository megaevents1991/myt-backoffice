import { Metadata } from "next";

export const metadata: Metadata = {
  title: "TixStock Events | MYT Backoffice",
  description: "Manage TixStock events and tickets",
};

export default function TixStockEventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">{children}</div>;
}
