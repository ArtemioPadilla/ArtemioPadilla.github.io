// PDF Generator for CV using jsPDF
// Simplified version with manual text wrapping for better control

function generatePDF() {
    // Initialize jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    // Page dimensions - conservative settings
    const pageWidth = 210;
    const pageHeight = 297;
    const leftMargin = 30;
    const rightMargin = 30;
    const topMargin = 30;
    const bottomMargin = 30;
    const contentWidth = pageWidth - leftMargin - rightMargin; // 150mm
    let yPos = topMargin;
    let pageNum = 1;
    
    // Colors
    const blue = [0, 123, 255];
    const darkGray = [50, 50, 50];
    const gray = [100, 100, 100];
    
    // Set default font
    pdf.setFont('helvetica', 'normal');
    
    // Manual text wrapping function
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
    
    // Render text with manual wrapping
    function renderWrappedText(text, x, y, maxWidth, fontSize, lineHeight) {
        const lines = wrapText(text, maxWidth, fontSize);
        pdf.setFontSize(fontSize);
        
        lines.forEach((line, index) => {
            pdf.text(line, x, y + (index * lineHeight));
        });
        
        return lines.length * lineHeight;
    }
    
    // Check for page break
    function checkPageBreak(requiredSpace) {
        if (yPos + requiredSpace > pageHeight - bottomMargin) {
            pdf.addPage();
            yPos = topMargin;
            pageNum++;
            addPageNumber();
            return true;
        }
        return false;
    }
    
    // Add page number
    function addPageNumber() {
        // Page number is added at the end for all pages
    }
    
    // Add section header
    function addSectionHeader(title) {
        checkPageBreak(15);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(...blue);
        pdf.text(title.toUpperCase(), leftMargin, yPos);
        
        // Add underline
        pdf.setDrawColor(...blue);
        pdf.setLineWidth(0.5);
        pdf.line(leftMargin, yPos + 2, leftMargin + 50, yPos + 2);
        
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...darkGray);
        yPos += 10;
    }
    
    // ============ HEADER ============
    // Name - simplified
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(...darkGray);
    pdf.text('Artemio Santiago', leftMargin, yPos);
    yPos += 8;
    
    pdf.setFontSize(22);
    pdf.text('Padilla Robles', leftMargin, yPos);
    yPos += 12;
    
    // Title
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(14);
    pdf.setTextColor(...blue);
    pdf.text('MLOps & Automation Engineer Sr.', leftMargin, yPos);
    yPos += 10;
    
    // Contact - simple left-aligned
    pdf.setFontSize(10);
    pdf.setTextColor(...gray);
    pdf.text('Mexico City', leftMargin, yPos);
    yPos += 5;
    pdf.text('55-6047-6808', leftMargin, yPos);
    yPos += 5;
    pdf.text('artemiopadilla@gmail.com', leftMargin, yPos);
    yPos += 15;
    
    // ============ PROFESSIONAL SUMMARY ============
    addSectionHeader('Professional Summary');
    
    const summaryText = "I'm a Mexican engineer focused on building reliable ML infrastructure that improves " +
                       "large-scale decision quality. With a background in nanoscience research (STM/AFM/Raman " +
                       "spectroscopy) and a peer-reviewed publication, I learned the discipline of working at " +
                       "10^-9 meters in ultra-high vacuum. Today, I apply the same rigor to ML infrastructure—ensuring " +
                       "models scale reliably to 10^9 requests.";
    
    pdf.setFontSize(10);
    const summaryHeight = renderWrappedText(summaryText, leftMargin, yPos, contentWidth, 10, 5);
    yPos += summaryHeight + 10;
    
    // ============ PROFESSIONAL EXPERIENCE ============
    addSectionHeader('Professional Experience');
    
    // Job 1
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('MLOps & Automation Engineer Sr.', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Dec 2023 – Present', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.setTextColor(...gray);
    pdf.text('Círculo de Crédito', leftMargin, yPos);
    yPos += 6;
    
    // Bullet points
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    const bullet1 = "• Founded division: established the company's MLOps & Automation division (strategy, tooling, governance).";
    const bullet1Height = renderWrappedText(bullet1, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet1Height + 3;
    
    const bullet2 = "• Accelerated model deployment: led productization of 9 analytical models (collections scoring, loan estimations, inference systems), cutting deployment time from >2 quarters to <1 quarter.";
    const bullet2Height = renderWrappedText(bullet2, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet2Height + 10;
    
    // Job 2
    checkPageBreak(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...darkGray);
    pdf.text('Data Engineer', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Aug 2022 – Dec 2023', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.text('Círculo de Crédito', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    const bullet3 = "• Initiated the company's knowledge graph as the foundation for automation and smarter data integration.";
    const bullet3Height = renderWrappedText(bullet3, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet3Height + 3;
    
    const bullet4 = "• Led external data enrichment (e.g., RENAPO), improving records for 80M+ individuals at scale.";
    const bullet4Height = renderWrappedText(bullet4, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet4Height + 10;
    
    // Job 3
    checkPageBreak(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...darkGray);
    pdf.text('Search Engine Evaluator', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Sept 2019 – Aug 2022', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.text('Appen (Remote)', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    const bullet5 = "• Evaluated companies, entities, and information sources against Google's information-quality guidelines, consistently ranking in the top 20% of evaluators.";
    const bullet5Height = renderWrappedText(bullet5, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet5Height + 3;
    
    const bullet6 = "• Assessed relevance, accuracy, and usefulness of search results to improve algorithms and user experience.";
    const bullet6Height = renderWrappedText(bullet6, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet6Height + 10;
    
    // Job 4
    checkPageBreak(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...darkGray);
    pdf.text('Laboratory Research Assistant – Nanosciences Lab', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Aug 2017 – Sept 2020', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.text('Institute of Physics (UNAM)', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    const bullet7 = "• Co-developed a modular optical system enabling enhanced Raman spectroscopy techniques for nanoscale research.";
    const bullet7Height = renderWrappedText(bullet7, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet7Height + 3;
    
    const bullet8 = "• Designed, assembled, and calibrated precision components under ultra-high vacuum, ensuring high SNR and reproducibility.";
    const bullet8Height = renderWrappedText(bullet8, leftMargin, yPos, contentWidth - 5, 9, 5);
    yPos += bullet8Height + 10;
    
    // ============ EDUCATION ============
    checkPageBreak(40);
    addSectionHeader('Education');
    
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...darkGray);
    pdf.text("Bachelor's Degree in Data Science", leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Sept 2020 – Jun 2022', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.text('National Autonomous University of Mexico (UNAM)', leftMargin, yPos);
    yPos += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('GPA: 3.84/4.0', leftMargin, yPos);
    yPos += 8;
    
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...darkGray);
    pdf.text('Bachelor of Science in Physics', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text('Sept 2013 – Sept 2020', pageWidth - rightMargin - 35, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(10);
    pdf.text('National Autonomous University of Mexico (UNAM)', leftMargin, yPos);
    yPos += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('GPA: 3.73/4.0', leftMargin, yPos);
    yPos += 10;
    
    // ============ TECHNICAL SKILLS ============
    checkPageBreak(40);
    addSectionHeader('Technical Skills');
    
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Languages:', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Python, SQL, R, Julia, C++, MATLAB', leftMargin + 25, yPos);
    yPos += 6;
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Cloud & MLOps:', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    const cloudText = 'AWS (SageMaker, EMR, Lambda, Glue), Airflow, Docker, Snowflake';
    const cloudHeight = renderWrappedText(cloudText, leftMargin + 25, yPos, contentWidth - 30, 9, 5);
    yPos += Math.max(cloudHeight, 6);
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Databases:', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text('PostgreSQL, MySQL, MongoDB, Cassandra, Neo4j, Redis', leftMargin + 25, yPos);
    yPos += 6;
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Big Data:', leftMargin, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Spark (PySpark), EMR, Data Lake architectures', leftMargin + 25, yPos);
    yPos += 10;
    
    // ============ LEADERSHIP & ACHIEVEMENTS ============
    checkPageBreak(40);
    addSectionHeader('Leadership & Achievements');
    
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    const achievements = [
        '• Co-Founder & Secretary-General, SECiD (Data Science Alumni Society) - 2024-Present',
        '• Student Representative, UNAM Data Science Program - 2021-2022',
        '• Peer-reviewed publication in Crystals journal - 2020',
        '• 1st Place, UN Youth Hackathon (All student team award) - 2021',
        '• 3rd Place, UN Youth Hackathon (General Award) - 2021'
    ];
    
    achievements.forEach(achievement => {
        checkPageBreak(10);
        const height = renderWrappedText(achievement, leftMargin, yPos, contentWidth - 5, 9, 5);
        yPos += height + 3;
    });
    
    yPos += 7;
    
    // ============ LANGUAGES ============
    checkPageBreak(25);
    addSectionHeader('Languages');
    
    pdf.setFontSize(9);
    pdf.setTextColor(...darkGray);
    
    pdf.text('• Spanish (Native)', leftMargin, yPos);
    yPos += 5;
    pdf.text('• English (Fluent - TOEFL Certified)', leftMargin, yPos);
    yPos += 5;
    pdf.text('• French (Basic)', leftMargin, yPos);
    
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
        title: 'Artemio Padilla - CV',
        subject: 'Curriculum Vitae',
        author: 'Artemio Padilla',
        keywords: 'MLOps, Data Engineering, Machine Learning, CV',
        creator: 'Artemio Padilla CV Generator'
    });
    
    // Save the PDF
    pdf.save('Artemio_Padilla_CV.pdf');
}

// Initialize button when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const pdfButton = document.getElementById('downloadPdfBtn');
    if (pdfButton) {
        pdfButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF();
        });
    }
    
    // Also handle the floating button
    const floatButton = document.querySelector('.pdf-float-btn');
    if (floatButton) {
        floatButton.addEventListener('click', function(e) {
            e.preventDefault();
            generatePDF();
        });
    }
});