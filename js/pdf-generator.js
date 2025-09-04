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
    
    // Page dimensions - standard margins for all formats for professional appearance
    const pageWidth = 210;
    const pageHeight = 297;
    const leftMargin = 18;
    const rightMargin = 18;
    const topMargin = format === 'summary' ? 16 : 20;  // Reduced top margin for 1-page
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
    const lineHeight = format === 'summary' ? 4.5 : 5;  // More readable line height
    const bulletIndent = 4; // mm - standard indent for all formats
    const sectionSpacing = format === 'summary' ? 4 : 6;  // Reduced space between sections for 1-page
    const bulletGap = format === 'summary' ? 1.5 : 2;  // Slightly more gap
    
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
        // Add small gap before header for 1-page to prevent overlap
        if (format === 'summary') yPos += 1;  // Small gap before headers
        checkPageBreak(15);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(format === 'summary' ? 11 : 11.5);  // Slightly larger for 1-page
        pdf.setTextColor(...accent);
        pdf.text(title.toUpperCase(), leftMargin, yPos);
        // Accent bar
        pdf.setDrawColor(...accent);
        pdf.setLineWidth(format === 'summary' ? 0.5 : 0.7);
        pdf.line(leftMargin, yPos + 1.8, leftMargin + (format === 'summary' ? 50 : 60), yPos + 1.8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...darkGray);
        yPos += format === 'summary' ? 6 : 8;  // Reduced space after header
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
    
    // Header block - smaller for 1-page
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(format === 'summary' ? 18 : 20);
    pdf.setTextColor(...darkGray);
    pdf.text(sanitizeText(`${personal.name.first} ${personal.name.last}`), leftMargin, yPos);
    yPos += format === 'summary' ? 6 : 9;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(format === 'summary' ? 11 : 12.5);
    pdf.setTextColor(...accent);
    pdf.text(sanitizeText(personal.title), leftMargin, yPos);
    yPos += format === 'summary' ? 5 : 7;
    
    // Add subtitle for condensed versions
    if (format === 'summary' || format === 'resume') {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(8);
        pdf.setTextColor(...gray);
        const subtitle = format === 'summary' 
            ? '1-Page Resume Highlights • Full CV at: https://artemiopadilla.github.io/cv.html'
            : '2-Page Resume Highlights • Full CV at: https://artemiopadilla.github.io/cv.html';
        pdf.text(subtitle, leftMargin, yPos);
        yPos += 4;
    }
    pdf.setFontSize(format === 'summary' ? 8.5 : 9);
    pdf.setTextColor(...gray);
    const contactLine = sanitizeText(`${personal.location}  •  ${personal.contact.phone}  •  ${personal.contact.email}`);
    pdf.text(contactLine, leftMargin, yPos);
    yPos += format === 'summary' ? 6 : 10;
    // Horizontal separator
    pdf.setDrawColor(...lightGray);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
    yPos += format === 'summary' ? 4 : 6;
    
    // ============ PROFESSIONAL SUMMARY ============
    addSectionHeader('Professional Summary');
    
    // Condense summary based on format
    pdf.setFontSize(9.5);
    let paragraphs = [];
    
    if (format === 'summary') {
        // 1-page: Just the brief (1-2 lines)
        paragraphs = [personal.summary.brief].filter(Boolean);
    } else if (format === 'resume') {
        // 2-page: Brief + tagline
        paragraphs = [
            personal.summary.brief,
            personal.summary.tagline
        ].filter(Boolean);
    } else {
        // Full CV: Everything
        paragraphs = [
            personal.summary.brief,
            personal.summary.tagline,
            personal.summary.full,
            personal.summary.connection,
            personal.summary.current
        ].filter(Boolean);
    }
    
    // Render selected paragraphs
    paragraphs.forEach((p, idx) => {
        const cleaned = fixSpacedOutParagraph(sanitizeText(p));
        if (typeof pdf.setCharSpace === 'function') pdf.setCharSpace(0);
        const fontSize = format === 'summary' ? 8.5 : 9.1;
        const h = renderParagraphWithExponents(cleaned, leftMargin, yPos, contentWidth, fontSize, lineHeight - 0.3);
        yPos += h + (format === 'summary' ? 1 : 2);
        checkPageBreak(25);
    });
    
    // Only show strengths for full CV, inline for 2-page resume
    if (format === 'resume' && personal.summary.strengths && personal.summary.strengths.length) {
        // Show first 2 strengths inline for 2-page resume
        const topStrengths = personal.summary.strengths.slice(0, 2).join('. ');
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(8.5);
        pdf.setTextColor(...gray);
        const strengthsHeight = renderWrappedText(sanitizeText(topStrengths), leftMargin, yPos, contentWidth, 8.5, lineHeight - 0.3);
        yPos += strengthsHeight + 2;
    } else if (format === 'full' && personal.summary.strengths && personal.summary.strengths.length) {
        // Full CV: show all strengths as bullets
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9.5);
        pdf.setTextColor(...darkGray);
        pdf.text('Core Strengths:', leftMargin, yPos);
        pdf.setFont('helvetica', 'normal');
        yPos += 5;
        personal.summary.strengths.forEach(s => renderBulletParagraph(s, 8.9));
    }
    
    // Only show closing for full CV
    if (format === 'full' && personal.summary.closing) {
        yPos += 2;
        const closingClean = fixSpacedOutParagraph(sanitizeText(personal.summary.closing));
        const closingHeight = renderWrappedText(closingClean, leftMargin, yPos, contentWidth, 8.9, lineHeight - 0.3);
        yPos += closingHeight;
    }
    
    yPos += format === 'summary' ? 2 : sectionSpacing;
    
    // ============ PROFESSIONAL EXPERIENCE ============
    addSectionHeader('Professional Experience');
    
    // Determine which experiences to include based on format
    let experiences = cvData.experience;
    if (format === 'resume') {
        experiences = experiences.slice(0, 3);  // 2-page: 3 jobs
    } else if (format === 'summary') {
        experiences = experiences.slice(0, 3);  // 1-page: 3 jobs with fewer highlights
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
            // For 1-page: show 2-3 highlights for most recent job, 1 for others
            const jobIndex = experiences.indexOf(job);
            highlights = jobIndex === 0 ? highlights.slice(0, 3) : highlights.slice(0, 1);
        }
        
        const bulletFontSize = format === 'summary' ? 8.5 : 8.9;
        highlights.forEach(highlight => {
            // Don't truncate for 1-page since we only show 1 highlight - show complete text
            let txt = highlight.text;
            if (format === 'full' && txt.length > 210) txt = txt.slice(0, 210) + '...';
            // No truncation for summary - we have space for 1 complete highlight per job
            renderBulletParagraph(sanitizeText(txt), bulletFontSize);
        });
        yPos += format === 'summary' ? 2 : 2;  // Reduced space after highlights
        // Divider
        pdf.setDrawColor(...lightGray);
        pdf.setLineWidth(0.2);
        pdf.line(leftMargin, yPos, pageWidth - rightMargin, yPos);
        yPos += format === 'summary' ? 4 : 4;  // Reduced space after divider
    });
    
    // ============ EDUCATION ============
    checkPageBreak(40);
    addSectionHeader('Education');
    
    // Education selection based on format
    let educationItems = cvData.education;
    if (format === 'resume') educationItems = educationItems.slice(0, 2);  // 2-page: 2 degrees
    if (format === 'summary') educationItems = educationItems.slice(0, 3);  // 1-page: 3 degrees (all formal education)

    educationItems.forEach(edu => {
        if (format === 'summary') {
            // Ultra-compact format for 1-page
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);
            pdf.setTextColor(...darkGray);
            pdf.text(edu.degree, leftMargin, yPos);
            
            // Dates on same line
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(...gray);
            const endDateText = edu.endDate ? formatDate(edu.endDate) : (edu.expectedEndDate ? `Expected ${formatDate(edu.expectedEndDate)}` : 'Present');
            const eduDateText = `${formatDate(edu.startDate)} – ${endDateText}`;
            pdf.text(eduDateText, pageWidth - rightMargin - pdf.getTextWidth(eduDateText), yPos);
            yPos += 3.5;
            
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(8);
            pdf.text(edu.institution, leftMargin, yPos);
            yPos += 4;  // Better spacing between education entries
        } else {
            // Original format for 2-page and full
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.setTextColor(...darkGray);
            pdf.text(edu.degree, leftMargin, yPos);
            
            // Dates
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(...gray);
            const endDateText = edu.endDate ? formatDate(edu.endDate) : (edu.expectedEndDate ? `Expected ${formatDate(edu.expectedEndDate)}` : 'Present');
            const eduDateText = `${formatDate(edu.startDate)} – ${endDateText}`;
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
        }
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
        pdf.setFontSize(format === 'summary' ? 8 : 9);
        pdf.setTextColor(...accent);
        pdf.text(title, x, y);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...darkGray);
        const fontSize = format === 'summary' ? 7.5 : 8.5;
        const lineHeight = format === 'summary' ? 3.5 : 4.2;
        const offset = format === 'summary' ? 2.5 : 3.5;
        const h = renderWrappedText(items.join(', '), x, y + offset, colWidth, fontSize, lineHeight) + (format === 'summary' ? 5 : 7);
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
    
    // ============ CERTIFICATIONS ============
    // Skip certifications for 1-page to save space
    if (format !== 'summary') {
        checkPageBreak(40);
        addSectionHeader('Certifications & Training');
        
        pdf.setFontSize(9);
        pdf.setTextColor(...darkGray);
        
        // Limit certifications based on format
        const certLimit = format === 'full' ? cvData.certifications.length : 5;  // resume: top 5
        const certs = cvData.certifications.slice(0, certLimit);
        
        certs.forEach(cert => {
            checkPageBreak(10);
            const certText = `• ${cert.name} - ${cert.issuer} (${cert.date})`;
            const certHeight = renderWrappedText(certText, leftMargin, yPos, contentWidth - 5, 9, 5);
            yPos += certHeight + 3;
        });
        
        yPos += 7;
    }
    
    // ============ LEADERSHIP & ACHIEVEMENTS ============
    // Skip these sections for 1-page resume to save space
    if (format !== 'summary') {
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
    }
    
    // ============ LANGUAGES & AWARDS (Two-column for 1-page) ============
    if (format === 'summary') {
        // Two-column layout for 1-page resume
        checkPageBreak(35);
        
        const colWidth = (contentWidth - 10) / 2;
        const col1X = leftMargin;
        const col2X = leftMargin + colWidth + 10;
        
        // Languages column
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(...accent);
        pdf.text('LANGUAGES', col1X, yPos);
        pdf.setDrawColor(...accent);
        pdf.setLineWidth(0.5);
        pdf.line(col1X, yPos + 1.8, col1X + 30, yPos + 1.8);
        
        // Awards column
        pdf.text('AWARDS', col2X, yPos);
        pdf.line(col2X, yPos + 1.8, col2X + 30, yPos + 1.8);
        
        yPos += 5;
        
        // Languages content
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.5);
        pdf.setTextColor(...darkGray);
        let langY = yPos;
        cvData.languages.forEach(lang => {
            pdf.text(`• ${lang.name} (${lang.level})`, col1X, langY);
            langY += 4;
        });
        
        // Awards content (last 3)
        let awardY = yPos;
        const recentAwards = cvData.awards.slice(0, 3);
        recentAwards.forEach(award => {
            const awardText = `• ${award.title}${award.year ? ` (${award.year})` : ''}`;
            // Wrap text if too long
            const maxWidth = colWidth - 5;
            if (pdf.getTextWidth(awardText) > maxWidth) {
                const lines = wrapText(awardText, maxWidth, 8.5);
                lines.forEach((line, idx) => {
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
        // Single column for other formats
        checkPageBreak(25);
        addSectionHeader('Languages');
        
        pdf.setFontSize(9);
        pdf.setTextColor(...darkGray);
        
        cvData.languages.forEach(lang => {
            renderBulletParagraph(`${lang.name} (${lang.level})`, 9);
        });
    }
    
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
    
    // Add page numbers and footer to all pages
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(...gray);
        
        // For condensed resumes, add footer with CV link
        if ((format === 'summary' && i === 1) || (format === 'resume' && i === totalPages)) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(7.5);
            pdf.text('For complete CV with all details, visit: https://artemiopadilla.github.io/cv.html', pageWidth / 2, pageHeight - 10, { align: 'center' });
        } else if (format !== 'summary') {
            // Regular page numbers for full CV and non-last pages of 2-page resume
            pdf.text(`Page ${i} / ${totalPages}`, pageWidth / 2, pageHeight - 15, { align: 'center' });
        }
    }
    
    // Set document properties
    pdf.setProperties({
        title: `${cvData.personal.name.full} - CV`,
        subject: 'Curriculum Vitae',
        author: cvData.personal.name.full,
        keywords: 'MLOps, Data Engineering, Machine Learning, CV',
        creator: 'Artemio Padilla CV Generator'
    });
    
    // Determine filename based on format with clear differentiation
    let filename;
    const firstName = cvData.personal.name.first;
    const lastName = cvData.personal.name.last.split(' ')[0];
    
    switch(format) {
        case 'resume':
            filename = `${firstName}_${lastName}_Resume_2pg.pdf`;
            break;
        case 'summary':
            filename = `${firstName}_${lastName}_Resume_1pg.pdf`;
            break;
        default:
            filename = `${firstName}_${lastName}_CV_Full.pdf`;
    }
    
    // Save the PDF
    pdf.save(filename);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Both download buttons are now dropdowns handled in their respective files
    // No direct PDF generation on button click needed
    
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