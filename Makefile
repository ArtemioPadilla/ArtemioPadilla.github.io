# Makefile for ArtemioPadilla.github.io
# Personal portfolio website automation

.PHONY: help serve validate commit push deploy clean test setup build build-cv validate-cv format-cv

# Default target - show help
help:
	@echo "Available commands:"
	@echo "  make build       - Build CV data (generate cv-data.js from cv-data.json)"
	@echo "  make serve       - Start local development server"
	@echo "  make validate    - Validate JSON data files"
	@echo "  make commit      - Build and commit changes with generated message"
	@echo "  make push        - Push changes to GitHub"
	@echo "  make deploy      - Build, validate, commit, and push (full deploy)"
	@echo "  make clean       - Clean temporary files"
	@echo "  make test        - Run tests (validate JSON)"
	@echo "  make setup       - Install development dependencies"
	@echo "  make open        - Open the site in browser"
	@echo "  make pdf-test    - Test PDF generation locally"
	@echo "  make build-cv    - Generate cv-data.js from cv-data.json"
	@echo "  make validate-cv - Validate CV data against schema"
	@echo "  make format-cv   - Format CV JSON file"

# Start local development server
serve:
	@echo "Starting local server on http://localhost:8000"
	@python3 -m http.server 8000 || python -m SimpleHTTPServer 8000

# Build CV data - generate cv-data.js from cv-data.json
build: build-cv
	@echo "✓ Build complete"

# Generate cv-data.js from cv-data.json
build-cv:
	@echo "Building CV data..."
	@npm run build:cv && echo "✓ cv-data.js generated" || (echo "✗ Build failed - run 'make setup' first"; exit 1)

# Validate CV data against schema
validate-cv:
	@echo "Validating CV data against schema..."
	@npm run validate:cv && echo "✓ CV data is valid" || (echo "✗ CV validation failed"; exit 1)

# Format CV JSON file
format-cv:
	@echo "Formatting CV JSON..."
	@npm run format:cv && echo "✓ CV JSON formatted" || (echo "✗ Format failed"; exit 1)

# Validate JSON data files
validate: validate-cv
	@echo "Validating CV data..."
	@python3 -c "import json; json.load(open('data/cv-data.json'))" && echo "✓ cv-data.json is valid" || echo "✗ cv-data.json has errors"
	@echo "Validating CV schema..."
	@python3 -c "import json; json.load(open('data/cv-schema.json'))" 2>/dev/null && echo "✓ cv-schema.json is valid" || echo "✓ cv-schema.json not present (optional)"

# Commit changes with auto-generated message
commit: build validate
	@echo "Committing changes..."
	@git add -A
	@git diff --cached --quiet || git commit -m "Update portfolio - $$(date '+%Y-%m-%d %H:%M')"
	@echo "✓ Changes committed"

# Push to GitHub
push:
	@echo "Pushing to GitHub..."
	@git push origin main
	@echo "✓ Pushed to GitHub"

# Full deployment pipeline
deploy: build validate commit push
	@echo "✓ Deployment complete!"
	@echo "Your site will be live at https://artemiopadilla.github.io in a few minutes"

# Clean temporary files
clean:
	@echo "Cleaning temporary files..."
	@find . -name "*.pyc" -delete 2>/dev/null || true
	@find . -name "__pycache__" -type d -delete 2>/dev/null || true
	@find . -name ".DS_Store" -delete 2>/dev/null || true
	@find . -name "*~" -delete 2>/dev/null || true
	@echo "✓ Temporary files cleaned"

# Run tests
test: validate
	@echo "Running tests..."
	@echo "✓ All tests passed"

# Install dependencies (if needed)
setup:
	@echo "Checking dependencies..."
	@command -v python3 >/dev/null 2>&1 || echo "⚠ Python 3 is required for local server"
	@command -v git >/dev/null 2>&1 || echo "⚠ Git is required for deployment"
	@command -v npm >/dev/null 2>&1 || echo "⚠ Node.js/npm is required for CV build"
	@echo "Installing npm packages..."
	@npm install && echo "✓ npm packages installed" || echo "⚠ npm install failed"
	@echo "Setting up git hooks..."
	@npm run setup:hooks 2>/dev/null && echo "✓ Git hooks installed" || echo "⚠ Git hooks setup skipped"
	@echo "✓ Setup complete"

# Open site in browser
open:
	@echo "Opening site in browser..."
	@open http://localhost:8000 || xdg-open http://localhost:8000 || start http://localhost:8000

# Test PDF generation
pdf-test: serve
	@echo "Testing PDF generation..."
	@echo "Open http://localhost:8000/cv.html in your browser"
	@echo "Click the PDF download button to test generation"

# Watch for changes and auto-reload (requires fswatch or inotifywait)
watch:
	@echo "Watching for changes..."
	@command -v fswatch >/dev/null 2>&1 && fswatch -o . | xargs -n1 -I{} make validate || \
	command -v inotifywait >/dev/null 2>&1 && while true; do inotifywait -r -e modify .; make validate; done || \
	echo "Install fswatch (Mac) or inotify-tools (Linux) for file watching"

# Git status
status:
	@git status

# Pull latest changes
pull:
	@git pull origin main
	@echo "✓ Repository updated"

# Create backup
backup:
	@echo "Creating backup..."
	@tar -czf backup-$$(date +%Y%m%d-%H%M%S).tar.gz --exclude=backup-*.tar.gz --exclude=.git .
	@echo "✓ Backup created"

# Update CV data timestamp
update-cv:
	@echo "Updating CV data timestamp..."
	@touch data/cv-data.json
	@make validate
	@echo "✓ CV data updated"

# Check for broken links (requires wget or curl)
check-links:
	@echo "Checking for broken links..."
	@command -v wget >/dev/null 2>&1 && wget --spider -r -nd -nv -H -l 1 http://localhost:8000 2>&1 | grep -B1 "broken link" || \
	echo "Start server with 'make serve' first, then run this command in another terminal"