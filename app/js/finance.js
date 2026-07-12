var Finance = (() => {
    const numberFormat = new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    const quantityFormat = new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });

    function parseDecimal(text) {
        if (typeof text === 'number') {
            return Number.isFinite(text) ? text : null;
        }
        const cleaned = String(text ?? '')
            .replace(/\s/g, '')
            .replace(',', '.');
        if (cleaned === '' || cleaned === '-') {
            return null;
        }
        const value = Number(cleaned);
        return Number.isFinite(value) ? value : null;
    }

    function parseAmount(text) {
        const value = parseDecimal(text);
        return value === null ? null : Math.round(value * 100);
    }

    const NO_BREAK_SPACE = String.fromCharCode(0xa0);

    function formatMoney(halere, currency) {
        const amount = numberFormat.format((halere || 0) / 100);
        const suffix = !currency || currency === 'CZK' ? 'Kč' : currency;
        return `${amount}${NO_BREAK_SPACE}${suffix}`;
    }

    function formatAmountInput(halere) {
        return numberFormat.format((halere || 0) / 100);
    }

    function formatQuantity(value) {
        return quantityFormat.format(value || 0);
    }

    function formatDate(isoDate) {
        if (!isoDate) {
            return '';
        }
        const [year, month, day] = isoDate.split('-').map(Number);
        return `${day}. ${month}. ${year}`;
    }

    function todayIso() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${now.getFullYear()}-${month}-${day}`;
    }

    function addDays(isoDate, days) {
        const [year, month, day] = isoDate.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
        return date.toISOString().slice(0, 10);
    }

    function lineBase(line) {
        return Math.round((line.quantity || 0) * (line.unitPrice || 0));
    }

    function vatBreakdown(lines, reverseCharge) {
        const groups = new Map();
        for (const line of lines) {
            const rate = Number(line.vatRate) || 0;
            const base = lineBase(line);
            groups.set(rate, (groups.get(rate) || 0) + base);
        }
        return [...groups.entries()]
            .sort((first, second) => second[0] - first[0])
            .map(([rate, base]) => ({
                rate,
                base,
                vat: reverseCharge ? 0 : Math.round(base * rate / 100),
            }));
    }

    function documentTotals(invoice) {
        const breakdown = vatBreakdown(invoice.lines || [], invoice.reverseCharge);
        const base = breakdown.reduce((sum, group) => sum + group.base, 0);
        const vat = breakdown.reduce((sum, group) => sum + group.vat, 0);
        const exact = base + vat;
        let rounding = 0;
        if (invoice.roundTotal) {
            rounding = Math.round(exact / 100) * 100 - exact;
        }
        return { breakdown, base, vat, exact, rounding, total: exact + rounding };
    }

    return {
        parseDecimal,
        parseAmount,
        formatMoney,
        formatAmountInput,
        formatQuantity,
        formatDate,
        todayIso,
        addDays,
        lineBase,
        vatBreakdown,
        documentTotals,
    };
})();
