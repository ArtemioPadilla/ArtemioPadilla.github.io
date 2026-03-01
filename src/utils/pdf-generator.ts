/**
 * PDF Generator for CV using jsPDF
 * Ported from js/pdf-generator.js to TypeScript
 * Generates PDF in 3 formats: full, resume (2-page), summary (1-page)
 */
import type { CVData, PDFFormat } from "../types/cv";

export async function generatePDF(
  cvData: CVData,
  format: PDFFormat = "full",
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "mm", "a4");

  const pageWidth = 210;
  const pageHeight = 297;
  const leftMargin = 18;
  const rightMargin = 18;
  const topMargin = format === "summary" ? 16 : 20;
  const bottomMargin = 20;
  const contentWidth = pageWidth - leftMargin - rightMargin;
  let yPos = topMargin;
  let pageNum = 1;

  const blue: [number, number, number] = [0, 123, 255];
  const darkGray: [number, number, number] = [40, 40, 40];
  const gray: [number, number, number] = [105, 105, 105];
  const lightGray: [number, number, number] = [200, 200, 200];
  const accent = blue;
  const lineHeight = format === "summary" ? 4.5 : 5;
  const bulletIndent = 4;
  const sectionSpacing = format === "summary" ? 4 : 6;
  const bulletGap = format === "summary" ? 1.5 : 2;

  pdf.setFont("helvetica", "normal");

  function sanitizeText(t: string): string {
    if (!t) return "";
    let s = t
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/[⁻−]/g, "-")
      .replace(/10⁻9/g, "10^-9")
      .replace(/10⁻⁹/g, "10^-9")
      .replace(/10⁹/g, "10^9")
      .replace(/(?<!\d)10-([0-9]{1,2})(\b)/g, "10^-$1$2")
      .replace(
        /[\u2000-\u200B\u00A0\u202F\u205F\u180E\u1680\u3000]/g,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
    try {
      s = s.normalize("NFKD");
    } catch {
      /* noop */
    }
    s = s.replace(/[^\x20-\x7E]/g, "");
    s = s.replace(/\b1e(-?\d+)\b/g, (_m, exp) => `10^${exp}`);
    s = s.replace(/(?:\b\w\b\s+){6,}\b\w\b/g, (seq) =>
      seq.replace(/\s+/g, ""),
    );
    s = s.replace(/(?:\b[A-Za-z]\b\s*){4,}/g, (seq) =>
      seq.replace(/\s+/g, ""),
    );
    s = s.replace(/(?:[A-Za-z]\s){4,}[A-Za-z]/g, (seq) =>
      seq.replace(/\s/g, ""),
    );
    s = s
      .split(/ {2,}/)
      .map((chunk) => {
        if (/^(?:[A-Za-z] ){2,}[A-Za-z]$/.test(chunk))
          return chunk.replace(/ /g, "");
        return chunk;
      })
      .join(" ");
    return s;
  }

  function fixSpacedOutParagraph(p: string): string {
    const ratio =
      (p.match(/\b\w\b/g) || []).length / (p.split(/\s+/).length || 1);
    if (/(?:[A-Za-z]\s){15,}[A-Za-z]/.test(p) || ratio > 0.65) {
      return p.replace(/([A-Za-z])\s(?=[A-Za-z])/g, "$1");
    }
    return p;
  }

  function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    pdf.setFontSize(fontSize);
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (pdf.getTextWidth(testLine) > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function renderWrappedText(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    fontSize: number,
    lineHt: number,
  ): number {
    const lines = wrapText(sanitizeText(text), maxWidth, fontSize);
    pdf.setFontSize(fontSize);
    lines.forEach((line, index) => pdf.text(line, x, y + index * lineHt));
    return lines.length * lineHt;
  }

  function checkPageBreak(requiredSpace: number, reflowHeader = true): boolean {
    if (yPos + requiredSpace > pageHeight - bottomMargin) {
      pdf.addPage();
      yPos = topMargin;
      pageNum++;
      if (reflowHeader) drawRunningHeader();
      return true;
    }
    return false;
  }

  function addSectionHeader(title: string): void {
    if (format === "summary") yPos += 1;
    checkPageBreak(15);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(format === "summary" ? 11 : 11.5);
    pdf.setTextColor(...accent);
    pdf.text(title.toUpperCase(), leftMargin, yPos);
    pdf.setDrawColor(...accent);
    pdf.setLineWidth(format === "summary" ? 0.5 : 0.7);
    pdf.line(
      leftMargin,
      yPos + 1.8,
      leftMargin + (format === "summary" ? 50 : 60),
      yPos + 1.8,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...darkGray);
    yPos += format === "summary" ? 6 : 8;
  }

  function drawRunningHeader(): void {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(...accent);
    pdf.text(
      `${personal.name.first.split(" ")[0]} ${personal.name.last.split(" ")[0]}`,
      leftMargin,
      topMargin - 6,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...gray);
    pdf.text(
      `${personal.title}  •  ${personal.contact.email}  •  ${personal.location}`,
      pageWidth - rightMargin,
      topMargin - 6,
      { align: "right" },
    );
    pdf.setDrawColor(...lightGray);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, topMargin - 4, pageWidth - rightMargin, topMargin - 4);
  }

  function drawBullet(baselineY: number, fontSize: number): void {
    const r = 1.08;
    pdf.setFillColor(...accent);
    const centerY = baselineY - fontSize * 0.14;
    pdf.circle(leftMargin + 1.8, centerY, r, "F");
  }

  function renderBulletParagraph(text: string, fontSize = 9): void {
    const clean = sanitizeText(text);
    const maxWidth = contentWidth - bulletIndent;
    const lines = wrapText(clean, maxWidth, fontSize);
    const requiredHeight = lines.length * (lineHeight - 0.2) + bulletGap + 1.5;
    if (yPos + requiredHeight > pageHeight - bottomMargin) {
      checkPageBreak(requiredHeight);
    }
    const baseline = yPos;
    drawBullet(baseline, fontSize);
    const xStart = leftMargin + bulletIndent;
    pdf.setFontSize(fontSize);
    lines.forEach((ln, idx) => {
      pdf.text(ln, xStart, baseline + idx * (lineHeight - 0.2));
    });
    yPos = baseline + lines.length * (lineHeight - 0.2) + bulletGap;
  }

  function fmtDate(dateStr: string | null): string {
    if (!dateStr) return "Present";
    if (dateStr.includes("-")) {
      const [year, month] = dateStr.split("-");
      const monthNames = [
        "",
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sept",
        "Oct",
        "Nov",
        "Dec",
      ];
      return `${monthNames[parseInt(month)]} ${year}`;
    }
    return dateStr;
  }

  // ============ HEADER ============
  const personal = cvData.personal;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(format === "summary" ? 18 : 20);
  pdf.setTextColor(...darkGray);
  pdf.text(
    sanitizeText(`${personal.name.first} ${personal.name.last}`),
    leftMargin,
    yPos,
  );
  yPos += format === "summary" ? 6 : 9;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(format === "summary" ? 11 : 12.5);
  pdf.setTextColor(...accent);
  pdf.text(sanitizeText(personal.title), leftMargin, yPos);
  yPos += format === "summary" ? 5 : 7;

  if (format === "summary" || format === "resume") {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8);
    pdf.setTextColor(...gray);
    const subtitle =
      format === "summary"
        ? "1-Page Resume Highlights - Full CV at: https://artemiopadilla.github.io/cv"
        : "2-Page Resume Highlights - Full CV at: https://artemiopadilla.github.io/cv";
    pdf.text(subtitle, leftMargin, yPos);
    yPos += 4;
  }

  pdf.setFontSize(format === "summary" ? 8.5 : 9);
  pdf.setTextColor(...gray);
  pdf.text(
    sanitizeText(
      `${personal.location}  •  ${personal.contact.phone}  •  ${personal.contact.email}`,
    ),
    leftMargin,
    yPos,
  );
  yPos += format === "summary" ? 6 : 10;
  pdf.setDrawColor(...lightGray);
  pdf.setLineWidth(0.3);
  pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
  yPos += format === "summary" ? 4 : 6;

  // ============ PROFESSIONAL SUMMARY ============
  addSectionHeader("Professional Summary");

  let paragraphs: string[] = [];
  if (format === "summary") {
    paragraphs = [personal.summary.brief].filter(Boolean) as string[];
  } else if (format === "resume") {
    paragraphs = [personal.summary.brief, personal.summary.tagline].filter(
      Boolean,
    ) as string[];
  } else {
    paragraphs = [
      personal.summary.brief,
      personal.summary.tagline,
      personal.summary.full,
      personal.summary.connection,
      personal.summary.current,
    ].filter(Boolean) as string[];
  }

  paragraphs.forEach((p) => {
    const cleaned = fixSpacedOutParagraph(sanitizeText(p));
    const fontSize = format === "summary" ? 8.5 : 9.1;
    const h = renderWrappedText(
      cleaned,
      leftMargin,
      yPos,
      contentWidth,
      fontSize,
      lineHeight - 0.3,
    );
    yPos += h + (format === "summary" ? 1 : 2);
    checkPageBreak(25);
  });

  if (
    format === "resume" &&
    personal.summary.strengths?.length
  ) {
    const topStrengths = personal.summary.strengths.slice(0, 2).join(". ");
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...gray);
    const sh = renderWrappedText(
      sanitizeText(topStrengths),
      leftMargin,
      yPos,
      contentWidth,
      8.5,
      lineHeight - 0.3,
    );
    yPos += sh + 2;
  } else if (
    format === "full" &&
    personal.summary.strengths?.length
  ) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...darkGray);
    pdf.text("Core Strengths:", leftMargin, yPos);
    pdf.setFont("helvetica", "normal");
    yPos += 5;
    personal.summary.strengths.forEach((s) => renderBulletParagraph(s, 8.9));
  }

  if (format === "full" && personal.summary.closing) {
    yPos += 2;
    const closingClean = fixSpacedOutParagraph(
      sanitizeText(personal.summary.closing),
    );
    const closingH = renderWrappedText(
      closingClean,
      leftMargin,
      yPos,
      contentWidth,
      8.9,
      lineHeight - 0.3,
    );
    yPos += closingH;
  }

  yPos += format === "summary" ? 2 : sectionSpacing;

  // ============ PROFESSIONAL EXPERIENCE ============
  addSectionHeader("Professional Experience");

  let experiences = cvData.experience;
  if (format === "resume" || format === "summary") {
    experiences = experiences.slice(0, 3);
  }

  experiences.forEach((job) => {
    checkPageBreak(40);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(...darkGray);
    pdf.text(job.title, leftMargin, yPos);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    const dateText = `${fmtDate(job.startDate)} - ${job.endDate ? fmtDate(job.endDate) : "Present"}`;
    pdf.text(dateText, pageWidth - rightMargin - pdf.getTextWidth(dateText), yPos);
    yPos += 4.5;
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...accent);
    pdf.text(job.company, leftMargin, yPos);
    yPos += 4.5;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);

    let highlights = job.highlights;
    if (format === "resume") {
      highlights = highlights.slice(0, 3);
    } else if (format === "summary") {
      const jobIndex = experiences.indexOf(job);
      highlights = jobIndex === 0 ? highlights.slice(0, 3) : highlights.slice(0, 1);
    }

    const bulletFontSize = format === "summary" ? 8.5 : 8.9;
    highlights.forEach((highlight) => {
      let txt = highlight.text;
      if (format === "full" && txt.length > 210) txt = txt.slice(0, 210) + "...";
      renderBulletParagraph(sanitizeText(txt), bulletFontSize);
    });

    yPos += 2;
    pdf.setDrawColor(...lightGray);
    pdf.setLineWidth(0.2);
    pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
    yPos += 4;
  });

  // ============ EDUCATION ============
  checkPageBreak(40);
  addSectionHeader("Education");

  let educationItems = cvData.education;
  if (format === "resume") educationItems = educationItems.slice(0, 2);
  if (format === "summary") educationItems = educationItems.slice(0, 3);

  educationItems.forEach((edu) => {
    if (format === "summary") {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...darkGray);
      pdf.text(edu.degree, leftMargin, yPos);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...gray);
      const endDateText = edu.endDate
        ? fmtDate(edu.endDate)
        : edu.expectedEndDate
          ? `Expected ${fmtDate(edu.expectedEndDate)}`
          : "Present";
      const eduDateText = `${fmtDate(edu.startDate ?? null)} - ${endDateText}`;
      pdf.text(
        eduDateText,
        pageWidth - rightMargin - pdf.getTextWidth(eduDateText),
        yPos,
      );
      yPos += 3.5;
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8);
      pdf.text(edu.institution, leftMargin, yPos);
      yPos += 4;
    } else {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(...darkGray);
      pdf.text(edu.degree, leftMargin, yPos);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...gray);
      const endDateText = edu.endDate
        ? fmtDate(edu.endDate)
        : edu.expectedEndDate
          ? `Expected ${fmtDate(edu.expectedEndDate)}`
          : "Present";
      const eduDateText = `${fmtDate(edu.startDate ?? null)} - ${endDateText}`;
      pdf.text(
        eduDateText,
        pageWidth - rightMargin - pdf.getTextWidth(eduDateText),
        yPos,
      );
      yPos += 5;
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(10);
      pdf.text(edu.institution, leftMargin, yPos);
      yPos += 5;
      if (edu.gpa) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(`GPA: ${edu.gpa}`, leftMargin, yPos);
        yPos += 5;
      }
      yPos += 3;
    }
  });

  // ============ TECHNICAL SKILLS ============
  checkPageBreak(40);
  addSectionHeader("Technical Skills");

  const skills = cvData.skills;
  const colGap = 10;
  const colWidth = (contentWidth - colGap) / 2;
  const leftX = leftMargin;
  const rightX = leftMargin + colWidth + colGap;
  let leftY = yPos;
  let rightY = yPos;

  function renderSkillBlock(
    x: number,
    y: number,
    title: string,
    items: string[],
  ): number {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(format === "summary" ? 8 : 9);
    pdf.setTextColor(...accent);
    pdf.text(title, x, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...darkGray);
    const fs = format === "summary" ? 7.5 : 8.5;
    const lh = format === "summary" ? 3.5 : 4.2;
    const offset = format === "summary" ? 2.5 : 3.5;
    return (
      renderWrappedText(items.join(", "), x, y + offset, colWidth, fs, lh) +
      (format === "summary" ? 5 : 7)
    );
  }

  const blocks: [string, string[]][] = [
    ["Languages", skills.languages],
    ["Cloud & MLOps", skills.cloudAndMLOps ?? []],
    [
      "Databases",
      [...(skills.databases?.relational ?? []), ...(skills.databases?.nosql ?? [])],
    ],
    ["Big Data", skills.bigData ?? []],
    ["ML", skills.machineLearning ?? []],
    ["Visualization", skills.visualization ?? []],
    ["Tools", skills.tools ?? []],
    ["Design", skills.design ?? []],
  ];

  blocks.forEach((b) => {
    if (!b[1].length) return;
    const targetLeft = leftY <= rightY;
    const x = targetLeft ? leftX : rightX;
    const newHeight = renderSkillBlock(x, targetLeft ? leftY : rightY, b[0], b[1]);
    if (targetLeft) leftY += newHeight;
    else rightY += newHeight;
  });
  yPos = Math.max(leftY, rightY) + 2;

  // ============ CERTIFICATIONS ============
  if (format !== "summary" && cvData.certifications?.length) {
    checkPageBreak(40);
    addSectionHeader("Certifications & Training");
    const certLimit = format === "full" ? cvData.certifications.length : 5;
    const certs = cvData.certifications.slice(0, certLimit);
    certs.forEach((cert) => {
      checkPageBreak(10);
      const certText = `• ${cert.name} - ${cert.issuer ?? ""} (${cert.date})`;
      const certH = renderWrappedText(
        certText,
        leftMargin,
        yPos,
        contentWidth - 5,
        9,
        5,
      );
      yPos += certH + 3;
    });
    yPos += 7;
  }

  // ============ LEADERSHIP & AWARDS & PUBLICATIONS ============
  if (format !== "summary") {
    if (cvData.leadership?.length) {
      checkPageBreak(40);
      addSectionHeader("Leadership");
      const leadershipList =
        format === "full" ? cvData.leadership : cvData.leadership.slice(0, 2);
      leadershipList.forEach((role) => {
        checkPageBreak(15);
        renderBulletParagraph(
          `${role.role}, ${role.organization} (${role.period})`,
          9,
        );
      });
      yPos += 4;
    }

    if (cvData.awards?.length) {
      checkPageBreak(30);
      addSectionHeader("Awards");
      const awardsList =
        format === "full" ? cvData.awards : cvData.awards.slice(0, 4);
      awardsList.forEach((award) => {
        checkPageBreak(12);
        renderBulletParagraph(
          `${award.title}${award.year ? ` (${award.year})` : ""}`,
          9,
        );
      });
      yPos += 2;
    }

    if (cvData.publications?.length) {
      checkPageBreak(30);
      addSectionHeader("Publications");
      const pubs =
        format === "full" ? cvData.publications : cvData.publications.slice(0, 1);
      pubs.forEach((pub) => {
        checkPageBreak(12);
        renderBulletParagraph(
          `${pub.title}${pub.journal ? ` - ${pub.journal}` : pub.institution ? ` - ${pub.institution}` : ""} (${pub.year})`,
          9,
        );
      });
      yPos += 4;
    }
  }

  // ============ LANGUAGES ============
  if (format === "summary") {
    checkPageBreak(35);
    const col2Width = (contentWidth - 10) / 2;
    const col1X = leftMargin;
    const col2X = leftMargin + col2Width + 10;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(...accent);
    pdf.text("LANGUAGES", col1X, yPos);
    pdf.setDrawColor(...accent);
    pdf.setLineWidth(0.5);
    pdf.line(col1X, yPos + 1.8, col1X + 30, yPos + 1.8);
    pdf.text("AWARDS", col2X, yPos);
    pdf.line(col2X, yPos + 1.8, col2X + 30, yPos + 1.8);
    yPos += 5;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...darkGray);
    let langY = yPos;
    (cvData.languages ?? []).forEach((lang) => {
      pdf.text(`• ${lang.name} (${lang.level})`, col1X, langY);
      langY += 4;
    });

    let awardY = yPos;
    (cvData.awards ?? []).slice(0, 3).forEach((award) => {
      const awardText = `• ${award.title}${award.year ? ` (${award.year})` : ""}`;
      if (pdf.getTextWidth(awardText) > col2Width - 5) {
        const lines = wrapText(awardText, col2Width - 5, 8.5);
        lines.forEach((line) => {
          pdf.text(line, col2X, awardY);
          awardY += 3.5;
        });
      } else {
        pdf.text(awardText, col2X, awardY);
        awardY += 4;
      }
    });
    yPos = Math.max(langY, awardY) + 2;
  } else {
    checkPageBreak(25);
    addSectionHeader("Languages");
    (cvData.languages ?? []).forEach((lang) => {
      renderBulletParagraph(`${lang.name} (${lang.level})`, 9);
    });
  }

  // ============ PROJECTS (full only) ============
  if (format === "full") {
    checkPageBreak(50);
    if (yPos < pageHeight - bottomMargin - 50) {
      addSectionHeader("Selected Projects");
      cvData.projects.slice(0, 3).forEach((project) => {
        checkPageBreak(18);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        const nameWidth = pdf.getTextWidth(project.name);
        const maxNameWidth = contentWidth - 25;
        let displayName = project.name;
        if (nameWidth > maxNameWidth) {
          let truncated = project.name;
          while (
            pdf.getTextWidth(truncated + "...") > maxNameWidth &&
            truncated.length > 4
          ) {
            truncated = truncated.slice(0, -1);
          }
          displayName = truncated + "...";
        }
        pdf.text(displayName, leftMargin, yPos);
        pdf.setFont("helvetica", "normal");
        pdf.text(
          ` (${project.year})`,
          leftMargin + pdf.getTextWidth(displayName) + 2,
          yPos,
        );
        yPos += 5;
        if (project.description) {
          const projH = renderWrappedText(
            project.description,
            leftMargin + 5,
            yPos,
            contentWidth - 10,
            9,
            5,
          );
          yPos += projH + 5;
        }
      });
    }
  }

  // ============ INTERESTS (full only) ============
  if (format === "full" && cvData.interests) {
    checkPageBreak(40);
    if (yPos < pageHeight - bottomMargin - 30) {
      addSectionHeader("Interests");
      const interestText = `${cvData.interests.philosophy ?? ""} Professional: ${(cvData.interests.professional ?? []).join(", ")}. Personal: ${(cvData.interests.personal ?? []).join(", ")}`;
      const intH = renderWrappedText(
        interestText,
        leftMargin,
        yPos,
        contentWidth,
        9,
        5,
      );
      yPos += intH + 5;
    }
  }

  // Page numbers
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    if (
      (format === "summary" && i === 1) ||
      (format === "resume" && i === totalPages)
    ) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(7.5);
      pdf.text(
        "For complete CV with all details, visit: https://artemiopadilla.github.io/cv",
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" },
      );
    } else if (format !== "summary") {
      pdf.text(`Page ${i} / ${totalPages}`, pageWidth / 2, pageHeight - 15, {
        align: "center",
      });
    }
  }

  pdf.setProperties({
    title: `${cvData.personal.name.full} - CV`,
    subject: "Curriculum Vitae",
    author: cvData.personal.name.full,
    keywords: "Deep Learning, ML Architecture, Machine Learning, AI, CV",
    creator: "Artemio Padilla CV Generator",
  });

  const firstName = cvData.personal.name.first;
  const lastName = cvData.personal.name.last.split(" ")[0];
  let filename: string;
  switch (format) {
    case "resume":
      filename = `${firstName}_${lastName}_Resume_2pg.pdf`;
      break;
    case "summary":
      filename = `${firstName}_${lastName}_Resume_1pg.pdf`;
      break;
    default:
      filename = `${firstName}_${lastName}_CV_Full.pdf`;
  }

  pdf.save(filename);
}
