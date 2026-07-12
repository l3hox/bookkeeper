var Html = (() => {
    const REPLACEMENTS = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => REPLACEMENTS[char]);
    }

    function escMultiline(value) {
        return esc(value).replace(/\n/g, '<br>');
    }

    return { esc, escMultiline };
})();
