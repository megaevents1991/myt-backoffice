import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { guardAdminRoute } from "@/lib/auth/guards";
import { getForm } from "@/lib/actions/form-actions";
import { getFormResponses } from "@/lib/actions/form-response-actions";
import { formatAnswer } from "@/lib/forms/validation";
import { adminLabel } from "@/lib/forms/i18n";

// Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
function safeSheetName(name: string): string {
  return (name || "Responses").replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
}

function safeFileName(name: string): string {
  return (name || "form").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "form";
}

export async function GET(request: Request) {
  const denied = await guardAdminRoute();
  if (denied) return denied;

  const formId = Number(new URL(request.url).searchParams.get("formId"));
  if (!Number.isFinite(formId)) {
    return NextResponse.json({ error: "formId is required" }, { status: 400 });
  }

  try {
    const loaded = await getForm(formId);
    if (!loaded) return NextResponse.json({ error: "Form not found" }, { status: 404 });

    const responses = await getFormResponses(formId);
    const questions = loaded.fields.filter((field) => field.type !== "section");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(
      safeSheetName(adminLabel(loaded.form.title_en, loaded.form.title_he)),
    );

    sheet.columns = [
      { header: "Submitted", key: "submitted_at", width: 20 },
      { header: "Name", key: "recipient_name", width: 22 },
      { header: "Email", key: "recipient_email", width: 26 },
      { header: "Language", key: "lang", width: 10 },
      ...questions.map((field) => ({
        header: adminLabel(field.label_en, field.label_he) || `Question ${field.id}`,
        key: `q${field.id}`,
        width: 28,
      })),
    ];
    sheet.getRow(1).font = { bold: true };

    for (const response of responses) {
      const row: Record<string, string> = {
        submitted_at: new Date(response.submitted_at).toLocaleString(),
        recipient_name: response.recipient_name ?? "",
        recipient_email: response.recipient_email ?? "",
        lang: response.lang,
      };
      for (const field of questions) {
        row[`q${field.id}`] = formatAnswer(field, response.answers[String(field.id)]);
      }
      sheet.addRow(row);
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeFileName(loaded.form.slug)}-responses.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Form responses export failed:", JSON.stringify(error));
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
