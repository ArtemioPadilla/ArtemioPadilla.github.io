// PDF Generator for CV using jsPDF with JSON data source
// Generates full CV from the same JSON data used for HTML rendering

async function generatePDF(format = 'full') {
    // Load CV data from JSON
    let cvData;
    
    // First check if data is already loaded via script tag (for file:// access)
    // Always attempt a fresh fetch (cache-busted) so recent edits appear; fall back to window.cvData if fetch fails
    try {
        const response = await fetch('data/cv-data.json?cb=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('network');
        cvData = await response.json();
        // Update global cache
        window.cvData = cvData;
    } catch (e) {
        if (window.cvData) {
            console.warn('Using previously loaded cvData due to fetch issue:', e);
            cvData = window.cvData;
        } else {
            console.error('Error loading CV data:', e);
            alert('Failed to load CV data for PDF generation');
            return;
        }
    }

    // Validation only (no mutation)
    if (!(cvData.experience||[]).some(e=>e.id==='unam-student-rep')) {
        console.warn('[PDF Validation] Student Representative experience missing (id: unam-student-rep). Update source data.');
    }

    // Initialize jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    // Page dimensions
    const pageWidth = 210;
    const pageHeight = 297;
    const leftMargin = 18;
    const rightMargin = 18;
    const topMargin = 20;
    const bottomMargin = 20;
    const contentWidth = pageWidth - leftMargin - rightMargin;
    let yPos = topMargin;
    let pageNum = 1;
    
    // Colors & style tokens
    // Color palette (reverted to blue-focused scheme)
    const blue = [0, 123, 255];
    const darkGray = [40, 40, 40];
    const gray = [105, 105, 105];
    const lightGray = [200, 200, 200];
    const accent = blue; // use blue as accent
    const lineHeight = 5;
    const bulletIndent = 4; // mm
    const sectionSpacing = 6;
    const bulletGap = 2;
    
    // Set default font
    pdf.setFont('helvetica', 'normal');
    
    // Helper functions
    function wrapText(text, maxWidth, fontSize) {
        pdf.setFontSize(fontSize);
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const testWidth = pdf.getTextWidth(testLine);
            
            if (testWidth > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    function sanitizeText(t) {
        if (!t) return '';
        let s = t
            .replace(/[\u2010-\u2015]/g, '-') // various dashes
            .replace(/[\u2212]/g, '-') // minus sign
            .replace(/[⁻−]/g, '-')
            .replace(/10⁻9/g, '10^-9')
            .replace(/10⁻⁹/g, '10^-9')
            .replace(/10⁹/g, '10^9')
            // Heuristic: if caret was lost and we have pattern 10-9 (very common for 10^-9 meters), restore caret
            // Only do this when base is 10 and a hyphen followed by 1-2 digits (to avoid over-aggressive substitutions like version numbers 10-90 etc.)
            .replace(/(?<!\d)10-([0-9]{1,2})(\b)/g, '10^-$1$2')
            .replace(/[\u2000-\u200B\u00A0\u202F\u205F\u180E\u1680\u3000]/g, '') // remove a wide range of unicode spaces
            .replace(/\s+/g, ' ')
            .trim();
    // Strip any remaining non-ASCII (after NFKD normalize) which can trigger font fallback + odd spacing in jsPDF
    try { s = s.normalize('NFKD'); } catch(e){}
    s = s.replace(/[^\x20-\x7E]/g, '');
        // Convert any earlier 1e-9 artifacts back to 10^-9 for caret-based superscript rendering
        s = s.replace(/\b1e(-?\d+)\b/g, (m, exp) => `10^${exp}`);
        // Compress sequences of spaced single letters (artifact cleanup)
        s = s.replace(/(?:\b\w\b\s+){6,}\b\w\b/g, seq => seq.replace(/\s+/g, '')); // join long sequences
    // Additional collapse: if 4+ single-letter tokens in a row, join all (defensive)
    s = s.replace(/(?:\b[A-Za-z]\b\s*){4,}/g, seq => seq.replace(/\s+/g, ''));
    // Collapse any letter-by-letter spaced words of length >=5 (e.g., "t h e   d i s c i p l i n e")
    s = s.replace(/(?:[A-Za-z]\s){4,}[A-Za-z]/g, seq => seq.replace(/\s/g, ''));
        // Repair words that became split into letters but separated by double (word) boundaries. Split on 2+ spaces to keep real word gaps.
        s = s.split(/ {2,}/).map(chunk => {
            if (/^(?:[A-Za-z] ){2,}[A-Za-z]$/.test(chunk)) return chunk.replace(/ /g,'');
            return chunk;
        }).join(' ');
        return s;
    }

    function fixSpacedOutParagraph(p) {
        // Detect pattern of many letter-space-letter repeats (heuristic)
        const ratio = (p.match(/\b\w\b/g) || []).length / (p.split(/\s+/).length || 1);
        if (/(?:[A-Za-z]\s){15,}[A-Za-z]/.test(p) || ratio > 0.65) {
            return p.replace(/([A-Za-z])\s(?=[A-Za-z])/g, '$1');
        }
        return p;
    }

    function renderWrappedText(text, x, y, maxWidth, fontSize, lineHt) {
        const lines = wrapText(sanitizeText(text), maxWidth, fontSize);
        pdf.setFontSize(fontSize);
        
        lines.forEach((line, index) => {
            pdf.text(line, x, y + (index * lineHt));
        });
        
        return lines.length * lineHt;
    }

    // Simplified paragraph rendering: show caret expressions literally (e.g., 10^-9) without superscript formatting
    function renderParagraphWithExponents(text, x, y, maxWidth, fontSize, lineHt) {
        const clean = sanitizeText(text);
        const lines = wrapText(clean, maxWidth, fontSize);
        pdf.setFontSize(fontSize);
        lines.forEach((ln, i) => pdf.text(ln, x, y + i * lineHt));
        return lines.length * lineHt;
    }
    
    function checkPageBreak(requiredSpace, reflowHeader = true) {
        if (yPos + requiredSpace > pageHeight - bottomMargin) {
            pdf.addPage();
            yPos = topMargin;
            pageNum++;
            if (reflowHeader) drawRunningHeader();
            return true;
        }
        return false;
    }
    
    function addSectionHeader(title) {
        checkPageBreak(15);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11.5);
        pdf.setTextColor(...accent);
        pdf.text(title.toUpperCase(), leftMargin, yPos);
        // Accent bar
        pdf.setDrawColor(...accent);
        pdf.setLineWidth(0.7);
        pdf.line(leftMargin, yPos + 1.8, leftMargin + 60, yPos + 1.8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...darkGray);
        yPos += 8;
    }

    function drawRunningHeader() {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(...accent);
        pdf.text(`${personal.name.first.split(' ')[0]} ${personal.name.last.split(' ')[0]}`, leftMargin, topMargin - 6);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...gray);
        pdf.text(`${personal.title}  •  ${personal.contact.email}  •  ${personal.location}`, pageWidth - rightMargin, topMargin - 6, { align: 'right' });
        // Horizontal rule
        pdf.setDrawColor(...lightGray);
        pdf.setLineWidth(0.3);
        pdf.line(leftMargin, topMargin - 4, pageWidth - rightMargin, topMargin - 4);
    }

    const BULLET_OFFSET_FACTOR = 0.14; // smaller number -> lower bullet (was 0.30)
    function drawBullet(baselineY, fontSize) {
        const r = 1.08;
        pdf.setFillColor(...accent);
        const centerY = baselineY - (fontSize * BULLET_OFFSET_FACTOR);
        pdf.circle(leftMargin + 1.8, centerY, r, 'F');
    }

    function renderBulletParagraph(text, fontSize = 9) {
        const clean = sanitizeText(text);
        const maxWidth = contentWidth - bulletIndent;
        const lines = wrapText(clean, maxWidth, fontSize);
        // Pre-calc required height and page-break if needed BEFORE drawing to avoid overlapping footer/page number
        const requiredHeight = lines.length * (lineHeight - 0.2) + bulletGap + 1.5; // extra padding
        if (yPos + requiredHeight > pageHeight - bottomMargin) {
            checkPageBreak(requiredHeight);
        }
        const baseline = yPos;
        drawBullet(baseline, fontSize);
        const xStart = leftMargin + bulletIndent;
        pdf.setFontSize(fontSize);
        lines.forEach((ln, idx) => {
            const lineBaseline = baseline + (idx * (lineHeight - 0.2));
            pdf.text(ln, xStart, lineBaseline);
        });
        yPos = baseline + lines.length * (lineHeight - 0.2) + bulletGap;
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Present';
        if (dateStr.includes('-')) {
            const [year, month] = dateStr.split('-');
            const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                               'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[parseInt(month)]} ${year}`;
        }
        return dateStr;
    }
    
    // ============ HEADER ============
    const personal = cvData.personal;
    
    // Header block
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.setTextColor(...darkGray);
    pdf.text(sanitizeText(`${personal.name.first} ${personal.name.last}`), leftMargin, yPos);
    yPos += 9;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12.5);
    pdf.setTextColor(...accent);
    pdf.text(sanitizeText(personal.title), leftMargin, yPos);
    yPos += 7;
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    const contactLine = sanitizeText(`${personal.location}  •  ${personal.contact.phone}  •  ${personal.contact.email}`);
    pdf.text(contactLine, leftMargin, yPos);
    yPos += 10;
    // Horizontal separator
    pdf.setDrawColor(...lightGray);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
    yPos += 6;
    
    // ============ PROFESSIONAL SUMMARY ============
    addSectionHeader('Professional Summary');
    
    // Build rich summary including tagline, connection, current context, strengths, and closing
    pdf.setFontSize(9.5);
    // Paragraphs for readability
    const paragraphs = [
        personal.summary.brief,
        personal.summary.tagline,
        personal.summary.full,
        personal.summary.connection, // no truncation; show full
        personal.summary.current
    ].filter(Boolean);
    paragraphs.forEach((p, idx) => {
        const cleaned = fixSpacedOutParagraph(sanitizeText(p));
        if (typeof pdf.setCharSpace === 'function') pdf.setCharSpace(0);
        const h = renderParagraphWithExponents(cleaned, leftMargin, yPos, contentWidth, 9.1, lineHeight - 0.3);
        yPos += h + 2;
        checkPageBreak(25);
    });
    if (personal.summary.strengths && personal.summary.strengths.length) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9.5);
        pdf.setTextColor(...darkGray);
        pdf.text('Core Strengths:', leftMargin, yPos);
        pdf.setFont('helvetica', 'normal');
        yPos += 5;
    personal.summary.strengths.forEach(s => renderBulletParagraph(s, 8.9));
    }
    if (personal.summary.closing) {
        yPos += 2;
        const closingClean = fixSpacedOutParagraph(sanitizeText(personal.summary.closing));
        const closingHeight = renderWrappedText(closingClean, leftMargin, yPos, contentWidth, 8.9, lineHeight - 0.3);
        yPos += closingHeight;
    }
    yPos += sectionSpacing;
    
    // ============ PROFESSIONAL EXPERIENCE ============
    addSectionHeader('Professional Experience');
    
    // Determine which experiences to include based on format
    let experiences = cvData.experience;
    if (format === 'resume') {
        experiences = experiences.slice(0, 3);
    } else if (format === 'summary') {
        experiences = experiences.slice(0, 2);
    }
    
    experiences.forEach(job => {
        checkPageBreak(40);
        
        // Job title + company inline for compactness
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10.5);
        pdf.setTextColor(...darkGray);
        const titleText = job.title;
        pdf.text(titleText, leftMargin, yPos);
        
        // Dates
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...gray);
        const dateText = `${formatDate(job.startDate)} – ${job.endDate ? formatDate(job.endDate) : 'Present'}`;
        pdf.text(dateText, pageWidth - rightMargin - pdf.getTextWidth(dateText), yPos);
        yPos += 4.5;
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(9.5);
        pdf.setTextColor(...accent);
        pdf.text(job.company, leftMargin, yPos);
        yPos += 4.5;
        
        // Highlights
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...darkGray);
        
        // Select top highlights for condensed formats
        let highlights = job.highlights;
        if (format === 'resume') {
            highlights = highlights.slice(0, 3);
        } else if (format === 'summary') {
            highlights = highlights.slice(0, 2);
        }
        
        highlights.forEach(highlight => {
            // Avoid very long highlights causing dense first page: truncate in full format as well
            let txt = highlight.text;
            if (format === 'full' && txt.length > 210) txt = txt.slice(0, 210) + '...';
            renderBulletParagraph(sanitizeText(txt), 8.9);
        });
        yPos += 2;
        // Divider
        pdf.setDrawColor(...lightGray);
        pdf.setLineWidth(0.2);
        pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
        yPos += 4;
    });
    
    // ============ EDUCATION ============
    checkPageBreak(40);
    addSectionHeader('Education');
    
    // Education selection based on format (full => all, resume => 2, summary => 1)
    let educationItems = cvData.education;
    if (format === 'resume') educationItems = educationItems.slice(0, 2);
    if (format === 'summary') educationItems = educationItems.slice(0, 1);

    educationItems.forEach(edu => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(...darkGray);
        pdf.text(edu.degree, leftMargin, yPos);
        
        // Dates
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...gray);
        const eduDateText = `${formatDate(edu.startDate)} – ${formatDate(edu.endDate)}`;
        pdf.text(eduDateText, pageWidth - rightMargin - pdf.getTextWidth(eduDateText), yPos);
        yPos += 5;
        
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.text(edu.institution, leftMargin, yPos);
        yPos += 5;
        
        if (edu.gpa) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.text(`GPA: ${edu.gpa}`, leftMargin, yPos);
            yPos += 5;
        }
        
        yPos += 3;
    });
    
    // ============ TECHNICAL SKILLS ============
    checkPageBreak(40);
    addSectionHeader('Technical Skills');
    
    const skills = cvData.skills;
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    // Two-column skills layout
    const colGap = 10;
    const colWidth = (contentWidth - colGap) / 2;
    const leftX = leftMargin;
    const rightX = leftMargin + colWidth + colGap;
    let leftY = yPos;
    let rightY = yPos;

    function renderSkillBlock(x, y, title, items) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(...accent);
        pdf.text(title, x, y);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...darkGray);
        const h = renderWrappedText(items.join(', '), x, y + 3.5, colWidth, 8.5, 4.2) + 7;
        return h;
    }
    const blocks = [
        ['Languages', skills.languages],
        ['Cloud & MLOps', skills.cloudAndMLOps],
        ['Databases', [...skills.databases.relational, ...skills.databases.nosql]],
        ['Big Data', skills.bigData],
        ['ML', skills.machineLearning],
        ['Visualization', skills.visualization],
        ['Tools', skills.tools],
        ['Design', skills.design]
    ];
    blocks.forEach((b, idx) => {
        const targetLeft = leftY <= rightY;
        const x = targetLeft ? leftX : rightX;
        const newHeight = renderSkillBlock(x, targetLeft ? leftY : rightY, b[0], b[1]);
        if (targetLeft) leftY += newHeight; else rightY += newHeight;
    });
    yPos = Math.max(leftY, rightY) + 2;
    
    // ============ CERTIFICATIONS (if space permits and full format) ============
    if (format === 'full') {
        checkPageBreak(40);
        addSectionHeader('Certifications & Training');
        
        pdf.setFontSize(9);
        pdf.setTextColor(...darkGray);
        
        // Full format includes all certifications; others already omitted
        const certs = cvData.certifications.slice(0, format === 'full' ? cvData.certifications.length : 5);
        certs.forEach(cert => {
            checkPageBreak(10);
            const certText = `• ${cert.name} - ${cert.issuer} (${cert.date})`;
            const certHeight = renderWrappedText(certText, leftMargin, yPos, contentWidth - 5, 9, 5);
            yPos += certHeight + 3;
        });
        
        yPos += 7;
    }
    
    // ============ LEADERSHIP & ACHIEVEMENTS ============
    checkPageBreak(40);
    // ============ LEADERSHIP =========
    addSectionHeader('Leadership');
    
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    // Leadership roles
    const leadershipList = (format === 'full') ? cvData.leadership : cvData.leadership.slice(0, 2);
    leadershipList.forEach(role => {
        checkPageBreak(15);
        renderBulletParagraph(`${role.role}, ${role.organization} (${role.period})`, 9);
    });

    yPos += 4;
    // ============ AWARDS =========
    checkPageBreak(30);
    addSectionHeader('Awards');
    const awardsList = (format === 'full') ? cvData.awards : cvData.awards.slice(0, 4);
    awardsList.forEach(award => {
        checkPageBreak(12);
        renderBulletParagraph(`${award.title}${award.year ? ` (${award.year})` : ''}`, 9);
    });
    yPos += 2;
    // ============ PUBLICATIONS =========
    checkPageBreak(30);
    addSectionHeader('Publications');
    const pubs = (format === 'full') ? cvData.publications : cvData.publications.slice(0, 1);
    pubs.forEach(pub => {
        checkPageBreak(12);
        renderBulletParagraph(`${pub.title}${pub.journal ? ` – ${pub.journal}` : pub.institution ? ` – ${pub.institution}` : ''} (${pub.year})`, 9);
    });
    yPos += 4;
    
    // ============ LANGUAGES ============
    checkPageBreak(25);
    addSectionHeader('Languages');
    
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    cvData.languages.forEach(lang => {
        renderBulletParagraph(`${lang.name} (${lang.level})`, 9);
    });
    
    // ============ PROJECTS (if full format and space permits) ============
    if (format === 'full') {
        checkPageBreak(50);
        if (yPos < pageHeight - bottomMargin - 50) {
            addSectionHeader('Selected Projects');
            
            pdf.setFontSize(9);
            pdf.setTextColor(...darkGray);
            
            cvData.projects.slice(0, 3).forEach(project => {
                checkPageBreak(18);
                // Project name (bold) and year with safe spacing
                pdf.setFont('helvetica', 'bold');
                const nameWidth = pdf.getTextWidth(project.name); // measure while bold
                const maxNameWidth = contentWidth - 25; // reserve space for year
                let displayName = project.name;
                let usedWidth = nameWidth;
                if (nameWidth > maxNameWidth) {
                    // Truncate overly long names
                    let truncated = project.name;
                    while (pdf.getTextWidth(truncated + '…') > maxNameWidth && truncated.length > 4) {
                        truncated = truncated.slice(0, -1);
                    }
                    displayName = truncated + '…';
                    usedWidth = pdf.getTextWidth(displayName);
                }
                pdf.text(displayName, leftMargin, yPos);
                // Year in normal font a small gap after name
                pdf.setFont('helvetica', 'normal');
                const gap = 2; // mm gap between name and year
                pdf.text(` (${project.year})`, leftMargin + usedWidth + gap, yPos);
                yPos += 5;
                const projDescHeight = renderWrappedText(project.description, leftMargin + 5, yPos, contentWidth - 10, 9, 5);
                yPos += projDescHeight + 5;
            });
        }
    }

    // ============ INTERESTS (Full only if space) ============
    if (format === 'full' && cvData.interests) {
        checkPageBreak(40);
        if (yPos < pageHeight - bottomMargin - 30) {
            addSectionHeader('Interests');
            pdf.setFontSize(9);
            pdf.setTextColor(...darkGray);
            const interestText = `${cvData.interests.philosophy} Professional: ${cvData.interests.professional.join(', ')}. Personal: ${cvData.interests.personal.join(', ')}`;
            const intHeight = renderWrappedText(interestText, leftMargin, yPos, contentWidth, 9, 5);
            yPos += intHeight + 5;
        }
    }
    
    // Add page numbers to all pages
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(...gray);
        pdf.text(`Page ${i} / ${totalPages}`, pageWidth / 2, pageHeight - 15, { align: 'center' });
    }
    
    // Set document properties
    pdf.setProperties({
        title: `${cvData.personal.name.full} - CV`,
        subject: 'Curriculum Vitae',
        author: cvData.personal.name.full,
        keywords: 'MLOps, Data Engineering, Machine Learning, CV',
        creator: 'Artemio Padilla CV Generator'
    });
    
    // Determine filename based on format
    let filename;
    switch(format) {
        case 'resume':
            filename = `${cvData.personal.name.first}_${cvData.personal.name.last.split(' ')[0]}_Resume.pdf`;
            break;
        case 'summary':
            filename = `${cvData.personal.name.first}_${cvData.personal.name.last.split(' ')[0]}_Summary.pdf`;
            break;
        default:
            filename = `${cvData.personal.name.first}_${cvData.personal.name.last.split(' ')[0]}_CV.pdf`;
    }
    
    // Save the PDF
    pdf.save(filename);
}

// Initialize button when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const pdfButton = document.getElementById('downloadPdfBtn');
    if (pdfButton) {
        pdfButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF('full');
        });
    }
    
    // Also handle the floating button
    const floatButton = document.querySelector('.pdf-float-btn');
    if (floatButton) {
        floatButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF('full');
        });
    }
    
    // Handle format-specific buttons if they exist
    const resumeButton = document.getElementById('downloadResumeBtn');
    if (resumeButton) {
        resumeButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF('resume');
        });
    }
    
    const summaryButton = document.getElementById('downloadSummaryBtn');
    if (summaryButton) {
        summaryButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF('summary');
        });
    }
});