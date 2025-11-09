const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD, bcrypt } = require('./database');

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
    return res.status(401).json({ success: false, error: 'Token manquant' });
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

function genererIdCourt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TX';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes Authentification
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, nom, telephone, password } = req.body;
    
    if (!email || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Champs manquants' });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe déjà
    const existe = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'Email déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await client.query(
      `INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, nom, telephone, solde`,
      [email, nom, telephone, hashedPassword, 0.00]
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
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
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
      return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
    }
    
    const utilisateur = result.rows[0];
    const motDePasseValide = await bcrypt.compare(password, utilisateur.password);
    
    if (!motDePasseValide) {
      return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
    }
    
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
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
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
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

app.get('/api/boissons', async (req, res) => {
  const boissons = [
    {
      id: 1,
      nom: "Coca-Cola Original",
      prix: 500,
      image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 2,
      nom: "Pepsi Max",
      prix: 500,
      image: "https://images.unsplash.com/photo-1624555130581-1d9cca1a1a71?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 3,
      nom: "Fanta Orange",
      prix: 450,
      image: "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: true
    },
    {
      id: 4,
      nom: "Sprite Citron",
      prix: 450,
      image: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 5,
      nom: "Coca-Cola Zéro",
      prix: 500,
      image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 6,
      nom: "Monster Energy",
      prix: 800,
      image: "https://images.unsplash.com/photo-1628771065518-0d82f1938462?w=400&h=400&fit=crop",
      categorie: "Energy",
      taille: "50cl",
      promotion: false
    },
    {
      id: 7,
      nom: "Eau Minérale",
      prix: 300,
      image: "https://images.unsplash.com/photo-1544003484-3cd181d179c1?w=400&h=400&fit=crop",
      categorie: "Eau",
      taille: "50cl",
      promotion: true
    },
    {
      id: 8,
      nom: "Jus d'Orange",
      prix: 700,
      image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400&h=400&fit=crop",
      categorie: "Jus",
      taille: "50cl",
      promotion: false
    }
  ];
  
  res.json({ success: true, data: boissons });
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
    
    const transaction = result.rows[0];
    
    res.json({
      success: true,
      data: {
        id: transaction.id,
        montant: parseFloat(transaction.montant),
        boissons: transaction.boissons,
        statut: transaction.statut,
        date: transaction.date_creation,
        dateExpiration: transaction.date_expiration
      }
    });
  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
  }
});

app.post('/api/transaction/:id/payer', authentifierToken, async (req, res) => {
  const client = await pool.connect();
  const { methode } = req.body;
  
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
      ['paye', methode, transaction.id]
    );
    
    await client.query(
      'UPDATE utilisateurs SET solde = solde - $1 WHERE id = $2',
      [transaction.montant, req.utilisateur.id]
    );
    
    await client.query(
      'UPDATE distributeur SET solde = solde + $1 WHERE id = $2',
      [transaction.montant, 'distributeur_principal']
    );
    
    await client.query('COMMIT');
    
    // Récupérer le nouveau solde
    const nouveauSoldeResult = await client.query(
      'SELECT solde FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );
    
    res.json({
      success: true,
      data: {
        id: transaction.id,
        montant: parseFloat(transaction.montant),
        statut: 'paye',
        datePaiement: new Date().toISOString(),
        methodePaiement: methode
      },
      nouveauSolde: parseFloat(nouveauSoldeResult.rows[0].solde),
      message: 'Paiement réussi! Votre commande sera prête dans 4 secondes.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', error);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
  } finally {
    client.release();
  }
});

app.post('/api/recharger', authentifierToken, async (req, res) => {
  try {
    const { montant, methode } = req.body;
    const utilisateurId = req.utilisateur.id;
    
    if (!montant || montant <= 0 || !methode) {
      return res.status(400).json({ success: false, error: 'Données invalides' });
    }
    
    const client = await pool.connect();
    
    const result = await client.query(
      'UPDATE utilisateurs SET solde = solde + $1 WHERE id = $2 RETURNING solde',
      [parseFloat(montant), utilisateurId]
    );
    
    // Enregistrer la recharge
    await client.query(
      'INSERT INTO transactions (id, utilisateur_id, montant, boissons, statut, methode_paiement) VALUES ($1, $2, $3, $4, $5, $6)',
      [genererIdCourt(), utilisateurId, parseFloat(montant), JSON.stringify([]), 'recharge', methode]
    );
    
    client.release();
    
    res.json({
      success: true,
      nouveauSolde: parseFloat(result.rows[0].solde),
      message: `Rechargement de ${montant}FCFA effectué avec succès via ${methode}`
    });
  } catch (error) {
    console.error('Erreur rechargement:', error);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
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
    
    const historique = result.rows.map(row => ({
      id: row.id,
      montant: parseFloat(row.montant),
      boissons: row.boissons,
      statut: row.statut,
      methodePaiement: row.methode_paiement,
      date: row.date_creation,
      datePaiement: row.date_paiement
    }));
    
    res.json({ success: true, data: historique });
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
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
    
    const utilisateur = result.rows[0];
    
    res.json({
      success: true,
      data: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        telephone: utilisateur.telephone,
        solde: parseFloat(utilisateur.solde),
        dateCreation: utilisateur.date_creation
      }
    });
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
  }
});

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

async function demarrerServeur() {
  try {
    await initialiserBDD();
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
