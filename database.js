const { Pool } = require('pg');

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
        password_hash VARCHAR(255) NOT NULL,
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
    
    // Table des produits
    await client.query(`
      CREATE TABLE IF NOT EXISTS produits (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prix DECIMAL(10,2) NOT NULL,
        image_url VARCHAR(500),
        categorie VARCHAR(50),
        stock INTEGER DEFAULT 100,
        disponible BOOLEAN DEFAULT true
      )
    `);
    
    // Insérer les produits initiaux
    await client.query(`
      INSERT INTO produits (nom, prix, image_url, categorie) VALUES
      ('Coca-Cola 33cl', 500, '/images/coca-can.png', 'soda'),
      ('Pepsi 33cl', 450, '/images/pepsi-can.png', 'soda'),
      ('Fanta Orange 33cl', 450, '/images/fanta-can.png', 'soda'),
      ('Sprite 33cl', 450, '/images/sprite-can.png', 'soda'),
      ('Coca-Cola 50cl', 700, '/images/coca-bottle.png', 'soda'),
      ('Pepsi 50cl', 650, '/images/pepsi-bottle.png', 'soda'),
      ('Monster Energy', 1000, '/images/monster-can.png', 'energy'),
      ('Ice Tea Pêche', 600, '/images/icetea-can.png', 'tea')
      ON CONFLICT DO NOTHING
    `);
    
    client.release();
    console.log('✅ Base de données initialisée avec succès');
    return true;
  } catch (error) {
    console.error('❌ Erreur initialisation BDD:', error);
    return false;
  }
}

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
