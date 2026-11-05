DATA ?= $(HOME)/Documents/Finance
PORT ?= 8765

.PHONY: run test

run:
	python3 server/local_server.py --data "$(DATA)" --port $(PORT)

test:
	node tests/run-tests.js
	python3 -m unittest discover -s tests -p "test_*.py"
