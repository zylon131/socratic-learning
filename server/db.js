import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export async function openDatabase() {
  const schema = 'BEGIN;\n' + await readFile(new URL('./schema.sql', import.meta.url), 'utf8') + '\nCOMMIT;'
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    await pool.query(schema)
    return {
      query: pool.query.bind(pool),
      transaction: async (work) => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await work(client)
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
      close: () => pool.end(),
    }
  }
  const directory = resolve(process.env.LOCAL_DATA_DIR || '.local/db')
  await mkdir(directory, { recursive: true })
  const db = await PGlite.create(directory)
  await db.exec(schema)
  return db
}
