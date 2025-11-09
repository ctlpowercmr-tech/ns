const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

let estConnecteBDD = false;

// Middleware d'authentification
const authentifierToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token requis' });
  }

  jwt.verify(token, JWT_SECRET, (err, utilisateur) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token invalide' });
    }
    req.utilisateur = utilisateur;
    next();
  });
};

app.use(async (req, res, next) => {
  if (!estConnecteBDD) {
    estConnecteBDD = await testerConnexionBDD();
    if (!estConnecteBDD) {
      return res.status(503).json({ success: false, error: 'Base de données non disponible' });
    }
  }
  next();
});

function genererIdCourt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TX';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes d'authentification
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, nom, telephone, password } = req.body;
    
    if (!email || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Champs manquants' });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe déjà
    const existant = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    if (existant.rows.length > 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'Email déjà utilisé' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Créer l'utilisateur
    const result = await client.query(
      `INSERT INTO utilisateurs (email, nom, telephone, password_hash, solde) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, nom, telephone, solde`,
      [email, nom, telephone, passwordHash, 0.00]
    );
    
    client.release();
    
    const utilisateur = result.rows[0];
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      utilisateur: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        telephone: utilisateur.telephone,
        solde: utilisateur.solde
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.post('/api/connexion', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
    }

    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM utilisateurs WHERE email = $1',
      [email]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    const utilisateur = result.rows[0];
    const motDePasseValide = await bcrypt.compare(password, utilisateur.password_hash);
    
    if (!motDePasseValide) {
      return res.status(400).json({ success: false, error: 'Mot de passe incorrect' });
    }
    
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      utilisateur: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        telephone: utilisateur.telephone,
        solde: utilisateur.solde
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Routes API
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
    res.status(500).json({ status: 'ERROR', message: 'Problème base de données' });
  }
});

app.get('/api/produits', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM produits WHERE disponible = true');
    client.release();
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Erreur produits:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.post('/api/transaction', authentifierToken, async (req, res) => {
  try {
    const { montant, boissons } = req.body;
    const utilisateurId = req.utilisateur.id;
    
    if (!montant || !boissons) {
      return res.status(400).json({ success: false, error: 'Données manquantes' });
    }

    const transactionId = genererIdCourt();
    const dateExpiration = new Date(Date.now() + 10 * 60 * 1000);
    
    const client = await pool.connect();
    
    const result = await client.query(
      `INSERT INTO transactions (id, utilisateur_id, montant, boissons, statut, date_expiration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [transactionId, utilisateurId, parseFloat(montant), JSON.stringify(boissons), 'en_attente', dateExpiration]
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
    
    res.json({ success: true, data: transaction });
  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.get('/api/transaction/:id', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND utilisateur_id = $2',
      [req.params.id, req.utilisateur.id]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }
    
    const transaction = result.rows[0];
    
    if (new Date() > new Date(transaction.date_expiration) && transaction.statut === 'en_attente') {
      await pool.query('UPDATE transactions SET statut = $1 WHERE id = $2', ['expire', transaction.id]);
      transaction.statut = 'expire';
    }
    
    const transactionFormatee = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: transaction.statut,
      date: transaction.date_creation,
      dateExpiration: transaction.date_expiration,
      datePaiement: transaction.date_paiement
    };
    
    res.json({ success: true, data: transactionFormatee });
  } catch (error) {
    console.error('Erreur récupération transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const { methodePaiement } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const transactionResult = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND utilisateur_id = $2 FOR UPDATE',
      [req.params.id, req.utilisateur.id]
    );
    
    if (transactionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }
    
    const transaction = transactionResult.rows[0];
    
    if (transaction.statut !== 'en_attente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Transaction déjà ${transaction.statut}` });
    }
    
    const soldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );
    
    const soldeUtilisateur = parseFloat(soldeResult.rows[0].solde);
    
    if (soldeUtilisateur < transaction.montant) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Solde insuffisant' });
    }
    
    // Effectuer le paiement
    await client.query(
      'UPDATE transactions SET statut = $1, date_paiement = NOW(), methode_paiement = $2 WHERE id = $3',
      ['paye', methodePaiement, transaction.id]
    );
    
    await client.query(
      'UPDATE utilisateurs SET solde = solde - $1 WHERE id = $2',
      [transaction.montant, req.utilisateur.id]
    );
    
    await client.query('COMMIT');
    
    console.log(`Paiement réussi: ${transaction.id}, Méthode: ${methodePaiement}`);
    
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );
    
    const transactionMiseAJour = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: 'paye',
      methodePaiement: methodePaiement,
      date: transaction.date_creation,
      datePaiement: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: transactionMiseAJour,
      nouveauSolde: parseFloat(nouveauSoldeResult.rows[0].solde)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

app.post('/api/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, methode } = req.body;
    
    if (!montant || montant <= 0) {
      return res.status(400).json({ success: false, error: 'Montant invalide' });
    }

    const client = await pool.connect();
    
    const result = await client.query(
      'UPDATE utilisateurs SET solde = solde + $1 WHERE id = $2 RETURNING solde',
      [parseFloat(montant), req.utilisateur.id]
    );
    
    client.release();
    
    const nouveauSolde = parseFloat(result.rows[0].solde);
    
    console.log(`Rechargement: +${montant}FCFA, Méthode: ${methode}, Nouveau solde: ${nouveauSolde}FCFA`);
    
    res.json({
      success: true,
      nouveauSolde: nouveauSolde,
      message: `Rechargement de ${montant}FCFA réussi via ${methode}`
    });
  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.get('/api/historique', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      `SELECT id, montant, boissons, statut, methode_paiement, date_creation, date_paiement 
       FROM transactions 
       WHERE utilisateur_id = $1 
       ORDER BY date_creation DESC 
       LIMIT 20`,
      [req.utilisateur.id]
    );
    
    client.release();
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

app.get('/api/profil', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT id, email, nom, telephone, solde, date_creation FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query(
      'UPDATE transactions SET statut = $1 WHERE statut = $2 AND date_expiration < NOW()',
      ['expire', 'en_attente']
    );
    client.release();
  } catch (error) {
    console.error('Erreur nettoyage:', error);
  }
}, 60 * 60 * 1000);

setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
  } catch (error) {
    console.error('Erreur ping:', error);
  }
}, 300000);

async function demarrerServeur() {
  try {
    await initialiserBDD();
    estConnecteBDD = await testerConnexionBDD();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur moderne démarré sur le port ${PORT}`);
      console.log(`✅ PostgreSQL: ${estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
      console.log(`🔄 Système de comptes utilisateur activé`);
    });
  } catch (error) {
    console.error('❌ Erreur démarrage:', error);
    process.exit(1);
  }
}

demarrerServeur();
