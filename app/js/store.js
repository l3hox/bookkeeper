var Store = (() => {
    const SCHEMA_VERSION = 1;
    const KEYS = {
        settings: 'mi:settings',
        contacts: 'mi:contacts',
        invoices: 'mi:invoices',
        meta: 'mi:meta',
    };

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

    function load(key, fallback) {
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

    function save(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function getSettings() {
        const stored = load(KEYS.settings, null);
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
        save(KEYS.settings, settings);
    }

    function getContacts() {
        return load(KEYS.contacts, []);
    }

    function saveContacts(contacts) {
        save(KEYS.contacts, contacts);
    }

    function getInvoices() {
        return load(KEYS.invoices, []);
    }

    function saveInvoices(invoices) {
        save(KEYS.invoices, invoices);
    }

    function getMeta() {
        return load(KEYS.meta, { schemaVersion: SCHEMA_VERSION, lastBackupAt: null });
    }

    function saveMeta(meta) {
        save(KEYS.meta, meta);
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
    };
})();
