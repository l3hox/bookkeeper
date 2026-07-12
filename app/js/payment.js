var Payment = (() => {
    const ACCOUNT_PATTERN = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/;
    const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

    function parseAccount(text) {
        const match = String(text || '').trim().match(ACCOUNT_PATTERN);
        if (!match) {
            return null;
        }
        return {
            prefix: match[1] || '',
            number: match[2],
            bankCode: match[3],
        };
    }

    function mod97(numericString) {
        let remainder = 0;
        for (const digit of numericString) {
            remainder = (remainder * 10 + Number(digit)) % 97;
        }
        return remainder;
    }

    function accountToIban(text) {
        const account = parseAccount(text);
        if (!account) {
            return null;
        }
        const bban = account.bankCode
            + account.prefix.padStart(6, '0')
            + account.number.padStart(10, '0');
        const checkDigits = String(98 - mod97(bban + '123500')).padStart(2, '0');
        return `CZ${checkDigits}${bban}`;
    }

    function formatIban(iban) {
        return String(iban || '').replace(/(.{4})/g, '$1 ').trim();
    }

    function stripDiacritics(text) {
        return String(text || '').normalize('NFD').replace(COMBINING_MARKS, '');
    }

    function spayd({ iban, amount, currency, variableSymbol, message, dueDate }) {
        const parts = ['SPD*1.0', `ACC:${String(iban).replace(/\s/g, '')}`];
        if (amount) {
            parts.push(`AM:${(amount / 100).toFixed(2)}`);
        }
        parts.push(`CC:${currency || 'CZK'}`);
        if (variableSymbol) {
            parts.push(`X-VS:${String(variableSymbol).replace(/\D/g, '').slice(0, 10)}`);
        }
        if (dueDate) {
            parts.push(`DT:${dueDate.replace(/-/g, '')}`);
        }
        if (message) {
            const cleaned = stripDiacritics(message).replace(/[*]/g, ' ').trim().slice(0, 60);
            if (cleaned) {
                parts.push(`MSG:${cleaned}`);
            }
        }
        return parts.join('*');
    }

    function spaydQrSvg(spaydString) {
        const generator = qrcode(0, 'M');
        generator.addData(spaydString);
        generator.make();
        return generator.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    }

    return {
        parseAccount,
        accountToIban,
        formatIban,
        spayd,
        spaydQrSvg,
    };
})();
