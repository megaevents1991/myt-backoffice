import { PageHeader } from "@/components/page-header";
import { LeadsInbox } from "@/components/tours/content/leads-inbox";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";

export default function TourLeadsPage() {
  return (
    <div dir="rtl">
      <PageHeader
        title="לידים"
        description="כל פנייה שנשלחה מטופס באתר: טופס לידים, צור קשר, בקשת ביטול, ניוזלטר ובקשה ליועץ. מכאן מסמנים סטטוס, משייכים לאיש צוות ומייצאים לאקסל."
        actions={<PublishSiteButton />}
      />
      <LeadsInbox />
    </div>
  );
}
