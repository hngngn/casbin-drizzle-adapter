import type { Config } from "drizzle-kit"

export default {
    driver: "pg",
    dbCredentials: {
        connectionString: process.env.DATABASE_URL as string,
    },
    schema: "./test/table.ts",
} satisfies Config
