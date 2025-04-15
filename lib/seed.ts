import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import 'dotenv/config';
import { Client } from 'pg';

interface UnicornData {
  Company: string;
  'Valuation ($B)': string;
  'Date Joined': string;
  Country: string;
  City: string;
  Industry: string;
  'Select Investors': string;
}

function formatDate(dateString: string | undefined): string | null {
  const formats = [
    'YYYY-MM-DD',
    'DD-MM-YY',
    'DD/MM/YY',
    'MM/DD/YY',
    'MM-DD-YY'
  ];

  for (const format of formats) {
    const parsedDate = moment(dateString, format);
    if (parsedDate.isValid()) {
      return parsedDate.format('YYYY-MM-DD');
    }
  }
  return dateString;
}
  if (!dateString) {
    console.warn(`Date string is undefined`);
    return null;
  }
  const parts = dateString.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  console.warn(`Could not parse date: ${dateString}`);
  return null;
}

export async function seed() {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  });
  await client.connect();

  const createTable = await client.query(`
    CREATE TABLE IF NOT EXISTS unicorns (
      id SERIAL PRIMARY KEY,
      company VARCHAR(255) NOT NULL UNIQUE,
      valuation DECIMAL(10, 2) NOT NULL,
      date_joined DATE,
      country VARCHAR(255) NOT NULL,
      city VARCHAR(255) NOT NULL,
      industry VARCHAR(255) NOT NULL,
      select_investors TEXT NOT NULL
    );
  `);

  console.log(`Created "unicorns" table`);

  const results: any[] = [];
  const csvFilePath = path.join(process.cwd(), 'unicorns.csv');

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          for (const row of results) {
            // Remove leading commas from all fields
            const cleanRow = {
              Company: row.Company ? row.Company.replace(/^\s*,/, '').trim() : '',
              'Valuation ($B)': row['Valuation ($B)'] ? row['Valuation ($B)'].replace(/^\s*,/, '').trim() : '',
              'Date Joined': row['Date Joined'] ? row['Date Joined'].replace(/^\s*,/, '').trim() : '',
              Country: row.Country ? row.Country.replace(/^\s*,/, '').trim() : '',
              City: row.City ? row.City.replace(/^\s*,/, '').trim() : '',
              Industry: row.Industry ? row.Industry.replace(/^\s*,/, '').trim() : '',
              'Select Investors': row['Select Investors'] ? row['Select Investors'].replace(/^\s*,/, '').trim() : ''
            };

            if (!cleanRow.Company || !cleanRow['Valuation ($B)'] || !cleanRow.Country || !cleanRow.City || !cleanRow.Industry || !cleanRow['Select Investors']) {
              console.warn('Skipping row with missing required fields:', cleanRow);
              continue;
            }
            await client.query(
              `INSERT INTO unicorns (company, valuation, date_joined, country, city, industry, select_investors)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (company) DO NOTHING`,
              [
                cleanRow.Company,
                parseFloat(cleanRow['Valuation ($B)']) * 1000,
                formatDate(cleanRow['Date Joined']),
                cleanRow.Country,
                cleanRow.City,
                cleanRow.Industry,
                cleanRow['Select Investors']
              ]
            );
          }
          resolve(results);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });

  await client.end();
  console.log(`Seeded ${results.length} unicorns`);

  return {
    createTable,
    unicorns: results,
  };
}


seed().catch(console.error);