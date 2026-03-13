import pool, { dbConfig } from "../src/db.js";

const safeConfigForLogs = {
  ...dbConfig,
  password: dbConfig.password ? "***" : "",
};

async function testDB() {
  let conn;
  try {
    conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS agent_test (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS agent_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS agent_user_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        data_key VARCHAR(100) NOT NULL,
        data_value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_agent_user_data_user_id (user_id),
        CONSTRAINT fk_agent_user_data_user
          FOREIGN KEY (user_id) REFERENCES agent_users(id)
          ON DELETE CASCADE
      )
    `);

    await conn.query("INSERT INTO agent_test (message) VALUES (?)", ["agent connection test"]);

    const dummyUsers = [
      { username: "dummy_alice", email: "dummy_alice@myapp.local" },
      { username: "dummy_bob", email: "dummy_bob@myapp.local" },
    ];

    for (const user of dummyUsers) {
      await conn.query(
        `
          INSERT INTO agent_users (username, email)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE email = VALUES(email)
        `,
        [user.username, user.email]
      );
    }

    const [users] = await conn.query(
      "SELECT id, username, email, created_at FROM agent_users WHERE username IN (?, ?) ORDER BY id ASC",
      [dummyUsers[0].username, dummyUsers[1].username]
    );

    for (const user of users) {
      await conn.query("INSERT INTO agent_user_data (user_id, data_key, data_value) VALUES (?, ?, ?)", [
        user.id,
        "profile_note",
        `seeded test data for ${user.username}`,
      ]);
    }

    const [rows] = await conn.query("SELECT * FROM agent_test ORDER BY id DESC LIMIT 5");
    const [userRows] = await conn.query(
      `
        SELECT d.id, u.username, d.data_key, d.data_value, d.created_at
        FROM agent_user_data d
        JOIN agent_users u ON u.id = d.user_id
        ORDER BY d.id DESC
        LIMIT 10
      `
    );

    console.log("agent_test rows:");
    console.log(rows);
    console.log("dummy users:");
    console.log(users);
    console.log("agent_user_data rows:");
    console.log(userRows);
  } catch (error) {
    console.error("DB connectivity test failed.");
    if (error instanceof Error) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    console.error("Connection config:", safeConfigForLogs);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

testDB();
