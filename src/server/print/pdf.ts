import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";

/**
 * A small text-flow layer over pdf-lib for the permission-aware print/PDF records this module
 * renders: SOP versions, training sessions, qualifications, and checklist runs can all run past
 * one US-Letter page (a long step list, a long evidence history), so every renderer needs the
 * same automatic page-break behavior rather than reimplementing it four times.
 */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT_COLOR = rgb(0.1, 0.1, 0.12);
const MUTED_COLOR = rgb(0.42, 0.42, 0.46);
const RULE_COLOR = rgb(0.78, 0.78, 0.82);

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class PdfWriter {
  doc: PDFDocument;
  private font: PDFFont;
  private boldFont: PDFFont;
  private page: PDFPage;
  private y: number;

  private constructor(doc: PDFDocument, font: PDFFont, boldFont: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.boldFont = boldFont;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  static async create(): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    const [font, boldFont] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
    ]);
    return new PdfWriter(doc, font, boldFont);
  }

  private ensureSpace(height: number): void {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  private drawLine(text: string, size: number, font: PDFFont, color = TEXT_COLOR): void {
    const lineHeight = size * 1.35;
    this.ensureSpace(lineHeight);
    this.page.drawText(text, { x: MARGIN, y: this.y - size, size, font, color });
    this.y -= lineHeight;
  }

  title(text: string): this {
    this.drawLine(text, 20, this.boldFont);
    return this;
  }

  heading(text: string): this {
    this.spacer(6);
    this.drawLine(text, 14, this.boldFont);
    this.rule();
    return this;
  }

  /** A "Label: value" line, wrapped if the value is long. */
  field(label: string, value: string): this {
    const size = 10.5;
    const prefix = `${label}: `;
    const prefixWidth = this.boldFont.widthOfTextAtSize(prefix, size);
    const lines = wrapText(value || "—", this.font, size, CONTENT_WIDTH - prefixWidth);
    const lineHeight = size * 1.4;
    this.ensureSpace(lineHeight);
    this.page.drawText(prefix, {
      x: MARGIN,
      y: this.y - size,
      size,
      font: this.boldFont,
      color: TEXT_COLOR,
    });
    this.page.drawText(lines[0] ?? "", {
      x: MARGIN + prefixWidth,
      y: this.y - size,
      size,
      font: this.font,
      color: TEXT_COLOR,
    });
    this.y -= lineHeight;
    for (const line of lines.slice(1)) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + prefixWidth,
        y: this.y - size,
        size,
        font: this.font,
        color: TEXT_COLOR,
      });
      this.y -= lineHeight;
    }
    return this;
  }

  paragraph(text: string, options: { size?: number; muted?: boolean } = {}): this {
    const size = options.size ?? 10.5;
    const color = options.muted ? MUTED_COLOR : TEXT_COLOR;
    const lineHeight = size * 1.4;
    for (const line of wrapText(text, this.font, size, CONTENT_WIDTH)) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font: this.font, color });
      this.y -= lineHeight;
    }
    return this;
  }

  bullet(text: string, options: { size?: number; indent?: number } = {}): this {
    const size = options.size ?? 10.5;
    const indent = options.indent ?? 12;
    const lineHeight = size * 1.4;
    const lines = wrapText(text, this.font, size, CONTENT_WIDTH - indent);
    lines.forEach((line, index) => {
      this.ensureSpace(lineHeight);
      const prefix = index === 0 ? "• " : "  ";
      this.page.drawText(`${prefix}${line}`, {
        x: MARGIN + indent - 12,
        y: this.y - size,
        size,
        font: this.font,
        color: TEXT_COLOR,
      });
      this.y -= lineHeight;
    });
    return this;
  }

  rule(): this {
    this.ensureSpace(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE_COLOR,
    });
    this.y -= 8;
    return this;
  }

  spacer(height = 10): this {
    this.y -= height;
    return this;
  }

  async finish(): Promise<Uint8Array> {
    // Object streams (pdf-lib's default) compress cross-reference data in a way older/strict
    // PDF readers can mis-decode; disabling them trades a slightly larger file for maximum
    // compatibility with the extraction tooling these printable records need to survive.
    return this.doc.save({ useObjectStreams: false });
  }
}

export interface SopVersionPrintRecord {
  sopTitle: string;
  versionNumber: number;
  status: string;
  category: string;
  difficulty: string;
  estimatedMinutes: number | null;
  changeSummary: string;
  publishedAt: Date | null;
  locationName: string;
  stationName: string | null;
  materials: { kind: string; name: string; quantity: string; unit: string }[];
  warnings: { text: string }[];
  steps: {
    displayOrder: number;
    title: string | null;
    instruction: string;
    quantity: string | null;
    unit: string | null;
    equipmentSetting: string | null;
    timerSeconds: number | null;
    warning: string | null;
    isRequired: boolean;
  }[];
}

export async function renderSopVersionPdf(record: SopVersionPrintRecord): Promise<Uint8Array> {
  const writer = await PdfWriter.create();
  writer.title(record.sopTitle);
  writer.paragraph(
    `Version ${record.versionNumber} · ${record.status} · ${record.category} · ${record.difficulty}`,
    { muted: true },
  );
  writer.field(
    "Location",
    record.stationName ? `${record.locationName} · ${record.stationName}` : record.locationName,
  );
  if (record.estimatedMinutes) writer.field("Estimated time", `${record.estimatedMinutes} min`);
  if (record.publishedAt) writer.field("Published", record.publishedAt.toISOString());
  if (record.changeSummary) writer.field("Change summary", record.changeSummary);

  if (record.warnings.length > 0) {
    writer.heading("Warnings");
    for (const warning of record.warnings) writer.bullet(warning.text);
  }

  if (record.materials.length > 0) {
    writer.heading("Materials & ingredients");
    for (const material of record.materials) {
      const quantity = [material.quantity, material.unit].filter(Boolean).join(" ");
      writer.bullet(quantity ? `${material.name} — ${quantity}` : material.name);
    }
  }

  writer.heading("Steps");
  for (const step of record.steps) {
    const label = step.title ? `${step.displayOrder}. ${step.title}` : `Step ${step.displayOrder}`;
    writer.paragraph(step.isRequired ? label : `${label} (optional)`, { size: 11.5 });
    writer.paragraph(step.instruction);
    const details: string[] = [];
    if (step.quantity || step.unit)
      details.push([step.quantity, step.unit].filter(Boolean).join(" "));
    if (step.equipmentSetting) details.push(`Setting: ${step.equipmentSetting}`);
    if (step.timerSeconds) details.push(`Timer: ${Math.round(step.timerSeconds / 60)} min`);
    if (details.length > 0) writer.paragraph(details.join(" · "), { muted: true, size: 9.5 });
    if (step.warning) writer.bullet(`Warning: ${step.warning}`);
    writer.spacer(6);
  }

  return writer.finish();
}

export interface TrainingSessionPrintRecord {
  employeeName: string;
  employeeNumber: string;
  locationName: string;
  sopTitle: string;
  sopVersionNumber: number;
  mode: string;
  attemptNumber: number;
  sessionStatus: string;
  assignmentStatus: string;
  scorePercent: number | null;
  passingScorePercent: number;
  startedAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  quizTotalQuestions: number;
  quizCorrectAnswers: number;
  evidence: {
    stepTitle: string | null;
    evidenceType: string;
    employeeNote: string;
    createdAt: Date;
  }[];
  latestDecision: {
    decision: string;
    note: string;
    decidedByName: string;
    decidedAt: Date;
  } | null;
}

export async function renderTrainingSessionPdf(
  record: TrainingSessionPrintRecord,
): Promise<Uint8Array> {
  const writer = await PdfWriter.create();
  writer.title("Training record");
  writer.field("Employee", `${record.employeeName} (#${record.employeeNumber})`);
  writer.field("Location", record.locationName);
  writer.field("SOP", `${record.sopTitle} · v${record.sopVersionNumber}`);
  writer.field("Mode", `${record.mode} · attempt ${record.attemptNumber}`);
  writer.field("Session status", record.sessionStatus);
  writer.field("Assignment status", record.assignmentStatus);
  if (record.scorePercent !== null) {
    writer.field("Score", `${record.scorePercent}% (passing ${record.passingScorePercent}%)`);
  }
  if (record.quizTotalQuestions > 0) {
    writer.field("Quiz", `${record.quizCorrectAnswers} / ${record.quizTotalQuestions} correct`);
  }
  writer.field("Started", record.startedAt.toISOString());
  if (record.submittedAt) writer.field("Submitted", record.submittedAt.toISOString());
  if (record.completedAt) writer.field("Completed", record.completedAt.toISOString());

  if (record.evidence.length > 0) {
    writer.heading("Evidence");
    for (const item of record.evidence) {
      const stepLabel = item.stepTitle ? `Step: ${item.stepTitle}` : "Final evidence";
      writer.bullet(
        `${stepLabel} · ${item.evidenceType} · ${item.createdAt.toISOString()}${
          item.employeeNote ? ` — ${item.employeeNote}` : ""
        }`,
      );
    }
  }

  if (record.latestDecision) {
    writer.heading("Approval decision");
    writer.field("Decision", record.latestDecision.decision);
    writer.field("Decided by", record.latestDecision.decidedByName);
    writer.field("Decided at", record.latestDecision.decidedAt.toISOString());
    if (record.latestDecision.note) writer.field("Note", record.latestDecision.note);
  }

  return writer.finish();
}

export interface QualificationPrintRecord {
  employeeName: string;
  employeeNumber: string;
  locationName: string;
  definitionName: string;
  definitionDescription: string;
  pathTitle: string;
  status: string;
  awardedAt: Date | null;
  expiresAt: Date | null;
  isExpired: boolean;
  revokedAt: Date | null;
  revokedNote: string | null;
  supportingSessions: {
    sopTitle: string;
    sopVersionNumber: number;
    completedAt: Date | null;
  }[];
}

export async function renderQualificationPdf(
  record: QualificationPrintRecord,
): Promise<Uint8Array> {
  const writer = await PdfWriter.create();
  writer.title(record.definitionName);
  writer.field("Employee", `${record.employeeName} (#${record.employeeNumber})`);
  writer.field("Location", record.locationName);
  writer.field("Path", record.pathTitle);
  writer.field("Status", record.isExpired ? "expired" : record.status);
  if (record.definitionDescription) writer.field("Description", record.definitionDescription);
  if (record.awardedAt) writer.field("Awarded", record.awardedAt.toISOString());
  if (record.expiresAt) writer.field("Expires", record.expiresAt.toISOString());
  if (record.revokedAt) {
    writer.field("Revoked", record.revokedAt.toISOString());
    if (record.revokedNote) writer.field("Revocation note", record.revokedNote);
  }

  if (record.supportingSessions.length > 0) {
    writer.heading("Supporting completions");
    for (const session of record.supportingSessions) {
      writer.bullet(
        `${session.sopTitle} · v${session.sopVersionNumber}${
          session.completedAt ? ` · ${session.completedAt.toISOString()}` : ""
        }`,
      );
    }
  }

  return writer.finish();
}

export interface ChecklistRunPrintRecord {
  checklistTitle: string;
  checklistType: string;
  employeeName: string;
  employeeNumber: string;
  locationName: string;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  items: {
    displayOrder: number;
    title: string;
    isRequired: boolean;
    isDone: boolean;
    employeeNote: string;
  }[];
}

export async function renderChecklistRunPdf(record: ChecklistRunPrintRecord): Promise<Uint8Array> {
  const writer = await PdfWriter.create();
  writer.title(record.checklistTitle);
  writer.paragraph(`${record.checklistType} checklist`, { muted: true });
  writer.field("Employee", `${record.employeeName} (#${record.employeeNumber})`);
  writer.field("Location", record.locationName);
  writer.field("Status", record.status);
  writer.field("Started", record.startedAt.toISOString());
  if (record.submittedAt) writer.field("Submitted", record.submittedAt.toISOString());
  if (record.completedAt) writer.field("Completed", record.completedAt.toISOString());

  writer.heading("Items");
  for (const item of record.items) {
    const box = item.isDone ? "[x]" : "[ ]";
    const label = `${box} ${item.displayOrder}. ${item.title}${item.isRequired ? "" : " (optional)"}`;
    writer.bullet(label);
    if (item.employeeNote)
      writer.paragraph(`Note: ${item.employeeNote}`, { muted: true, size: 9.5 });
  }

  return writer.finish();
}
