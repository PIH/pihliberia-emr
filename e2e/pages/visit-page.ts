// The visit page, where a form sends the browser after a successful save (see EntryFormPage and SectionFormPage).
export const VISIT_PAGE_URL = /pihcore\/visit\/visit\.page/;

// The returnUrl of a form opened in the given visit.
export const visitPagePath = (visitUuid: string): string => `/openmrs/pihcore/visit/visit.page?visit=${visitUuid}`;
