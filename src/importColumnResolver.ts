export type ImportColumnMapping = {
  field: string;
  label: string;
  expectedHeader: string;
  detectedHeader: string;
  column: string;
  method: 'header' | 'legacy';
  required: boolean;
};

export type ImportColumnResolution<T extends string> = {
  columns: Record<T, string>;
  mappings: ImportColumnMapping[];
  missingRequiredHeaders: string[];
  mode: 'header' | 'legacy';
  warnings: string[];
};

export type ImportColumnDefinition<T extends string> = {
  field: T;
  label: string;
  header: string;
  required?: boolean;
};

type WorksheetHeaderReader = {
  columnCount?: number;
  actualColumnCount?: number;
  getCell(row: number, column: number): {
    text: string;
  };
};

export const NEW_CLIENT_HEADER_COLUMNS = [
  { field: 'fullName', label: 'Nome e cognome', header: 'Contraente', required: true },
  { field: 'source', label: 'Fonte', header: 'Fonte', required: true },
  { field: 'relationshipStartDate', label: 'Inizio rapporto', header: 'Iniz. Rapp.', required: true },
  { field: 'birthDate', label: 'Data di nascita', header: 'Nascita', required: true },
  { field: 'phone', label: 'Cellulare', header: 'Cellulare', required: true },
  { field: 'coverages', label: 'Coperture cliente', header: 'Cop. Cl', required: true },
] as const satisfies readonly ImportColumnDefinition<string>[];

export const CUSTOMER_CLUSTER_HEADER_COLUMNS = [
  { field: 'clientName', label: 'Cliente', header: 'Contraente', required: true },
  { field: 'source', label: 'Fonte', header: 'Fonte', required: true },
  { field: 'quietanzaDate', label: 'Prossima quietanza', header: 'Dt. Prox Scad Quiet', required: true },
  { field: 'birthDate', label: 'Data di nascita', header: 'Nascita', required: true },
  { field: 'address', label: 'Indirizzo', header: 'Indirizzo', required: true },
  { field: 'phone', label: 'Cellulare', header: 'Cellulare', required: true },
  { field: 'customerTenure', label: 'Anzianità cliente', header: 'Anz. Cl', required: true },
  { field: 'policyCount', label: 'Numero polizze', header: 'N. Pol. Tot. Cl', required: true },
  { field: 'annualPremium', label: 'Premi annuali', header: 'Premi Annui Cl', required: true },
  { field: 'agencyCommissions', label: 'Provvigioni', header: 'Prv Tot. Cl', required: true },
] as const satisfies readonly ImportColumnDefinition<string>[];

export const WIDE_EXPIRATION_HEADER_COLUMNS = [
  { field: 'fullName', label: 'Nome e cognome', header: 'Contraente', required: true },
  { field: 'source', label: 'Fonte', header: 'Fonte', required: true },
  { field: 'fiscalCode', label: 'Codice fiscale / P.IVA', header: 'Cod.Fiscale / P.IVA', required: true },
  { field: 'nextExpirationDate', label: 'Prossima scadenza', header: 'Dt. Prox Scad Cl', required: true },
  { field: 'phone', label: 'Cellulare', header: 'Cellulare', required: true },
  { field: 'autoPremium', label: 'Premio auto annuale', header: 'Pr. Ann. Auto Cl', required: true },
] as const satisfies readonly ImportColumnDefinition<string>[];

export function resolveExactHeaderColumns<T extends string>(
  worksheet: WorksheetHeaderReader,
  definitions: readonly ImportColumnDefinition<T>[],
): ImportColumnResolution<T> {
  const headersByName = getHeadersByName(worksheet);
  const columns = {} as Record<T, string>;
  const mappings = definitions.map(definition => {
    const matches = headersByName.get(normalizeHeader(definition.header)) || [];
    const match = matches[0];
    const column = match?.column || '';
    columns[definition.field] = column;

    return {
      field: definition.field,
      label: definition.label,
      expectedHeader: definition.header,
      detectedHeader: match?.header || '',
      column,
      method: 'header' as const,
      required: definition.required !== false,
    };
  });
  const missingRequiredHeaders = mappings
    .filter(mapping => mapping.required && !mapping.column)
    .map(mapping => mapping.expectedHeader);

  return {
    columns,
    mappings,
    missingRequiredHeaders,
    mode: 'header',
    warnings: missingRequiredHeaders.length > 0
      ? [`Intestazioni mancanti: ${missingRequiredHeaders.join(', ')}.`]
      : [],
  };
}

export function describeLegacyColumns<T extends string>(
  worksheet: WorksheetHeaderReader,
  columns: Record<T, string>,
  labels: Record<T, string>,
): ImportColumnResolution<T> {
  const mappedColumns = { ...columns };
  const mappings = (Object.keys(columns) as T[]).map(field => {
    const column = columns[field];
    return {
      field,
      label: labels[field],
      expectedHeader: '',
      detectedHeader: column ? worksheet.getCell(1, columnToNumber(column)).text.trim() : '',
      column,
      method: 'legacy' as const,
      required: Boolean(column),
    };
  });

  return {
    columns: mappedColumns,
    mappings,
    missingRequiredHeaders: [],
    mode: 'legacy',
    warnings: [
      'Questo formato usa ancora le posizioni storiche: controlla le intestazioni mostrate prima di confermare.',
    ],
  };
}

export function getExactHeaderMatchCount<T extends string>(
  worksheet: WorksheetHeaderReader,
  definitions: readonly ImportColumnDefinition<T>[],
): number {
  return resolveExactHeaderColumns(worksheet, definitions).mappings
    .filter(mapping => Boolean(mapping.column)).length;
}

function getHeadersByName(
  worksheet: WorksheetHeaderReader,
): Map<string, Array<{ column: string; header: string }>> {
  const headers = new Map<string, Array<{ column: string; header: string }>>();
  const columnCount = Math.max(
    worksheet.actualColumnCount || 0,
    worksheet.columnCount || 0,
    1,
  );

  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const header = worksheet.getCell(1, columnNumber).text.trim();
    if (!header) continue;

    const normalized = normalizeHeader(header);
    const matches = headers.get(normalized) || [];
    matches.push({ column: numberToColumn(columnNumber), header });
    headers.set(normalized, matches);
  }

  return headers;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function numberToColumn(columnNumber: number): string {
  let value = columnNumber;
  let column = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }

  return column;
}

function columnToNumber(column: string): number {
  return [...column].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}
