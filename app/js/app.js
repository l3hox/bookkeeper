var App = (() => {
    const esc = Html.esc;

    const STATUS_LABELS = {
        paid: 'Uhrazeno',
        overdue: 'Po splatnosti',
        open: 'Vystaveno',
    };

    const TYPE_SHORT = {
        invoice: 'Faktura',
        proforma: 'Záloha',
        credit: 'Opravný doklad',
    };

    const UNIT_SUGGESTIONS = ['ks', 'hod', 'den', 'měsíc', 'km', 'kg', 'm²'];
    const CURRENCIES = ['CZK', 'EUR', 'USD'];
    const VAT_RATES = [21, 12, 0];
    const FREE_TEXT_TEMPLATE = 'Fakturuji Vám za provedení díla podle smlouvy o dílo ze dne [datum smlouvy] '
        + 'v rozsahu specifikovaném v Příloze č. 1 ([název projektu]), milník [označení], '
        + 'akceptováno dne [datum akceptace].';
    const UNFILLED_PLACEHOLDER = /\[[^\]]+\]/;

    let settings = null;
    let contacts = [];
    let invoices = [];
    let editorDraft = null;
    let contactDraft = null;
    let listFilters = { year: 'all', type: 'all', status: 'all', search: '' };
    let reportYear = null;
    let viewRoot = null;

    function generateId() {
        if (window.crypto && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function invoiceStatus(invoice) {
        if (invoice.paidDate) {
            return 'paid';
        }
        if (invoice.dueDate && invoice.dueDate < Finance.todayIso()) {
            return 'overdue';
        }
        return 'open';
    }

    function invoiceTotal(invoice) {
        return Finance.documentTotals(invoice).total;
    }

    function nextNumber(type, year) {
        const prefix = type === 'proforma' ? 'Z' : '';
        const pattern = new RegExp(`^${prefix}${year}(\\d{4})$`);
        let highest = 0;
        for (const invoice of invoices) {
            const sameSeries = (invoice.type === 'proforma') === (type === 'proforma');
            const match = sameSeries && String(invoice.number).match(pattern);
            if (match) {
                highest = Math.max(highest, Number(match[1]));
            }
        }
        return `${prefix}${year}${String(highest + 1).padStart(4, '0')}`;
    }

    function variableSymbolFrom(number) {
        return String(number).replace(/\D/g, '').slice(0, 10);
    }

    function sumByCurrency(list) {
        const sums = new Map();
        for (const invoice of list) {
            const currency = invoice.currency || 'CZK';
            sums.set(currency, (sums.get(currency) || 0) + invoiceTotal(invoice));
        }
        return sums;
    }

    function formatCurrencySums(sums) {
        if (sums.size === 0) {
            return Finance.formatMoney(0, 'CZK');
        }
        return [...sums.entries()]
            .map(([currency, amount]) => Finance.formatMoney(amount, currency))
            .join('<br>');
    }

    function findInvoice(invoiceId) {
        return invoices.find(invoice => invoice.id === invoiceId) || null;
    }

    function persistInvoices() {
        Store.saveInvoices(invoices);
    }

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function route() {
        const hash = location.hash.replace(/^#\/?/, '');
        const [path, query] = hash.split('?');
        const segments = path.split('/').filter(Boolean);
        const params = new URLSearchParams(query || '');
        if (segments[0] === 'invoices' && segments[1] === 'new') {
            return { view: 'editor', invoiceId: null, type: params.get('type') || 'invoice' };
        }
        if (segments[0] === 'invoice' && segments[1]) {
            return segments[2] === 'edit'
                ? { view: 'editor', invoiceId: segments[1] }
                : { view: 'detail', invoiceId: segments[1] };
        }
        const known = ['invoices', 'contacts', 'reports', 'settings'];
        if (known.includes(segments[0])) {
            return { view: segments[0] };
        }
        return { view: 'dashboard' };
    }

    function render() {
        const current = route();
        document.body.dataset.view = current.view;
        for (const link of document.querySelectorAll('.nav a')) {
            link.classList.toggle('is-active', link.dataset.view === current.view
                || (current.view === 'detail' || current.view === 'editor') && link.dataset.view === 'invoices');
        }
        if (current.view !== 'editor') {
            editorDraft = null;
        }
        switch (current.view) {
            case 'dashboard': viewRoot.innerHTML = renderDashboard(); break;
            case 'invoices': viewRoot.innerHTML = renderInvoiceList(); break;
            case 'detail': viewRoot.innerHTML = renderDetail(current.invoiceId); break;
            case 'editor': viewRoot.innerHTML = renderEditor(current); break;
            case 'contacts': viewRoot.innerHTML = renderContacts(); break;
            case 'reports': viewRoot.innerHTML = renderReports(); break;
            case 'settings': viewRoot.innerHTML = renderSettings(); break;
        }
    }

    function statusChip(invoice) {
        const status = invoiceStatus(invoice);
        return `<span class="chip chip-${status}">${STATUS_LABELS[status]}</span>`;
    }

    function backupNotice() {
        if (invoices.length === 0) {
            return '';
        }
        const meta = Store.getMeta();
        const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        if (meta.lastBackupAt && meta.lastBackupAt > monthAgo) {
            return '';
        }
        const reason = meta.lastBackupAt
            ? `Poslední záloha je z ${Finance.formatDate(meta.lastBackupAt.slice(0, 10))}.`
            : 'Zatím nemáte žádnou zálohu.';
        return `
            <div class="notice">
                <p>${Store.dataDir() ? `Data jsou na disku ve složce ${esc(Store.dataDir())}; zálohujte ji spolu s ostatními soubory.` : 'Data žijí jen v tomto prohlížeči.'} ${reason}</p>
                <button class="btn btn-small" data-action="export-backup">Stáhnout zálohu</button>
            </div>`;
    }

    const VAT_REGISTRATION_LIMIT_HALERE = 2000000 * 100;
    const VAT_REGISTRATION_WARNING_SHARE = 0.9;

    function turnoverThisYearCzk(year) {
        return invoices
            .filter(invoice => (invoice.type === 'invoice' || invoice.type === 'credit')
                && (invoice.currency || 'CZK') === 'CZK'
                && (invoice.issueDate || '').startsWith(year))
            .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
    }

    function vatRegistrationNotice(year) {
        if (settings.vatPayer) {
            return '';
        }
        const turnover = turnoverThisYearCzk(year);
        if (turnover < VAT_REGISTRATION_LIMIT_HALERE * VAT_REGISTRATION_WARNING_SHARE) {
            return '';
        }
        return `
            <div class="notice">
                <p>Obrat v CZK za rok ${year} je ${Finance.formatMoney(turnover, 'CZK')}. Po překročení 2 000 000 Kč za kalendářní rok se stáváte plátcem DPH od 1. ledna následujícího roku a přihlášku podáváte do 10 pracovních dnů od překročení (§ 6 a § 94 ZDPH). Doklady v cizí měně do součtu nejsou započteny.</p>
            </div>`;
    }

    function renderDashboard() {
        if (!settings.supplier.name) {
            return `
                <header class="view-head"><h1>Přehled</h1></header>
                <div class="onboarding">
                    <h2>Začínáme</h2>
                    <ol>
                        <li><a href="#/settings">Vyplňte údaje dodavatele a bankovní účet v Nastavení</a></li>
                        <li><a href="#/contacts">Přidejte prvního odběratele do Kontaktů</a></li>
                        <li><a href="#/invoices/new">Vystavte první fakturu</a></li>
                    </ol>
                    <p>${esc(Store.storageLabel())} Žádná data neopouštějí tento počítač.</p>
                </div>`;
        }
        const thisYear = String(new Date().getFullYear());
        const unpaid = invoices.filter(invoice => invoiceStatus(invoice) !== 'paid');
        const overdue = invoices.filter(invoice => invoiceStatus(invoice) === 'overdue');
        const issuedThisYear = invoices.filter(invoice =>
            invoice.type !== 'proforma' && (invoice.issueDate || '').startsWith(thisYear));
        const paidThisYear = invoices.filter(invoice =>
            invoice.paidDate && invoice.paidDate.startsWith(thisYear));
        const recent = [...invoices]
            .sort((first, second) => (second.issueDate || '').localeCompare(first.issueDate || '')
                || String(second.number).localeCompare(String(first.number)))
            .slice(0, 8);
        return `
            <header class="view-head">
                <h1>Přehled</h1>
                <div class="view-actions">
                    <a class="btn btn-primary" href="#/invoices/new">Nová faktura</a>
                </div>
            </header>
            ${backupNotice()}
            ${vatRegistrationNotice(thisYear)}
            <div class="tiles">
                <div class="tile"><span class="tile-label">Neuhrazeno</span><span class="tile-value">${formatCurrencySums(sumByCurrency(unpaid))}</span></div>
                <div class="tile ${overdue.length ? 'tile-alert' : ''}"><span class="tile-label">Po splatnosti</span><span class="tile-value">${formatCurrencySums(sumByCurrency(overdue))}</span></div>
                <div class="tile"><span class="tile-label">Fakturováno ${thisYear}</span><span class="tile-value">${formatCurrencySums(sumByCurrency(issuedThisYear))}</span></div>
                <div class="tile"><span class="tile-label">Uhrazeno ${thisYear}</span><span class="tile-value">${formatCurrencySums(sumByCurrency(paidThisYear))}</span></div>
            </div>
            ${overdue.length ? `
                <section class="panel">
                    <h2>Po splatnosti</h2>
                    ${invoiceTable(overdue)}
                </section>` : ''}
            <section class="panel">
                <h2>Poslední doklady</h2>
                ${recent.length ? invoiceTable(recent) : '<p class="empty">Zatím žádné doklady. <a href="#/invoices/new">Vystavte první fakturu.</a></p>'}
            </section>`;
    }

    function invoiceTable(list) {
        const rows = list.map(invoice => `
            <tr data-action="open-invoice" data-id="${invoice.id}">
                <td class="mono">${esc(invoice.number)}</td>
                <td>${TYPE_SHORT[invoice.type]}</td>
                <td>${esc(invoice.customer.name)}</td>
                <td class="num">${Finance.formatDate(invoice.issueDate)}</td>
                <td class="num">${Finance.formatDate(invoice.dueDate)}</td>
                <td class="num">${Finance.formatMoney(invoiceTotal(invoice), invoice.currency)}</td>
                <td>${statusChip(invoice)}</td>
            </tr>`).join('');
        return `
            <table class="data-table">
                <thead>
                    <tr><th>Číslo</th><th>Typ</th><th>Odběratel</th><th class="num">Vystaveno</th><th class="num">Splatnost</th><th class="num">Částka</th><th>Stav</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function filteredInvoices() {
        const search = listFilters.search.trim().toLowerCase();
        return invoices
            .filter(invoice => listFilters.year === 'all' || (invoice.issueDate || '').startsWith(listFilters.year))
            .filter(invoice => listFilters.type === 'all' || invoice.type === listFilters.type)
            .filter(invoice => listFilters.status === 'all' || invoiceStatus(invoice) === listFilters.status)
            .filter(invoice => !search
                || String(invoice.number).toLowerCase().includes(search)
                || invoice.customer.name.toLowerCase().includes(search))
            .sort((first, second) => (second.issueDate || '').localeCompare(first.issueDate || '')
                || String(second.number).localeCompare(String(first.number)));
    }

    function renderInvoiceList() {
        const years = [...new Set(invoices.map(invoice => (invoice.issueDate || '').slice(0, 4)).filter(Boolean))]
            .sort()
            .reverse();
        const list = filteredInvoices();
        const yearOptions = ['<option value="all">Všechny roky</option>']
            .concat(years.map(year => `<option value="${year}" ${listFilters.year === year ? 'selected' : ''}>${year}</option>`))
            .join('');
        return `
            <header class="view-head">
                <h1>Faktury</h1>
                <div class="view-actions">
                    <a class="btn" href="#/invoices/new?type=proforma">Nová zálohová faktura</a>
                    <a class="btn btn-primary" href="#/invoices/new">Nová faktura</a>
                </div>
            </header>
            <div class="filters">
                <select data-filter="year">${yearOptions}</select>
                <select data-filter="type">
                    <option value="all">Všechny typy</option>
                    <option value="invoice" ${listFilters.type === 'invoice' ? 'selected' : ''}>Faktury</option>
                    <option value="proforma" ${listFilters.type === 'proforma' ? 'selected' : ''}>Zálohové faktury</option>
                    <option value="credit" ${listFilters.type === 'credit' ? 'selected' : ''}>Opravné doklady</option>
                </select>
                <select data-filter="status">
                    <option value="all">Všechny stavy</option>
                    <option value="open" ${listFilters.status === 'open' ? 'selected' : ''}>Vystavené</option>
                    <option value="overdue" ${listFilters.status === 'overdue' ? 'selected' : ''}>Po splatnosti</option>
                    <option value="paid" ${listFilters.status === 'paid' ? 'selected' : ''}>Uhrazené</option>
                </select>
                <input type="search" data-filter="search" placeholder="Hledat číslo nebo odběratele" value="${esc(listFilters.search)}">
            </div>
            ${list.length ? invoiceTable(list) : '<p class="empty">Žádné doklady neodpovídají filtru.</p>'}`;
    }

    function renderDetail(invoiceId) {
        const invoice = findInvoice(invoiceId);
        if (!invoice) {
            return '<p class="empty">Doklad nenalezen. <a href="#/invoices">Zpět na seznam.</a></p>';
        }
        const status = invoiceStatus(invoice);
        const typeActions = [];
        if (invoice.type === 'proforma') {
            typeActions.push(`<button class="btn" data-action="invoice-from-proforma" data-id="${invoice.id}">Vystavit fakturu</button>`);
        }
        if (invoice.type === 'invoice') {
            typeActions.push(`<button class="btn" data-action="credit-note" data-id="${invoice.id}">Opravný doklad</button>`);
        }
        return `
            <header class="view-head">
                <div>
                    <a class="back-link" href="#/invoices">← Faktury</a>
                    <h1>${TYPE_SHORT[invoice.type]} ${esc(invoice.number)} ${statusChip(invoice)}</h1>
                </div>
                <div class="view-actions">
                    <button class="btn btn-danger-ghost" data-action="delete-invoice" data-id="${invoice.id}">Smazat</button>
                    <button class="btn" data-action="duplicate-invoice" data-id="${invoice.id}">Duplikovat</button>
                    ${typeActions.join('')}
                    <a class="btn" href="#/invoice/${invoice.id}/edit">Upravit</a>
                    <button class="btn" data-action="toggle-paid" data-id="${invoice.id}">${status === 'paid' ? 'Zrušit úhradu' : 'Uhrazeno'}</button>
                    <button class="btn btn-primary" data-action="print" data-number="${esc(invoice.number)}">Tisk / PDF</button>
                </div>
            </header>
            ${status === 'paid' ? `<p class="paid-line">Uhrazeno ${Finance.formatDate(invoice.paidDate)}</p>` : ''}
            ${Store.dataDir() ? `<p class="archive-hint">PDF uložte jako ${esc(invoice.number)}.pdf do složky ${esc(Store.dataDir())}/pdf.</p>` : ''}
            <div class="paper" id="print-area">${InvoiceDoc.render(invoice)}</div>`;
    }

    function emptyLine() {
        return { description: '', quantity: '1', unit: '', unitPrice: '', vatRate: settings.invoicing.defaultVatRate };
    }

    function newDraft(type) {
        const year = new Date().getFullYear();
        const number = nextNumber(type, year);
        const issueDate = Finance.todayIso();
        return {
            id: null,
            type,
            number,
            variableSymbol: variableSymbolFrom(number),
            contactId: '',
            customer: { name: '', street: '', city: '', zip: '', country: 'Česká republika', ico: '', dic: '' },
            issueDate,
            dutyDate: issueDate,
            dueDate: Finance.addDays(issueDate, settings.invoicing.dueDays),
            paymentMethod: 'transfer',
            currency: settings.invoicing.currency,
            itemsMode: 'lines',
            lines: [emptyLine()],
            reverseCharge: false,
            roundTotal: settings.invoicing.roundTotal,
            note: '',
            paidDate: '',
            creditForNumber: '',
            creditForDate: '',
            creditReason: '',
            relatedProformaNumber: '',
            snapshot: null,
        };
    }

    function draftFromInvoice(invoice) {
        return {
            id: invoice.id,
            type: invoice.type,
            number: invoice.number,
            variableSymbol: invoice.variableSymbol,
            contactId: invoice.contactId || '',
            customer: { ...invoice.customer },
            issueDate: invoice.issueDate,
            dutyDate: invoice.dutyDate || invoice.issueDate,
            dueDate: invoice.dueDate,
            paymentMethod: invoice.paymentMethod,
            currency: invoice.currency,
            itemsMode: invoice.itemsMode === 'text' ? 'text' : 'lines',
            lines: invoice.lines.map(line => ({
                description: line.description,
                quantity: String(line.quantity).replace('.', ','),
                unit: line.unit,
                unitPrice: Finance.formatAmountInput(line.unitPrice),
                vatRate: line.vatRate,
            })),
            reverseCharge: Boolean(invoice.reverseCharge),
            roundTotal: Boolean(invoice.roundTotal),
            note: invoice.note || '',
            paidDate: invoice.paidDate || '',
            creditForNumber: invoice.creditForNumber || '',
            creditForDate: invoice.creditForDate || '',
            creditReason: invoice.creditReason || '',
            relatedProformaNumber: invoice.relatedProformaNumber || '',
            snapshot: {
                supplier: invoice.supplier,
                bank: invoice.bank,
                vatMode: invoice.vatMode,
                footNote: invoice.footNote,
            },
        };
    }

    function draftTotalsInvoice() {
        const vatMode = editorDraft.snapshot ? editorDraft.snapshot.vatMode : settings.vatPayer;
        return {
            lines: editorDraft.lines.map(line => ({
                quantity: Finance.parseDecimal(line.quantity) || 0,
                unitPrice: Finance.parseAmount(line.unitPrice) || 0,
                vatRate: vatMode ? line.vatRate : 0,
            })),
            reverseCharge: editorDraft.reverseCharge,
            roundTotal: editorDraft.roundTotal,
        };
    }

    function validateDraft() {
        const errors = [];
        if (!editorDraft.customer.name.trim()) {
            errors.push('Vyplňte název odběratele.');
        }
        if (!editorDraft.number.trim()) {
            errors.push('Vyplňte číslo dokladu.');
        }
        const duplicate = invoices.find(invoice =>
            invoice.number === editorDraft.number.trim() && invoice.id !== editorDraft.id);
        if (duplicate) {
            errors.push(`Doklad s číslem ${editorDraft.number.trim()} už existuje.`);
        }
        if (!editorDraft.issueDate) {
            errors.push('Vyplňte datum vystavení.');
        }
        if (!editorDraft.dueDate) {
            errors.push('Vyplňte datum splatnosti.');
        }
        const vatMode = editorDraft.snapshot ? editorDraft.snapshot.vatMode : settings.vatPayer;
        const supplier = editorDraft.snapshot ? editorDraft.snapshot.supplier : settings.supplier;
        if (!supplier.name) {
            errors.push('V Nastavení chybí údaje dodavatele.');
        } else {
            if (!supplier.street || !supplier.city) {
                errors.push('V Nastavení chybí sídlo dodavatele (povinný údaj obchodní listiny, § 435 občanského zákoníku).');
            }
            if (!supplier.ico) {
                errors.push('V Nastavení chybí IČO dodavatele (§ 435 občanského zákoníku).');
            }
            if (!supplier.registration) {
                errors.push('V Nastavení chybí údaj o zápisu v rejstříku nebo evidenci, např. „Fyzická osoba zapsaná v živnostenském rejstříku“ (§ 435 občanského zákoníku).');
            }
        }
        if (vatMode && !supplier.dic) {
            errors.push('Jste plátce DPH, ale v Nastavení chybí vaše DIČ (povinná náležitost daňového dokladu).');
        }
        if (vatMode && editorDraft.type !== 'proforma' && !editorDraft.dutyDate) {
            errors.push('Vyplňte datum uskutečnění plnění (povinná náležitost daňového dokladu).');
        }
        if (editorDraft.type === 'credit' && !editorDraft.creditReason.trim()) {
            errors.push('Vyplňte důvod opravy (povinná náležitost opravného daňového dokladu).');
        }
        if (editorDraft.itemsMode === 'text') {
            return errors.concat(freeTextErrors(editorDraft.lines[0]));
        }
        const usableLines = editorDraft.lines.filter(line => line.description.trim());
        if (usableLines.length === 0) {
            errors.push('Přidejte alespoň jednu položku s popisem.');
        }
        for (const line of usableLines) {
            if (Finance.parseDecimal(line.quantity) === null) {
                errors.push(`Položka „${line.description.trim()}“ má neplatné množství.`);
            }
            if (Finance.parseAmount(line.unitPrice) === null) {
                errors.push(`Položka „${line.description.trim()}“ má neplatnou cenu.`);
            }
        }
        return errors;
    }

    function freeTextErrors(line) {
        const errors = [];
        const text = line.description.trim();
        if (!text) {
            errors.push('Vyplňte text předmětu plnění.');
        } else if (UNFILLED_PLACEHOLDER.test(text)) {
            errors.push('Text předmětu plnění obsahuje nevyplněný údaj v hranatých závorkách.');
        }
        if (Finance.parseAmount(line.unitPrice) === null) {
            errors.push('Zadejte platnou částku.');
        }
        return errors;
    }

    function freeTextLineFrom(lines) {
        const filled = lines.find(line => line.description.trim()) || lines[0] || emptyLine();
        return {
            ...filled,
            description: filled.description.trim() ? filled.description : FREE_TEXT_TEMPLATE,
            quantity: '1',
            unit: '',
        };
    }

    function switchItemsMode(mode) {
        if (mode === editorDraft.itemsMode) {
            return;
        }
        if (mode === 'text') {
            const filledCount = editorDraft.lines.filter(line => line.description.trim()).length;
            if (filledCount > 1 && !confirm('Volný text má jen jednu částku. Zachová se první vyplněná položka, ostatní se odeberou. Pokračovat?')) {
                return;
            }
            editorDraft.lines = [freeTextLineFrom(editorDraft.lines)];
        }
        editorDraft.itemsMode = mode;
    }

    function draftToInvoice() {
        const snapshot = editorDraft.snapshot || {
            supplier: { ...settings.supplier },
            bank: { ...settings.bank },
            vatMode: settings.vatPayer,
            footNote: settings.invoicing.footNote,
        };
        return {
            id: editorDraft.id || generateId(),
            type: editorDraft.type,
            number: editorDraft.number.trim(),
            variableSymbol: editorDraft.variableSymbol.trim(),
            contactId: editorDraft.contactId,
            supplier: snapshot.supplier,
            bank: snapshot.bank,
            vatMode: snapshot.vatMode,
            footNote: snapshot.footNote,
            customer: {
                ...editorDraft.customer,
                name: editorDraft.customer.name.trim(),
            },
            issueDate: editorDraft.issueDate,
            dutyDate: editorDraft.dutyDate,
            dueDate: editorDraft.dueDate,
            paymentMethod: editorDraft.paymentMethod,
            currency: editorDraft.currency,
            itemsMode: editorDraft.itemsMode,
            lines: editorDraft.lines
                .filter(line => line.description.trim())
                .slice(0, editorDraft.itemsMode === 'text' ? 1 : undefined)
                .map(line => ({
                    description: line.description.trim(),
                    quantity: Finance.parseDecimal(line.quantity),
                    unit: line.unit.trim(),
                    unitPrice: Finance.parseAmount(line.unitPrice),
                    vatRate: snapshot.vatMode ? Number(line.vatRate) : 0,
                })),
            reverseCharge: editorDraft.reverseCharge,
            roundTotal: editorDraft.roundTotal,
            note: editorDraft.note.trim(),
            paidDate: editorDraft.paidDate || null,
            creditForNumber: editorDraft.creditForNumber,
            creditForDate: editorDraft.creditForDate,
            creditReason: editorDraft.creditReason.trim(),
            relatedProformaNumber: editorDraft.relatedProformaNumber,
            createdAt: editorDraft.createdAt || new Date().toISOString(),
        };
    }

    function editorTotalsHtml() {
        const totals = Finance.documentTotals(draftTotalsInvoice());
        const vatMode = editorDraft.snapshot ? editorDraft.snapshot.vatMode : settings.vatPayer;
        const currency = editorDraft.currency;
        const recap = vatMode
            ? totals.breakdown.map(group => `
                <div class="totals-row">
                    <span>Základ ${group.rate} % / DPH</span>
                    <span>${Finance.formatMoney(group.base, currency)} / ${Finance.formatMoney(group.vat, currency)}</span>
                </div>`).join('')
            : '';
        const rounding = totals.rounding !== 0
            ? `<div class="totals-row"><span>Zaokrouhlení</span><span>${Finance.formatMoney(totals.rounding, currency)}</span></div>`
            : '';
        const currencyHint = vatMode && currency !== 'CZK'
            ? '<p class="hint hint-alert">U daňového dokladu v cizí měně musí být výše DPH uvedena i v korunách (§ 29 zákona o DPH). Přepočet kurzem ČNB doplňte do poznámky.</p>'
            : '';
        return `
            ${recap}
            ${rounding}
            <div class="totals-row totals-grand"><span>Celkem</span><span>${Finance.formatMoney(totals.total, currency)}</span></div>
            ${currencyHint}`;
    }

    function itemsModeHtml() {
        const option = (mode, label) => `
            <label class="check">
                <input type="radio" name="items-mode" value="${mode}" ${editorDraft.itemsMode === mode ? 'checked' : ''}> ${label}
            </label>`;
        return `
            <div class="items-mode" data-action-change="items-mode">
                ${option('lines', 'Položky (množství, jednotka, cena)')}
                ${option('text', 'Volný text s jednou částkou')}
            </div>`;
    }

    function editorFreeTextHtml() {
        const vatMode = editorDraft.snapshot ? editorDraft.snapshot.vatMode : settings.vatPayer;
        const line = editorDraft.lines[0];
        return `
            <label>Předmět plnění
                <textarea data-line-field="description" data-index="0" rows="4">${esc(line.description)}</textarea>
            </label>
            <p class="hint">Údaje v hranatých závorkách nahraďte skutečnými; s nimi doklad nepůjde uložit.</p>
            <div class="free-text-amount">
                <label>Částka${vatMode ? ' bez DPH' : ''}
                    <input type="text" class="num-input" data-line-field="unitPrice" data-index="0" value="${esc(line.unitPrice)}" placeholder="0,00">
                </label>
                ${vatMode ? `
                    <label>DPH
                        <select data-line-field="vatRate" data-index="0">
                            ${VAT_RATES.map(rate => `<option value="${rate}" ${Number(line.vatRate) === rate ? 'selected' : ''}>${rate} %</option>`).join('')}
                        </select>
                    </label>` : ''}
            </div>`;
    }

    function editorItemsHtml() {
        if (editorDraft.itemsMode === 'text') {
            return `${itemsModeHtml()}${editorFreeTextHtml()}`;
        }
        return `
            ${itemsModeHtml()}
            ${editorLinesHtml()}
            <button type="button" class="btn btn-small" data-action="add-line">Přidat položku</button>`;
    }

    function editorLinesHtml() {
        const vatMode = editorDraft.snapshot ? editorDraft.snapshot.vatMode : settings.vatPayer;
        const rows = editorDraft.lines.map((line, index) => `
            <tr>
                <td><input type="text" data-line-field="description" data-index="${index}" value="${esc(line.description)}" placeholder="Popis položky"></td>
                <td><input type="text" class="num-input" data-line-field="quantity" data-index="${index}" value="${esc(line.quantity)}"></td>
                <td><input type="text" class="unit-input" data-line-field="unit" data-index="${index}" value="${esc(line.unit)}" list="unit-suggestions"></td>
                <td><input type="text" class="num-input" data-line-field="unitPrice" data-index="${index}" value="${esc(line.unitPrice)}" placeholder="0,00"></td>
                ${vatMode ? `
                    <td>
                        <select data-line-field="vatRate" data-index="${index}">
                            ${VAT_RATES.map(rate => `<option value="${rate}" ${Number(line.vatRate) === rate ? 'selected' : ''}>${rate} %</option>`).join('')}
                        </select>
                    </td>` : ''}
                <td><button type="button" class="btn-icon" data-action="remove-line" data-index="${index}" title="Odebrat položku">×</button></td>
            </tr>`).join('');
        return `
            <table class="lines-table">
                <thead>
                    <tr>
                        <th>Popis</th><th>Množství</th><th>MJ</th><th>Cena za MJ${vatMode ? ' bez DPH' : ''}</th>${vatMode ? '<th>DPH</th>' : ''}<th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function renderEditor(current) {
        const routeType = current.type === 'proforma' ? 'proforma' : current.type === 'credit' ? 'credit' : 'invoice';
        if (editorDraft) {
            const idMismatch = (editorDraft.id || null) !== (current.invoiceId || null);
            const typeMismatch = !current.invoiceId && editorDraft.type !== routeType;
            if (idMismatch || typeMismatch) {
                editorDraft = null;
            }
        }
        if (!editorDraft) {
            if (current.invoiceId) {
                const invoice = findInvoice(current.invoiceId);
                if (!invoice) {
                    return '<p class="empty">Doklad nenalezen. <a href="#/invoices">Zpět na seznam.</a></p>';
                }
                editorDraft = draftFromInvoice(invoice);
            } else {
                editorDraft = newDraft(routeType);
            }
        }
        const draft = editorDraft;
        const vatMode = draft.snapshot ? draft.snapshot.vatMode : settings.vatPayer;
        const contactOptions = ['<option value="">Vybrat z kontaktů…</option>']
            .concat(contacts.map(contact =>
                `<option value="${contact.id}" ${draft.contactId === contact.id ? 'selected' : ''}>${esc(contact.name)}</option>`))
            .join('');
        return `
            <header class="view-head">
                <div>
                    <a class="back-link" href="${draft.id ? `#/invoice/${draft.id}` : '#/invoices'}">← Zpět</a>
                    <h1>${draft.id ? 'Úprava dokladu' : `Nový doklad: ${InvoiceDoc.TYPE_TITLES[draft.type]}`}</h1>
                </div>
                <div class="view-actions">
                    <button class="btn btn-primary" data-action="save-invoice">Uložit</button>
                </div>
            </header>
            <div id="editor-errors"></div>
            <form class="editor" data-action-submit="save-invoice">
                <div class="editor-grid">
                    <fieldset class="panel">
                        <legend>Odběratel</legend>
                        <select data-action-change="apply-contact">${contactOptions}</select>
                        <div class="field-row">
                            <label>IČO <input type="text" data-field="customer.ico" value="${esc(draft.customer.ico)}"></label>
                            <button type="button" class="btn btn-small" data-action="ares-customer">Načíst z ARES</button>
                        </div>
                        <label>Název <input type="text" data-field="customer.name" value="${esc(draft.customer.name)}" required></label>
                        <label>DIČ <input type="text" data-field="customer.dic" value="${esc(draft.customer.dic)}"></label>
                        <label>Ulice a č. p. <input type="text" data-field="customer.street" value="${esc(draft.customer.street)}"></label>
                        <div class="field-row">
                            <label>PSČ <input type="text" data-field="customer.zip" value="${esc(draft.customer.zip)}"></label>
                            <label>Město <input type="text" data-field="customer.city" value="${esc(draft.customer.city)}"></label>
                        </div>
                        <label>Země <input type="text" data-field="customer.country" value="${esc(draft.customer.country)}"></label>
                    </fieldset>
                    <fieldset class="panel">
                        <legend>Doklad</legend>
                        <div class="field-row">
                            <label>Číslo <input type="text" class="mono" data-field="number" value="${esc(draft.number)}"></label>
                            <label>Variabilní symbol <input type="text" class="mono" data-field="variableSymbol" value="${esc(draft.variableSymbol)}"></label>
                        </div>
                        <div class="field-row">
                            <label>Vystaveno <input type="date" data-field="issueDate" value="${draft.issueDate}"></label>
                            ${vatMode && draft.type !== 'proforma' ? `<label>DUZP <input type="date" data-field="dutyDate" value="${draft.dutyDate}"></label>` : ''}
                            <label>Splatnost <input type="date" data-field="dueDate" value="${draft.dueDate}"></label>
                        </div>
                        <div class="field-row">
                            <label>Způsob platby
                                <select data-field="paymentMethod">
                                    <option value="transfer" ${draft.paymentMethod === 'transfer' ? 'selected' : ''}>Převodem</option>
                                    <option value="cash" ${draft.paymentMethod === 'cash' ? 'selected' : ''}>Hotově</option>
                                    <option value="card" ${draft.paymentMethod === 'card' ? 'selected' : ''}>Kartou</option>
                                </select>
                            </label>
                            <label>Měna
                                <select data-field="currency">
                                    ${CURRENCIES.map(code => `<option value="${code}" ${draft.currency === code ? 'selected' : ''}>${code}</option>`).join('')}
                                </select>
                            </label>
                            <label>Uhrazeno dne <input type="date" data-field="paidDate" value="${draft.paidDate || ''}"></label>
                        </div>
                        ${vatMode ? `
                            <label class="check"><input type="checkbox" data-field="reverseCharge" ${draft.reverseCharge ? 'checked' : ''}> Přenesená daňová povinnost (daň odvede zákazník)</label>` : ''}
                        <label class="check"><input type="checkbox" data-field="roundTotal" ${draft.roundTotal ? 'checked' : ''}> Zaokrouhlit celkovou částku na koruny</label>
                        ${draft.type === 'credit' ? `
                            <div class="field-row">
                                <label>K dokladu č. <input type="text" class="mono" data-field="creditForNumber" value="${esc(draft.creditForNumber)}"></label>
                                <label>ze dne <input type="date" data-field="creditForDate" value="${draft.creditForDate}"></label>
                            </div>
                            <label>Důvod opravy <input type="text" data-field="creditReason" value="${esc(draft.creditReason)}" placeholder="Např. vrácení zboží, sleva z ceny"></label>` : ''}
                    </fieldset>
                </div>
                <fieldset class="panel">
                    <legend>Předmět plnění</legend>
                    ${editorItemsHtml()}
                </fieldset>
                <div class="editor-grid">
                    <fieldset class="panel">
                        <legend>Poznámka na dokladu</legend>
                        <textarea data-field="note" rows="3">${esc(draft.note)}</textarea>
                    </fieldset>
                    <div class="panel totals" id="editor-totals">${editorTotalsHtml()}</div>
                </div>
            </form>
            <datalist id="unit-suggestions">${UNIT_SUGGESTIONS.map(unit => `<option value="${unit}">`).join('')}</datalist>`;
    }

    function renderContacts() {
        const draft = contactDraft || { id: null, name: '', ico: '', dic: '', street: '', city: '', zip: '', country: 'Česká republika', email: '', phone: '', dueDays: '', note: '' };
        const rows = [...contacts]
            .sort((first, second) => first.name.localeCompare(second.name, 'cs'))
            .map(contact => `
                <tr data-action="edit-contact" data-id="${contact.id}" class="${draft.id === contact.id ? 'is-selected' : ''}">
                    <td>${esc(contact.name)}</td>
                    <td class="mono">${esc(contact.ico)}</td>
                    <td>${esc(contact.email)}</td>
                </tr>`).join('');
        return `
            <header class="view-head">
                <h1>Kontakty</h1>
                <div class="view-actions">
                    <button class="btn btn-primary" data-action="new-contact">Nový kontakt</button>
                </div>
            </header>
            <div class="contacts-grid">
                <div>
                    ${contacts.length
                        ? `<table class="data-table"><thead><tr><th>Název</th><th>IČO</th><th>E-mail</th></tr></thead><tbody>${rows}</tbody></table>`
                        : '<p class="empty">Zatím žádné kontakty.</p>'}
                </div>
                <form class="panel" data-action-submit="save-contact">
                    <h2>${draft.id ? 'Úprava kontaktu' : 'Nový kontakt'}</h2>
                    <div id="contact-errors"></div>
                    <div class="field-row">
                        <label>IČO <input type="text" data-contact-field="ico" value="${esc(draft.ico)}"></label>
                        <button type="button" class="btn btn-small" data-action="ares-contact">Načíst z ARES</button>
                    </div>
                    <label>Název <input type="text" data-contact-field="name" value="${esc(draft.name)}" required></label>
                    <label>DIČ <input type="text" data-contact-field="dic" value="${esc(draft.dic)}"></label>
                    <label>Ulice a č. p. <input type="text" data-contact-field="street" value="${esc(draft.street)}"></label>
                    <div class="field-row">
                        <label>PSČ <input type="text" data-contact-field="zip" value="${esc(draft.zip)}"></label>
                        <label>Město <input type="text" data-contact-field="city" value="${esc(draft.city)}"></label>
                    </div>
                    <label>Země <input type="text" data-contact-field="country" value="${esc(draft.country)}"></label>
                    <label>E-mail <input type="email" data-contact-field="email" value="${esc(draft.email)}"></label>
                    <label>Telefon <input type="text" data-contact-field="phone" value="${esc(draft.phone)}"></label>
                    <label>Splatnost (dny, nechte prázdné pro výchozí) <input type="number" min="0" data-contact-field="dueDays" value="${esc(draft.dueDays)}"></label>
                    <label>Interní poznámka <textarea data-contact-field="note" rows="2">${esc(draft.note)}</textarea></label>
                    <div class="field-row">
                        <button class="btn btn-primary" type="submit">Uložit kontakt</button>
                        ${draft.id ? `<button class="btn btn-danger-ghost" type="button" data-action="delete-contact" data-id="${draft.id}">Smazat</button>` : ''}
                    </div>
                </form>
            </div>`;
    }

    function monthLabel(month) {
        const names = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
            'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
        return names[month - 1];
    }

    function renderReports() {
        const years = [...new Set(invoices.map(invoice => (invoice.issueDate || '').slice(0, 4)).filter(Boolean))]
            .sort()
            .reverse();
        if (years.length === 0) {
            return '<header class="view-head"><h1>Reporty</h1></header><p class="empty">Zatím žádná data.</p>';
        }
        if (!reportYear || !years.includes(reportYear)) {
            reportYear = years[0];
        }
        const year = reportYear;
        const czkOnly = invoice => (invoice.currency || 'CZK') === 'CZK';
        const issued = invoices.filter(invoice =>
            invoice.type !== 'proforma' && (invoice.issueDate || '').startsWith(year) && czkOnly(invoice));
        const paid = invoices.filter(invoice =>
            invoice.paidDate && invoice.paidDate.startsWith(year) && czkOnly(invoice));
        const hasForeignCurrency = invoices.some(invoice => !czkOnly(invoice));

        const monthRows = [];
        for (let month = 1; month <= 12; month += 1) {
            const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
            const issuedInMonth = issued.filter(invoice => invoice.issueDate.startsWith(monthPrefix));
            const paidInMonth = paid.filter(invoice => invoice.paidDate.startsWith(monthPrefix));
            if (issuedInMonth.length === 0 && paidInMonth.length === 0) {
                continue;
            }
            const issuedSum = issuedInMonth.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
            const paidSum = paidInMonth.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
            monthRows.push(`
                <tr>
                    <td>${monthLabel(month)}</td>
                    <td class="num">${Finance.formatMoney(issuedSum, 'CZK')}</td>
                    <td class="num">${Finance.formatMoney(paidSum, 'CZK')}</td>
                </tr>`);
        }

        const issuedTotal = issued.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
        const paidTotal = paid.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);

        let vatSection = '';
        if (settings.vatPayer) {
            const taxDocuments = issued.filter(invoice => invoice.vatMode);
            const vatRows = [];
            const yearTotals = new Map();
            for (let month = 1; month <= 12; month += 1) {
                const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
                const docs = taxDocuments.filter(invoice => (invoice.dutyDate || invoice.issueDate).startsWith(monthPrefix));
                if (docs.length === 0) {
                    continue;
                }
                const cells = VAT_RATES.map(rate => {
                    let base = 0;
                    let vat = 0;
                    for (const doc of docs) {
                        for (const group of Finance.documentTotals(doc).breakdown) {
                            if (group.rate === rate) {
                                base += group.base;
                                vat += group.vat;
                            }
                        }
                    }
                    const totals = yearTotals.get(rate) || { base: 0, vat: 0 };
                    totals.base += base;
                    totals.vat += vat;
                    yearTotals.set(rate, totals);
                    return `<td class="num">${Finance.formatMoney(base, 'CZK')}</td><td class="num">${Finance.formatMoney(vat, 'CZK')}</td>`;
                }).join('');
                vatRows.push(`<tr><td>${monthLabel(month)}</td>${cells}</tr>`);
            }
            const totalCells = VAT_RATES.map(rate => {
                const totals = yearTotals.get(rate) || { base: 0, vat: 0 };
                return `<td class="num">${Finance.formatMoney(totals.base, 'CZK')}</td><td class="num">${Finance.formatMoney(totals.vat, 'CZK')}</td>`;
            }).join('');
            vatSection = `
                <section class="panel">
                    <h2>Podklady pro přiznání k DPH (podle DUZP)</h2>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Období</th>
                                ${VAT_RATES.map(rate => `<th class="num">Základ ${rate} %</th><th class="num">DPH ${rate} %</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>${vatRows.join('')}</tbody>
                        <tfoot><tr><td>Celkem ${year}</td>${totalCells}</tr></tfoot>
                    </table>
                    <p class="hint">Zahrnuje faktury a opravné doklady. Doklady s přenesenou daňovou povinností mají DPH 0, základ patří do řádku 25 přiznání.</p>
                </section>`;
        }

        const clientTotals = new Map();
        for (const invoice of issued) {
            const key = invoice.customer.name;
            clientTotals.set(key, (clientTotals.get(key) || 0) + invoiceTotal(invoice));
        }
        const clientRows = [...clientTotals.entries()]
            .sort((first, second) => second[1] - first[1])
            .slice(0, 10)
            .map(([name, total]) => `<tr><td>${esc(name)}</td><td class="num">${Finance.formatMoney(total, 'CZK')}</td></tr>`)
            .join('');

        return `
            <header class="view-head">
                <h1>Reporty</h1>
                <div class="view-actions">
                    <select data-action-change="report-year">
                        ${years.map(option => `<option value="${option}" ${option === year ? 'selected' : ''}>${option}</option>`).join('')}
                    </select>
                </div>
            </header>
            ${hasForeignCurrency ? '<p class="hint">Reporty zahrnují pouze doklady v CZK.</p>' : ''}
            <div class="tiles">
                <div class="tile"><span class="tile-label">Fakturováno ${year}</span><span class="tile-value">${Finance.formatMoney(issuedTotal, 'CZK')}</span></div>
                <div class="tile"><span class="tile-label">Uhrazeno ${year}</span><span class="tile-value">${Finance.formatMoney(paidTotal, 'CZK')}</span></div>
            </div>
            <section class="panel">
                <h2>Po měsících</h2>
                <table class="data-table">
                    <thead><tr><th>Měsíc</th><th class="num">Fakturováno (bez záloh)</th><th class="num">Uhrazeno</th></tr></thead>
                    <tbody>${monthRows.join('')}</tbody>
                </table>
            </section>
            ${vatSection}
            <section class="panel">
                <h2>Odběratelé ${year}</h2>
                <table class="data-table">
                    <thead><tr><th>Odběratel</th><th class="num">Fakturováno</th></tr></thead>
                    <tbody>${clientRows}</tbody>
                </table>
            </section>`;
    }

    function seriesGaps() {
        const gaps = [];
        const series = new Map();
        for (const invoice of invoices) {
            const match = String(invoice.number).match(/^(Z?)(\d{4})(\d{4})$/);
            if (!match) {
                continue;
            }
            const key = `${match[1]}${match[2]}`;
            if (!series.has(key)) {
                series.set(key, []);
            }
            series.get(key).push(Number(match[3]));
        }
        for (const [key, numbers] of series) {
            numbers.sort((first, second) => first - second);
            for (let index = 1; index < numbers.length; index += 1) {
                for (let missing = numbers[index - 1] + 1; missing < numbers[index]; missing += 1) {
                    gaps.push(`${key}${String(missing).padStart(4, '0')}`);
                }
            }
        }
        return gaps;
    }

    function renderSettings() {
        const meta = Store.getMeta();
        const supplier = settings.supplier;
        const iban = settings.bank.iban || Payment.accountToIban(settings.bank.account) || '';
        const gaps = seriesGaps();
        const years = [...new Set(invoices.map(invoice => (invoice.issueDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
        return `
            <header class="view-head">
                <h1>Nastavení</h1>
                <div class="view-actions">
                    <button class="btn btn-primary" data-action="save-settings">Uložit nastavení</button>
                </div>
            </header>
            <div id="settings-errors"></div>
            <form class="editor" data-action-submit="save-settings">
                <div class="editor-grid">
                    <fieldset class="panel">
                        <legend>Dodavatel (vaše údaje)</legend>
                        <div class="field-row">
                            <label>IČO <input type="text" data-settings-field="supplier.ico" value="${esc(supplier.ico)}"></label>
                            <button type="button" class="btn btn-small" data-action="ares-supplier">Načíst z ARES</button>
                        </div>
                        <label>Název / jméno <input type="text" data-settings-field="supplier.name" value="${esc(supplier.name)}"></label>
                        <label>DIČ <input type="text" data-settings-field="supplier.dic" value="${esc(supplier.dic)}" placeholder="CZ12345678"></label>
                        <label>Ulice a č. p. <input type="text" data-settings-field="supplier.street" value="${esc(supplier.street)}"></label>
                        <div class="field-row">
                            <label>PSČ <input type="text" data-settings-field="supplier.zip" value="${esc(supplier.zip)}"></label>
                            <label>Město <input type="text" data-settings-field="supplier.city" value="${esc(supplier.city)}"></label>
                        </div>
                        <label>Země <input type="text" data-settings-field="supplier.country" value="${esc(supplier.country)}"></label>
                        <label>Zápis v rejstříku <input type="text" data-settings-field="supplier.registration" value="${esc(supplier.registration)}" placeholder="Fyzická osoba zapsaná v živnostenském rejstříku"></label>
                        <p class="hint">Údaj o zápisu v obchodním rejstříku nebo jiné evidenci je povinnou náležitostí obchodních listin (§ 435 občanského zákoníku).</p>
                        <label>E-mail <input type="email" data-settings-field="supplier.email" value="${esc(supplier.email)}"></label>
                        <label>Telefon <input type="text" data-settings-field="supplier.phone" value="${esc(supplier.phone)}"></label>
                        <label>Web <input type="text" data-settings-field="supplier.web" value="${esc(supplier.web)}"></label>
                        <label class="check"><input type="checkbox" data-settings-field="vatPayer" ${settings.vatPayer ? 'checked' : ''}> Jsem plátce DPH</label>
                    </fieldset>
                    <div>
                        <fieldset class="panel">
                            <legend>Bankovní účet</legend>
                            <label>Číslo účtu <input type="text" class="mono" data-settings-field="bank.account" value="${esc(settings.bank.account)}" placeholder="19-2000145399/0800"></label>
                            <label>IBAN (dopočítá se z čísla účtu) <input type="text" class="mono" data-settings-field="bank.iban" value="${esc(iban)}"></label>
                            <label>SWIFT/BIC <input type="text" class="mono" data-settings-field="bank.swift" value="${esc(settings.bank.swift)}"></label>
                        </fieldset>
                        <fieldset class="panel">
                            <legend>Fakturace</legend>
                            <div class="field-row">
                                <label>Splatnost (dny) <input type="number" min="0" data-settings-field="invoicing.dueDays" value="${settings.invoicing.dueDays}"></label>
                                <label>Výchozí měna
                                    <select data-settings-field="invoicing.currency">
                                        ${CURRENCIES.map(code => `<option value="${code}" ${settings.invoicing.currency === code ? 'selected' : ''}>${code}</option>`).join('')}
                                    </select>
                                </label>
                                <label>Výchozí sazba DPH
                                    <select data-settings-field="invoicing.defaultVatRate">
                                        ${VAT_RATES.map(rate => `<option value="${rate}" ${settings.invoicing.defaultVatRate === rate ? 'selected' : ''}>${rate} %</option>`).join('')}
                                    </select>
                                </label>
                            </div>
                            <label class="check"><input type="checkbox" data-settings-field="invoicing.roundTotal" ${settings.invoicing.roundTotal ? 'checked' : ''}> Zaokrouhlovat celkovou částku na koruny</label>
                            <label>Patička na dokladech <textarea data-settings-field="invoicing.footNote" rows="2">${esc(settings.invoicing.footNote)}</textarea></label>
                        </fieldset>
                    </div>
                </div>
            </form>
            <div class="editor-grid">
                <section class="panel">
                    <h2>Záloha dat</h2>
                    <p>${meta.lastBackupAt
                        ? `Poslední záloha: ${Finance.formatDate(meta.lastBackupAt.slice(0, 10))}`
                        : 'Zatím žádná záloha.'}
                        Data jsou uložena jen v tomto prohlížeči, zálohujte pravidelně.</p>
                    <div class="field-row">
                        <button class="btn btn-primary" data-action="export-backup">Stáhnout zálohu (JSON)</button>
                        <label class="btn">Obnovit ze zálohy <input type="file" accept="application/json" data-action-change="import-backup" hidden></label>
                    </div>
                </section>
                <section class="panel">
                    <h2>Export pro účetnictví</h2>
                    <div class="field-row">
                        <select id="csv-year">
                            ${years.map(year => `<option value="${year}">${year}</option>`).join('')}
                            <option value="all">Vše</option>
                        </select>
                        <button class="btn" data-action="export-csv">Stáhnout CSV</button>
                    </div>
                    ${gaps.length ? `<p class="hint hint-alert">Chybějící čísla v řadách: ${gaps.map(esc).join(', ')}. Číselná řada dokladů má být souvislá.</p>` : ''}
                </section>
            </div>`;
    }

    function showErrors(containerId, errors) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = errors.length
                ? `<div class="errors"><ul>${errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul></div>`
                : '';
        }
    }

    function setByPath(target, path, value) {
        const keys = path.split('.');
        let cursor = target;
        for (const key of keys.slice(0, -1)) {
            cursor = cursor[key];
        }
        cursor[keys[keys.length - 1]] = value;
    }

    function readSettingsForm() {
        const updated = JSON.parse(JSON.stringify(settings));
        for (const input of viewRoot.querySelectorAll('[data-settings-field]')) {
            const path = input.dataset.settingsField;
            let value = input.type === 'checkbox' ? input.checked : input.value.trim();
            if (path === 'invoicing.dueDays' || path === 'invoicing.defaultVatRate') {
                value = Number(value) || 0;
            }
            setByPath(updated, path, value);
        }
        if (!updated.bank.iban && updated.bank.account) {
            updated.bank.iban = Payment.accountToIban(updated.bank.account) || '';
        }
        return updated;
    }

    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[=+\-@|]/.test(text)) {
            text = `\t${text}`;
        }
        return `"${text.replace(/"/g, '""')}"`;
    }

    function csvAmount(halere) {
        return `"${(halere / 100).toFixed(2).replace('.', ',')}"`;
    }

    function exportCsv(year) {
        const list = invoices
            .filter(invoice => year === 'all' || (invoice.issueDate || '').startsWith(year))
            .sort((first, second) => String(first.number).localeCompare(String(second.number)));
        const header = ['Číslo', 'Typ', 'Odběratel', 'IČO', 'DIČ', 'Vystaveno', 'DUZP', 'Splatnost', 'Uhrazeno', 'Měna', 'Základ', 'DPH', 'Zaokrouhlení', 'Celkem', 'Stav']
            .map(csvCell)
            .join(';');
        const rows = list.map(invoice => {
            const totals = Finance.documentTotals(invoice);
            return [
                csvCell(invoice.number),
                csvCell(InvoiceDoc.TYPE_TITLES[invoice.type]),
                csvCell(invoice.customer.name),
                csvCell(invoice.customer.ico),
                csvCell(invoice.customer.dic),
                csvCell(Finance.formatDate(invoice.issueDate)),
                csvCell(Finance.formatDate(invoice.dutyDate)),
                csvCell(Finance.formatDate(invoice.dueDate)),
                csvCell(Finance.formatDate(invoice.paidDate)),
                csvCell(invoice.currency),
                csvAmount(totals.base),
                csvAmount(totals.vat),
                csvAmount(totals.rounding),
                csvAmount(totals.total),
                csvCell(STATUS_LABELS[invoiceStatus(invoice)]),
            ].join(';');
        });
        const byteOrderMark = String.fromCharCode(0xfeff);
        const content = byteOrderMark + [header, ...rows].join('\r\n') + '\r\n';
        const suffix = year === 'all' ? 'vse' : year;
        downloadFile(`faktury-${suffix}.csv`, content, 'text/csv;charset=utf-8');
    }

    async function fillFromAres(icoValue, apply) {
        if (icoValue && !Ares.validateIco(icoValue)) {
            alert('Zadané IČO nemá platný kontrolní součet, přesto zkusím vyhledat.');
        }
        try {
            const subject = await Ares.lookup(icoValue);
            apply(subject);
            render();
        } catch (error) {
            alert(error.message);
        }
    }

    function saveInvoiceAction() {
        const errors = validateDraft();
        showErrors('editor-errors', errors);
        if (errors.length > 0) {
            return;
        }
        const invoice = draftToInvoice();
        const existingIndex = invoices.findIndex(item => item.id === invoice.id);
        if (existingIndex >= 0) {
            invoices[existingIndex] = invoice;
        } else {
            invoices.push(invoice);
        }
        persistInvoices();
        editorDraft = null;
        location.hash = `#/invoice/${invoice.id}`;
    }

    function updateDraftFromInput(input) {
        if (input.dataset.lineField !== undefined) {
            const line = editorDraft.lines[Number(input.dataset.index)];
            line[input.dataset.lineField] = input.type === 'checkbox' ? input.checked : input.value;
        } else if (input.dataset.field) {
            const value = input.type === 'checkbox' ? input.checked : input.value;
            setByPath(editorDraft, input.dataset.field, value);
        }
        const totalsBox = document.getElementById('editor-totals');
        if (totalsBox) {
            totalsBox.innerHTML = editorTotalsHtml();
        }
    }

    function readContactForm() {
        const draft = contactDraft || {};
        const result = { ...draft };
        for (const input of viewRoot.querySelectorAll('[data-contact-field]')) {
            result[input.dataset.contactField] = input.value.trim();
        }
        return result;
    }

    function handleAction(action, element) {
        switch (action) {
            case 'open-invoice':
                location.hash = `#/invoice/${element.dataset.id}`;
                break;
            case 'print': {
                const previousTitle = document.title;
                document.title = element.dataset.number || previousTitle;
                window.print();
                document.title = previousTitle;
                break;
            }
            case 'toggle-paid': {
                const invoice = findInvoice(element.dataset.id);
                invoice.paidDate = invoice.paidDate ? null : Finance.todayIso();
                persistInvoices();
                render();
                break;
            }
            case 'delete-invoice': {
                const invoice = findInvoice(element.dataset.id);
                const confirmed = confirm(`Opravdu smazat doklad ${invoice.number}?\n\nVystavené doklady se běžně nemažou, číselná řada má zůstat souvislá. Zvažte místo smazání opravný doklad.`);
                if (confirmed) {
                    invoices = invoices.filter(item => item.id !== invoice.id);
                    persistInvoices();
                    location.hash = '#/invoices';
                }
                break;
            }
            case 'duplicate-invoice': {
                const source = findInvoice(element.dataset.id);
                editorDraft = draftFromInvoice(source);
                editorDraft.id = null;
                editorDraft.snapshot = null;
                editorDraft.paidDate = '';
                editorDraft.number = nextNumber(source.type, new Date().getFullYear());
                editorDraft.variableSymbol = variableSymbolFrom(editorDraft.number);
                editorDraft.issueDate = Finance.todayIso();
                editorDraft.dutyDate = Finance.todayIso();
                editorDraft.dueDate = Finance.addDays(Finance.todayIso(), settings.invoicing.dueDays);
                location.hash = `#/invoices/new?type=${editorDraft.type}`;
                render();
                break;
            }
            case 'credit-note': {
                const source = findInvoice(element.dataset.id);
                editorDraft = draftFromInvoice(source);
                editorDraft.id = null;
                editorDraft.snapshot = null;
                editorDraft.type = 'credit';
                editorDraft.paidDate = '';
                editorDraft.number = nextNumber('credit', new Date().getFullYear());
                editorDraft.variableSymbol = variableSymbolFrom(editorDraft.number);
                editorDraft.issueDate = Finance.todayIso();
                editorDraft.dutyDate = Finance.todayIso();
                editorDraft.dueDate = Finance.addDays(Finance.todayIso(), settings.invoicing.dueDays);
                editorDraft.creditForNumber = source.number;
                editorDraft.creditForDate = source.issueDate;
                editorDraft.creditReason = '';
                editorDraft.lines = editorDraft.lines.map(line => ({
                    ...line,
                    unitPrice: line.unitPrice.startsWith('-') ? line.unitPrice.slice(1) : `-${line.unitPrice}`,
                }));
                location.hash = '#/invoices/new?type=credit';
                render();
                break;
            }
            case 'invoice-from-proforma': {
                const source = findInvoice(element.dataset.id);
                editorDraft = draftFromInvoice(source);
                editorDraft.id = null;
                editorDraft.snapshot = null;
                editorDraft.type = 'invoice';
                editorDraft.paidDate = '';
                editorDraft.number = nextNumber('invoice', new Date().getFullYear());
                editorDraft.variableSymbol = variableSymbolFrom(editorDraft.number);
                editorDraft.issueDate = Finance.todayIso();
                editorDraft.dutyDate = source.paidDate || Finance.todayIso();
                editorDraft.dueDate = Finance.addDays(Finance.todayIso(), settings.invoicing.dueDays);
                editorDraft.relatedProformaNumber = source.number;
                location.hash = '#/invoices/new?type=invoice';
                render();
                break;
            }
            case 'save-invoice':
                saveInvoiceAction();
                break;
            case 'add-line':
                editorDraft.lines.push(emptyLine());
                render();
                break;
            case 'remove-line':
                editorDraft.lines.splice(Number(element.dataset.index), 1);
                if (editorDraft.lines.length === 0) {
                    editorDraft.lines.push(emptyLine());
                }
                render();
                break;
            case 'ares-customer':
                fillFromAres(editorDraft.customer.ico, subject => {
                    editorDraft.customer = { ...editorDraft.customer, ...subject };
                });
                break;
            case 'ares-contact': {
                contactDraft = readContactForm();
                fillFromAres(contactDraft.ico, subject => {
                    contactDraft = { ...contactDraft, ...subject };
                });
                break;
            }
            case 'ares-supplier': {
                settings = readSettingsForm();
                fillFromAres(settings.supplier.ico, subject => {
                    settings.supplier = { ...settings.supplier, ...subject, registration: settings.supplier.registration };
                    Store.saveSettings(settings);
                });
                break;
            }
            case 'new-contact':
                contactDraft = null;
                render();
                break;
            case 'edit-contact':
                contactDraft = { ...contacts.find(contact => contact.id === element.dataset.id) };
                render();
                break;
            case 'save-contact': {
                const draft = readContactForm();
                if (!draft.name) {
                    showErrors('contact-errors', ['Vyplňte název kontaktu.']);
                    return;
                }
                if (draft.id) {
                    const index = contacts.findIndex(contact => contact.id === draft.id);
                    contacts[index] = draft;
                } else {
                    draft.id = generateId();
                    contacts.push(draft);
                }
                Store.saveContacts(contacts);
                contactDraft = null;
                render();
                break;
            }
            case 'delete-contact': {
                if (confirm('Opravdu smazat kontakt? Vystavené doklady zůstanou beze změny.')) {
                    contacts = contacts.filter(contact => contact.id !== element.dataset.id);
                    Store.saveContacts(contacts);
                    contactDraft = null;
                    render();
                }
                break;
            }
            case 'save-settings': {
                settings = readSettingsForm();
                Store.saveSettings(settings);
                showErrors('settings-errors', []);
                render();
                break;
            }
            case 'export-backup': {
                const backup = Store.exportBackup();
                downloadFile(`faktury-zaloha-${Finance.todayIso()}.json`, JSON.stringify(backup, null, 4) + '\n', 'application/json');
                Store.markBackupDone();
                render();
                break;
            }
            case 'export-csv': {
                const yearSelect = document.getElementById('csv-year');
                exportCsv(yearSelect ? yearSelect.value : 'all');
                break;
            }
        }
    }

    function bindRootEvents() {
        viewRoot.addEventListener('click', event => {
            const target = event.target.closest('[data-action]');
            if (target) {
                if (target.tagName === 'TR' && event.target.closest('a, button, input, select')) {
                    return;
                }
                handleAction(target.dataset.action, target);
            }
        });
        viewRoot.addEventListener('submit', event => {
            const form = event.target.closest('[data-action-submit]');
            if (form) {
                event.preventDefault();
                handleAction(form.dataset.actionSubmit, form);
            }
        });
        viewRoot.addEventListener('input', event => {
            const input = event.target;
            if (input.dataset.filter !== undefined) {
                listFilters[input.dataset.filter] = input.value;
                if (input.dataset.filter === 'search') {
                    render();
                    const searchBox = viewRoot.querySelector('[data-filter="search"]');
                    if (searchBox) {
                        searchBox.focus();
                        searchBox.setSelectionRange(searchBox.value.length, searchBox.value.length);
                    }
                    return;
                }
                render();
                return;
            }
            if (editorDraft && (input.dataset.field || input.dataset.lineField !== undefined)) {
                updateDraftFromInput(input);
            }
        });
        viewRoot.addEventListener('change', event => {
            const input = event.target;
            const changeAction = input.closest('[data-action-change]');
            if (!changeAction) {
                return;
            }
            switch (changeAction.dataset.actionChange) {
                case 'apply-contact': {
                    const contact = contacts.find(item => item.id === input.value);
                    editorDraft.contactId = input.value;
                    if (contact) {
                        editorDraft.customer = {
                            name: contact.name,
                            street: contact.street,
                            city: contact.city,
                            zip: contact.zip,
                            country: contact.country,
                            ico: contact.ico,
                            dic: contact.dic,
                        };
                        const dueDays = contact.dueDays !== '' && contact.dueDays !== undefined
                            ? Number(contact.dueDays)
                            : settings.invoicing.dueDays;
                        editorDraft.dueDate = Finance.addDays(editorDraft.issueDate, dueDays);
                    }
                    render();
                    break;
                }
                case 'items-mode':
                    switchItemsMode(input.value);
                    render();
                    break;
                case 'report-year':
                    reportYear = input.value;
                    render();
                    break;
                case 'import-backup': {
                    const file = input.files[0];
                    if (!file) {
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                        try {
                            const data = JSON.parse(reader.result);
                            const summary = `Záloha z ${data.exportedAt ? Finance.formatDate(data.exportedAt.slice(0, 10)) : 'neznámého data'}.`;
                            if (confirm(`${summary}\n\nObnovením PŘEPÍŠETE všechna současná data v aplikaci. Pokračovat?`)) {
                                Store.importBackup(data);
                                settings = Store.getSettings();
                                contacts = Store.getContacts();
                                invoices = Store.getInvoices();
                                render();
                            }
                        } catch (error) {
                            alert(`Zálohu se nepodařilo načíst: ${error.message}`);
                        }
                        input.value = '';
                    };
                    reader.readAsText(file);
                    break;
                }
            }
        });
    }

    function init() {
        settings = Store.getSettings();
        contacts = Store.getContacts();
        invoices = Store.getInvoices();
        viewRoot = document.getElementById('view');
        document.querySelector('.sidebar-foot').textContent = Store.storageLabel();
        bindRootEvents();
        window.addEventListener('hashchange', render);
        render();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
