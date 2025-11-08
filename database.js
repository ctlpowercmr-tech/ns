const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nom VARCHAR(100) NOT NULL,
        telephone VARCHAR(20),
        solde DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Table des transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(20) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        montant DECIMAL(10,2) NOT NULL,
        boissons JSONB NOT NULL,
        statut VARCHAR(20) NOT NULL,
        methode_paiement VARCHAR(50),
        date_creation TIMESTAMP DEFAULT NOW(),
        date_expiration TIMESTAMP,
        date_paiement TIMESTAMP
      )
    `);
    
    // Table des recharges
    await client.query(`
      CREATE TABLE IF NOT EXISTS recharges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        montant DECIMAL(10,2) NOT NULL,
        operateur VARCHAR(50) NOT NULL,
        numero_telephone VARCHAR(20) NOT NULL,
        statut VARCHAR(20) DEFAULT 'en_attente',
        date_creation TIMESTAMP DEFAULT NOW(),
        date_validation TIMESTAMP
      )
    `);
    
    // Créer un utilisateur admin par défaut
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (email, password, nom, telephone, solde) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, ['admin@distributeur.com', hashedPassword, 'Administrateur', '+237600000000', 10000.00]);
    
    client.release();
    console.log('✅ Base de données initialisée avec succès');
    return true;
  } catch (error) {
    console.error('❌ Erreur initialisation BDD:', error);
    return false;
  }
}

// Maintenance de la connexion
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