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

pack:
	gnome-extensions pack \
		--podir=po \
		$$(for f in schemas/*.gschema.xml; do echo "--schema=$$f"; done) \
		--extra-source=src \
		--extra-source=interfaces \
		--extra-source=assets \
		--force

install: pack
	gnome-extensions install $(ZIP) --force
	@echo ""
	@echo "Extension installed. Log out and back in, then enable with:"
	@echo "  gnome-extensions enable $(UUID)"

test:
	npm ci
	npm test

uninstall:
	gnome-extensions uninstall $(UUID) || true
	rm -rf $(INSTALL_DIR)

clean:
	rm -f $(ZIP)
	rm -f schemas/gschemas.compiled
	rm -rf locale
