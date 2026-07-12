# forge-invoices

Local invoicing app for a Czech business, built as a replacement for fakturoid.cz. A static HTML application with no server, no build step, and no external dependencies at runtime: open `index.html` in a browser and start invoicing. All data stays on your computer.

## Quick start

Open `index.html` directly (double-click), or serve the directory if you prefer an HTTP origin:

```sh
open index.html
```

On first run the dashboard shows a setup checklist: fill in your supplier details and bank account in Nastavení, add a contact, issue the first invoice.

## Features

- **Doklady**: faktura (daňový doklad), zálohová faktura, opravný daňový doklad. Vystavení faktury k uhrazené záloze s DUZP dle data přijetí platby, duplikace dokladů, přenesená daňová povinnost.
- **Náležitosti**: režim plátce i neplátce DPH, kontrola povinných náležitostí před uložením, souvislá číselná řada s detekcí mezer, DIČ a DUZP hlídané pro daňové doklady.
- **Platby**: QR platba (SPAYD standard ČBA [SPAYD]), IBAN dopočítaný z čísla účtu, variabilní symbol, sledování úhrad a dokladů po splatnosti.
- **Kontakty**: adresář odběratelů s načtením údajů z ARES [ARES] podle IČO, individuální splatnost.
- **Tisk**: tiskové PDF přes dialog prohlížeče (Tisk / PDF, cíl "Uložit jako PDF"), typograficky vysázený dokument na A4.
- **Reporty**: přehled fakturace a úhrad po měsících, podklady pro přiznání k DPH po sazbách podle DUZP, přehled odběratelů.
- **Data**: záloha do JSON souboru a obnova ze zálohy, CSV export pro účetní (středníky, kódování pro český Excel).

## Data and backups

Data live in the browser's localStorage under `mi:` keys, scoped to the way you open the app (the `file://` path or the HTTP origin). Consequences:

- Opening the app from a different path or browser shows an empty database. Use backup export/import to move data.
- Clearing browser site data deletes your invoices. **Download a backup (Nastavení, Záloha dat) regularly.** The app reminds you when the last backup is older than a month.
- Tax documents must be archived for 10 years ([§ 35 ZDPH][ZDPH-35]). Keep backup JSON files (and PDF copies of issued invoices) somewhere durable.

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
app/js/store.js         localStorage persistence, backup export/import
app/js/ares.js          ARES lookup and IČO checksum validation
app/js/invoiceDoc.js    printable document renderer
app/js/app.js           state, routing, views, actions
tests/run-tests.js      unit tests (node tests/run-tests.js)
```

Run the tests:

```sh
node tests/run-tests.js
```

Legal background and which statutory requirement maps to which app behavior: [docs/Právní náležitosti.md](docs/Právní%20náležitosti.md).

## License

[EUPL-1.2](LICENSE).

[SPAYD]: https://qr-platba.cz/pro-vyvojare/ "QR platba, standard Short Payment Descriptor"
[ARES]: https://ares.gov.cz/stranky/vyvojar-info "ARES, informace pro vývojáře"
[ZDPH-35]: https://www.zakonyprolidi.cz/cs/2004-235#p35 "Zákon č. 235/2004 Sb., § 35, uchovávání daňových dokladů"
