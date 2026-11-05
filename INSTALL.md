# Install the local invoicing app

> A local Czech invoicing app: a static HTML front end served by a standard-library Python server that stores every document as a JSON file on disk.

I want you to set up the invoicing app on this Mac so its data live in a folder on disk, and confirm it serves and stores documents.

OBJECTIVE: The app runs at http://127.0.0.1:8765/ and writes its data to the chosen data directory.

DONE WHEN: `curl -s -H "X-Invoices-Api: 1" http://127.0.0.1:8765/api/state` returns JSON whose `dataDir` is the chosen data directory, and `make test` passes.

## TODO

- [ ] Check prerequisites
- [ ] Run the tests
- [ ] Start the server with the data directory
- [ ] Verify the API answers with that data directory

## Check prerequisites

The server needs Python 3.9 or newer, and the app tests need Node.js. Both use only their standard libraries.

```sh
python3 --version
node --version
make --version
```

## Run the tests

```sh
make test
```

Expected: `all N tests passed` from the app tests and `OK` from the server tests.

## Start the server

The default data directory is `~/Documents/Finance`; it is created if missing. The server refuses a data directory inside the repository.

```sh
make run
# or: make run DATA=/path/to/data PORT=8765
```

## Verify

In a second terminal:

```sh
curl -s -H "X-Invoices-Api: 1" http://127.0.0.1:8765/api/state
ls ~/Documents/Finance
```

Expected: JSON with `"dataDir"` set to the data directory, and the folders `contacts`, `invoices`, `pdf` and `trash`.

EXECUTE NOW: work through the TODO list above, then confirm the DONE WHEN condition.
