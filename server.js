const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool, initialiserBDD, bcrypt } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Middleware d'authentification
function authentifierToken(req, res, next) {
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
}

// Routes publiques
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ 
      status: 'OK', 
      message: 'API Distributeur Premium Fonctionnelle',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'BDD non disponible' });
  }
});

// Inscription utilisateur
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, nom, telephone, password } = req.body;

    if (!email || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Champs manquants' });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe déjà
    const existingUser = await client.query(
      'SELECT id FROM utilisateurs WHERE email = $1', 
      [email]
    );

    if (existingUser.rows.length > 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'Email déjà utilisé' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const result = await client.query(
      `INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, nom, telephone, solde`,
      [email, nom, telephone, hashedPassword, 0.00]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    client.release();

    res.json({
      success: true,
      message: 'Compte créé avec succès',
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        telephone: user.telephone,
        solde: user.solde
      }
    });

  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Connexion utilisateur
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
      return res.status(400).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      client.release();
      return res.status(400).json({ success: false, error: 'Mot de passe incorrect' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    client.release();

    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        telephone: user.telephone,
        solde: user.solde
      }
    });

  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Routes protégées
app.get('/api/profil', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, email, nom, telephone, solde FROM utilisateurs WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    client.release();
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Rechargement de compte
app.post('/api/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, methode } = req.body;

    if (!montant || montant <= 0) {
      return res.status(400).json({ success: false, error: 'Montant invalide' });
    }

    const client = await pool.connect();
    
    await client.query('BEGIN');

    // Mettre à jour le solde
    const result = await client.query(
      'UPDATE utilisateurs SET solde = solde + $1, updated_at = NOW() WHERE id = $2 RETURNING solde',
      [parseFloat(montant), req.user.userId]
    );

    // Enregistrer la transaction de rechargement
    const transactionId = 'RCH' + Date.now().toString().slice(-8);
    await client.query(
      `INSERT INTO transactions (id, utilisateur_id, montant, boissons, statut, methode_paiement) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [transactionId, req.user.userId, parseFloat(montant), [], 'paye', methode]
    );

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      message: `Rechargement de ${montant} FCFA réussi via ${methode}`,
      nouveauSolde: parseFloat(result.rows[0].solde)
    });

  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Créer une transaction
app.post('/api/transaction', authentifierToken, async (req, res) => {
  try {
    const { boissons } = req.body;
    const montant = boissons.reduce((sum, b) => sum + b.prix, 0);

    const transactionId = 'TX' + Date.now().toString().slice(-8);
    const dateExpiration = new Date(Date.now() + 10 * 60 * 1000);

    const client = await pool.connect();
    
    const result = await client.query(
      `INSERT INTO transactions (id, utilisateur_id, montant, boissons, statut, date_expiration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [transactionId, req.user.userId, montant, JSON.stringify(boissons), 'en_attente', dateExpiration]
    );

    client.release();

    const transaction = result.rows[0];
    const transactionFormatee = {
      id: transaction.id,
      montant: parseFloat(transaction.montant),
      boissons: transaction.boissons,
      statut: transaction.statut,
      dateExpiration: transaction.date_expiration
    };

    res.json({
      success: true,
      data: transactionFormatee
    });

  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Payer une transaction
app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Vérifier la transaction
    const transactionResult = await client.query(
      `SELECT t.*, u.solde as solde_utilisateur 
       FROM transactions t 
       JOIN utilisateurs u ON t.utilisateur_id = u.id 
       WHERE t.id = $1 AND t.utilisateur_id = $2 FOR UPDATE`,
      [req.params.id, req.user.userId]
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

    // Vérifier le solde
    if (parseFloat(transaction.solde_utilisateur) < parseFloat(transaction.montant)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Solde insuffisant' });
    }

    // Effectuer le paiement
    await client.query(
      'UPDATE transactions SET statut = $1, date_paiement = NOW() WHERE id = $2',
      ['paye', transaction.id]
    );

    await client.query(
      'UPDATE utilisateurs SET solde = solde - $1 WHERE id = $2',
      [transaction.montant, req.user.userId]
    );

    await client.query(
      `UPDATE distributeur 
       SET solde = solde + $1, total_transactions = total_transactions + 1 
       WHERE id = 'distributeur_principal'`,
      [transaction.montant]
    );

    // Récupérer le nouveau solde
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.user.userId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Paiement réussi',
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

// Historique des transactions
app.get('/api/historique', authentifierToken, async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      `SELECT id, montant, boissons, statut, methode_paiement, date_creation, date_paiement
       FROM transactions 
       WHERE utilisateur_id = $1 
       ORDER BY date_creation DESC 
       LIMIT 50`,
      [req.user.userId]
    );

    client.release();

    const transactions = result.rows.map(t => ({
      id: t.id,
      montant: parseFloat(t.montant),
      boissons: t.boissons,
      statut: t.statut,
      methodePaiement: t.methode_paiement,
      date: t.date_creation,
      datePaiement: t.date_paiement
    }));

    res.json({ success: true, transactions });

  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Démarrer le serveur
async function demarrerServeur() {
  try {
    await initialiserBDD();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur Premium démarré sur le port ${PORT}`);
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`✅ Système d'authentification activé`);
      console.log(`✅ Base de données PostgreSQL connectée`);
    });
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    process.exit(1);
  }
}

demarrerServeur();
