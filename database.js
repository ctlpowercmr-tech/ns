const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Configuration robuste de la connexion
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 20,
  min: 2
});

// Test de connexion
async function testerConnexionBDD() {
  try {
    const client = await pool.connect();
    console.log('✅ Connexion PostgreSQL établie');
    
    // Test supplémentaire
    const result = await client.query('SELECT version()');
    console.log('📊 Version PostgreSQL:', result.rows[0].version);
    
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Erreur connexion PostgreSQL:', error.message);
    return false;
  }
}

// Vérifier si les tables existent
async function tablesExistent() {
  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name IN ('utilisateurs', 'transactions', 'distributeur')
    `);
    client.release();
    return result.rows.length === 3;
  } catch (error) {
    console.error('Erreur vérification tables:', error);
    return false;
  }
}

// Supprimer toutes les tables (pour reset)
async function supprimerTables() {
  try {
    const client = await pool.connect();
    console.log('🗑️  Suppression des tables existantes...');
    
    await client.query('DROP TABLE IF EXISTS transactions CASCADE');
    await client.query('DROP TABLE IF EXISTS distributeur CASCADE');
    await client.query('DROP TABLE IF EXISTS utilisateurs CASCADE');
    
    client.release();
    console.log('✅ Tables supprimées avec succès');
    return true;
  } catch (error) {
    console.error('❌ Erreur suppression tables:', error);
    return false;
  }
}

// Initialisation robuste de la BDD
async function initialiserBDD() {
  let client;
  
  try {
    client = await pool.connect();
    console.log('🚀 Début initialisation BDD...');

    // Vérifier d'abord si les tables existent déjà
    const tablesExist = await tablesExistent();
    
    if (tablesExist) {
      console.log('ℹ️  Tables existent déjà, vérification structure...');
      client.release();
      return true;
    }

    console.log('📦 Création des tables...');

    // 1. Table utilisateurs avec tailles CORRECTES
    await client.query(`
      CREATE TABLE IF NOT EXISTS utilisateurs (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        nom VARCHAR(150) NOT NULL,
        telephone VARCHAR(30),
        password VARCHAR(255) NOT NULL,
        solde DECIMAL(12,2) DEFAULT 0.00,
        date_creation TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Table utilisateurs créée');

    // 2. Table transactions avec tailles CORRECTES
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(50) PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id),
        montant DECIMAL(12,2) NOT NULL,
        boissons JSONB NOT NULL,
        statut VARCHAR(50) NOT NULL,
        methode_paiement VARCHAR(100),
        date_creation TIMESTAMP DEFAULT NOW(),
        date_expiration TIMESTAMP,
        date_paiement TIMESTAMP
      )
    `);
    console.log('✅ Table transactions créée');

    // 3. Table distributeur
    await client.query(`
      CREATE TABLE IF NOT EXISTS distributeur (
        id VARCHAR(50) PRIMARY KEY,
        solde DECIMAL(12,2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Table distributeur créée');

    // 4. Insertion données initiales
    await client.query(`
      INSERT INTO distributeur (id, solde) 
      VALUES ('distributeur_principal', 0.00)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✅ Données distributeur initialisées');

    // 5. Créer utilisateur demo
    const hashedPassword = await bcrypt.hash('demo123', 12);
    await client.query(`
      INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, ['demo@ctl.cm', 'Utilisateur Demo', '+237612345678', hashedPassword, 10000.00]);
    console.log('✅ Utilisateur demo créé');

    client.release();
    console.log('🎉 Base de données initialisée avec succès!');
    return true;

  } catch (error) {
    if (client) client.release();
    console.error('❌ Erreur initialisation BDD:', error);
    
    // Tentative de récupération
    console.log('🔄 Tentative de récupération...');
    try {
      await supprimerTables();
      return await initialiserBDD();
    } catch (retryError) {
      console.error('❌ Échec récupération:', retryError);
      return false;
    }
  }
}

// Maintenance automatique
setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('🔄 Maintenance connexion BDD OK');
  } catch (error) {
    console.error('❌ Erreur maintenance BDD:', error);
  }
}, 300000); // 5 minutes

// Gestion propre des erreurs
process.on('SIGINT', async () => {
  console.log('🔄 Fermeture connexions BDD...');
  await pool.end();
  process.exit(0);
});

module.exports = {
  pool,
  testerConnexionBDD,
  initialiserBDD,
  supprimerTables,
  tablesExistent,
  bcrypt
};
