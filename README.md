# forge-invoices

Local invoicing app for a Czech business, built as a replacement for fakturoid.cz. A static HTML application served by a small local Python server that keeps every document as a JSON file on disk. No build step and no third-party dependencies: `python3` and a browser are the whole runtime. All data stays on your computer.

## Quick start

```sh
make run                          # data in ~/Documents/Finance
make run DATA=~/Finance PORT=8765 # another data directory or port
```

Open the address it prints (default <http://127.0.0.1:8765/>). On first run the dashboard shows a setup checklist: fill in your supplier details and bank account in Nastavení, add a contact, issue the first invoice.

Opening `index.html` directly still works, but then the data live only in that browser's localStorage. The sidebar says which mode is active.

### Moving data from the browser to disk

Data entered in the `file://` version sit in that origin's localStorage, which the `http://127.0.0.1` page cannot read.

1. Open `index.html` the old way, go to Nastavení, Záloha dat, and download a backup.
2. Run `make run`, open the printed address, go to Nastavení, and restore that backup. Every part is written to the data directory.
3. Check that the files exist: `ls ~/Documents/Finance/invoices`.

## Features

- **Doklady**: faktura (daňový doklad), zálohová faktura, opravný daňový doklad. Vystavení faktury k uhrazené záloze s DUZP dle data přijetí platby, duplikace dokladů, přenesená daňová povinnost.
- **Náležitosti**: režim plátce i neplátce DPH, kontrola povinných náležitostí před uložením, souvislá číselná řada s detekcí mezer, DIČ a DUZP hlídané pro daňové doklady.
- **Platby**: QR platba (SPAYD standard ČBA [SPAYD]), IBAN dopočítaný z čísla účtu, variabilní symbol, sledování úhrad a dokladů po splatnosti.
- **Kontakty**: adresář odběratelů s načtením údajů z ARES [ARES] podle IČO, individuální splatnost.
- **Tisk**: tiskové PDF přes dialog prohlížeče (Tisk / PDF, cíl "Uložit jako PDF"), typograficky vysázený dokument na A4.
- **Reporty**: přehled fakturace a úhrad po měsících, podklady pro přiznání k DPH po sazbách podle DUZP, přehled odběratelů.
- **Data**: záloha do JSON souboru a obnova ze zálohy, CSV export pro účetní (středníky, kódování pro český Excel).

## Data and backups

The data directory (default `~/Documents/Finance`, set with `DATA=` or `INVOICES_DATA_DIR`) holds plain, diffable JSON:

```text
settings.json          supplier, bank, invoicing defaults
meta.json              schema version, last backup time
contacts/<id>.json     one file per contact
invoices/<number>.json one file per document, named by its number
pdf/                   printed documents; save the print dialog's PDF here as <number>.pdf
trash/                 every replaced or removed file, timestamped; nothing is ever deleted
```

- Every write goes to a temporary file that is flushed and then renamed over the target, so a crash never leaves a half-written document.
- The server refuses a data directory inside this repository, so invoices cannot be committed by accident.
- The server listens on 127.0.0.1 only, serves only `index.html` and `app/`, and its API answers only requests carrying the app's own header, which other web pages cannot send without a refused CORS preflight.
- Back the data directory up with the rest of your files (Time Machine, an off-site copy). The JSON backup export and import remain available for moving data between machines.
- Tax documents must be archived for 10 years ([§ 35 ZDPH][ZDPH-35]); see [Právní náležitosti](docs/Právní%20náležitosti.md) for the non-VAT-payer case.

Backups contain personal and business data. Do not commit them to a public repository.

## Out of scope

Expense tracking, sending invoices by e-mail, bank feed matching, and multi-user access are not included. Recurring invoices are covered by duplicating an existing document. VAT amounts on foreign-currency tax documents must be stated in CZK manually (the editor warns about this).

## Development

Plain HTML, CSS, and vanilla JavaScript. Modules are plain scripts exposing `var` globals (no bundler), the QR code generator is vendored in `app/vendor/`.

```text
index.html              app shell
app/css/                screen and print stylesheets
app/js/finance.js       money math in integer haléře, VAT breakdown, cs-CZ formatting
app/js/payment.js       Czech account to IBAN, SPAYD descriptor, QR rendering
app/js/store.js         persistence (data server on disk, or localStorage), backup export/import
app/js/ares.js          ARES lookup and IČO checksum validation
app/js/invoiceDoc.js    printable document renderer
app/js/app.js           state, routing, views, actions
tests/run-tests.js      app unit tests
server/local_server.py  local server and the data directory store
tests/test_local_server.py  server unit tests
Makefile                make run, make test
```

Run the tests:

```sh
make test
```

Legal background and which statutory requirement maps to which app behavior: [docs/Právní náležitosti.md](docs/Právní%20náležitosti.md).

## License

[EUPL-1.2](LICENSE).

[SPAYD]: https://qr-platba.cz/pro-vyvojare/ "QR platba, standard Short Payment Descriptor"
[ARES]: https://ares.gov.cz/stranky/vyvojar-info "ARES, informace pro vývojáře"
[ZDPH-35]: https://www.zakonyprolidi.cz/cs/2004-235#p35 "Zákon č. 235/2004 Sb., § 35, uchovávání daňových dokladů"
