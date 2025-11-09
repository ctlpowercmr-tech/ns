const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 20,
});

// Test connexion
async function testerConnexionBDD() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connecté');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Erreur PostgreSQL:', error);
    return false;
  }
}

// Initialisation BDD
async function initialiserBDD() {
  try {
    const client = await pool.connect();
    
    // Table utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS utilisateurs (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        nom VARCHAR(100) NOT NULL,
        telephone VARCHAR(20),
        password_hash VARCHAR(255) NOT NULL,
        solde DECIMAL(10,2) DEFAULT 0.00,
        date_creation TIMESTAMP DEFAULT NOW(),
        dernier_login TIMESTAMP
      )
    `);

    // Table transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(20) PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id),
        montant DECIMAL(10,2) NOT NULL,
        boissons JSONB NOT NULL,
        statut VARCHAR(20) NOT NULL,
        methode_paiement VARCHAR(50),
        date_creation TIMESTAMP DEFAULT NOW(),
        date_expiration TIMESTAMP,
        date_paiement TIMESTAMP
      )
    `);

    // Table historique recharges
    await client.query(`
      CREATE TABLE IF NOT EXISTS recharges (
        id SERIAL PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id),
        montant DECIMAL(10,2) NOT NULL,
        methode VARCHAR(50) NOT NULL,
        statut VARCHAR(20) DEFAULT 'success',
        date_creation TIMESTAMP DEFAULT NOW()
      )
    `);

    // Créer admin par défaut
    await client.query(`
      INSERT INTO utilisateurs (email, nom, telephone, password_hash, solde) 
      VALUES ('admin@distributeur.com', 'Administrateur', '+237600000000', '$2a$10$8K1p/a0dRTlB0.Z6rT1Lx.Hr5O5U5Q5c5b5b5b5b5b5b5b5b5b5b5b', 100000.00)
      ON CONFLICT (email) DO NOTHING
    `);

    client.release();
    console.log('✅ Base de données initialisée');
    return true;
  } catch (error) {
    console.error('❌ Erreur initialisation BDD:', error);
    return false;
  }
}

// Maintenance connexion
setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
  } catch (error) {
    console.error('Erreur maintenance connexion:', error);
  }
}, 300000);

module.exports = { pool, testerConnexionBDD, initialiserBDD };
