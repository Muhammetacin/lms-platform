# ADR-117 — Cursusaanbod en zelfinschrijving

Status **Accepted for V2**

Een gepubliceerde cursus kan expliciet in de catalogus van de eigen organisatie worden opgenomen. De instelling is standaard uitgeschakeld. Actieve medewerkers kunnen een opgenomen cursus zelf starten. Unieke inschrijvingen per cursus en lidmaatschap en samengestelde foreign keys leggen de organisatiegrens in PostgreSQL vast.

Zelfinschrijving is een eigen relatie naast directe en teamtoewijzing. Alle drie geven toegang tot cursusinhoud, lesafronding en quizzen wanneer de cursus gepubliceerd en het lidmaatschap actief is. De rapporten combineren de drie bronnen en tellen een medewerker per cursus één keer. De catalogus vermeldt of de medewerker een cursus al kan openen.

Verbergen uit de catalogus sluit nieuwe inschrijvingen. Bestaande inschrijvingen en voortgang blijven bewaard. Een beheerder kan een cursus aan een medewerker of team toewijzen via de bestaande schermen. Een aparte functie voor uitschrijven valt buiten LMS-117.
