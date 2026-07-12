# Právní náležitosti dokladů

Přehled zákonných požadavků na vystavované doklady a jak je aplikace pokrývá. Stav legislativy k červenci 2026; před spolehnutím na konkrétní paragraf ověřte aktuální znění na odkazech níže.

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

Faktura neplátce není daňovým dokladem. Musí splnit náležitosti účetního dokladu ([§ 11 zákona č. 563/1991 Sb., o účetnictví][ZOU-11]) a obchodní listiny ([§ 435 zákona č. 89/2012 Sb., občanský zákoník][OZ-435]): jméno, sídlo, IČO a údaj o zápisu v obchodním rejstříku nebo jiné evidenci. V režimu neplátce aplikace skryje sloupce DPH a doplní text „Dodavatel není plátcem DPH."

Údaj o zápisu (například „Fyzická osoba zapsaná v živnostenském rejstříku" nebo spisová značka) se vyplňuje v Nastavení a tiskne se na každém dokladu.

## Uchovávání dokladů

Daňové doklady se uchovávají 10 let od konce zdaňovacího období, ve kterém se plnění uskutečnilo ([§ 35 ZDPH][ZDPH-35]). Doporučený postup s touto aplikací: pravidelně stahovat JSON zálohu a u vystavených faktur ukládat i PDF kopii.

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
