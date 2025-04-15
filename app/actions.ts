"use server";

import { Config, configSchema, explanationsSchema, Result } from "@/lib/types";
import { Client } from "pg";
import { generateObject, generateText } from "ai"; // ✅ import both functions
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";

// ✅ Groq model with proper baseURL and error handling
const getGroqModel = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key is not configured. Please set GROQ_API_KEY in your .env file.");
  }

  try {
    const baseURL = "https://api.groq.com/openai/v1";
    console.log("Calling GROQ API with endpoint:", baseURL);
    console.log("Using model:", "llama3-70b-8192");

    const groq = createOpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL,
      defaultHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });

    return groq.chat("llama3-70b-8192");
  } catch (e) {
    if (e.message.includes("quota") || e.message.includes("billing")) {
      throw new Error("Groq API quota exceeded. Please check your billing details or use a different API key.");
    }
    throw e;
  }
};

// ✅ OpenAI model
const getOpenAIModel = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key is not configured. Please set GROQ_API_KEY in your .env file.");
  }

  try {
    const baseURL = "https://api.groq.com/openai/v1";
    const groq = createOpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL,
      defaultHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });
    return groq;
  } catch (e) {
    if (e.message.includes("quota") || e.message.includes("billing")) {
      throw new Error("Groq API quota exceeded. Please check your billing details or use a different API key.");
    }
    throw e;
  }
};

// ✅ Generate SQL query
export const generateQuery = async (input: string) => {
  "use server";
  try {
    console.log('Starting query generation for input:', input);
    const groq = getGroqModel();
    console.log('Groq model initialized successfully');
    const result = await generateText({
      model: groq,
      system: `You are a SQL (postgres) expert. Generate a SQL query to answer the user's question about unicorn companies. The table schema is:
      unicorns (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255) NOT NULL UNIQUE,
        valuation DECIMAL(10, 2) NOT NULL,
        date_joined DATE,
        country VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(255) NOT NULL,
        select_investors TEXT NOT NULL
      )`,
      prompt: `Generate a SQL query for: ${input}. Return ONLY the SQL query with no additional text or explanation.`,
      max_tokens: 500,
      temperature: 0.7,
    });

    if (result?.text) {
      console.log('Successfully generated SQL query:', result.text);
      return result.text;
    }
    console.log('No text in result, returning default query');
    return "SELECT * FROM unicorns LIMIT 10";
  } catch (e) {
    console.error('Error in generateQuery:', e);
    throw new Error(`Failed to generate query: ${e.message}`);
  }
};

// ✅ Run query
export const runGenerateSQLQuery = async (query: string) => {
  "use server";

  // Clean and validate the query
  const cleanedQuery = query.trim().replace(/;+$/, '');
  const queryLower = cleanedQuery.toLowerCase();
  console.log("Generated SQL query:", queryLower);
  if (!queryLower.startsWith("select")) {
    throw new Error("Only SELECT queries are allowed");
  }

  // More comprehensive check for forbidden operations
  const forbiddenOps = ['drop', 'delete', 'insert', 'update', 'alter', 
                       'truncate', 'create', 'grant', 'revoke', 'execute',
                       'merge', 'lock', 'comment', 'explain'];
  
  if (forbiddenOps.some(op => queryLower.includes(op))) {
    throw new Error(`Query contains forbidden operation: ${cleanedQuery}`);
  }

  // Check if query uses regexp_split_part and validate data format
  if (queryLower.includes('regexp_split_part')) {
    console.log('Detected regexp_split_part query, validating data format');
    const testQuery = "SELECT select_investors FROM unicorns WHERE select_investors LIKE '%,%' LIMIT 1";
    const client = new Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      ssl: { rejectUnauthorized: false },
    });
    
    try {
      await client.connect();
      const { rows } = await client.query(testQuery);
      if (rows.length === 0) {
        throw new Error('No comma-separated values found in select_investors column');
      }
    } finally {
      await client.end();
    }
  }

  console.log('Creating PostgreSQL client with config:', {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    ssl: { rejectUnauthorized: false }
  });
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Attempting to connect to PostgreSQL database with config:', {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    console.log('Successfully connected to PostgreSQL database');
    
    // First check if table exists
    console.log('Checking if unicorns table exists');
    const tableCheck = await client.query(
      "SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'unicorns')"
    );
    console.log('Table check result:', tableCheck.rows[0].exists);
    if (!tableCheck.rows[0].exists) {
      throw new Error('Table "unicorns" does not exist');
    }

    // Check if table has data
    console.log('Checking if unicorns table has data');
    const countQuery = await client.query('SELECT COUNT(*) FROM unicorns');
    console.log('Row count:', countQuery.rows[0].count);
    if (countQuery.rows[0].count === '0') {
      throw new Error('Table exists but contains no data');
    }
    
    // Check if table has data
    const countResult = await client.query('SELECT COUNT(*) FROM unicorns');
    const rowCount = parseInt(countResult.rows[0].count);
    
    if (rowCount === 0) {
      throw new Error('The unicorns table exists but contains no data. Please ensure your Supabase database is properly seeded.');
    }
    
    console.log('Executing SQL query:', query);
    const { rows } = await client.query(query);
    console.log('Query executed successfully, rows returned:', rows.length);
    if (rows.length === 0) {
      throw new Error('Your query executed successfully but found no matching records. Try broadening your search criteria.');
    }
    
    // Convert results to CSV format if needed
    if (queryLower.includes('csv') || queryLower.includes('export')) {
      const csvContent = rows.map(row => Object.values(row).join(',')).join('\n');
      return { csv: csvContent };
    }
    
    return rows as Result[];
  } catch (e: any) {
    console.error('Database operation failed:', e);
    if (e.message.includes('relation "unicorns" does not exist') || 
        e.message === 'Table "unicorns" does not exist') {
      console.error('Table does not exist error');
      throw new Error("Table does not exist");
    } else if (e.message === 'Query executed successfully but returned no results') {
      console.error('Query returned no results');
      throw new Error('No data found matching your query criteria');
    } else {
      console.error('Unexpected database error:', e.stack || e.message);
      throw new Error(`Database error: ${e.message}`);
    }
  } finally {
    await client.end();
  }
};

// ✅ Explain query
export const explainQuery = async (input: string, sqlQuery: string) => {
  "use server";

  try {
    const result = await generateText({
      model: getGroqModel(),
      system: `You are a SQL (postgres) expert. Your job is to explain to the user a SQL query you wrote. The table schema is:
      unicorns (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255) NOT NULL UNIQUE,
        valuation DECIMAL(10, 2) NOT NULL,
        date_joined DATE,
        country VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(255) NOT NULL,
        select_investors TEXT NOT NULL
      );

      Break the query into sections and explain each. If a section has no explanation, include it but leave the explanation empty.`,
      prompt: `Explain the SQL query you generated to retrieve the data the user wanted.

User Query:
${input}

Generated SQL Query:
${sqlQuery}`,
      max_tokens: 500,
      temperature: 0.7
    });

    return { explanations: [{ section: "Full Query", explanation: result.text }] };
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to generate query explanation: ${e.message}`);
  }
};

// ✅ Generate chart configuration
export const generateChartConfig = async (results: Result[], userQuery: string) => {
  "use server";

  const system = `You are a data visualization expert.`;

  try {
    const { object: config } = await generateObject({
      model: getOpenAIModel(),
      system,
      prompt: `Given the following data from a SQL query result, generate the chart config that best visualises the data and answers the user's query.
For multiple groups use multi-lines.

User Query:
${userQuery}

Data:
${JSON.stringify(results, null, 2)}`,
      schema: configSchema,
    });

    const colors: Record<string, string> = {};
    config.yKeys.forEach((key, index) => {
      colors[key] = `hsl(var(--chart-${index + 1}))`;
    });

    const updatedConfig: Config = { ...config, colors };
    return { config: updatedConfig };
  } catch (e) {
    console.error(e.message);
    throw new Error("Failed to generate chart suggestion");
  }
};