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
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Connexion PostgreSQL établie');
    return true;
  } catch (error) {
    console.error('❌ Erreur connexion PostgreSQL:', error);
    return false;
  }
}

async function initialiserBDD() {
  let client;
  try {
    client = await pool.connect();
    console.log('🔄 Initialisation de la base de données...');

    // Vérifier si les tables existent déjà
    const tablesExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'utilisateurs'
      )
    `);

    if (tablesExist.rows[0].exists) {
      console.log('✅ Tables existent déjà, vérification des structures...');
      
      // Vérifier et corriger les structures si nécessaire
      await verifierEtCorrigerStructures(client);
      
      client.release();
      return true;
    }

    // Créer les tables si elles n'existent pas
    console.log('📦 Création des tables...');
    
    await client.query(`
      CREATE TABLE utilisateurs (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        nom VARCHAR(100) NOT NULL,
        telephone VARCHAR(30),
        password VARCHAR(255) NOT NULL,
        solde DECIMAL(10,2) DEFAULT 0.00,
        date_creation TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE transactions (
        id VARCHAR(50) PRIMARY KEY,
        utilisateur_id INTEGER REFERENCES utilisateurs(id),
        montant DECIMAL(10,2) NOT NULL,
        boissons JSONB NOT NULL,
        statut VARCHAR(50) NOT NULL,
        methode_paiement VARCHAR(100),
        date_creation TIMESTAMP DEFAULT NOW(),
        date_expiration TIMESTAMP,
        date_paiement TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE distributeur (
        id VARCHAR(50) PRIMARY KEY,
        solde DECIMAL(10,2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Données initiales
    await client.query(`
      INSERT INTO distributeur (id, solde) 
      VALUES ('distributeur_principal', 0.00)
    `);

    const hashedPassword = await bcrypt.hash('demo123', 10);
    await client.query(`
      INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
      VALUES ($1, $2, $3, $4, $5)
    `, ['demo@ctl.cm', 'Utilisateur Demo', '+237612345678', hashedPassword, 10000.00]);

    console.log('✅ Base de données initialisée avec succès');
    client.release();
    return true;

  } catch (error) {
    if (client) client.release();
    console.error('❌ Erreur initialisation BDD:', error.message);
    
    // Si c'est une erreur de structure, suggérer le reset
    if (error.message.includes('varchar') || error.message.includes('too long')) {
      console.log('💡 ASTUCE: Exécutez "npm run reset-db" pour réinitialiser la base de données');
    }
    
    return false;
  }
}

async function verifierEtCorrigerStructures(client) {
  try {
    // Vérifier la structure de la table transactions
    const columns = await client.query(`
      SELECT column_name, data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = 'transactions'
    `);

    const idColumn = columns.rows.find(col => col.column_name === 'id');
    if (idColumn && idColumn.character_maximum_length < 50) {
      console.log('🔄 Correction de la structure de la table transactions...');
      // Recréer la table avec la bonne structure
      await client.query('DROP TABLE IF EXISTS transactions CASCADE');
      await client.query(`
        CREATE TABLE transactions (
          id VARCHAR(50) PRIMARY KEY,
          utilisateur_id INTEGER REFERENCES utilisateurs(id),
          montant DECIMAL(10,2) NOT NULL,
          boissons JSONB NOT NULL,
          statut VARCHAR(50) NOT NULL,
          methode_paiement VARCHAR(100),
          date_creation TIMESTAMP DEFAULT NOW(),
          date_expiration TIMESTAMP,
          date_paiement TIMESTAMP
        )
      `);
    }
  } catch (error) {
    console.error('Erreur vérification structure:', error);
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
