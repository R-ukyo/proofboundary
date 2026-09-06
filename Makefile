.PHONY: build up down test verify metrics psql

build:
\tdocker compose build

up:
\tdocker compose up --build

down:
\tdocker compose down

test:
\tdocker compose run --rm app npm test

verify:
\tdocker compose run --rm app npm run verify

metrics:
\tdocker compose run --rm app npm run metrics
