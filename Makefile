.PHONY: dev build test lint clean install

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

test:
	npm test

lint:
	cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings

clean:
	rm -rf node_modules dist .next .turbo
