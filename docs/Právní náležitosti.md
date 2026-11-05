# Právní náležitosti dokladů

Přehled zákonných požadavků na vystavované doklady a jak je aplikace pokrývá. Stav legislativy ověřen 5. 11. 2026; před spolehnutím na konkrétní paragraf ověřte aktuální znění na odkazech níže.

## Daňový doklad (plátce DPH)

Náležitosti daňového dokladu stanoví [§ 29 zákona č. 235/2004 Sb., o DPH][ZDPH-29]:

| Náležitost | V aplikaci |
| --- | --- |
| Označení a DIČ dodavatele | Nastavení, dodavatel; DIČ hlídáno validací před uložením |
| Označení a DIČ odběratele | Editor dokladu, sekce Odběratel |
| Evidenční číslo dokladu | Automatická souvislá řada `RRRRČČČČ`, kontrola duplicit a mezer |
| Rozsah a předmět plnění | Položky dokladu |
| Den vystavení | Pole Vystaveno, povinné |
| Den uskutečnění plnění (DUZP) | Pole DUZP, povinné pro daňové doklady |
| Jednotková cena bez daně | Sloupec Cena za MJ |
| Základ daně, sazba daně, výše daně | Rekapitulace DPH po sazbách na dokladu |
| „Daň odvede zákazník" u přenesené povinnosti | Checkbox Přenesená daňová povinnost, text se tiskne automaticky |

Sazby DPH od 1. 1. 2024: základní 21 %, snížená 12 % (konsolidační balíček, [zákon č. 349/2023 Sb.][KONSOLIDACE]).

Daňový doklad se vystavuje do 15 dnů ode dne, kdy vznikla povinnost přiznat daň ([§ 28 ZDPH][ZDPH-28]). Toto hlídá uživatel, aplikace lhůtu nevynucuje.

Výše daně se uvádí v české měně ([§ 29 odst. 1 ZDPH][ZDPH-29]). U dokladu v cizí měně aplikace zobrazí upozornění; přepočet kurzem ČNB je na uživateli.

## Opravný daňový doklad

Náležitosti podle [§ 45 ZDPH][ZDPH-45]: odkaz na evidenční číslo původního dokladu, důvod opravy a rozdílové částky. Aplikace při vystavení opravného dokladu z faktury předvyplní číslo a datum původního dokladu, obrátí znaménka částek a vyžaduje vyplnění důvodu opravy.

## Zálohová faktura

Zálohová faktura není daňovým dokladem; aplikace ji tak označuje a netiskne na ni DUZP. Po přijetí úplaty vzniká plátci povinnost vystavit daňový doklad; akce „Vystavit fakturu" na uhrazené záloze předvyplní DUZP datem přijetí platby.

## Neplátce DPH

Faktura neplátce není daňovým dokladem. Povinné údaje stanoví občanský zákoník pro obchodní listiny ([§ 435 OZ][OZ-435]): jméno a sídlo podnikatele, identifikační číslo, a údaj o zápisu do rejstříku. Podnikatel zapsaný v obchodním rejstříku uvede údaj o zápisu včetně oddílu a vložky; podnikatel nezapsaný ve veřejném rejstříku, který je zapsán v jiné evidenci, uvede údaj o svém zápisu do této evidence. Pro OSVČ zapsanou v živnostenském rejstříku jde tedy o povinný údaj, například „Fyzická osoba zapsaná v živnostenském rejstříku“ ([OZ-435-TEXT], [EPRAVO-LISTINY]). Zákon nepředepisuje uvést evidující živnostenský úřad; uvést ho lze, povinnost jsme v primárním textu nenašli.

Aplikace v režimu neplátce skryje sloupce DPH, netiskne DUZP a doplní text „Dodavatel není plátcem DPH.“ Uložení dokladu odmítne, pokud v Nastavení chybí jméno, sídlo, IČO nebo údaj o zápisu.

Náležitosti účetního dokladu ([§ 11 zákona o účetnictví][ZOU-11]) se týkají účetních jednotek. OSVČ, která vede daňovou evidenci a nikoli účetnictví, je na vystavené faktuře povinně neuvádí ([POHODA-DOKLAD]). Uvádějí se běžně (označení dokladu, popis plnění, částka, datum vystavení) a aplikace je tiskne vždy.

### Hranice pro registraci k DPH

Od 1. 1. 2025 se obrat sleduje za kalendářní rok. Po překročení 2 000 000 Kč se osoba stává plátcem od 1. ledna následujícího roku a přihlášku k registraci podává do 10 pracovních dnů od překročení; po překročení 2 536 500 Kč se stává plátcem hned následujícím dnem ([FS-PLATCOVSTVI], [BUSINESSINFO-DPH-2026]). Aplikace na přehledu upozorní, když obrat v CZK za kalendářní rok překročí 90 % první hranice; doklady v cizí měně do součtu nezapočítá.

### Elektronická fakturace

Pro tuzemský styk mezi podnikateli není elektronická faktura v ČR k 5. 11. 2026 povinná; povinně elektronické faktury přijímají jen veřejné instituce ([FAKTUROID-DIGI], neověřeno v primárním zdroji). Směrnice EU 2025/516 (ViDA) zavádí povinnou elektronickou fakturaci pro přeshraniční plnění mezi podnikateli od 1. 7. 2030 ([TRIS-VIDA]). Český návrh na povinnou tuzemskou e-fakturaci jsme nenašli; Slovensko ji zavádí pro plátce od 1. 1. 2027.

## Uchovávání dokladů

Plátce uchovává daňové doklady 10 let od konce zdaňovacího období, ve kterém se plnění uskutečnilo ([§ 35 ZDPH][ZDPH-35]). Neplátce vede doklady k daňové evidenci po dobu, kdy lze daň stanovit (daňový řád); pro jistotu doporučujeme také 10 let (délka lhůty pro neplátce neověřena v primárním textu). Aplikace spuštěná přes `make run` drží každý doklad jako JSON soubor v datové složce a vytištěné PDF patří do její podsložky `pdf/`; datovou složku zálohujte (Time Machine, kopie mimo počítač).

Vystavené doklady se nemažou; číselná řada má zůstat souvislá. Aplikace před smazáním dokladu varuje a v Nastavení hlásí mezery v řadách. Chybný doklad se řeší opravným daňovým dokladem, ne smazáním.

## QR platba

QR kód na dokladu používá standard Short Payment Descriptor České bankovní asociace ([QR platba][SPAYD]): IBAN, částka, měna, variabilní symbol, datum splatnosti a zpráva pro příjemce bez diakritiky.

[ZDPH-29]: https://www.zakonyprolidi.cz/cs/2004-235#p29 "Zákon č. 235/2004 Sb., § 29, náležitosti daňového dokladu"
[ZDPH-28]: https://www.zakonyprolidi.cz/cs/2004-235#p28 "Zákon č. 235/2004 Sb., § 28, vystavování daňových dokladů"
[ZDPH-45]: https://www.zakonyprolidi.cz/cs/2004-235#p45 "Zákon č. 235/2004 Sb., § 45, opravný daňový doklad"
[ZDPH-35]: https://www.zakonyprolidi.cz/cs/2004-235#p35 "Zákon č. 235/2004 Sb., § 35, uchovávání daňových dokladů"
[ZOU-11]: https://www.zakonyprolidi.cz/cs/1991-563#p11 "Zákon č. 563/1991 Sb., § 11, účetní doklad"
[OZ-435]: https://www.zakonyprolidi.cz/cs/2012-89#p435 "Zákon č. 89/2012 Sb., § 435, obchodní listiny"
[KONSOLIDACE]: https://www.zakonyprolidi.cz/cs/2023-349 "Zákon č. 349/2023 Sb., konsolidační balíček"
[SPAYD]: https://qr-platba.cz/pro-vyvojare/ "QR platba, standard Short Payment Descriptor"
[OZ-435-TEXT]: https://www.podnikatel.cz/zakony/novy-obcansky-zakonik/zneni-20230106/f4580257/ "Občanský zákoník, díl 5 Podnikatel, znění od 6. 1. 2023 (podnikatel.cz)"
[EPRAVO-LISTINY]: https://epravo.cz/top/clanky/povinna-identifikace-podnikatele-na-obchodnich-listinach-51933.html "epravo.cz, Povinná identifikace podnikatele na obchodních listinách"
[POHODA-DOKLAD]: https://portal.pohoda.cz/dane-ucetnictvi-mzdy/dph/faktura-nebo-danovy-doklad/ "Pohoda, Faktura nebo daňový doklad"
[FS-PLATCOVSTVI]: https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/11977_25_Informace_ke_zmenam_v_platcovstv2025.pdf "Finanční správa, Informace ke změnám v plátcovství od 1. 1. 2025"
[BUSINESSINFO-DPH-2026]: https://www.businessinfo.cz/clanky/pozor-na-zmeny-v-dph-nektere-plati-od-1-ledna-2026-co-museji-podnikatele-udelat/ "BusinessInfo, změny v DPH od 1. ledna 2026"
[FAKTUROID-DIGI]: https://www.fakturoid.cz/almanach/zacatky-podnikani/povinna-digitalizace-faktur "Fakturoid, Povinná digitalizace faktur"
[TRIS-VIDA]: https://technical-regulation-information-system.ec.europa.eu/cs/notification/27201/print "TRIS, oznámení odkazující na směrnici 2025/516"
