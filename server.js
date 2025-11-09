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
function authentifierToken(req, res, next) {
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
}

// Middleware connexion BDD
app.use(async (req, res, next) => {
  if (!estConnecteBDD) {
    estConnecteBDD = await testerConnexionBDD();
    if (!estConnecteBDD) {
      return res.status(503).json({ success: false, error: 'Base de données non disponible' });
    }
  }
  next();
});

// Générer ID court
function genererIdCourt() {
  return 'TX' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Routes API
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ 
      success: true, 
      status: 'OK', 
      message: 'Système opérationnel',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Base de données indisponible' });
  }
});

// Inscription
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, nom, telephone, password } = req.body;

    if (!email || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Champs manquants' });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe
    const existant = await client.query(
      'SELECT id FROM utilisateurs WHERE email = $1',
      [email]
    );

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

    const utilisateur = result.rows[0];
    
    // Générer token
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    client.release();

    res.json({
      success: true,
      message: 'Compte créé avec succès',
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

// Connexion
app.post('/api/connexion', async (req, res) => {
  try {
    const { email, password } = req.body;

    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM utilisateurs WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
    }

    const utilisateur = result.rows[0];
    const motDePasseValide = await bcrypt.compare(password, utilisateur.password_hash);

    if (!motDePasseValide) {
      client.release();
      return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
    }

    // Mettre à jour dernier login
    await client.query(
      'UPDATE utilisateurs SET dernier_login = NOW() WHERE id = $1',
      [utilisateur.id]
    );

    // Générer token
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    client.release();

    res.json({
      success: true,
      message: 'Connexion réussie',
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

// Créer transaction
app.post('/api/transaction', async (req, res) => {
  try {
    const { montant, boissons } = req.body;

    if (!montant || !boissons) {
      return res.status(400).json({ success: false, error: 'Données manquantes' });
    }

    const transactionId = genererIdCourt();
    const dateExpiration = new Date(Date.now() + 10 * 60 * 1000);

    const client = await pool.connect();
    
    const result = await client.query(
      `INSERT INTO transactions (id, montant, boissons, statut, date_expiration)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [transactionId, parseFloat(montant), JSON.stringify(boissons), 'en_attente', dateExpiration]
    );

    client.release();

    const transaction = result.rows[0];
    const transactionFormatee = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: transaction.statut,
      date: transaction.date_creation,
      dateExpiration: transaction.date_expiration
    };

    console.log(`Nouvelle transaction: ${transactionId}, Montant: ${montant}FCFA`);

    res.json({
      success: true,
      data: transactionFormatee,
      message: 'Transaction créée avec succès'
    });

  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur création transaction' });
  }
});

// Payer transaction
app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Récupérer transaction
    const transactionResult = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [req.params.id]
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

    // Vérifier solde utilisateur
    const soldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );

    const soldeUtilisateur = parseFloat(soldeResult.rows[0].solde);

    if (soldeUtilisateur < transaction.montant) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Solde insuffisant' });
    }

    // Effectuer paiement
    await client.query(
      'UPDATE transactions SET statut = $1, utilisateur_id = $2, date_paiement = NOW() WHERE id = $3',
      ['paye', req.utilisateur.id, transaction.id]
    );

    await client.query(
      'UPDATE utilisateurs SET solde = solde - $1 WHERE id = $2',
      [transaction.montant, req.utilisateur.id]
    );

    await client.query('COMMIT');

    // Récupérer nouveau solde
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );

    const transactionMiseAJour = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: 'paye',
      datePaiement: new Date().toISOString()
    };

    res.json({
      success: true,
      data: transactionMiseAJour,
      nouveauSolde: parseFloat(nouveauSoldeResult.rows[0].solde),
      message: 'Paiement effectué avec succès'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', error);
    res.status(500).json({ success: false, error: 'Erreur lors du paiement' });
  } finally {
    client.release();
  }
});

// Recharger compte
app.post('/api/compte/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, methode } = req.body;

    if (!montant || montant <= 0 || !methode) {
      return res.status(400).json({ success: false, error: 'Données invalides' });
    }

    const client = await pool.connect();

    // Mettre à jour solde
    const result = await client.query(
      'UPDATE utilisateurs SET solde = solde + $1 WHERE id = $2 RETURNING solde',
      [parseFloat(montant), req.utilisateur.id]
    );

    // Enregistrer recharge
    await client.query(
      'INSERT INTO recharges (utilisateur_id, montant, methode) VALUES ($1, $2, $3)',
      [req.utilisateur.id, parseFloat(montant), methode]
    );

    client.release();

    const nouveauSolde = parseFloat(result.rows[0].solde);

    res.json({
      success: true,
      nouveauSolde: nouveauSolde,
      message: `Rechargement de ${montant}FCFA effectué via ${methode}`
    });

  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({ success: false, error: 'Erreur rechargement' });
  }
});

// Historique transactions
app.get('/api/historique/transactions', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();

    const result = await client.query(
      `SELECT id, montant, boissons, statut, date_creation, date_paiement 
       FROM transactions 
       WHERE utilisateur_id = $1 
       ORDER BY date_creation DESC 
       LIMIT 50`,
      [req.utilisateur.id]
    );

    client.release();

    const transactions = result.rows.map(t => ({
      id: t.id,
      montant: parseFloat(t.montant),
      boissons: t.boissons,
      statut: t.statut,
      date: t.date_creation,
      datePaiement: t.date_paiement
    }));

    res.json({
      success: true,
      data: transactions
    });

  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ success: false, error: 'Erreur récupération historique' });
  }
});

// Solde utilisateur
app.get('/api/compte/solde', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();

    const result = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );

    client.release();

    const solde = parseFloat(result.rows[0].solde);

    res.json({
      success: true,
      solde: solde
    });

  } catch (error) {
    console.error('Erreur solde:', error);
    res.status(500).json({ success: false, error: 'Erreur récupération solde' });
  }
});

// Informations transaction
app.get('/api/transaction/:id', async (req, res) => {
  try {
    const client = await pool.connect();

    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1',
      [req.params.id]
    );

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }

    const transaction = result.rows[0];

    // Vérifier expiration
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
      dateExpiration: transaction.date_expiration
    };

    res.json({
      success: true,
      data: transactionFormatee
    });

  } catch (error) {
    console.error('Erreur transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur récupération transaction' });
  }
});

// Nettoyage transactions expirées
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
}, 60000);

// Démarrage serveur
async function demarrerServeur() {
  try {
    await initialiserBDD();
    estConnecteBDD = await testerConnexionBDD();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur démarré sur le port ${PORT}`);
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`✅ PostgreSQL: ${estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
      console.log(`🔄 Maintenance active`);
    });
  } catch (error) {
    console.error('❌ Erreur démarrage:', error);
    process.exit(1);
  }
}

demarrerServeur();
