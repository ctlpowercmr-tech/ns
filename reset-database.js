const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

console.log('🔄 Reset de la base de données...');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function resetDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ Connexion à PostgreSQL établie');

    // Supprimer les tables existantes
    await client.query('DROP TABLE IF EXISTS transactions CASCADE');
    await client.query('DROP TABLE IF EXISTS distributeur CASCADE');
    await client.query('DROP TABLE IF EXISTS utilisateurs CASCADE');
    console.log('✅ Tables existantes supprimées');

    // Recréer les tables avec les bonnes tailles
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

    console.log('✅ Tables recréées avec succès');

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

    console.log('✅ Données initiales insérées');
    console.log('🎉 Reset de la base de données terminé avec succès!');

    client.release();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors du reset:', error);
    process.exit(1);
  }
}

resetDatabase();
