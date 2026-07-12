'use strict';

const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.join(__dirname, '..');

function createLocalStorageMock() {
    const backing = new Map();
    return {
        getItem: key => (backing.has(key) ? backing.get(key) : null),
        setItem: (key, value) => backing.set(key, String(value)),
        removeItem: key => backing.delete(key),
        keys: () => [...backing.keys()],
    };
}

const localStorageMock = createLocalStorageMock();
const context = vm.createContext({
    console,
    localStorage: localStorageMock,
    Intl,
});

for (const file of [
    'app/vendor/qrcode-generator-1.4.4.min.js',
    'app/js/html.js',
    'app/js/finance.js',
    'app/js/payment.js',
    'app/js/store.js',
    'app/js/ares.js',
    'app/js/invoiceDoc.js',
]) {
    vm.runInContext(readFileSync(path.join(appRoot, file), 'utf8'), context, { filename: file });
}

const { Finance, Payment, Store, Ares, InvoiceDoc, Html } = context;
const sampleInvoice = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'sample-invoice.json'), 'utf8'));

function acrossRealms(value) {
    return JSON.parse(JSON.stringify(value));
}

let testCount = 0;

function test(name, run) {
    testCount += 1;
    try {
        run();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`FAIL - ${name}`);
        console.error(error.message);
        process.exitCode = 1;
    }
}

test('parseAmount accepts czech decimal notation', () => {
    assert.strictEqual(Finance.parseAmount('1 234,56'), 123456);
    assert.strictEqual(Finance.parseAmount('450'), 45000);
    assert.strictEqual(Finance.parseAmount('-12,5'), -1250);
    assert.strictEqual(Finance.parseAmount('abc'), null);
    assert.strictEqual(Finance.parseAmount(''), null);
});

test('parseDecimal handles quantities', () => {
    assert.strictEqual(Finance.parseDecimal('2,5'), 2.5);
    assert.strictEqual(Finance.parseDecimal('10'), 10);
});

test('lineBase multiplies quantity and unit price in halere', () => {
    assert.strictEqual(Finance.lineBase({ quantity: 2.5, unitPrice: 100000 }), 250000);
    assert.strictEqual(Finance.lineBase({ quantity: 3, unitPrice: 33333 }), 99999);
});

test('vatBreakdown groups by rate and computes vat per group', () => {
    const breakdown = acrossRealms(Finance.vatBreakdown(sampleInvoice.lines, false));
    assert.deepStrictEqual(breakdown, [
        { rate: 21, base: 1000000, vat: 210000 },
        { rate: 12, base: 50000, vat: 6000 },
    ]);
});

test('reverse charge zeroes vat but keeps bases', () => {
    const breakdown = acrossRealms(Finance.vatBreakdown(sampleInvoice.lines, true));
    assert.deepStrictEqual(breakdown.map(group => group.vat), [0, 0]);
    assert.deepStrictEqual(breakdown.map(group => group.base), [1000000, 50000]);
});

test('documentTotals sums bases and vat', () => {
    const totals = Finance.documentTotals(sampleInvoice);
    assert.strictEqual(totals.base, 1050000);
    assert.strictEqual(totals.vat, 216000);
    assert.strictEqual(totals.rounding, 0);
    assert.strictEqual(totals.total, 1266000);
});

test('documentTotals rounds total to whole crowns when enabled', () => {
    const totals = Finance.documentTotals({
        lines: [{ quantity: 1, unitPrice: 12345, vatRate: 21 }],
        roundTotal: true,
    });
    assert.strictEqual(totals.vat, 2592);
    assert.strictEqual(totals.exact, 14937);
    assert.strictEqual(totals.rounding, -37);
    assert.strictEqual(totals.total, 14900);
});

test('formatDate renders czech date without leading zeros', () => {
    assert.strictEqual(Finance.formatDate('2026-07-12'), '12. 7. 2026');
});

test('addDays crosses month boundaries', () => {
    assert.strictEqual(Finance.addDays('2026-01-31', 14), '2026-02-14');
    assert.strictEqual(Finance.addDays('2026-12-20', 14), '2027-01-03');
});

test('formatMoney uses czech formatting', () => {
    assert.match(Finance.formatMoney(123456, 'CZK'), /^1\s234,56\sKč$/u);
    assert.match(Finance.formatMoney(-45000, 'EUR'), /^-450,00\sEUR$/u);
});

test('accountToIban matches the CNB reference example', () => {
    assert.strictEqual(Payment.accountToIban('19-2000145399/0800'), 'CZ6508000000192000145399');
});

test('accountToIban produces self-consistent check digits', () => {
    const iban = Payment.accountToIban('2000145399/0800');
    const rearranged = iban.slice(4) + '1235' + iban.slice(2, 4);
    let remainder = 0;
    for (const digit of rearranged) {
        remainder = (remainder * 10 + Number(digit)) % 97;
    }
    assert.strictEqual(remainder, 1);
});

test('parseAccount rejects malformed accounts', () => {
    assert.strictEqual(Payment.parseAccount('not-an-account'), null);
    assert.strictEqual(Payment.parseAccount('123/12345'), null);
    assert.strictEqual(Payment.accountToIban(''), null);
});

test('spayd builds the full payment descriptor', () => {
    const descriptor = Payment.spayd({
        iban: 'CZ6508000000192000145399',
        amount: 45000,
        currency: 'CZK',
        variableSymbol: '20260001',
        message: 'Faktura č. 20260001',
        dueDate: '2026-08-15',
    });
    assert.strictEqual(
        descriptor,
        'SPD*1.0*ACC:CZ6508000000192000145399*AM:450.00*CC:CZK*X-VS:20260001*DT:20260815*MSG:Faktura c. 20260001',
    );
});

test('spayd qr renders as svg', () => {
    const svg = Payment.spaydQrSvg('SPD*1.0*ACC:CZ6508000000192000145399*AM:450.00*CC:CZK');
    assert.match(svg, /^<svg/);
});

test('formatIban groups by four characters', () => {
    assert.strictEqual(Payment.formatIban('CZ6508000000192000145399'), 'CZ65 0800 0000 1920 0014 5399');
});

test('validateIco verifies the checksum digit', () => {
    assert.strictEqual(Ares.validateIco('27082440'), true);
    assert.strictEqual(Ares.validateIco('45317054'), true);
    assert.strictEqual(Ares.validateIco('12345678'), false);
    assert.strictEqual(Ares.validateIco('123456789'), false);
});

test('normalizeIco pads to eight digits', () => {
    assert.strictEqual(Ares.normalizeIco('123'), '00000123');
    assert.strictEqual(Ares.normalizeIco(''), null);
});

test('html escaping neutralizes markup', () => {
    assert.strictEqual(Html.esc('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
    assert.strictEqual(Html.escMultiline('a\nb'), 'a<br>b');
});

test('invoice document renders required tax document elements', () => {
    const rendered = InvoiceDoc.render(sampleInvoice);
    assert.match(rendered, /Daňový doklad/);
    assert.match(rendered, /20260001/);
    assert.match(rendered, /Bob Example &amp; syn &lt;s\.r\.o\.&gt;/);
    assert.match(rendered, /CZ87654321/);
    assert.match(rendered, /Datum uskutečnění plnění/);
    assert.match(rendered, /30\. 6\. 2026/);
    assert.match(rendered, /DPH 21 %/);
    assert.match(rendered, /DPH 12 %/);
    assert.match(rendered, /12\s660,00\sKč/u);
    assert.match(rendered, /<svg/);
    assert.match(rendered, /Fyzická osoba zapsaná v živnostenském rejstříku/);
});

test('non vat payer document has no vat table and carries the notice', () => {
    const rendered = InvoiceDoc.render({
        ...sampleInvoice,
        vatMode: false,
        lines: sampleInvoice.lines.map(line => ({ ...line, vatRate: 0 })),
    });
    assert.match(rendered, /Dodavatel není plátcem DPH\./);
    assert.doesNotMatch(rendered, /Daňový doklad/);
    assert.doesNotMatch(rendered, /doc-recap/);
});

test('reverse charge document carries the statutory wording', () => {
    const rendered = InvoiceDoc.render({ ...sampleInvoice, reverseCharge: true });
    assert.match(rendered, /Daň odvede zákazník\./);
});

test('credit note references the corrected document and reason', () => {
    const rendered = InvoiceDoc.render({
        ...sampleInvoice,
        type: 'credit',
        number: '20260002',
        creditForNumber: '20260001',
        creditForDate: '2026-07-01',
        creditReason: 'Sleva z ceny po reklamaci',
        lines: sampleInvoice.lines.map(line => ({ ...line, unitPrice: -line.unitPrice })),
    });
    assert.match(rendered, /Opravný daňový doklad/);
    assert.match(rendered, /K daňovému dokladu č\. 20260001 ze dne 1\. 7\. 2026/);
    assert.match(rendered, /Důvod opravy: Sleva z ceny po reklamaci/);
    assert.doesNotMatch(rendered, /doc-qr/);
});

test('proforma document is marked as not a tax document and hides duzp', () => {
    const rendered = InvoiceDoc.render({ ...sampleInvoice, type: 'proforma', number: 'Z20260001' });
    assert.match(rendered, /Zálohová faktura/);
    assert.match(rendered, /Není daňovým dokladem/);
    assert.doesNotMatch(rendered, /Datum uskutečnění plnění/);
});

test('store preserves corrupt data before falling back', () => {
    localStorageMock.setItem('mi:contacts', '{broken json');
    const contacts = acrossRealms(Store.getContacts());
    assert.deepStrictEqual(contacts, []);
    const corruptKeys = localStorageMock.keys().filter(key => key.startsWith('mi:contacts:corrupt:'));
    assert.strictEqual(corruptKeys.length, 1);
    assert.strictEqual(localStorageMock.getItem(corruptKeys[0]), '{broken json');
});

test('store round trips invoices and settings', () => {
    Store.saveInvoices([sampleInvoice]);
    assert.deepStrictEqual(acrossRealms(Store.getInvoices()), [sampleInvoice]);
    const settings = Store.getSettings();
    settings.supplier.name = 'Carol Example';
    settings.vatPayer = true;
    Store.saveSettings(settings);
    assert.strictEqual(Store.getSettings().supplier.name, 'Carol Example');
    assert.strictEqual(Store.getSettings().vatPayer, true);
});

test('backup import rejects foreign files', () => {
    assert.throws(() => Store.importBackup({ application: 'other' }), /není zálohou/);
    assert.throws(() => Store.importBackup({ application: 'forge-invoices', schemaVersion: 99 }), /novější verze/);
    assert.throws(
        () => Store.importBackup({ application: 'forge-invoices', schemaVersion: 1, settings: {}, contacts: 'x', invoices: [] }),
        /neplatnou strukturu/,
    );
});

test('backup import accepts the legacy application name', () => {
    const backup = JSON.parse(JSON.stringify(Store.exportBackup()));
    backup.application = 'my-invoices';
    Store.importBackup(backup);
});

test('backup export and import round trip', () => {
    const backup = Store.exportBackup();
    assert.strictEqual(backup.application, 'forge-invoices');
    Store.importBackup(JSON.parse(JSON.stringify(backup)));
    assert.deepStrictEqual(acrossRealms(Store.getInvoices()), [sampleInvoice]);
});

console.log(process.exitCode ? 'TESTS FAILED' : `all ${testCount} tests passed`);
