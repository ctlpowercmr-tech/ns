const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise';

app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

let estConnecteBDD = false;

// Middleware d'authentification
function authentifierToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
}

// Middleware de connexion BDD
app.use(async (req, res, next) => {
  if (!estConnecteBDD) {
    estConnecteBDD = await testerConnexionBDD();
    if (!estConnecteBDD) {
      return res.status(503).json({ error: 'Base de données non disponible' });
    }
  }
  next();
});

// Générer ID court
function genererIdCourt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TX';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes Publiques
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    res.json({ 
      status: 'OK', 
      message: 'API et Base de données fonctionnelles',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Problème avec la base de données' });
  }
});

// Inscription
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, nom, prenom, telephone } = req.body;
    
    if (!email || !password || !nom || !prenom) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe déjà
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      client.release();
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const result = await client.query(
      `INSERT INTO users (email, password, nom, prenom, telephone, solde) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, email, nom, prenom, telephone, solde`,
      [email, hashedPassword, nom, prenom, telephone, 0.00]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);

    client.release();

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        telephone: user.telephone,
        solde: user.solde
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Connexion
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(400).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      client.release();
      return res.status(400).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);

    client.release();

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        telephone: user.telephone,
        solde: user.solde
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Routes Protégées
app.get('/api/produits', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM produits ORDER BY nom');
    client.release();

    res.json({ success: true, produits: result.rows });
  } catch (error) {
    console.error('Erreur récupération produits:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/transaction', authentifierToken, async (req, res) => {
  try {
    const { montant, boissons, methodePaiement } = req.body;
    const userId = req.user.userId;
    
    if (!montant || !boissons) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const transactionId = genererIdCourt();
    const dateExpiration = new Date(Date.now() + 10 * 60 * 1000);
    
    const client = await pool.connect();
    
    const result = await client.query(
      `INSERT INTO transactions (id, user_id, montant, boissons, statut, methode_paiement, date_expiration)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [transactionId, userId, parseFloat(montant), JSON.stringify(boissons), 'en_attente', methodePaiement, dateExpiration]
    );
    
    client.release();
    
    const transaction = result.rows[0];

    res.json({
      success: true,
      transaction: {
        id: transaction.id,
        montant: parseFloat(transaction.montant),
        boissons: transaction.boissons,
        statut: transaction.statut,
        dateCreation: transaction.date_creation,
        dateExpiration: transaction.date_expiration
      }
    });
  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/transaction/:id', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }
    
    const transaction = result.rows[0];

    // Vérifier l'expiration
    if (new Date() > new Date(transaction.date_expiration) && transaction.statut === 'en_attente') {
      await pool.query(
        'UPDATE transactions SET statut = $1 WHERE id = $2',
        ['expire', transaction.id]
      );
      transaction.statut = 'expire';
    }
    
    res.json({
      success: true,
      transaction: {
        id: transaction.id,
        montant: parseFloat(transaction.montant),
        boissons: transaction.boissons,
        statut: transaction.statut,
        dateCreation: transaction.date_creation,
        dateExpiration: transaction.date_expiration,
        datePaiement: transaction.date_paiement
      }
    });
  } catch (error) {
    console.error('Erreur récupération transaction:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Vérifier la transaction et l'utilisateur
    const transactionResult = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.user.userId]
    );
    
    if (transactionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }
    
    const transaction = transactionResult.rows[0];
    
    if (transaction.statut !== 'en_attente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Transaction déjà ${transaction.statut}` });
    }
    
    // Vérifier le solde utilisateur
    const soldeResult = await client.query(
      'SELECT solde FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    const soldeUtilisateur = parseFloat(soldeResult.rows[0].solde);
    
    if (soldeUtilisateur < transaction.montant) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solde insuffisant' });
    }
    
    // Effectuer le paiement
    await client.query(
      'UPDATE transactions SET statut = $1, date_paiement = NOW() WHERE id = $2',
      ['paye', transaction.id]
    );
    
    await client.query(
      'UPDATE users SET solde = solde - $1 WHERE id = $2',
      [transaction.montant, req.user.userId]
    );
    
    await client.query('COMMIT');
    
    // Récupérer le nouveau solde
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    res.json({
      success: true,
      message: 'Paiement réussi! Votre commande sera prête dans 4 secondes.',
      nouveauSolde: parseFloat(nouveauSoldeResult.rows[0].solde)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  } finally {
    client.release();
  }
});

app.post('/api/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, methodePaiement } = req.body;
    const userId = req.user.userId;
    
    if (!montant || montant <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const client = await pool.connect();
    
    const result = await client.query(
      'UPDATE users SET solde = solde + $1 WHERE id = $2 RETURNING solde',
      [parseFloat(montant), userId]
    );
    
    client.release();
    
    const nouveauSolde = parseFloat(result.rows[0].solde);
    
    res.json({
      success: true,
      message: `Rechargement de ${montant} FCFA effectué avec succès via ${methodePaiement}`,
      nouveauSolde: nouveauSolde
    });
  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/historique', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      `SELECT id, montant, boissons, statut, date_creation, date_paiement, methode_paiement
       FROM transactions 
       WHERE user_id = $1 
       ORDER BY date_creation DESC 
       LIMIT 50`,
      [req.user.userId]
    );
    
    client.release();
    
    res.json({
      success: true,
      transactions: result.rows
    });
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/profile', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT id, email, nom, prenom, telephone, solde, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = result.rows[0];
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        telephone: user.telephone,
        solde: user.solde,
        dateInscription: user.created_at
      }
    });
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Nettoyage des transactions expirées
setInterval(async () => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'UPDATE transactions SET statut = $1 WHERE statut = $2 AND date_expiration < NOW()',
      ['expire', 'en_attente']
    );
    client.release();
    if (result.rowCount > 0) {
      console.log(`Nettoyage: ${result.rowCount} transactions expirées`);
    }
  } catch (error) {
    console.error('Erreur nettoyage:', error);
  }
}, 60 * 60 * 1000);

// Maintenance serveur
setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('🔄 Serveur maintenu actif');
  } catch (error) {
    console.error('❌ Erreur maintenance:', error);
  }
}, 300000);

// Démarrage
async function demarrerServeur() {
  try {
    await initialiserBDD();
    estConnecteBDD = await testerConnexionBDD();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur backend démarré sur le port ${PORT}`);
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`✅ PostgreSQL: ${estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
    });
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    process.exit(1);
  }
}

demarrerServeur();
