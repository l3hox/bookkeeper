var InvoiceDoc = (() => {
    const esc = Html.esc;

    const TYPE_TITLES = {
        invoice: 'Faktura',
        proforma: 'Zálohová faktura',
        credit: 'Opravný daňový doklad',
    };

    const PAYMENT_LABELS = {
        transfer: 'Převodem',
        cash: 'Hotově',
        card: 'Kartou',
    };

    function subtitle(invoice) {
        if (invoice.type === 'proforma') {
            return 'Není daňovým dokladem';
        }
        if (invoice.type === 'credit') {
            const issued = invoice.creditForDate ? ` ze dne ${Finance.formatDate(invoice.creditForDate)}` : '';
            return `K daňovému dokladu č. ${esc(invoice.creditForNumber || '')}${issued}`;
        }
        if (invoice.vatMode) {
            return 'Daňový doklad';
        }
        return '';
    }

    function partyBlock(label, party) {
        const address = [party.street, [party.zip, party.city].filter(Boolean).join(' '), party.country]
            .filter(Boolean);
        const identifiers = [];
        if (party.ico) {
            identifiers.push(`IČO: ${esc(party.ico)}`);
        }
        if (party.dic) {
            identifiers.push(`DIČ: ${esc(party.dic)}`);
        }
        return `
            <div class="doc-party">
                <h2>${label}</h2>
                <p class="doc-party-name">${esc(party.name)}</p>
                <p>${address.map(esc).join('<br>')}</p>
                ${identifiers.length ? `<p class="doc-party-ids">${identifiers.join('<br>')}</p>` : ''}
                ${party.registration ? `<p class="doc-party-reg">${esc(party.registration)}</p>` : ''}
            </div>`;
    }

    function metaRow(label, value, emphasis) {
        if (!value) {
            return '';
        }
        return `
            <div class="doc-meta-row${emphasis ? ' is-strong' : ''}">
                <span>${label}</span>
                <span>${value}</span>
            </div>`;
    }

    function paymentMeta(invoice) {
        if (invoice.paymentMethod !== 'transfer') {
            return metaRow('Způsob platby', esc(PAYMENT_LABELS[invoice.paymentMethod] || ''));
        }
        return [
            metaRow('Bankovní účet', esc(invoice.bank.account)),
            metaRow('IBAN', esc(Payment.formatIban(invoice.bank.iban))),
            metaRow('SWIFT/BIC', esc(invoice.bank.swift)),
            metaRow('Variabilní symbol', esc(invoice.variableSymbol), true),
            metaRow('Způsob platby', 'Převodem'),
        ].join('');
    }

    function datesMeta(invoice) {
        const rows = [metaRow('Datum vystavení', Finance.formatDate(invoice.issueDate))];
        if (invoice.vatMode && invoice.type !== 'proforma') {
            rows.push(metaRow('Datum uskutečnění plnění', Finance.formatDate(invoice.dutyDate)));
        }
        rows.push(metaRow('Datum splatnosti', Finance.formatDate(invoice.dueDate), true));
        return rows.join('');
    }

    function itemsTable(invoice) {
        const showVat = Boolean(invoice.vatMode);
        const currency = invoice.currency;
        const headCells = [
            '<th class="col-desc">Popis</th>',
            '<th class="num">Množství</th>',
            '<th class="num">Cena za MJ</th>',
            showVat ? '<th class="num">DPH</th>' : '',
            `<th class="num">${showVat ? 'Základ' : 'Celkem'}</th>`,
        ].join('');
        const bodyRows = invoice.lines.map(line => {
            const quantity = `${Finance.formatQuantity(line.quantity)}${line.unit ? ' ' + esc(line.unit) : ''}`;
            return `
                <tr>
                    <td class="col-desc">${Html.escMultiline(line.description)}</td>
                    <td class="num">${quantity}</td>
                    <td class="num">${Finance.formatMoney(line.unitPrice, currency)}</td>
                    ${showVat ? `<td class="num">${line.vatRate} %</td>` : ''}
                    <td class="num">${Finance.formatMoney(Finance.lineBase(line), currency)}</td>
                </tr>`;
        }).join('');
        return `
            <table class="doc-items">
                <thead><tr>${headCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>`;
    }

    function vatRecap(invoice, totals) {
        if (!invoice.vatMode) {
            return '';
        }
        const currency = invoice.currency;
        const rows = totals.breakdown.map(group => `
            <tr>
                <td>DPH ${group.rate} %</td>
                <td class="num">${Finance.formatMoney(group.base, currency)}</td>
                <td class="num">${Finance.formatMoney(group.vat, currency)}</td>
                <td class="num">${Finance.formatMoney(group.base + group.vat, currency)}</td>
            </tr>`).join('');
        return `
            <table class="doc-recap">
                <thead>
                    <tr><th>Sazba</th><th class="num">Základ</th><th class="num">DPH</th><th class="num">Celkem</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function qrBlock(invoice, totals) {
        const payable = invoice.paymentMethod === 'transfer'
            && invoice.bank.iban
            && totals.total > 0
            && invoice.type !== 'credit';
        if (!payable) {
            return '';
        }
        const spaydString = Payment.spayd({
            iban: invoice.bank.iban,
            amount: totals.total,
            currency: invoice.currency,
            variableSymbol: invoice.variableSymbol,
            message: `${TYPE_TITLES[invoice.type]} ${invoice.number}`,
            dueDate: invoice.dueDate,
        });
        return `
            <div class="doc-qr">
                ${Payment.spaydQrSvg(spaydString)}
                <span>QR platba</span>
            </div>`;
    }

    function legalNotes(invoice) {
        const notes = [];
        if (invoice.type === 'credit' && invoice.creditReason) {
            notes.push(`Důvod opravy: ${esc(invoice.creditReason)}`);
        }
        if (invoice.reverseCharge) {
            notes.push('<strong>Daň odvede zákazník.</strong>');
        }
        if (!invoice.vatMode) {
            notes.push('Dodavatel není plátcem DPH.');
        }
        if (invoice.relatedProformaNumber) {
            notes.push(`Vystaveno k zálohové faktuře č. ${esc(invoice.relatedProformaNumber)}.`);
        }
        if (invoice.note) {
            notes.push(Html.escMultiline(invoice.note));
        }
        if (invoice.footNote) {
            notes.push(Html.escMultiline(invoice.footNote));
        }
        return notes;
    }

    function contactLine(supplier) {
        return [supplier.email, supplier.phone, supplier.web].filter(Boolean).map(esc).join('   ·   ');
    }

    function render(invoice) {
        const totals = Finance.documentTotals(invoice);
        const currency = invoice.currency;
        const notes = legalNotes(invoice);
        const roundingRow = totals.rounding !== 0
            ? `<div class="doc-total-row"><span>Zaokrouhlení</span><span>${Finance.formatMoney(totals.rounding, currency)}</span></div>`
            : '';
        return `
            <article class="doc">
                <header class="doc-head">
                    <div>
                        <h1>${TYPE_TITLES[invoice.type]}</h1>
                        ${subtitle(invoice) ? `<p class="doc-subtitle">${subtitle(invoice)}</p>` : ''}
                    </div>
                    <div class="doc-number">
                        <span>č.</span>${esc(invoice.number)}
                    </div>
                </header>
                <section class="doc-parties">
                    ${partyBlock('Dodavatel', invoice.supplier)}
                    ${partyBlock('Odběratel', invoice.customer)}
                </section>
                <section class="doc-meta">
                    <div class="doc-meta-col">${paymentMeta(invoice)}</div>
                    <div class="doc-meta-col">${datesMeta(invoice)}</div>
                </section>
                ${itemsTable(invoice)}
                <section class="doc-summary">
                    <div class="doc-summary-left">
                        ${qrBlock(invoice, totals)}
                    </div>
                    <div class="doc-summary-right">
                        ${vatRecap(invoice, totals)}
                        ${roundingRow}
                        <div class="doc-total">
                            <span>${totals.total < 0 ? 'Celkem' : 'K úhradě'}</span>
                            <span>${Finance.formatMoney(totals.total, currency)}</span>
                        </div>
                    </div>
                </section>
                ${notes.length ? `<footer class="doc-notes">${notes.map(note => `<p>${note}</p>`).join('')}</footer>` : ''}
                ${contactLine(invoice.supplier) ? `<p class="doc-contact">${contactLine(invoice.supplier)}</p>` : ''}
            </article>`;
    }

    return { render, TYPE_TITLES, PAYMENT_LABELS };
})();
