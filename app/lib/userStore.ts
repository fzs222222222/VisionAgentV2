import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getMysqlPool } from "@/app/lib/db";

export type AuthUser = {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
};

type UserRow = RowDataPacket & {
  id: number;
  username: string;
  password_hash: string;
  created_at: Date;
};

function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByUsername(username: string) {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<UserRow[]>(
    `SELECT id, username, password_hash, created_at
     FROM users
     WHERE username = :username
     LIMIT 1`,
    { username },
  );

  return rows[0] ? mapUserRow(rows[0]) : null;
}

export async function createUser(input: { username: string; passwordHash: string }) {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO users (username, password_hash)
     VALUES (:username, :passwordHash)`,
    input,
  );

  const [rows] = await pool.execute<UserRow[]>(
    `SELECT id, username, password_hash, created_at
     FROM users
     WHERE id = :id
     LIMIT 1`,
    { id: result.insertId },
  );

  return rows[0] ? mapUserRow(rows[0]) : null;
}

