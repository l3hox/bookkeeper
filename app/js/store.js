var Store = (() => {
    const SCHEMA_VERSION = 1;
    const API_HEADER = 'X-Invoices-Api';
    const servedOverHttp = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    const diskState = servedOverHttp ? loadDiskState() : null;

    function defaultSettings() {
        return {
            supplier: {
                name: '',
                street: '',
                city: '',
                zip: '',
                country: 'Česká republika',
                ico: '',
                dic: '',
                registration: '',
                email: '',
                phone: '',
                web: '',
            },
            vatPayer: false,
            bank: {
                account: '',
                iban: '',
                swift: '',
            },
            invoicing: {
                dueDays: 14,
                currency: 'CZK',
                roundTotal: false,
                defaultVatRate: 21,
                footNote: '',
            },
        };
    }

    function apiRequest(method, endpoint, body) {
        const request = new XMLHttpRequest();
        request.open(method, endpoint, false);
        request.setRequestHeader(API_HEADER, '1');
        if (body !== undefined) {
            request.setRequestHeader('Content-Type', 'application/json');
        }
        request.send(body === undefined ? null : JSON.stringify(body));
        return request;
    }

    function loadDiskState() {
        let request;
        try {
            request = apiRequest('GET', 'api/state');
        } catch (error) {
            request = { status: 0, responseText: String(error) };
        }
        if (request.status !== 200) {
            const message = 'Datový server neodpovídá, data nelze načíst z disku. Spusťte aplikaci příkazem „make run“ a otevřete adresu, kterou vypíše.';
            alert(message);
            throw new Error(`${message} (${request.status} ${request.responseText})`);
        }
        return JSON.parse(request.responseText);
    }

    function load(name, fallback) {
        if (diskState) {
            const stored = diskState[name];
            return stored === null || stored === undefined ? fallback : JSON.parse(JSON.stringify(stored));
        }
        const key = `mi:${name}`;
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.error(`Poškozená data v klíči ${key}, zálohuji je stranou:`, error);
            localStorage.setItem(`${key}:corrupt:${Finance.todayIso()}`, raw);
            return fallback;
        }
    }

    function save(name, value) {
        if (!diskState) {
            localStorage.setItem(`mi:${name}`, JSON.stringify(value));
            return;
        }
        const request = apiRequest('PUT', `api/${name}`, value);
        if (request.status !== 200) {
            const message = `Uložení na disk selhalo (${name}): ${request.status} ${request.responseText}`;
            alert(message);
            throw new Error(message);
        }
        diskState[name] = JSON.parse(JSON.stringify(value));
    }

    function storageLabel() {
        return diskState ? `Data na disku: ${diskState.dataDir}` : 'Data jen v tomto prohlížeči. Pro uložení na disk spusťte „make run“.';
    }

    function dataDir() {
        return diskState ? diskState.dataDir : null;
    }

    function getSettings() {
        const stored = load('settings', null);
        if (!stored) {
            return defaultSettings();
        }
        const defaults = defaultSettings();
        return {
            ...defaults,
            ...stored,
            supplier: { ...defaults.supplier, ...stored.supplier },
            bank: { ...defaults.bank, ...stored.bank },
            invoicing: { ...defaults.invoicing, ...stored.invoicing },
        };
    }

    function saveSettings(settings) {
        save('settings', settings);
    }

    function getContacts() {
        return load('contacts', []);
    }

    function saveContacts(contacts) {
        save('contacts', contacts);
    }

    function getInvoices() {
        return load('invoices', []);
    }

    function saveInvoices(invoices) {
        save('invoices', invoices);
    }

    function getMeta() {
        return load('meta', { schemaVersion: SCHEMA_VERSION, lastBackupAt: null });
    }

    function saveMeta(meta) {
        save('meta', meta);
    }

    const BACKUP_APPLICATIONS = ['forge-invoices', 'my-invoices'];

    function exportBackup() {
        return {
            application: 'forge-invoices',
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            settings: getSettings(),
            contacts: getContacts(),
            invoices: getInvoices(),
        };
    }

    function importBackup(data) {
        if (!data || !BACKUP_APPLICATIONS.includes(data.application)) {
            throw new Error('Soubor není zálohou této aplikace.');
        }
        if (data.schemaVersion > SCHEMA_VERSION) {
            throw new Error('Záloha pochází z novější verze aplikace.');
        }
        if (!Array.isArray(data.contacts) || !Array.isArray(data.invoices) || typeof data.settings !== 'object') {
            throw new Error('Záloha má neplatnou strukturu.');
        }
        saveSettings(data.settings);
        saveContacts(data.contacts);
        saveInvoices(data.invoices);
    }

    function markBackupDone() {
        const meta = getMeta();
        meta.lastBackupAt = new Date().toISOString();
        saveMeta(meta);
    }

    return {
        SCHEMA_VERSION,
        defaultSettings,
        getSettings,
        saveSettings,
        getContacts,
        saveContacts,
        getInvoices,
        saveInvoices,
        getMeta,
        markBackupDone,
        exportBackup,
        importBackup,
        storageLabel,
        dataDir,
    };
})();
