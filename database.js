const { Pool } = require('pg');

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
        prenom VARCHAR(100) NOT NULL,
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

    // Table des produits
    await client.query(`
      CREATE TABLE IF NOT EXISTS produits (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prix DECIMAL(10,2) NOT NULL,
        marque VARCHAR(50) NOT NULL,
        taille VARCHAR(20) NOT NULL,
        image_url TEXT,
        categorie VARCHAR(50),
        stock INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insérer les produits initiaux
    await client.query(`
      INSERT INTO produits (nom, prix, marque, taille, image_url, categorie) VALUES
      ('Coca-Cola Classique', 500, 'Coca-Cola', '33cl', '/images/coca-classique.jpg', 'Soda'),
      ('Coca-Cola Zéro', 500, 'Coca-Cola', '33cl', '/images/coca-zero.jpg', 'Soda'),
      ('Pepsi Classique', 450, 'Pepsi', '33cl', '/images/pepsi-classique.jpg', 'Soda'),
      ('Pepsi Max', 450, 'Pepsi', '33cl', '/images/pepsi-max.jpg', 'Soda'),
      ('Fanta Orange', 400, 'Fanta', '33cl', '/images/fanta-orange.jpg', 'Soda'),
      ('Sprite', 400, 'Sprite', '33cl', '/images/sprite.jpg', 'Soda'),
      ('Orangina', 450, 'Orangina', '33cl', '/images/orangina.jpg', 'Soda'),
      ('Schweppes Tonic', 450, 'Schweppes', '33cl', '/images/schweppes-tonic.jpg', 'Soda'),
      ('Ice Tea Pêche', 400, 'Lipton', '33cl', '/images/ice-teach-peche.jpg', 'Thé'),
      ('Eau Minérale', 300, 'Source', '50cl', '/images/eau-minerale.jpg', 'Eau'),
      ('Jus d''Orange', 600, 'Jus Pur', '25cl', '/images/jus-orange.jpg', 'Jus'),
      ('Café Glacé', 700, 'Nescafé', '25cl', '/images/cafe-glace.jpg', 'Café')
      ON CONFLICT DO NOTHING
    `);

    // Créer un utilisateur admin par défaut
    await client.query(`
      INSERT INTO users (email, password, nom, prenom, solde) 
      VALUES ('admin@distributeur.com', '$2a$10$rOzZIIbCjA5qGYwW1yq.3.FrU1AjcYj1JqJ1JqJ1JqJ1JqJ1JqJ1Jq', 'Admin', 'System', 100000.00)
      ON CONFLICT (email) DO NOTHING
    `);

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
    console.log('🔄 Connexion PostgreSQL maintenue active');
  } catch (error) {
    console.error('❌ Erreur maintenance connexion:', error);
  }
}, 300000);

module.exports = { pool, testerConnexionBDD, initialiserBDD };
