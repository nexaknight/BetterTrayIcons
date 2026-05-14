# Makefile for BetterTrayIcons
#
# Common targets:
#   make install   build the extension and install it locally
#   make pack      build the EGO-compatible ZIP only
#   make test      run lint, schema and translation checks
#   make clean     remove generated files
#   make uninstall remove the locally installed extension

UUID := BetterTrayIcons@nexaknight.com
ZIP := $(UUID).shell-extension.zip
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all install pack test clean uninstall help

all: help

help:
	@echo "Available targets:"
	@echo "  make install    Build and install the extension locally"
	@echo "  make pack       Build the EGO-compatible ZIP only"
	@echo "  make test       Run lint, schema and translation checks"
	@echo "  make clean      Remove generated files"
	@echo "  make uninstall  Remove the locally installed extension"

pack: $(ZIP)

$(ZIP):
	gnome-extensions pack \
		--podir=po \
		$$(for f in schemas/*.gschema.xml; do echo "--schema=$$f"; done) \
		--extra-source=src \
		--extra-source=interfaces \
		--force

# Install the extension locally for the current user
install: pack
	gnome-extensions install $(ZIP) --force
	@echo ""
	@echo "Extension installed. Log out and back in, then enable with:"
	@echo "  gnome-extensions enable $(UUID)"

# Run all pre-commit checks
test:
	npm ci
	npm test

# Remove the locally installed extension
uninstall:
	gnome-extensions uninstall $(UUID) || true
	rm -rf $(INSTALL_DIR)

# Remove generated files
clean:
	rm -f $(ZIP)
	rm -f schemas/gschemas.compiled
	rm -rf locale
