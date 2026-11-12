import { z } from 'zod';

// Muss vor allen Schemas geladen werden: Die Content-Security-Policy verbietet eval;
// ohne diese Einstellung probiert Zod es aus und löst eine Browser-Warnung aus.
z.config({ jitless: true });
