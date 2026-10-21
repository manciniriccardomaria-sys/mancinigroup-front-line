import { analyzeRegistryRows, type RegistryAnalysis, type RegistrySourceRow } from './customerRegistryModel';
import { getItalyDate } from './lib/utils';

const normalizeHeader = (value: string) => value.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const HEADERS = {
  fiscalCode: ['Cod.Fiscale / P.IVA', 'Codice fiscale', 'CF', 'CF / P.IVA'],
  clientName: ['Contraente', 'Nominativo', 'Cliente', 'Cognome e nome'],
  firstName: ['Nome'], lastName: ['Cognome'], birthDate: ['Nascita', 'Data di nascita'],
  sourceCode: ['Fonte'], clientStatus: ['St. Cl', 'Stato cliente'],
};

export async function parseCustomerRegistryWorkbook(file: File): Promise<RegistryAnalysis> {
  const ExcelJS = await import('exceljs');
  const Workbook = ExcelJS.Workbook || ExcelJS.default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer() as never);
  for (const sheet of workbook.worksheets) {
    for (let headerRow = 1; headerRow <= Math.min(sheet.rowCount, 10); headerRow += 1) {
      const columns: Partial<Record<keyof typeof HEADERS, number>> = {};
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const header = normalizeHeader(sheet.getCell(headerRow, column).text);
        for (const [field, aliases] of Object.entries(HEADERS)) {
          if (aliases.some(alias => normalizeHeader(alias) === header)) {
            if (columns[field]) throw new Error(`Colonna duplicata: ${aliases[0]}. Verifica il file prima di caricarlo.`);
            columns[field] = column;
          }
        }
      }
      if (!columns.fiscalCode || !columns.birthDate || (!columns.clientName && !(columns.firstName && columns.lastName))) continue;
      const rows: RegistrySourceRow[] = [];
      for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
        const text = (field: keyof typeof HEADERS) => columns[field] ? sheet.getCell(row, columns[field]!).text.trim() : '';
        const raw = (field: keyof typeof HEADERS) => {
          if (!columns[field]) return '';
          const value = sheet.getCell(row, columns[field]!).value;
          return value && typeof value === 'object' && 'result' in value ? value.result : value instanceof Date || typeof value !== 'object' ? value : text(field);
        };
        const firstName = text('firstName'); const lastName = text('lastName');
        const clientName = text('clientName') || `${lastName} ${firstName}`.trim();
        if (!clientName && !text('fiscalCode') && !text('birthDate')) continue;
        rows.push({ row, fiscalCode: raw('fiscalCode'), clientName, firstName, lastName, birthDate: raw('birthDate'), sourceCode: text('sourceCode'), clientStatus: text('clientStatus') });
      }
      const analysis = analyzeRegistryRows(rows, getItalyDate(), file.name, sheet.name);
      if (!analysis.records.length) throw new Error('Il file non contiene anagrafiche con un CF o una P.IVA utilizzabile.');
      return analysis;
    }
  }
  throw new Error('File non riconosciuto. Servono le colonne Cod.Fiscale / P.IVA, Contraente (oppure Nome e Cognome) e Nascita.');
}
