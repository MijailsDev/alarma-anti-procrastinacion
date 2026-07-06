import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

let sqlPromise = null;

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs();
  }
  return sqlPromise;
}

export async function createDatabase(dbPath) {
  const SQL = await getSql();
  let db;

  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const wrapped = {
    _db: db,
    _path: dbPath,
    open: true,

    exec(sql) {
      db.exec(sql);
    },

    pragma(str) {
      const [key, value] = str.split('=').map(s => s.trim());
      db.exec(`PRAGMA ${key} = ${value}`);
    },

    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        stmt,
        get(...params) {
          stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return null;
        },
        all(...params) {
          const rows = [];
          stmt.bind(params);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
        run(...params) {
          stmt.bind(params);
          stmt.step();
          const changes = db.getRowsModified();
          stmt.free();
          return { changes, lastInsertRowid: BigInt(db.exec("SELECT last_insert_rowid()")[0].values[0][0]) };
        }
      };
    },

    close() {
      if (this.open) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this._path, buffer);
        db.close();
        this.open = false;
      }
    }
  };

  return wrapped;
}
