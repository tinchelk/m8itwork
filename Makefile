.PHONY: install dev verify
install:
	npm --prefix backend ci
	npm --prefix backend run db:generate
	npm --prefix frontend ci
dev:
	docker compose --profile app up --build
verify:
	npm --prefix backend run lint
	npm --prefix backend run typecheck
	npm --prefix backend test
	npm --prefix backend run build
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck
	npm --prefix frontend run build
