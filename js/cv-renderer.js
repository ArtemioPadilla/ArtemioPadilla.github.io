// CV Renderer - Dynamically generates CV HTML from JSON data
class CVRenderer {
    constructor() {
        this.data = null;
        this.format = 'full'; // full, resume, summary
    }

    // Load CV data from JSON
    async loadData() {
        // Start with embedded data (works offline / file://)
        if (window.cvData) {
            this.data = window.cvData;
        }
        // Fetch authoritative JSON when running over HTTP(S)
        if (location.protocol.startsWith('http')) {
            try {
                const response = await fetch('data/cv-data.json?cb=' + Date.now(), { cache: 'no-store' });
                if (!response.ok) throw new Error(`Failed to load CV data: ${response.status}`);
                this.data = await response.json();
            } catch (error) {
                console.warn('Fetch failed, using embedded cvData if available:', error);
                if (!this.data) throw error;
            }
        }
        if (!this.data) return false;
        this.validateData();
        return true;
    }

    // Non-mutating validation (no band-aids)
    validateData() {
        const expIds = new Set((this.data.experience||[]).map(e=>e.id));
        const leadershipStudent = (this.data.leadership||[]).some(l=> (l.role||'').startsWith('Student Representative'));
        if (!expIds.has('unam-student-rep')) {
            console.warn('[CV Validation] Student Representative role missing from experience array (id: unam-student-rep). Update source data.');
        }
        if (leadershipStudent && expIds.has('unam-student-rep')) {
            // All good (it was moved). Nothing to do.
        }
    }
    
    // Show error message in all sections
    showError(message) {
        const sections = document.querySelectorAll('.resume-section-content');
        sections.forEach(section => {
            section.innerHTML = `
                <div class="error-message">
                    <h3>Error Loading Content</h3>
                    <p>${message}</p>
                    <p>You can try:</p>
                    <ul>
                        <li>Refreshing the page</li>
                        <li>Downloading the <a href="#" onclick="generatePDF()">PDF version</a></li>
                        <li>Viewing the <a href="cv-backup.html">static backup version</a></li>
                    </ul>
                </div>
            `;
        });
    }

    // Set rendering format
    setFormat(format) {
        this.format = format;
    }

    // Main render function
    async render() {
        if (!this.data) {
            const loaded = await this.loadData();
            if (!loaded) {
                console.error('Failed to load CV data');
                return;
            }
        }

        try {
            // Render each section
            this.renderAbout();
            this.renderExperience();
            this.renderProjects();
            this.renderEducation();
            this.renderCertifications();
            this.renderSkills();
            this.renderLeadership();
            this.renderInterests();
            this.renderAwards();
            this.renderPublications();
            this.renderLanguages();
        } catch (error) {
            console.error('Error rendering CV:', error);
            this.showError('An error occurred while rendering the CV. Please refresh the page.');
        }
    }

    // Render About section
    renderAbout() {
        const aboutSection = document.getElementById('about');
        if (!aboutSection) return;

        const content = aboutSection.querySelector('.resume-section-content');
        if (!content) return;

        const { personal } = this.data;
        
        // Clear existing content
        content.innerHTML = '';
        
        // Build HTML
        const html = `
            <h1 class="mb-0">
                ${personal.name.first}
                <span class="text-primary">${personal.name.last}</span>
            </h1>
            <div class="subheading mb-5">
                ${personal.location} · ${personal.contact.phone} ·
                <a href="mailto:${personal.contact.email}">${personal.contact.email}</a>
            </div>
            <p class="lead mb-3">${personal.summary.brief}</p>
            <p class="lead mb-3"><strong>${personal.summary.tagline}</strong></p>
            <p class="lead mb-3">${personal.summary.full}</p>
            <p class="lead mb-3">
                <strong>${personal.summary.connection.split('?')[0]}?</strong> 
                ${personal.summary.connection.split('?')[1]}
            </p>
            <p class="lead mb-3">${personal.summary.current}</p>
            <ul class="mb-4">
                ${personal.summary.strengths.map(s => `<li>${s}</li>`).join('')}
            </ul>
            <p class="lead mb-4">${personal.summary.closing}</p>
            
            <div class="social-icons">
                <a class="social-icon" href="${personal.contact.linkedin}" aria-label="LinkedIn">
                    <i class="fab fa-linkedin-in"></i>
                </a>
                <a class="social-icon" href="${personal.contact.github}" aria-label="GitHub">
                    <i class="fab fa-github"></i>
                </a>
                <a class="social-icon" href="${personal.contact.orcid}" aria-label="ORCID">
                    <i class="fa-brands fa-orcid"></i>
                </a>
                <a class="social-icon" href="${personal.contact.twitter}" aria-label="Twitter">
                    <i class="fab fa-twitter"></i>
                </a>
                <a class="social-icon" href="${personal.contact.facebook}" aria-label="Facebook">
                    <i class="fab fa-facebook-f"></i>
                </a>
            </div>
            
            <!-- PDF Download Dropdown -->
            <div class="mt-4 dropdown">
                <button class="btn btn-primary btn-lg dropdown-toggle" type="button" id="downloadPdfBtn" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-file-pdf me-2"></i>Download PDF
                </button>
                <ul class="dropdown-menu" aria-labelledby="downloadPdfBtn">
                    <li>
                        <a class="dropdown-item" href="#" onclick="generatePDF('full'); return false;">
                            <i class="fas fa-file-alt me-2"></i>Full CV
                            <small class="d-block text-muted">Complete with all details</small>
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" href="#" onclick="generatePDF('resume'); return false;">
                            <i class="fas fa-file me-2"></i>2-Page Resume
                            <small class="d-block text-muted">Resume highlights</small>
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" href="#" onclick="generatePDF('summary'); return false;">
                            <i class="fas fa-file-invoice me-2"></i>1-Page Resume
                            <small class="d-block text-muted">Executive summary</small>
                        </a>
                    </li>
                </ul>
            </div>
        `;
        
        content.innerHTML = html;
        
        // Bootstrap dropdown will handle the button click - no need for additional listener
    }

    // Render Experience section
    renderExperience() {
        const experienceSection = document.getElementById('experience');
        if (!experienceSection) return;

        const content = experienceSection.querySelector('.resume-section-content');
        if (!content) return;

    let experiences = this.data.experience;
        
        // Filter based on format
        if (this.format === 'resume') {
            experiences = experiences.slice(0, 3);
        } else if (this.format === 'summary') {
            experiences = experiences.slice(0, 2);
        }

        const html = `
            <h2 class="mb-5">Professional Experience</h2>
            ${experiences.map(exp => `
                <div class="d-flex flex-column flex-md-row justify-content-between mb-5">
                    <div class="flex-grow-1">
                        <h3 class="mb-0">${exp.title}</h3>
                        <div class="subheading mb-3">${exp.company}</div>
                        <ul>
                            ${exp.highlights.map(h => `<li>${this.formatHighlight(h)}</li>`).join('')}
                        </ul>
                    </div>
                    <div class="flex-shrink-0">
                        <span class="text-primary">
                            ${this.formatDate(exp.startDate)} – ${exp.endDate ? this.formatDate(exp.endDate) : 'Present'}
                        </span>
                    </div>
                </div>
            `).join('')}
        `;
        
        content.innerHTML = html;
    }

    // Render Projects section
    renderProjects() {
        const projectsSection = document.getElementById('projects');
        if (!projectsSection) return;

        const content = projectsSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Projects</h2>
            ${this.data.projects.map(project => `
                <div class="d-flex flex-column flex-md-row justify-content-between mb-5">
                    <div class="flex-grow-1">
                        <h3 class="mb-0">
                            <a href="${project.url}" target="_blank"><strong>${project.name}</strong></a>
                        </h3>
                        <div class="subheading mb-3">${project.type}</div>
                        <p>${project.description}</p>
                    </div>
                    <div class="flex-shrink-0"><span class="text-primary">${project.year}</span></div>
                </div>
            `).join('')}
        `;
        
        content.innerHTML = html;
    }

    // Render Education section
    renderEducation() {
        const educationSection = document.getElementById('education');
        if (!educationSection) return;

        const content = educationSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Formal Education</h2>
            ${this.data.education.map(edu => `
                <div class="d-flex flex-column flex-md-row justify-content-between mb-5">
                    <div class="flex-grow-1">
                        <h3 class="mb-0">${edu.institution}</h3>
                        <div class="subheading mb-3">${edu.degree}</div>
                        ${edu.coursework ? `<div>Relevant coursework: ${edu.coursework}</div>` : ''}
                        ${edu.gpa ? `<p>GPA: ${edu.gpa}</p>` : ''}
                        ${edu.achievement ? `<div>${edu.achievement}</div>` : ''}
                    </div>
                    <div class="flex-shrink-0">
                        <span class="text-primary">
                            ${this.formatDate(edu.startDate, true)} – ${edu.endDate ? this.formatDate(edu.endDate, true) : (edu.expectedEndDate ? `Expected ${this.formatDate(edu.expectedEndDate, true)}` : 'Present')}
                        </span>
                    </div>
                </div>
            `).join('')}
        `;
        
        content.innerHTML = html;
    }

    // Render Certifications section (Other Education)
    renderCertifications() {
        const certSection = document.getElementById('othereducation');
        if (!certSection) return;

        const content = certSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Other Education</h2>
            ${this.data.certifications.map(cert => `
                <div class="d-flex flex-column flex-md-row justify-content-between mb-5">
                    <div class="flex-grow-1">
                        <h3 class="mb-0">${cert.type}: ${cert.name}</h3>
                        <div class="subheading mb-3">${cert.issuer}</div>
                        ${cert.url ? 
                            `<div><a href="${cert.url}" target="_blank"><strong>Certificate</strong></a></div>` :
                            cert.description ? `<div>${cert.description}</div>` : ''
                        }
                    </div>
                    <div class="flex-shrink-0"><span class="text-primary">${cert.date}</span></div>
                </div>
            `).join('')}
        `;
        
        content.innerHTML = html;
    }

    // Render Skills section
    renderSkills() {
        const skillsSection = document.getElementById('skills');
        if (!skillsSection) return;

        const content = skillsSection.querySelector('.resume-section-content');
        if (!content) return;

        const { skills } = this.data;
        
        const html = `
            <h2 class="mb-5">Skills</h2>
            <div class="subheading mb-3">Programming Languages & Tools</div>
            <ul class="list-inline dev-icons">
                <li class="list-inline-item"><i class="fab fa-python"></i></li>
                <li class="list-inline-item"><i class="fas fa-database"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-r-project"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-github"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-raspberry-pi"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-docker"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-linux"></i></li>
                <li class="list-inline-item"><i class="fa-brands fa-cloudflare"></i></li>
                <li class="list-inline-item"><i class="fab fa-html5"></i></li>
                <li class="list-inline-item"><i class="fab fa-css3-alt"></i></li>
            </ul>
            <div class="subheading mb-3">Other:</div>
            <ul class="fa-ul mb-0">
                <li>
                    <span class="fa-li"><i class="fas fa-database"></i></span>
                    <strong>Relational Databases:</strong> ${skills.databases.relational.join(', ')}
                </li>
                <li>
                    <span class="fa-li"><i class="fa-solid fa-folder"></i></span>
                    <strong>NoSQL Databases:</strong> ${skills.databases.nosql.join(', ')}
                </li>
                <li>
                    <span class="fa-li"><i class="fa-solid fa-server"></i></span>
                    <strong>Big Data:</strong> ${skills.bigData.join(', ')}
                </li>
                <li>
                    <span class="fa-li"><i class="fa-solid fa-paintbrush"></i></span>
                    <strong>Adobe:</strong> ${skills.design.join(', ')}
                </li>
                <li>
                    <span class="fa-li"><i class="fa-solid fa-code"></i></span>
                    <strong>Other programming languages:</strong> ${skills.languages.filter(l => !['Python', 'SQL', 'R'].includes(l)).join(', ')}
                </li>
            </ul>
        `;
        
        content.innerHTML = html;
    }

    // Render Leadership section
    renderLeadership() {
        const leadershipSection = document.getElementById('leadership');
        if (!leadershipSection) return;

        const content = leadershipSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Leadership</h2>
            ${this.data.leadership.map(item => `
                <div class="d-flex flex-column flex-md-row justify-content-between mb-5">
                    <div class="flex-grow-1">
                        <h3 class="mb-0">${item.role}</h3>
                        <div class="subheading mb-3">${item.organization}</div>
                        ${item.highlights ? 
                            `<ul>${item.highlights.map(h => `<li>${h}</li>`).join('')}</ul>` :
                            item.description ? `<p>${item.description}</p>` : ''
                        }
                    </div>
                    <div class="flex-shrink-0"><span class="text-primary">${item.period}</span></div>
                </div>
            `).join('')}
        `;
        
        content.innerHTML = html;
    }

    // Render Interests section
    renderInterests() {
        const interestsSection = document.getElementById('interests');
        if (!interestsSection) return;

        const content = interestsSection.querySelector('.resume-section-content');
        if (!content) return;

        const { interests } = this.data;
        
        const html = `
            <h2 class="mb-5">Interests</h2>
            <p class="mb-4">${interests.philosophy}</p>
            <p class="mb-4">Professional interests: ${interests.professional.join(', ')}</p>
            <p class="mb-0">Personal interests: ${interests.personal.join(', ')}</p>
        `;
        
        content.innerHTML = html;
    }

    // Render Awards section
    renderAwards() {
        const awardsSection = document.getElementById('awards');
        if (!awardsSection) return;

        const content = awardsSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Awards</h2>
            <ul class="fa-ul mb-0">
                ${this.data.awards.map(award => `
                    <li>
                        <span class="fa-li"><i class="fas fa-trophy text-warning"></i></span>
                        ${award.title}
                        ${award.organization ? ` - ${award.organization}` : ''}
                        ${award.year ? ` - ${award.year}` : ''}
                        ${award.certificates ? award.certificates.map(cert => 
                            ` · <a href="${cert.url}" target="_blank">${cert.name}</a>`
                        ).join('') : ''}
                    </li>
                `).join('')}
            </ul>
        `;
        
        content.innerHTML = html;
    }

    // Render Publications section
    renderPublications() {
        const pubSection = document.getElementById('publications');
        if (!pubSection) return;

        const content = pubSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Publications</h2>
            <ul class="fa-ul mb-0">
                ${this.data.publications.map(pub => `
                    <li>
                        <span class="fa-li"><i class="fa-solid fa-book"></i></span>
                        <a href="${pub.url}" target="_blank">
                            <strong>${pub.type}:</strong> ${pub.title}
                            ${pub.journal ? ` — <em>${pub.journal}</em>` : ''}
                            ${pub.institution ? ` — ${pub.institution}` : ''}
                            , ${pub.year}
                        </a>
                    </li>
                `).join('')}
            </ul>
        `;
        
        content.innerHTML = html;
    }

    // Render Languages section
    renderLanguages() {
        const langSection = document.getElementById('languages');
        if (!langSection) return;

        const content = langSection.querySelector('.resume-section-content');
        if (!content) return;

        const html = `
            <h2 class="mb-5">Languages</h2>
            <ul class="fa-ul mb-0">
                ${this.data.languages.map(lang => `
                    <li>
                        <span class="fa-li"><i class="fa-solid fa-comment"></i></span>
                        <strong>${lang.name}:</strong> ${lang.level}
                        ${lang.certifications ? ' — ' + lang.certifications.map(cert => 
                            `<a href="${cert.url}" target="_blank">${cert.name}</a>`
                        ).join(' · ') : ''}
                    </li>
                `).join('')}
            </ul>
        `;
        
        content.innerHTML = html;
    }

    // Helper function to format highlights with metrics
    formatHighlight(highlight) {
        let text = highlight.text;
        
        // Bold metrics in the text
        if (highlight.metrics) {
            Object.entries(highlight.metrics).forEach(([, value]) => {
                if (typeof value === 'number' || typeof value === 'string') {
                    // Replace the value with bolded version if found in text
                    const regex = new RegExp(`\\b${value}\\b`, 'g');
                    text = text.replace(regex, `<strong>${value}</strong>`);
                }
            });
        }
        
        return text;
    }

    // Helper function to format dates
    formatDate(dateStr, yearOnly = false) {
        if (!dateStr) return '';
        
        if (yearOnly) {
            // For education dates that might be just years
            if (dateStr.length === 4) {
                return dateStr;
            }
            if (dateStr.includes('-')) {
                const [year, month] = dateStr.split('-');
                const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                   'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
                return `${monthNames[parseInt(month)]} ${year}`;
            }
        }
        
        // For experience dates
        if (dateStr.includes('-')) {
            const [year, month] = dateStr.split('-');
            const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                               'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[parseInt(month)]} ${year}`;
        }
        
        return dateStr;
    }
}

// Initialize CV Renderer when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    // Only initialize if we're on the CV page
    if (document.getElementById('about')) {
        const renderer = new CVRenderer();
        
        // Make renderer globally available for PDF generator
        window.cvRenderer = renderer;
        
        // Render the CV
        await renderer.render();
        
        // Handle format switching if buttons exist
        const formatButtons = document.querySelectorAll('[data-cv-format]');
        formatButtons.forEach(button => {
            button.addEventListener('click', async function() {
                const format = this.getAttribute('data-cv-format');
                renderer.setFormat(format);
                await renderer.render();
            });
        });
    }
});