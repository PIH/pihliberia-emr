// Takes the specs shared from pihemr (@pih/pihemr-e2e) into this repo's run. A spec added there runs here without a change.
// To leave some out: includeSpecs({ except: ['<spec name>'] }); to run only some: includeSpecs({ only: ['<spec name>'] }).
import { includeSpecs } from '@pih/pihemr-e2e/src/include-specs';

includeSpecs();
