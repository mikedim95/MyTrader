import "dotenv/config";
import mysql from "mysql2/promise";

export const dbConfig = {
  host: process.env.MYAPP_DB_HOST ?? "localhost",
  port: Number(process.env.MYAPP_DB_PORT ?? 3306),
  user: process.env.MYAPP_DB_USER ?? "myapp_user",
  password: process.env.MYAPP_DB_PASSWORD ?? "myapp_pass",
  database: process.env.MYAPP_DB_NAME ?? "myapp",
  waitForConnections: true,
  connectionLimit: Number(process.env.MYAPP_DB_CONNECTION_LIMIT ?? 10),
  decimalNumbers: true,
  dateStrings: true,
};

const pool = mysql.createPool(dbConfig);

export { pool };
export default pool;
