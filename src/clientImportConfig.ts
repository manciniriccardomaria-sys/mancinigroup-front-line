export const CLIENT_IMPORT_CONFIG = {
  weekendRule: 'next_monday',

  newClients: {
    fileName: '01_Nuovi_Clienti.xlsx',
    sheetName: 'NuoviClienti',
    columns: {
      fullName: 'A',
      source: 'G',
      relationshipStartDate: 'I',
      birthDate: 'R',
      phone: 'Z',
      coverages: 'BC',
    },
    identityFields: ['fullName', 'birthDate', 'source'],
    scheduleRule: {
      type: 'relationship_start_plus_campaign_months',
      dateColumn: 'I',
    },
  },

  expirations: {
    fileName: '02_Scadenze_Clienti.xlsx',
    sheetName: 'Scadenze',
    columns: {
      fullName: 'C',
      policyNumber: 'D',
      source: 'E',
      policyType: 'H',
      expirationType: 'K',
      baseDate: 'N',
      vehiclePlate: 'U',
      phone: 'AW',
    },
    identityFields: ['policyNumber'],
    scheduleRule: {
      type: 'base_date_plus_months_minus_reminder_days',
      reminderDays: 10,
      expirationTypes: {
        R: { label: 'Rata', monthsToAdd: 6 },
        A: { label: 'Annuale', monthsToAdd: 12 },
      },
    },
  },

  winback: {
    fileName: '03_Winback_Clienti.xlsx',
    sheetName: 'Winback',
    columns: {
      fullName: 'C',
      policyNumber: 'D',
      source: 'E',
      lastGrossPremium: 'I',
      exitDate: 'N',
      vehiclePlate: 'R',
      phone: 'AW',
    },
    identityFields: ['policyNumber'],
    scheduleRule: {
      type: 'next_exit_anniversary_minus_reminder_days',
      reminderDays: 10,
    },
  },
} as const;

