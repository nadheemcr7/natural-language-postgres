"use server";

import { Config, configSchema, explanationsSchema, Result } from "@/lib/types";
import { openai } from "@ai-sdk/openai";
import { Client } from "pg";
import { generateObject } from "ai";
import { z } from "zod";

// Configure OpenAI with error handling
const getOpenAIModel = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured. Please set OPENAI_API_KEY in your .env file.");
  }
  
  try {
    const model = openai("gpt-3.5-turbo");
    model.maxRetries = 0; // Disable retries to fail fast
    return model;
  } catch (e) {
    if (e.message.includes('quota') || e.message.includes('billing')) {
      throw new Error("OpenAI API quota exceeded. Please check your billing details or use a different API key.");
    }
    throw e;
  }
};

export const generateQuery = async (input: string) => {
  "use server";
  try {
    // Try OpenAI first if API key is valid
    try {
      const result = await generateObject({
        model: getOpenAIModel(),
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
        prompt: `Generate a SQL query for: ${input}`,
        schema: z.object({
          query: z.string()
        })
      });
      return result.object.query;
    } catch (e) {
      if (e.message.includes('quota') || e.message.includes('billing')) {
        console.warn('OpenAI quota exceeded, falling back to simple query generation');
        console.log('To use advanced query generation, please update your OpenAI API key or billing details');
        
        // Fallback to keyword-based query generation
        const keywords = input.toLowerCase().split(' ');
        
        if (keywords.includes('count') || keywords.includes('how many')) {
          if (keywords.includes('industry')) {
            return `SELECT industry, COUNT(*) as count FROM unicorns GROUP BY industry ORDER BY count DESC`;
          } else if (keywords.includes('country')) {
            return `SELECT country, COUNT(*) as count FROM unicorns GROUP BY country ORDER BY count DESC`;
          } else {
            return `SELECT 'total' as metric, COUNT(*) as count FROM unicorns`;
          }
        }
        
        if (keywords.includes('valuation') || keywords.includes('worth')) {
          if (keywords.includes('highest') || keywords.includes('top')) {
            return `SELECT company, valuation FROM unicorns ORDER BY valuation DESC LIMIT 10`;
          } else if (keywords.includes('average') || keywords.includes('avg')) {
            return `SELECT 'average' as metric, AVG(valuation) as value FROM unicorns`;
          } else {
            return `SELECT company, valuation FROM unicorns ORDER BY valuation DESC`;
          }
        }
        
        // Default fallback query
        return 'SELECT company, valuation FROM unicorns LIMIT 50';
      }
      throw e;
    }
    
    // Fallback to simple keyword-based query generation
    const keywords = input.toLowerCase().split(' ');
    
    if (keywords.includes('count') || keywords.includes('how many')) {
      if (keywords.includes('industry')) {
        return `SELECT industry, COUNT(*) as count FROM unicorns GROUP BY industry ORDER BY count DESC`;
      } else if (keywords.includes('country')) {
        return `SELECT country, COUNT(*) as count FROM unicorns GROUP BY country ORDER BY count DESC`;
      } else {
        return `SELECT 'total' as metric, COUNT(*) as count FROM unicorns`;
      }
    }
    
    if (keywords.includes('valuation') || keywords.includes('worth')) {
      if (keywords.includes('highest') || keywords.includes('top')) {
        return `SELECT company, valuation FROM unicorns ORDER BY valuation DESC LIMIT 10`;
      } else if (keywords.includes('average') || keywords.includes('avg')) {
        return `SELECT 'average' as metric, AVG(valuation) as value FROM unicorns`;
      } else {
        return `SELECT company, valuation FROM unicorns ORDER BY valuation DESC`;
      }
    }
    
    // Default query if no specific pattern matched
    return `SELECT company, valuation FROM unicorns LIMIT 50`;
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to generate query: ${e.message}`);
  }
};

export const runGenerateSQLQuery = async (query: string) => {
  "use server";
  // Check if the query is a SELECT statement
  if (
    !query.trim().toLowerCase().startsWith("select") ||
    query.trim().toLowerCase().includes("drop") ||
    query.trim().toLowerCase().includes("delete") ||
    query.trim().toLowerCase().includes("insert") ||
    query.trim().toLowerCase().includes("update") ||
    query.trim().toLowerCase().includes("alter") ||
    query.trim().toLowerCase().includes("truncate") ||
    query.trim().toLowerCase().includes("create") ||
    query.trim().toLowerCase().includes("grant") ||
    query.trim().toLowerCase().includes("revoke")
  ) {
    throw new Error("Only SELECT queries are allowed");
  }

  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    const { rows } = await client.query(query);
    return rows as Result[];
  } catch (e: any) {
    if (e.message.includes('relation "unicorns" does not exist')) {
      console.log(
        "Table does not exist, creating and seeding it with dummy data now...",
      );
      throw Error("Table does not exist");
    } else {
      throw e;
    }
  } finally {
    await client.end();
  }
};

export const explainQuery = async (input: string, sqlQuery: string) => {
  "use server";
  try {
    const result = await generateObject({
      model: getOpenAIModel(),
      schema: z.object({
        explanations: explanationsSchema,
      }),
      system: `You are a SQL (postgres) expert. Your job is to explain to the user write a SQL query you wrote to retrieve the data they asked for. The table schema is as follows:
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

    When you explain you must take a section of the query, and then explain it. Each "section" should be unique. So in a query like: "SELECT * FROM unicorns limit 20", the sections could be "SELECT *", "FROM UNICORNS", "LIMIT 20".
    If a section doesnt have any explanation, include it, but leave the explanation empty.

    `,
      prompt: `Explain the SQL query you generated to retrieve the data the user wanted. Assume the user is not an expert in SQL. Break down the query into steps. Be concise.

      User Query:
      ${input}

      Generated SQL Query:
      ${sqlQuery}`,
    });
    return result.object;
  } catch (e) {
    console.error(e);
    throw new Error("Failed to generate query");
  }
};

export const generateChartConfig = async (
  results: Result[],
  userQuery: string,
) => {
  "use server";
  const system = `You are a data visualization expert. `;

  try {
    const { object: config } = await generateObject({
      model: getOpenAIModel(),
      system,
      prompt: `Given the following data from a SQL query result, generate the chart config that best visualises the data and answers the users query.
      For multiple groups use multi-lines.

      Here is an example complete config:
      export const chartConfig = {
        type: "pie",
        xKey: "month",
        yKeys: ["sales", "profit", "expenses"],
        colors: {
          sales: "#4CAF50",    // Green for sales
          profit: "#2196F3",   // Blue for profit
          expenses: "#F44336"  // Red for expenses
        },
        legend: true
      }

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
    if (e.message.includes('quota') || e.message.includes('billing')) {
      console.warn('OpenAI quota exceeded, using fallback chart configuration');
      // Fallback to basic chart config when API quota is exceeded
      if (!results || results.length === 0) {
        return {
          config: {
            type: "bar",
            xKey: "company",
            yKeys: ["valuation"],
            colors: {"valuation": "hsl(var(--chart-1))"},
            legend: true
          }
        };
      }
      
      const fallbackConfig: Config = {
        type: "bar",
        xKey: Object.keys(results[0])[0],
        yKeys: Object.keys(results[0]).slice(1),
        colors: {},
        legend: true
      };
      
      fallbackConfig.yKeys.forEach((key, index) => {
        fallbackConfig.colors[key] = `hsl(var(--chart-${index + 1}))`;
      });
      
      return { config: fallbackConfig };
    }
    
    console.error(e.message);
    throw new Error("Failed to generate chart suggestion");
  }
};
