const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 20,
});

async function testerConnexionBDD() {
  try {
    const client = await pool.connect();
    console.log('✅ Connexion PostgreSQL établie');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Erreur connexion PostgreSQL:', error);
    return false;
  }
}

async function initialiserBDD() {
  try {
    const client = await pool.connect();
    
    // Table des utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS utilisateurs (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        nom VARCHAR(100) NOT NULL,
        telephone VARCHAR(20),
        password VARCHAR(255) NOT NULL,
        solde DECIMAL(10,2) DEFAULT 0.00,
        date_creation TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Table des transactions
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
    
    // Table du distributeur
    await client.query(`
      CREATE TABLE IF NOT EXISTS distributeur (
        id VARCHAR(20) PRIMARY KEY,
        solde DECIMAL(10,2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Insérer le distributeur
    await client.query(`
      INSERT INTO distributeur (id, solde) 
      VALUES ('distributeur_principal', 0.00)
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Créer un utilisateur demo
    const hashedPassword = await bcrypt.hash('demo123', 10);
    await client.query(`
      INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, ['demo@ctl.cm', 'Utilisateur Demo', '+237612345678', hashedPassword, 10000.00]);
    
    client.release();
    console.log('✅ Base de données initialisée avec succès');
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

module.exports = {
  pool,
  testerConnexionBDD,
  initialiserBDD,
  bcrypt
};
