// Data layer for donations, contact messages, and newsletter subscribers.
//
// Two backends, picked automatically at startup:
//  - Google Sheets, when SHEETS_SPREADSHEET_ID and service account credentials
//    are configured. One spreadsheet, one tab per collection, one row per record.
//  - JSON files under data/, used for local development.
//
// All methods are async. Records keep the same shape in both backends, so the
// rest of the app (and the admin views) never care which one is active.

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');

// Column order doubles as the header row in each sheet tab. New fields must be
// appended at the end so existing spreadsheets keep working.
const COLLECTIONS = {
  donations: {
    sheet: 'Donations',
    headers: [
      'id', 'status', 'amount', 'currency', 'program', 'provider',
      'donorName', 'donorEmail', 'donatedAt', 'paidAt', 'updatedAt',
      'providerReference', 'providerTransactionId', 'providerStatus',
      'providerResponse', 'checkoutUrl'
    ]
  },
  messages: {
    sheet: 'Messages',
    headers: ['id', 'name', 'email', 'phone', 'message', 'submittedAt']
  },
  newsletter: {
    sheet: 'Newsletter',
    headers: ['id', 'email', 'subscribedAt']
  }
};

const NUMERIC_FIELDS = new Set(['amount']);

const columnLetter = (count) => {
  // Enough for our widest tab; extend if a collection ever exceeds 26 columns.
  return String.fromCharCode('A'.charCodeAt(0) + count - 1);
};

const recordToRow = (headers, record) => headers.map((field) => {
  const value = record[field];
  if (value === null || value === undefined) return '';
  return String(value);
});

const rowToRecord = (headers, row) => {
  const record = {};
  headers.forEach((field, i) => {
    const cell = row[i] === undefined ? '' : row[i];
    if (cell === '') {
      record[field] = null;
    } else if (NUMERIC_FIELDS.has(field)) {
      record[field] = Number(cell);
    } else {
      record[field] = cell;
    }
  });
  return record;
};

// --- Google Sheets backend ---

const loadServiceAccountCredentials = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  const attempts = [raw, () => Buffer.from(raw, 'base64').toString('utf8')];
  for (const attempt of attempts) {
    try {
      const text = typeof attempt === 'function' ? attempt() : attempt;
      const parsed = JSON.parse(text);
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch (err) {
      // Try the next decoding.
    }
  }

  console.error('GOOGLE_SERVICE_ACCOUNT_JSON is set but could not be parsed (raw or base64 JSON expected).');
  return null;
};

const createSheetsStore = () => {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) return null;

  const credentials = loadServiceAccountCredentials();
  if (!credentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;

  let google;
  try {
    ({ google } = require('googleapis'));
  } catch (err) {
    console.error('googleapis is not installed; run npm install.');
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: credentials || undefined,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetIds = {};

  // Create any missing tabs and write header rows. Runs once, lazily, so a
  // brand-new empty spreadsheet works out of the box.
  let readyPromise = null;
  const ensureReady = () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const existing = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

        const missing = Object.values(COLLECTIONS).filter((c) => !existing.has(c.sheet));
        if (missing.length > 0) {
          const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: missing.map((c) => ({ addSheet: { properties: { title: c.sheet } } }))
            }
          });
          response.data.replies.forEach((reply) => {
            existing.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
          });
        }

        for (const collection of Object.values(COLLECTIONS)) {
          sheetIds[collection.sheet] = existing.get(collection.sheet);

          const headerRange = `${collection.sheet}!A1:${columnLetter(collection.headers.length)}1`;
          const current = await sheets.spreadsheets.values.get({ spreadsheetId, range: headerRange });
          const firstRow = (current.data.values && current.data.values[0]) || [];
          if (firstRow.length === 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: headerRange,
              valueInputOption: 'RAW',
              requestBody: { values: [collection.headers] }
            });
          }
        }
      })().catch((err) => {
        readyPromise = null; // allow a retry on the next call
        throw err;
      });
    }
    return readyPromise;
  };

  const fetchRows = async (collection) => {
    const { sheet, headers } = COLLECTIONS[collection];
    const range = `${sheet}!A2:${columnLetter(headers.length)}`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values || [];
  };

  return {
    name: 'google-sheets',

    async list(collection) {
      await ensureReady();
      const { headers } = COLLECTIONS[collection];
      const rows = await fetchRows(collection);
      return rows.filter((row) => row.some((cell) => cell !== '')).map((row) => rowToRecord(headers, row));
    },

    async append(collection, record) {
      await ensureReady();
      const { sheet, headers } = COLLECTIONS[collection];
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheet}!A1:${columnLetter(headers.length)}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [recordToRow(headers, record)] }
      });
      return true;
    },

    async update(collection, match, updates) {
      await ensureReady();
      const { sheet, headers } = COLLECTIONS[collection];
      const rows = await fetchRows(collection);
      const index = rows.findIndex((row) => match(rowToRecord(headers, row)));
      if (index === -1) return null;

      const updated = { ...rowToRecord(headers, rows[index]), ...updates };
      const rowNumber = index + 2; // 1-based, after the header row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheet}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [recordToRow(headers, updated)] }
      });
      return updated;
    },

    async remove(collection, id) {
      await ensureReady();
      const { sheet, headers } = COLLECTIONS[collection];
      const rows = await fetchRows(collection);
      const index = rows.findIndex((row) => rowToRecord(headers, row).id === id);
      if (index === -1) return false;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetIds[sheet],
                dimension: 'ROWS',
                startIndex: index + 1, // 0-based, +1 skips the header row
                endIndex: index + 2
              }
            }
          }]
        }
      });
      return true;
    }
  };
};

// --- JSON file backend (local development) ---

const createJsonStore = () => {
  const fileFor = (collection) => path.join(DATA_DIR, `${collection}.json`);

  const readAll = (collection) => {
    const filePath = fileFor(collection);
    try {
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(filePath, '[]');
        return [];
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err);
      return [];
    }
  };

  const writeAll = (collection, records) => {
    try {
      fs.writeFileSync(fileFor(collection), JSON.stringify(records, null, 2));
      return true;
    } catch (err) {
      console.error(`Error writing ${fileFor(collection)}:`, err);
      return false;
    }
  };

  return {
    name: 'json-files',

    async list(collection) {
      return readAll(collection);
    },

    async append(collection, record) {
      const records = readAll(collection);
      records.push(record);
      return writeAll(collection, records);
    },

    async update(collection, match, updates) {
      const records = readAll(collection);
      const index = records.findIndex(match);
      if (index === -1) return null;
      records[index] = { ...records[index], ...updates };
      return writeAll(collection, records) ? records[index] : null;
    },

    async remove(collection, id) {
      const records = readAll(collection);
      const remaining = records.filter((record) => record.id !== id);
      if (remaining.length === records.length) return false;
      return writeAll(collection, remaining);
    }
  };
};

const store = createSheetsStore() || createJsonStore();
console.log(`Data store: ${store.name}`);

module.exports = store;
