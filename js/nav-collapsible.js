// Navigation collapsible functionality
document.addEventListener('DOMContentLoaded', function() {
    const collapsibles = document.querySelectorAll('.collapsible');
    
    collapsibles.forEach(button => {
        button.addEventListener('click', function() {
            this.classList.toggle('active');
            const content = this.nextElementSibling;
            
            if (content) {
                if (content.style.display === 'block') {
                    content.style.display = 'none';
                    // Update aria-expanded for accessibility
                    this.setAttribute('aria-expanded', 'false');
                } else {
                    content.style.display = 'block';
                    // Update aria-expanded for accessibility
                    this.setAttribute('aria-expanded', 'true');
                }
            }
        });
        
        // Initialize aria-expanded attribute
        button.setAttribute('aria-expanded', 'false');
    });
});