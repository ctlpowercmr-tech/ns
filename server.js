const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise';

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// Middleware d'authentification
const authentifierToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token manquant' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// Variables globales
let estConnecteBDD = false;

// Middleware pour vérifier la connexion BDD
app.use(async (req, res, next) => {
  if (!estConnecteBDD) {
    estConnecteBDD = await testerConnexionBDD();
    if (!estConnecteBDD) {
      return res.status(503).json({
        success: false,
        error: 'Base de données non disponible'
      });
    }
  }
  next();
});

// Générer un ID court
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
    res.status(500).json({
      status: 'ERROR',
      message: 'Problème avec la base de données'
    });
  }
});

// Inscription
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, password, nom, telephone } = req.body;
    
    if (!email || !password || !nom) {
      return res.status(400).json({ 
        success: false, 
        error: 'Données manquantes' 
      });
    }

    const client = await pool.connect();
    
    // Vérifier si l'utilisateur existe déjà
    const userExists = await client.query(
      'SELECT id FROM utilisateurs WHERE email = $1',
      [email]
    );
    
    if (userExists.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Un utilisateur avec cet email existe déjà'
      });
    }
    
    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Créer l'utilisateur
    const result = await client.query(
      `INSERT INTO utilisateurs (email, password, nom, telephone) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, nom, telephone, created_at`,
      [email, hashedPassword, nom, telephone]
    );
    
    const user = result.rows[0];
    
    // Créer le solde initial
    await client.query(
      'INSERT INTO soldes (user_id, solde) VALUES ($1, $2)',
      [user.id, 0.00]
    );
    
    client.release();
    
    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Utilisateur créé avec succès',
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        telephone: user.telephone
      },
      token
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

// Connexion
app.post('/api/connexion', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email et mot de passe requis' 
      });
    }

    const client = await pool.connect();
    
    // Trouver l'utilisateur
    const result = await client.query(
      `SELECT u.id, u.email, u.password, u.nom, u.telephone, s.solde 
       FROM utilisateurs u 
       LEFT JOIN soldes s ON u.id = s.user_id 
       WHERE u.email = $1`,
      [email]
    );
    
    if (result.rows.length === 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    const user = result.rows[0];
    
    // Vérifier le mot de passe
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Mot de passe incorrect'
      });
    }
    
    client.release();
    
    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Connexion réussie',
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        telephone: user.telephone,
        solde: parseFloat(user.solde)
      },
      token
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

// Routes Protégées
app.post('/api/transaction', authentifierToken, async (req, res) => {
  try {
    const { montant, boissons } = req.body;
    const userId = req.user.userId;
    
    if (!montant || !boissons) {
      return res.status(400).json({ 
        success: false, 
        error: 'Données manquantes' 
      });
    }

    const transactionId = genererIdCourt();
    const dateExpiration = new Date(Date.now() + 10 * 60 * 1000);
    
    const client = await pool.connect();
    
    const result = await client.query(
      `INSERT INTO transactions (id, user_id, montant, boissons, statut, date_expiration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [transactionId, userId, parseFloat(montant), JSON.stringify(boissons), 'en_attente', dateExpiration]
    );
    
    client.release();
    
    const transaction = {
      id: result.rows[0].id,
      montant: parseFloat(result.rows[0].montant),
      boissons: result.rows[0].boissons,
      statut: result.rows[0].statut,
      date: result.rows[0].date_creation,
      dateExpiration: result.rows[0].date_expiration
    };
    
    console.log(`Nouvelle transaction: ${transactionId}, Montant: ${montant}FCFA`);
    
    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

app.get('/api/transaction/:id', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      `SELECT t.*, u.nom as user_nom 
       FROM transactions t 
       JOIN utilisateurs u ON t.user_id = u.id 
       WHERE t.id = $1`,
      [req.params.id]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Transaction non trouvée'
      });
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
    
    const transactionFormatee = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: transaction.statut,
      date: transaction.date_creation,
      dateExpiration: transaction.date_expiration,
      datePaiement: transaction.date_paiement,
      user_nom: transaction.user_nom
    };
    
    res.json({
      success: true,
      data: transactionFormatee
    });
  } catch (error) {
    console.error('Erreur récupération transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const userId = req.user.userId;
    
    // Vérifier la transaction
    const transactionResult = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    
    if (transactionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Transaction non trouvée'
      });
    }
    
    const transaction = transactionResult.rows[0];
    
    if (transaction.statut !== 'en_attente') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Transaction déjà ${transaction.statut}`
      });
    }
    
    // Vérifier le solde utilisateur
    const soldeResult = await client.query(
      'SELECT solde FROM soldes WHERE user_id = $1',
      [userId]
    );
    
    const soldeUtilisateur = parseFloat(soldeResult.rows[0].solde);
    
    if (soldeUtilisateur < transaction.montant) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Solde insuffisant'
      });
    }
    
    // Effectuer le paiement
    await client.query(
      'UPDATE transactions SET statut = $1, date_paiement = NOW() WHERE id = $2',
      ['paye', transaction.id]
    );
    
    await client.query(
      'UPDATE soldes SET solde = solde - $1, updated_at = NOW() WHERE user_id = $2',
      [transaction.montant, userId]
    );
    
    await client.query('COMMIT');
    
    console.log(`Paiement réussi: ${transaction.id}`);
    
    // Récupérer le nouveau solde
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM soldes WHERE user_id = $1',
      [userId]
    );
    
    const transactionMiseAJour = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: 'paye',
      date: transaction.date_creation,
      datePaiement: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: transactionMiseAJour,
      nouveauSolde: parseFloat(nouveauSoldeResult.rows[0].solde),
      message: 'Paiement réussi! Votre commande sera prête dans 4 secondes.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  } finally {
    client.release();
  }
});

// Rechargement de compte
app.post('/api/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, operateur, numero_telephone } = req.body;
    const userId = req.user.userId;
    
    if (!montant || !operateur || !numero_telephone) {
      return res.status(400).json({
        success: false,
        error: 'Tous les champs sont requis'
      });
    }
    
    if (montant <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Le montant doit être positif'
      });
    }

    const client = await pool.connect();
    
    // Enregistrer la demande de rechargement
    const result = await client.query(
      `INSERT INTO rechargements (user_id, montant, operateur, numero_telephone, statut)
       VALUES ($1, $2, $3, $4, 'traite')
       RETURNING *`,
      [userId, parseFloat(montant), operateur, numero_telephone]
    );
    
    // Mettre à jour le solde immédiatement (simulation)
    await client.query(
      'UPDATE soldes SET solde = solde + $1, updated_at = NOW() WHERE user_id = $2',
      [parseFloat(montant), userId]
    );
    
    // Récupérer le nouveau solde
    const soldeResult = await client.query(
      'SELECT solde FROM soldes WHERE user_id = $1',
      [userId]
    );
    
    client.release();
    
    const nouveauSolde = parseFloat(soldeResult.rows[0].solde);
    
    console.log(`Rechargement: +${montant}FCFA via ${operateur}, Nouveau solde: ${nouveauSolde}FCFA`);
    
    res.json({
      success: true,
      nouveauSolde: nouveauSolde,
      message: `Votre compte a été rechargé de ${montant}FCFA via ${operateur}`
    });
  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

// Vider le compte
app.post('/api/vider-compte', authentifierToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const client = await pool.connect();
    
    // Récupérer le solde actuel
    const soldeResult = await client.query(
      'SELECT solde FROM soldes WHERE user_id = $1',
      [userId]
    );
    
    const ancienSolde = parseFloat(soldeResult.rows[0].solde);
    
    if (ancienSolde <= 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Votre solde est déjà à 0 FCFA'
      });
    }
    
    // Mettre le solde à 0
    await client.query(
      'UPDATE soldes SET solde = 0.00, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );
    
    client.release();
    
    res.json({
      success: true,
      ancienSolde: ancienSolde,
      nouveauSolde: 0.00,
      message: `Votre compte a été vidé. ${ancienSolde}FCFA ont été retirés.`
    });
  } catch (error) {
    console.error('Erreur vider compte:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

// Historique des transactions
app.get('/api/historique', authentifierToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 20 } = req.query;

    const client = await pool.connect();
    
    const result = await client.query(
      `SELECT id, montant, boissons, statut, date_creation, date_paiement
       FROM transactions 
       WHERE user_id = $1 
       ORDER BY date_creation DESC 
       LIMIT $2`,
      [userId, parseInt(limit)]
    );
    
    client.release();
    
    const historique = result.rows.map(row => ({
      id: row.id,
      montant: parseFloat(row.montant),
      boissons: row.boissons,
      statut: row.statut,
      date: row.date_creation,
      datePaiement: row.date_paiement
    }));
    
    res.json({
      success: true,
      data: historique
    });
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
  }
});

// Profil utilisateur
app.get('/api/profil', authentifierToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const client = await pool.connect();
    
    const result = await client.query(
      `SELECT u.id, u.email, u.nom, u.telephone, u.created_at, s.solde
       FROM utilisateurs u 
       LEFT JOIN soldes s ON u.id = s.user_id 
       WHERE u.id = $1`,
      [userId]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    const user = result.rows[0];
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        telephone: user.telephone,
        solde: parseFloat(user.solde),
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur'
    });
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
    console.error('Erreur nettoyage transactions:', error);
  }
}, 60 * 60 * 1000);

// Ping périodique pour garder le serveur actif
setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('🔄 Serveur maintenu actif - Ping PostgreSQL');
  } catch (error) {
    console.error('❌ Erreur ping serveur:', error);
  }
}, 300000);

// Démarrage du serveur
async function demarrerServeur() {
  try {
    const bddInitialisee = await initialiserBDD();
    
    if (!bddInitialisee) {
      console.error('❌ Impossible d\'initialiser la base de données');
      process.exit(1);
    }
    
    estConnecteBDD = await testerConnexionBDD();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur backend démarré sur le port ${PORT}`);
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`✅ PostgreSQL: ${estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
      console.log(`🔄 Maintenance active: SERVEUR TOUJOURS EN LIGNE`);
    });
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    process.exit(1);
  }
}

demarrerServeur();
