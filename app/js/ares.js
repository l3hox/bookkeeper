var Ares = (() => {
    const ENDPOINT = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
    const ICO_WEIGHTS = [8, 7, 6, 5, 4, 3, 2];

    function normalizeIco(text) {
        const digits = String(text || '').replace(/\D/g, '');
        if (digits.length === 0 || digits.length > 8) {
            return null;
        }
        return digits.padStart(8, '0');
    }

    function validateIco(text) {
        const ico = normalizeIco(text);
        if (!ico) {
            return false;
        }
        const weightedSum = ICO_WEIGHTS.reduce(
            (sum, weight, index) => sum + weight * Number(ico[index]),
            0,
        );
        const remainder = weightedSum % 11;
        const checkDigit = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
        return checkDigit === Number(ico[7]);
    }

    function buildStreet(seat) {
        const houseNumber = [seat.cisloDomovni, seat.cisloOrientacni]
            .filter(part => part !== undefined && part !== null)
            .join('/');
        const streetName = seat.nazevUlice || seat.nazevCastiObce || seat.nazevObce || '';
        return [streetName, houseNumber].filter(Boolean).join(' ');
    }

    async function lookup(icoText) {
        const ico = normalizeIco(icoText);
        if (!ico) {
            throw new Error('IČO musí být číslo o délce do 8 číslic.');
        }
        let response;
        try {
            response = await fetch(`${ENDPOINT}/${ico}`);
        } catch (error) {
            throw new Error('ARES není dostupný. Zkontrolujte připojení k internetu.');
        }
        if (response.status === 404) {
            throw new Error(`Subjekt s IČO ${ico} nebyl v ARES nalezen.`);
        }
        if (!response.ok) {
            throw new Error(`ARES vrátil chybu ${response.status}.`);
        }
        const data = await response.json();
        const seat = data.sidlo || {};
        return {
            ico: data.ico || ico,
            name: data.obchodniJmeno || '',
            dic: data.dic || data.dicSkDph || '',
            street: buildStreet(seat),
            city: seat.nazevObce || '',
            zip: seat.psc ? String(seat.psc).padStart(5, '0') : '',
            country: seat.nazevStatu || 'Česká republika',
        };
    }

    return {
        normalizeIco,
        validateIco,
        lookup,
    };
})();
