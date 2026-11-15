import { z } from 'zod';

// Standardmeldungen auf Deutsch, wo ein Schema keine eigene Meldung hat (z. B. „Ungültiger String …“ statt „Invalid string …“).
z.config(z.locales.de());
